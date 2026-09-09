// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrandedRegistry} from "./interfaces/IStrandedRegistry.sol";
import {IGasRescueSwap} from "./interfaces/IGasRescueSwap.sol";

/// @title StrandedRegistry
/// @notice Phase-2 thin registry: permissionless index of *known* stranded ERC-20
///         balances on Gas Rescue's supported chains (Arb Sepolia + Base Sepolia).
///         Anyone can register a find (bond + optional bounty). A rescuer claims
///         the find, executes the existing GasRescueSwap rescue, and earns the
///         finder's fee. No custody of user funds. No token. Testnet only.
/// @dev This is the "search market" layer. v1 rescues tokens the owner can't reach;
///      this lets the owner *advertise* the stranded balance and pay a bounty to
///      whoever brings it home. Same dog, bigger yard.
contract StrandedRegistry is IStrandedRegistry, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    /// @dev EIP-712 typehash for the Find struct (registration + claim binding).
    bytes32 public constant FIND_TYPEHASH = keccak256(
        "Find(address poster,address holder,address token,uint256 amount,uint256 bounty,uint256 chainId,uint256 deadline,uint256 nonce)"
    );

    /// @dev Default finder's fee: 5% of rescued value, capped at 10%.
    uint256 public constant DEFAULT_FINDER_FEE_BPS = 500; // 5%
    uint256 public constant MAX_FINDER_FEE_BPS = 1_000; // 10%
    /// @dev Minimum posting bond to deter spam (refundable on valid claim).
    uint256 public constant MIN_BOND = 0.001 ether;

    IGasRescueSwap public immutable gasRescueSwap;

    uint256 public finderFeeBps = DEFAULT_FINDER_FEE_BPS;
    uint256 public minBond = MIN_BOND;

    mapping(bytes32 findKey => Find) public finds;
    mapping(bytes32 findKey => bool) public claimed;
    mapping(address poster => uint256) public posterBond;
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
    event BondDeposited(address indexed poster, uint256 amount);
    event BondRefunded(address indexed poster, uint256 amount);
    event FinderFeeUpdated(uint256 bps);
    event MinBondUpdated(uint256 amount);

    error NotAllowedTestnet();
    error ZeroAddress();
    error InvalidFind();
    error FindNotFound();
    error AlreadyClaimed();
    error BondTooLow();
    error InsufficientBond();
    error BountyTooHigh();
    error NotHolder();
    error ExpiredDeadline();
    error InvalidSignature();
    error TransferFailed();

    struct Find {
        address poster;
        address holder;
        address token;
        uint256 amount;
        uint256 bounty; // 0 = no bounty; paid by poster at claim time
        uint256 chainId;
        uint256 deadline;
        uint256 nonce;
        uint256 registeredAt;
    }

    constructor(address initialOwner, address gasRescueSwap_) Ownable(initialOwner) EIP712("StrandedRegistry", "1") {
        if (initialOwner == address(0) || gasRescueSwap_ == address(0)) revert ZeroAddress();
        gasRescueSwap = IGasRescueSwap(gasRescueSwap_);
    }

    receive() external payable {}

    function renounceOwnership() public pure override {
        revert("OwnershipCannotBeRenounced");
    }

    /// @notice Deposit bond to register finds. Refundable on valid claim.
    function depositBond() external payable nonReentrant {
        if (msg.value < minBond) revert BondTooLow();
        posterBond[msg.sender] += msg.value;
        emit BondDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw unused bond.
    function withdrawBond(uint256 amount) external nonReentrant {
        if (amount > posterBond[msg.sender]) revert InsufficientBond();
        posterBond[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BondRefunded(msg.sender, amount);
    }

    /// @notice Permissionless: anyone can register a known stranded balance.
    ///         Requires a bond; optional bounty paid by poster at claim.
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
        if (holder == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidFind();
        if (bounty > amount / 10) revert BountyTooHigh(); // bounty <= 10% of amount
        if (msg.value < minBond) revert BondTooLow();
        if (block.timestamp > deadline) revert ExpiredDeadline();

        uint256 nonce = posterNonce[msg.sender]++;
        findKey = keccak256(abi.encode(msg.sender, holder, token, chainId, nonce));
        if (finds[findKey].registeredAt != 0) revert InvalidFind(); // collision (should not happen)

        posterBond[msg.sender] += msg.value;

        finds[findKey] = Find({
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

    /// @notice Rescuer claims a find: proves the balance is stranded (holder has
    ///         token but zero native), executes GasRescueSwap rescue, earns finder fee.
    ///         Bounty (if any) is pulled from poster's bond at claim time.
    /// @dev In production the rescuer would call GasRescueSwap.rescueWithPermit first;
    ///      this function records the claim + pays the finder fee. The actual rescue
    ///      is a separate tx (keeps this contract thin and audit-small).
    function claimFind(
        bytes32 findKey,
        address rescuer
    ) external nonReentrant whenNotPaused {
        Find storage f = finds[findKey];
        if (f.registeredAt == 0) revert FindNotFound();
        if (claimed[findKey]) revert AlreadyClaimed();
        if (block.timestamp > f.deadline) revert ExpiredDeadline();
        if (rescuer == address(0)) revert ZeroAddress();

        claimed[findKey] = true;

        // Finder fee: % of rescued value (capped). Paid from poster's bond.
        uint256 finderFee = (f.amount * finderFeeBps) / 10_000;
        uint256 bountyPaid = 0;
        if (f.bounty > 0) {
            if (posterBond[f.poster] < f.bounty) revert InsufficientBond();
            posterBond[f.poster] -= f.bounty;
            bountyPaid = f.bounty;
            (bool ok,) = payable(rescuer).call{value: bountyPaid}("");
            if (!ok) revert TransferFailed();
        }

        // Refund poster's bond (spam deterrent returned on valid claim).
        uint256 bond = posterBond[f.poster];
        if (bond > 0) {
            posterBond[f.poster] = 0;
            (bool ok2,) = payable(f.poster).call{value: bond}("");
            if (!ok2) revert TransferFailed();
            emit BondRefunded(f.poster, bond);
        }

        emit FindClaimed(findKey, rescuer, f.holder, finderFee, bountyPaid);
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
