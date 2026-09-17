// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IStrandedRegistry} from "./interfaces/IStrandedRegistry.sol";
import {IGasRescueSwapProof} from "./interfaces/IGasRescueSwapProof.sol";

/// @title StrandedRegistry
/// @notice Phase-2 thin registry: permissionless *index* of known stranded ERC-20
///         balances on Gas Rescue's supported chains (Arb Sepolia + Base Sepolia).
///         Anyone can register a find (bond + optional native-wei bounty). Claims
///         are proof-gated: only the GasRescueSwap relayer that completed a matching
///         rescue (holder + token + amountIn) can claim, and only that find's
///         bond is released. Withdrawals cannot spend bonds locked to open finds.
///         No custody of user funds. No token. Testnet only.
///         Non-production scaffold — do not deploy to mainnet.
/// @dev This is the "search market" layer. v1 rescues tokens the owner can't reach;
///      this lets the owner *advertise* the stranded balance and pay a bounty to
///      the relayer that brings it home. Same dog, bigger yard.
contract StrandedRegistry is IStrandedRegistry, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    /// @dev EIP-712 typehash for the Find struct (registration + claim binding).
    bytes32 public constant FIND_TYPEHASH = keccak256(
        "Find(address poster,address holder,address token,uint256 amount,uint256 bounty,uint256 chainId,uint256 deadline,uint256 nonce)"
    );

    /// @dev Default finder's fee: 5% of rescued *token* value, capped at 10%.
    ///      Emitted on claim for off-chain settlement only — never paid as wei.
    uint256 public constant DEFAULT_FINDER_FEE_BPS = 500; // 5%
    uint256 public constant MAX_FINDER_FEE_BPS = 1_000; // 10%
    /// @dev Minimum posting bond to deter spam (refundable on valid claim or expiry).
    uint256 public constant MIN_BOND = 0.001 ether;

    address public immutable gasRescueSwap;

    uint256 public finderFeeBps = DEFAULT_FINDER_FEE_BPS;
    uint256 public minBond = MIN_BOND;

    mapping(bytes32 findKey => Find) private _finds;
    mapping(bytes32 findKey => bool) public claimed;
    /// @dev Native bond locked to a single find at `registerFind`. Claim/reclaim
    ///      releases only this amount, never the poster's entire `posterBond`.
    mapping(bytes32 findKey => uint256) public findBond;
    /// @dev Total native credited to a poster (deposits + find bonds + receive).
    mapping(address poster => uint256) public posterBond;
    /// @dev Sum of this poster's still-locked `findBond`s. Invariant:
    ///      `lockedBond[p] <= posterBond[p]`. Withdrawable = difference.
    mapping(address poster => uint256) public lockedBond;
    /// @dev One GasRescueSwap receipt (holder, nonce) can settle at most one find.
    mapping(address holder => mapping(uint256 nonce => bool)) public usedRescueProof;
    mapping(address => uint256) public posterNonce;

    event FindRegistered(
        bytes32 indexed findKey,
        address indexed poster,
        address indexed holder,
        address token,
        uint256 amount,
        uint256 bounty,
        uint256 chainId
    );
    event FindClaimed(
        bytes32 indexed findKey,
        address indexed rescuer,
        address indexed holder,
        uint256 finderFee,
        uint256 bountyPaid
    );
    event FindReclaimed(bytes32 indexed findKey, address indexed poster, uint256 amount);
    event BondDeposited(address indexed poster, uint256 amount);
    event BondRefunded(address indexed poster, uint256 amount);
    event FinderFeeUpdated(uint256 bps);
    event MinBondUpdated(uint256 amount);

    error NotAllowedTestnet();
    error ChainIdMismatch();
    error ZeroAddress();
    error InvalidFind();
    error FindNotFound();
    error AlreadyClaimed();
    error BondTooLow();
    error InsufficientBond();
    error BondLocked();
    error BountyTooHigh();
    error NotHolder();
    error NotPoster();
    error NotRelayer();
    error InvalidRescueProof();
    error RescueProofAlreadyUsed();
    error ExpiredDeadline();
    error FindNotExpired();
    error InvalidSignature();
    error TransferFailed();

    constructor(address initialOwner, address gasRescueSwap_) Ownable(initialOwner) EIP712("StrandedRegistry", "1") {
        if (initialOwner == address(0) || gasRescueSwap_ == address(0)) revert ZeroAddress();
        gasRescueSwap = gasRescueSwap_;
    }

    /// @inheritdoc IStrandedRegistry
    function finds(bytes32 findKey) external view returns (Find memory) {
        return _finds[findKey];
    }

    /// @inheritdoc IStrandedRegistry
    function availableBond(address poster) public view returns (uint256) {
        return posterBond[poster] - lockedBond[poster];
    }

    /// @notice Credit unexpected native to `msg.sender`'s unused poster bond.
    ///         No ETH is accepted without an accounting credit (M-3).
    /// @dev Not `nonReentrant`: a credit-only hook must not brick refunds if a
    ///      recipient forwards value back here during `claimFind` / `withdrawBond`.
    receive() external payable {
        if (msg.value == 0) return;
        posterBond[msg.sender] += msg.value;
        emit BondDeposited(msg.sender, msg.value);
    }

    function renounceOwnership() public pure override {
        revert("OwnershipCannotBeRenounced");
    }

    /// @notice Deposit unused bond. Withdrawable until locked by `registerFind`.
    function depositBond() external payable nonReentrant {
        if (msg.value < minBond) revert BondTooLow();
        posterBond[msg.sender] += msg.value;
        emit BondDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw unused (unlocked) bond. Active `findBond` locks are excluded (H-1).
    function withdrawBond(uint256 amount) external nonReentrant {
        uint256 available = availableBond(msg.sender);
        if (amount > available) {
            if (amount > posterBond[msg.sender]) revert InsufficientBond();
            revert BondLocked();
        }
        posterBond[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BondRefunded(msg.sender, amount);
    }

    /// @notice Permissionless: anyone can register a known stranded balance.
    ///         Requires a bond; optional bounty is native wei paid from that bond.
    ///         findKey = keccak256(poster, holder, token, chainId, nonce) — first writer wins.
    function registerFind(
        address holder,
        address token,
        uint256 amount,
        uint256 bounty,
        uint256 chainId,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (bytes32 findKey) {
        if (!_isAllowedTestnet(chainId)) revert NotAllowedTestnet();
        if (chainId != block.chainid) revert ChainIdMismatch();
        if (holder == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidFind();
        // H-2: bounty is native wei, funded by this find's bond — never token units.
        if (bounty > msg.value) revert BountyTooHigh();
        if (msg.value < minBond) revert BondTooLow();
        if (block.timestamp > deadline) revert ExpiredDeadline();

        uint256 nonce = posterNonce[msg.sender]++;
        findKey = keccak256(abi.encode(msg.sender, holder, token, chainId, nonce));
        if (_finds[findKey].registeredAt != 0) revert InvalidFind(); // collision (should not happen)

        posterBond[msg.sender] += msg.value;
        lockedBond[msg.sender] += msg.value;
        findBond[findKey] = msg.value;

        _finds[findKey] = Find({
            poster: msg.sender,
            holder: holder,
            token: token,
            amount: amount,
            bounty: bounty,
            chainId: chainId,
            deadline: deadline,
            nonce: nonce,
            registeredAt: block.timestamp
        });

        emit FindRegistered(findKey, msg.sender, holder, token, amount, bounty, chainId);
        emit BondDeposited(msg.sender, msg.value);
    }

    /// @notice Relayer claims a find after a completed GasRescueSwap rescue.
    ///         Bounty (if any) and the leftover find bond are paid from *this*
    ///         find's `findBond` only — other finds and unused `posterBond` stay.
    /// @param findKey Registry key from `registerFind`.
    /// @param rescueNonce `Order.nonce` consumed by the matching rescue.
    /// @dev Proof gate:
    ///      1. `msg.sender` must be a GasRescueSwap allowlisted relayer.
    ///      2. `gasRescueSwap.rescueReceipt(holder, rescueNonce)` must exist and
    ///         match this find's `token` + `amount`, and `relayer == msg.sender`.
    ///      3. That receipt can settle at most one find (`usedRescueProof`).
    ///      4. `find.chainId == block.chainid` (L-4).
    ///      Bounty is paid to `msg.sender` (the executing relayer). Callers cannot
    ///      choose a different rescuer. Rescue itself stays a separate tx so this
    ///      contract remains thin.
    function claimFind(bytes32 findKey, uint256 rescueNonce) external nonReentrant whenNotPaused {
        Find storage f = _finds[findKey];
        if (f.registeredAt == 0) revert FindNotFound();
        if (claimed[findKey]) revert AlreadyClaimed();
        if (f.chainId != block.chainid) revert ChainIdMismatch();
        if (block.timestamp > f.deadline) revert ExpiredDeadline();

        IGasRescueSwapProof swap = IGasRescueSwapProof(gasRescueSwap);
        if (!swap.relayers(msg.sender)) revert NotRelayer();

        (address tokenIn, uint256 amountIn, address receiptRelayer) = swap.rescueReceipt(f.holder, rescueNonce);
        if (receiptRelayer == address(0) || receiptRelayer != msg.sender) revert InvalidRescueProof();
        if (tokenIn != f.token || amountIn != f.amount) revert InvalidRescueProof();
        if (usedRescueProof[f.holder][rescueNonce]) revert RescueProofAlreadyUsed();

        usedRescueProof[f.holder][rescueNonce] = true;
        claimed[findKey] = true;

        address rescuer = msg.sender;
        uint256 bond = findBond[findKey];
        findBond[findKey] = 0;
        if (f.bounty > bond) revert InsufficientBond();
        _releaseLockedBond(f.poster, bond);

        // Finder fee: token-unit record for off-chain settlement. Not transferred.
        uint256 finderFee = (f.amount * finderFeeBps) / 10_000;
        uint256 bountyPaid = f.bounty;
        uint256 refund = bond - bountyPaid;

        if (bountyPaid > 0) {
            (bool ok,) = payable(rescuer).call{value: bountyPaid}("");
            if (!ok) revert TransferFailed();
        }
        if (refund > 0) {
            (bool ok2,) = payable(f.poster).call{value: refund}("");
            if (!ok2) revert TransferFailed();
            emit BondRefunded(f.poster, refund);
        }

        emit FindClaimed(findKey, rescuer, f.holder, finderFee, bountyPaid);
    }

    /// @notice Poster reclaims an unclaimed find's bond after `deadline` (M-4).
    ///         Marks the find claimed so a late receipt cannot still pay out.
    function reclaimExpired(bytes32 findKey) external nonReentrant {
        Find storage f = _finds[findKey];
        if (f.registeredAt == 0) revert FindNotFound();
        if (msg.sender != f.poster) revert NotPoster();
        if (claimed[findKey]) revert AlreadyClaimed();
        if (f.chainId != block.chainid) revert ChainIdMismatch();
        if (block.timestamp <= f.deadline) revert FindNotExpired();

        uint256 bond = findBond[findKey];
        findBond[findKey] = 0;
        claimed[findKey] = true;
        _releaseLockedBond(f.poster, bond);

        if (bond > 0) {
            (bool ok,) = payable(f.poster).call{value: bond}("");
            if (!ok) revert TransferFailed();
            emit BondRefunded(f.poster, bond);
        }
        emit FindReclaimed(findKey, f.poster, bond);
    }

    function setFinderFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FINDER_FEE_BPS) revert InvalidFind();
        finderFeeBps = bps;
        emit FinderFeeUpdated(bps);
    }

    function setMinBond(uint256 amount) external onlyOwner {
        minBond = amount;
        emit MinBondUpdated(amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _isAllowedTestnet(uint256 chainId) internal pure returns (bool) {
        return chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID;
    }

    /// @dev Drop a find's lock from both `lockedBond` and `posterBond`.
    function _releaseLockedBond(address poster, uint256 bond) internal {
        if (lockedBond[poster] < bond || posterBond[poster] < bond) revert InsufficientBond();
        lockedBond[poster] -= bond;
        posterBond[poster] -= bond;
    }

    /// @notice Hash a Find for off-chain signing (optional attestation).
    function hashFind(Find calldata f) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(_encodeFind(f)));
    }

    function _encodeFind(Find calldata f) internal pure returns (bytes memory) {
        return abi.encode(
            FIND_TYPEHASH,
            f.poster,
            f.holder,
            f.token,
            f.amount,
            f.bounty,
            f.chainId,
            f.deadline,
            f.nonce
        );
    }
}
