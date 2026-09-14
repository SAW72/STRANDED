// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IGasRescueSwap} from "./interfaces/IGasRescueSwap.sol";
import {IGasRescueSwapViews} from "./interfaces/IGasRescueSwapViews.sol";

/// @title GasRescueLens
/// @notice Read-only helper bound to one `GasRescueSwap`. Wallet + HackQuest evidence:
///         paused / owner / relayer / Permit2 / allowlists / order hash / bytecode-selector
///         drift vs current source. Holds no funds. Testnet only (84532 / 421614).
///         Permit2 policy is observed, never enabled here.
contract GasRescueLens {
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address public constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @dev Permit2Immutable() — live Arb Sepolia (F-1) returns this; current source does too.
    bytes4 public constant PERMIT2_IMMUTABLE_SELECTOR = 0xe8d9f070;

    /// @dev Documented live judged product (not this Lens).
    address public constant LIVE_ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address public constant LIVE_BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address public constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address public constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address public constant LIVE_ARB_WETH = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address public constant LIVE_ARB_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address public constant LIVE_ARB_GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address public constant LIVE_ARB_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    address public constant LIVE_BASE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant LIVE_BASE_TOKEN = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address public constant LIVE_BASE_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    IGasRescueSwapViews public immutable swap;

    struct Status {
        uint256 chainId;
        address swap;
        address owner;
        address pendingOwner;
        bool paused;
        address weth;
        address permit2;
        bool permit2Enabled;
        bool permit2IsCanonicalOrZero;
        bool boundToLiveArb;
        bool boundToLiveBase;
    }

    struct AllowlistCheck {
        bool relayerAllowed;
        bool tokenAllowed;
        bool tokenEip2612;
        bool routerAllowed;
        bool nonceUsed;
    }

    /// @notice One-call readiness for a quoted rescue. Does not verify signatures.
    ///         `ready` is fail-closed: includes `permit2Off` so an enabled Permit2
    ///         cannot look demo-ready. Lens never toggles Permit2.
    struct RescueReadiness {
        bool notPaused;
        bool relayerOk;
        bool tokenAllowed;
        bool tokenEip2612;
        bool routerAllowed;
        bool nonceUnused;
        bool userFunded;
        bool permit2Off;
        bool ready;
    }

    /// @notice Selector / error probes vs current `src/GasRescueSwap.sol` (F-5/F-6 + receipt).
    struct BytecodeHints {
        bool hasCanonicalPermit2Getter;
        bool hasRescueReceipt;
        bool setPermit2IsImmutable;
        bool permit2Enabled;
        bool permit2IsCanonicalOrZero;
        bool tipMatchesLiveViews;
    }

    error ZeroAddress();
    error WrongChain();
    error NotGasRescueSwap();

    constructor(
        address swap_
    ) {
        if (!_isAllowedTestnet(block.chainid)) revert WrongChain();
        if (swap_ == address(0)) revert ZeroAddress();
        IGasRescueSwapViews candidate = IGasRescueSwapViews(swap_);
        if (candidate.owner() == address(0)) revert ZeroAddress();
        if (candidate.ARB_SEPOLIA_CHAIN_ID() != ARB_SEPOLIA_CHAIN_ID) revert NotGasRescueSwap();
        if (candidate.BASE_SEPOLIA_CHAIN_ID() != BASE_SEPOLIA_CHAIN_ID) revert NotGasRescueSwap();
        swap = candidate;
    }

    function status() public view returns (Status memory out) {
        out.chainId = block.chainid;
        out.swap = address(swap);
        out.owner = swap.owner();
        out.pendingOwner = swap.pendingOwner();
        out.paused = swap.paused();
        out.weth = swap.weth();
        out.permit2 = swap.permit2();
        out.permit2Enabled = swap.permit2Enabled();
        out.permit2IsCanonicalOrZero = _permit2Ok(out.permit2);
        out.boundToLiveArb = address(swap) == LIVE_ARB_SWAP;
        out.boundToLiveBase = address(swap) == LIVE_BASE_SWAP;
    }

    function allowlistCheck(
        address relayer,
        address token,
        address router,
        address user,
        uint256 nonce
    ) public view returns (AllowlistCheck memory out) {
        out.relayerAllowed = swap.relayers(relayer);
        out.tokenAllowed = swap.allowedTokens(token);
        out.tokenEip2612 = swap.eip2612Tokens(token);
        out.routerAllowed = swap.allowedRouters(router);
        out.nonceUsed = swap.usedNonces(user, nonce);
    }

    /// @notice Documented Arb Sepolia demo addresses (GRTT + live relayer/router).
    function arbDemoAllowlist(
        address user,
        uint256 nonce
    ) external view returns (AllowlistCheck memory) {
        return allowlistCheck(LIVE_RELAYER, LIVE_ARB_GRTT, LIVE_ARB_ROUTER, user, nonce);
    }

    function rescueReadiness(
        address relayer,
        address token,
        address router,
        address user,
        uint256 nonce,
        uint256 amountIn
    ) public view returns (RescueReadiness memory out) {
        out.notPaused = !swap.paused();
        out.relayerOk = swap.relayers(relayer) && relayer != swap.owner();
        out.tokenAllowed = swap.allowedTokens(token);
        out.tokenEip2612 = swap.eip2612Tokens(token);
        out.routerAllowed = swap.allowedRouters(router);
        out.nonceUnused = !swap.usedNonces(user, nonce);
        out.userFunded = amountIn == 0 || IERC20(token).balanceOf(user) >= amountIn;
        out.permit2Off = !swap.permit2Enabled() && _permit2Ok(swap.permit2());
        out.ready = out.notPaused && out.relayerOk && out.tokenAllowed && out.tokenEip2612 && out.routerAllowed
            && out.nonceUnused && out.userFunded && out.permit2Off;
    }

    function hashOrder(
        IGasRescueSwap.Order calldata order
    ) external view returns (bytes32) {
        return swap.hashOrder(order);
    }

    function domainSeparator() external view returns (bytes32) {
        return swap.DOMAIN_SEPARATOR();
    }

    function orderTypehash() external view returns (bytes32) {
        return swap.ORDER_TYPEHASH();
    }

    /// @dev True if `staticcall` succeeds or reverts with data (selector exists).
    ///      Empty revert (no fallback) means the selector is missing — used for live drift.
    ///      Dummy `(address,uint256)` trailing words are appended so arg-taking getters
    ///      (e.g. `rescueReceipt`) still decode; Solidity ignores extra trailing data
    ///      on zero-arg views.
    function hasSelector(
        bytes4 selector
    ) public view returns (bool) {
        return _hasSelector(address(swap), selector);
    }

    function rescueReceiptOrMissing(
        address user,
        uint256 nonce
    ) external view returns (bool supported, address tokenIn, uint256 amountIn, address relayer) {
        bytes4 selector = bytes4(keccak256("rescueReceipt(address,uint256)"));
        (bool ok, bytes memory data) = address(swap).staticcall(abi.encodeWithSelector(selector, user, nonce));
        if (!ok || data.length < 96) {
            return (false, address(0), 0, address(0));
        }
        (tokenIn, amountIn, relayer) = abi.decode(data, (address, uint256, address));
        return (true, tokenIn, amountIn, relayer);
    }

    function bytecodeHints() public view returns (BytecodeHints memory out) {
        out.hasCanonicalPermit2Getter = _hasSelector(address(swap), bytes4(keccak256("CANONICAL_PERMIT2()")));
        out.hasRescueReceipt = _hasSelector(address(swap), bytes4(keccak256("rescueReceipt(address,uint256)")));
        out.setPermit2IsImmutable = _setPermit2IsImmutable();
        out.permit2Enabled = swap.permit2Enabled();
        out.permit2IsCanonicalOrZero = _permit2Ok(swap.permit2());
        // Live Sepolia deploys share the F-1 view surface; tip additionally has F-5 getter + receipt.
        out.tipMatchesLiveViews = !out.hasCanonicalPermit2Getter && !out.hasRescueReceipt;
    }

    function _setPermit2IsImmutable() internal view returns (bool) {
        (bool ok, bytes memory data) = address(swap)
            .staticcall(abi.encodeWithSelector(bytes4(keccak256("setPermit2(address,bool)")), address(0), false));
        if (ok || data.length < 4) return false;
        bytes4 err;
        assembly {
            err := mload(add(data, 32))
        }
        return err == PERMIT2_IMMUTABLE_SELECTOR;
    }

    function _hasSelector(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector, address(0), uint256(0)));
        if (ok) return true;
        return data.length > 0;
    }

    function _permit2Ok(
        address permit2
    ) internal pure returns (bool) {
        return permit2 == address(0) || permit2 == CANONICAL_PERMIT2;
    }

    function _isAllowedTestnet(
        uint256 chainId
    ) internal pure returns (bool) {
        return chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID;
    }
}
