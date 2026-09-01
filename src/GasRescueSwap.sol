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

import {IGasRescueSwap} from "./interfaces/IGasRescueSwap.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/// @title GasRescueSwap
/// @notice Scout #1 product: swap a slice of stranded `tokenIn` for native gas and
///         same-chain move-out of the remainder to `to`. Non-proxy. Testnet only.
///         Never treats `msg.sender` as a user/fee/native/remainder substitute.
contract GasRescueSwap is IGasRescueSwap, Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)"
    );

    IWETH public immutable weth;
    IPermit2 public permit2;
    bool public permit2Enabled;

    mapping(address relayer => bool allowed) public relayers;
    mapping(address token => bool allowed) public allowedTokens;
    mapping(address token => bool allowed) public eip2612Tokens;
    mapping(address router => bool allowed) public allowedRouters;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;

    event RelayerUpdated(address indexed relayer, bool allowed);
    event TokenAllowed(address indexed token, bool allowed);
    event Eip2612TokenAllowed(address indexed token, bool allowed);
    event RouterAllowed(address indexed router, bool allowed);
    event Permit2Updated(address indexed permit2, bool enabled);
    event Rescued(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 feeAmount,
        uint256 amountSwap,
        uint256 nativeOut,
        address indexed nativeTo,
        address to,
        uint256 nonce,
        address relayer
    );

    error NotRelayer();
    error OwnerIsRelayer();
    error WrongChain();
    error ZeroAddress();
    error InvalidOrder();
    error ExpiredDeadline();
    error TokenNotAllowed();
    error RouterNotAllowed();
    error UsedNonce();
    error InvalidSignature();
    error Underfunded();
    error FoTOrBalanceMismatch();
    error PathMismatch();
    error NoGaslessAuth();
    error Slippage();
    error SwapFailed();
    error NativeTransferFailed();

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        if (msg.sender == owner()) revert OwnerIsRelayer();
        _;
    }

    constructor(
        address initialOwner,
        address initialRelayer,
        address weth_
    ) Ownable(initialOwner) EIP712("StewardGasRescue", "1") {
        if (initialOwner == address(0) || weth_ == address(0)) revert ZeroAddress();
        if (initialRelayer == initialOwner) revert OwnerIsRelayer();
        weth = IWETH(weth_);
        if (initialRelayer != address(0)) {
            relayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    receive() external payable {}

    function setRelayer(
        address relayer,
        bool allowed
    ) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        if (allowed && relayer == owner()) revert OwnerIsRelayer();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function setTokenAllowed(
        address token,
        bool allowed
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedTokens[token] = allowed;
        if (!allowed) {
            eip2612Tokens[token] = false;
            emit Eip2612TokenAllowed(token, false);
        }
        emit TokenAllowed(token, allowed);
    }

    function setEip2612Token(
        address token,
        bool allowed
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        eip2612Tokens[token] = allowed;
        if (allowed) {
            allowedTokens[token] = true;
            emit TokenAllowed(token, true);
        }
        emit Eip2612TokenAllowed(token, allowed);
    }

    function setRouterAllowed(
        address router,
        bool allowed
    ) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        allowedRouters[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    function setPermit2(
        address permit2_,
        bool enabled
    ) external onlyOwner {
        if (enabled && permit2_ == address(0)) revert ZeroAddress();
        permit2 = IPermit2(permit2_);
        permit2Enabled = enabled;
        emit Permit2Updated(permit2_, enabled);
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

    function hashOrder(
        Order calldata order
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(_encodeOrder(order)));
    }

    function _encodeOrder(
        Order calldata order
    ) internal pure returns (bytes memory) {
        return abi.encode(
            ORDER_TYPEHASH,
            order.user,
            order.tokenIn,
            order.amountIn,
            order.feeAmount,
            order.feeTo,
            order.amountSwap,
            order.minAmountOut,
            order.to,
            order.nativeTo,
            order.router,
            order.pathHash,
            order.chainId,
            order.deadline,
            order.nonce
        );
    }

    /// @dev Sequence is fixed: view-only checks + EIP-712 recover + funding/slippage
    ///      preflight (no nonce write) → consume nonce → permit → pull → feeTo skim →
    ///      remainder ERC-20 to `to` → allowlisted router (`pathHash`) → unwrap →
    ///      native to `nativeTo` ≥ `minAmountOut` (fail closed). Atomic; no partial fills.
    function rescueWithPermit(
        Order calldata order,
        bytes calldata orderSignature,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata swapData
    ) external nonReentrant whenNotPaused onlyRelayer {
        _preflight(order, orderSignature, swapData);
        if (!eip2612Tokens[order.tokenIn]) revert NoGaslessAuth();
        _consumeNonce(order);

        IERC20Permit(order.tokenIn).permit(order.user, address(this), order.amountIn, order.deadline, v, r, s);
        uint256 nativeOut = _pullSwapAndSettle(order, swapData);
        _emitRescued(order, nativeOut);
    }

    function rescueWithPermit2(
        Order calldata order,
        bytes calldata orderSignature,
        uint256 permit2Nonce,
        bytes calldata permit2Signature,
        bytes calldata swapData
    ) external nonReentrant whenNotPaused onlyRelayer {
        _preflight(order, orderSignature, swapData);
        if (!permit2Enabled || address(permit2) == address(0)) revert NoGaslessAuth();
        _consumeNonce(order);

        IERC20 token = IERC20(order.tokenIn);
        uint256 balanceBefore = token.balanceOf(address(this));
        permit2.permitTransferFrom(
            IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({token: order.tokenIn, amount: order.amountIn}),
                nonce: permit2Nonce,
                deadline: order.deadline
            }),
            IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: order.amountIn}),
            order.user,
            permit2Signature
        );
        if (token.balanceOf(address(this)) - balanceBefore != order.amountIn) revert FoTOrBalanceMismatch();

        uint256 nativeOut = _settleAndSwap(order, swapData);
        _emitRescued(order, nativeOut);
    }

    function _preflight(
        Order calldata order,
        bytes calldata orderSignature,
        bytes calldata swapData
    ) internal view {
        _checkOrder(order);
        if (swapData.length == 0 || keccak256(swapData) != order.pathHash) revert PathMismatch();

        address signer = ECDSA.recover(hashOrder(order), orderSignature);
        if (signer != order.user) revert InvalidSignature();

        if (IERC20(order.tokenIn).balanceOf(order.user) < order.amountIn) revert Underfunded();
    }

    function _consumeNonce(
        Order calldata order
    ) internal {
        usedNonces[order.user][order.nonce] = true;
    }

    function _checkOrder(
        Order calldata order
    ) internal view {
        if (!_isAllowedTestnet(block.chainid) || order.chainId != block.chainid) revert WrongChain();
        if (
            order.user == address(0) || order.tokenIn == address(0) || order.feeTo == address(0)
                || order.to == address(0) || order.nativeTo == address(0) || order.router == address(0)
        ) {
            revert ZeroAddress();
        }
        if (order.feeTo == address(this) || order.to == address(this) || order.nativeTo == address(this)) {
            revert InvalidOrder();
        }
        if (order.amountIn == 0 || order.amountSwap == 0 || order.minAmountOut == 0) revert InvalidOrder();
        // overflow-safe: amountSwap + feeAmount <= amountIn
        if (order.amountSwap > order.amountIn || order.feeAmount > order.amountIn - order.amountSwap) {
            revert InvalidOrder();
        }
        if (block.timestamp > order.deadline) revert ExpiredDeadline();
        if (!allowedTokens[order.tokenIn]) revert TokenNotAllowed();
        if (!allowedRouters[order.router]) revert RouterNotAllowed();
        if (usedNonces[order.user][order.nonce]) revert UsedNonce();
    }

    function _isAllowedTestnet(
        uint256 chainId
    ) internal pure returns (bool) {
        return chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID;
    }

    function _pullSwapAndSettle(
        Order calldata order,
        bytes calldata swapData
    ) internal returns (uint256 nativeOut) {
        IERC20 token = IERC20(order.tokenIn);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(order.user, address(this), order.amountIn);
        if (token.balanceOf(address(this)) - balanceBefore != order.amountIn) revert FoTOrBalanceMismatch();
        return _settleAndSwap(order, swapData);
    }

    function _settleAndSwap(
        Order calldata order,
        bytes calldata swapData
    ) internal returns (uint256 nativeOut) {
        IERC20 token = IERC20(order.tokenIn);

        if (order.feeAmount > 0) {
            token.safeTransfer(order.feeTo, order.feeAmount);
        }

        uint256 remainder = order.amountIn - order.feeAmount - order.amountSwap;
        if (remainder > 0) {
            token.safeTransfer(order.to, remainder);
        }

        uint256 nativeBefore = order.nativeTo.balance;

        token.forceApprove(order.router, order.amountSwap);
        (bool ok,) = order.router.call(swapData);
        if (!ok) revert SwapFailed();
        token.forceApprove(order.router, 0);

        uint256 leftover = token.balanceOf(address(this));
        if (leftover > 0) {
            token.safeTransfer(order.to, leftover);
        }

        uint256 wethBal = weth.balanceOf(address(this));
        if (wethBal > 0) {
            weth.withdraw(wethBal);
        }

        uint256 credit = address(this).balance;
        if (credit > 0) {
            (bool sent,) = payable(order.nativeTo).call{value: credit}("");
            if (!sent) revert NativeTransferFailed();
        }

        uint256 nativeAfter = order.nativeTo.balance;
        if (nativeAfter < nativeBefore || nativeAfter - nativeBefore < order.minAmountOut) revert Slippage();
        nativeOut = nativeAfter - nativeBefore;
    }

    function _emitRescued(
        Order calldata order,
        uint256 nativeOut
    ) internal {
        emit Rescued(
            order.user,
            order.tokenIn,
            order.amountIn,
            order.feeAmount,
            order.amountSwap,
            nativeOut,
            order.nativeTo,
            order.to,
            order.nonce,
            msg.sender
        );
    }
}
