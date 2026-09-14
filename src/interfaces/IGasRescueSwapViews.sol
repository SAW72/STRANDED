// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGasRescueSwap} from "./IGasRescueSwap.sol";

/// @title IGasRescueSwapViews
/// @notice Read surface shared by live Sepolia `GasRescueSwap` deploys and current source.
///         `CANONICAL_PERMIT2()` and `rescueReceipt` are intentionally omitted: those
///         selectors are missing on the 2026-09-14 live Arb/Base bytecode (pre-F-5 getter
///         and pre-registry receipt). Probe them via `GasRescueLens.hasSelector`.
interface IGasRescueSwapViews {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function paused() external view returns (bool);
    function weth() external view returns (address);
    function permit2() external view returns (address);
    function permit2Enabled() external view returns (bool);
    function relayers(
        address relayer
    ) external view returns (bool);
    function allowedTokens(
        address token
    ) external view returns (bool);
    function eip2612Tokens(
        address token
    ) external view returns (bool);
    function allowedRouters(
        address router
    ) external view returns (bool);
    function usedNonces(
        address user,
        uint256 nonce
    ) external view returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function ORDER_TYPEHASH() external view returns (bytes32);
    function hashOrder(
        IGasRescueSwap.Order calldata order
    ) external view returns (bytes32);
    function ARB_SEPOLIA_CHAIN_ID() external view returns (uint256);
    function BASE_SEPOLIA_CHAIN_ID() external view returns (uint256);
}
