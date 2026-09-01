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
/// @notice Base Sepolia thin-slice: destination-only rescue when a user holds an
///         allowlisted EIP-2612 ERC-20 but has zero native ETH for gas.
///         Fee is routed to `order.feeTo`; remainder always returns to `order.user`.
contract GasRescue is IGasRescue, Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address user,address token,uint256 amount,uint256 feeAmount,address feeTo,uint256 deadline,uint256 nonce)"
    );

    mapping(address relayer => bool allowed) public relayers;
    mapping(address token => bool allowed) public allowedTokens;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;

    event RelayerUpdated(address indexed relayer, bool allowed);
    event TokenAllowed(address indexed token, bool allowed);
    event Rescued(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 feeAmount,
        address indexed feeTo,
        uint256 nonce,
        address relayer
    );

    error NotRelayer();
    error WrongChain();
    error ZeroAddress();
    error InvalidOrder();
    error ExpiredDeadline();
    error TokenNotAllowed();
    error UsedNonce();
    error InvalidSignature();
    error Underfunded();
    error FoTOrBalanceMismatch();

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

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.user,
                    order.token,
                    order.amount,
                    order.feeAmount,
                    order.feeTo,
                    order.deadline,
                    order.nonce
                )
            )
        );
    }

    /// @dev Sequence is fixed: view-only checks (including unused nonce) → EIP-712
    ///      recover → underfunded check (still no nonce write) → then mark nonce used
    ///      → permit → transferFrom → exact balance delta → pay feeTo / user.
    function rescueWithPermit(Order calldata order, bytes calldata orderSignature, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        whenNotPaused
        onlyRelayer
    {
        _checkOrder(order);

        address signer = ECDSA.recover(hashOrder(order), orderSignature);
        if (signer != order.user) revert InvalidSignature();

        if (IERC20(order.token).balanceOf(order.user) < order.amount) revert Underfunded();

        usedNonces[order.user][order.nonce] = true;

        IERC20Permit(order.token).permit(order.user, address(this), order.amount, order.deadline, v, r, s);
        _pullAndSettle(order);

        emit Rescued(order.user, order.token, order.amount, order.feeAmount, order.feeTo, order.nonce, msg.sender);
    }

    function _checkOrder(Order calldata order) internal view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain();
        if (order.user == address(0) || order.token == address(0) || order.feeTo == address(0)) {
            revert ZeroAddress();
        }
        if (order.amount == 0 || order.feeAmount >= order.amount) revert InvalidOrder();
        if (block.timestamp > order.deadline) revert ExpiredDeadline();
        if (!allowedTokens[order.token]) revert TokenNotAllowed();
        if (usedNonces[order.user][order.nonce]) revert UsedNonce();
    }

    function _pullAndSettle(Order calldata order) internal {
        IERC20 token = IERC20(order.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(order.user, address(this), order.amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != order.amount) revert FoTOrBalanceMismatch();

        token.safeTransfer(order.feeTo, order.feeAmount);
        token.safeTransfer(order.user, order.amount - order.feeAmount);
    }
}
