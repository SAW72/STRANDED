// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IGasRescue} from "./interfaces/IGasRescue.sol";

/// @title GasRescue
/// @notice Base Sepolia thin-slice: destination-only rescue when a user holds ERC-20
///         but has zero native ETH to pay gas. Not a bridge, not a mainnet product,
///         not an ETH top-up fee model.
///
/// Security properties required by the locked design / prior auditor rejects:
/// - Relayer allowlist + pause / onlyOwner
/// - `nonReentrant`
/// - Order nonce marked used *before* signature recovery and any external call
/// - EIP-2612 permit parameters derived from the Order (token, amount, deadline, user)
/// - Fee-on-transfer handled by measuring this contract's balance delta
/// - Fail closed
contract GasRescue is IGasRescue, Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @dev Base Sepolia. Enforced on every rescue so this deployment cannot be
    ///      replayed or reused as a multi-chain / mainnet product.
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address user,address token,uint256 amount,uint256 fee,address recipient,uint256 deadline,uint256 nonce)"
    );

    mapping(address relayer => bool allowed) public relayers;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;

    event RelayerUpdated(address indexed relayer, bool allowed);
    event Rescued(
        address indexed user,
        address indexed token,
        address indexed recipient,
        address relayer,
        uint256 received,
        uint256 fee,
        uint256 nonce
    );

    error NotRelayer();
    error WrongChain();
    error ZeroAddress();
    error InvalidOrder();
    error ExpiredDeadline();
    error UsedNonce();
    error InvalidSignature();
    error InsufficientReceived();

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    constructor(address initialOwner, address initialRelayer) Ownable(initialOwner) EIP712("GasRescue", "1") {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (initialRelayer != address(0)) {
            relayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice EIP-712 domain separator for off-chain Order signing.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Digest a relayer (or wallet) should have `order.user` sign.
    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(_orderStructHash(order));
    }

    /// @inheritdoc IGasRescue
    function rescueWithPermit(Order calldata order, bytes calldata orderSignature, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        whenNotPaused
        onlyRelayer
    {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain();
        _validateOrder(order);

        // Auditor requirement: consume nonce before signature recovery and before
        // any external call (permit / transferFrom). Revert undoes the write if
        // the signature is later found invalid — a successful reentrant call cannot
        // reuse this nonce.
        if (usedNonces[order.user][order.nonce]) revert UsedNonce();
        usedNonces[order.user][order.nonce] = true;

        _verifyOrderSignature(order, orderSignature);

        uint256 received = _pullAndSettle(order, v, r, s);
        emit Rescued(order.user, order.token, order.recipient, msg.sender, received, order.fee, order.nonce);
    }

    /// @dev Permit + pull + fee skim. Isolated so the outer frame can emit without
    ///      blowing the Solidity stack (calldata Order + many locals).
    function _pullAndSettle(Order calldata order, uint8 v, bytes32 r, bytes32 s) internal returns (uint256 received) {
        // Permit is bound to this Order: owner/token/amount/deadline come from it.
        // Fee, recipient, and the GasRescue nonce are bound by the Order signature.
        IERC20Permit(order.token).permit(order.user, address(this), order.amount, order.deadline, v, r, s);

        IERC20 token = IERC20(order.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(order.user, address(this), order.amount);
        received = token.balanceOf(address(this)) - balanceBefore;
        if (received <= order.fee) revert InsufficientReceived();

        token.safeTransfer(msg.sender, order.fee);
        token.safeTransfer(order.recipient, received - order.fee);
    }

    function _validateOrder(Order calldata order) internal view {
        if (order.user == address(0) || order.token == address(0) || order.recipient == address(0)) {
            revert ZeroAddress();
        }
        if (order.amount == 0 || order.fee >= order.amount) revert InvalidOrder();
        if (block.timestamp > order.deadline) revert ExpiredDeadline();
    }

    function _verifyOrderSignature(Order calldata order, bytes calldata orderSignature) internal view {
        address signer = ECDSA.recover(hashOrder(order), orderSignature);
        if (signer != order.user) revert InvalidSignature();
    }

    function _orderStructHash(Order calldata order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.user,
                order.token,
                order.amount,
                order.fee,
                order.recipient,
                order.deadline,
                order.nonce
            )
        );
    }
}
