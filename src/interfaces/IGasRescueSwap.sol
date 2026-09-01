// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGasRescueSwap
/// @notice Swap-for-gas + same-chain move-out. Testnet only (Base Sepolia / Arb Sepolia).
/// @dev EIP-712 typehash (canonical freeze):
/// Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)
/// Domain: name StewardGasRescue / version 1 / chainId / verifyingContract.
interface IGasRescueSwap {
    struct Order {
        address user;
        address tokenIn;
        uint256 amountIn;
        uint256 feeAmount;
        address feeTo;
        uint256 amountSwap;
        uint256 minAmountOut;
        address to;
        address nativeTo;
        address router;
        bytes32 pathHash;
        uint256 chainId;
        uint256 deadline;
        uint256 nonce;
    }

    /// @notice EIP-2612 path. Token must be on the EIP-2612 allowlist. `swapData` must hash to `order.pathHash`.
    function rescueWithPermit(
        Order calldata order,
        bytes calldata orderSignature,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata swapData
    ) external;

    /// @notice Permit2 path. Reverts `NoGaslessAuth` unless Permit2 is owner-enabled (fail closed).
    ///         Pulls via `permitWitnessTransferFrom` with the Order struct hash as witness.
    function rescueWithPermit2(
        Order calldata order,
        bytes calldata orderSignature,
        uint256 permit2Nonce,
        bytes calldata permit2Signature,
        bytes calldata swapData
    ) external;
}
