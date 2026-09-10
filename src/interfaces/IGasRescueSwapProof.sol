// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGasRescueSwapProof
/// @notice On-chain rescue receipt + relayer allowlist that `StrandedRegistry.claimFind`
///         uses to bind a bounty to a completed `GasRescueSwap` job.
/// @dev Written by `GasRescueSwap` in `_emitRescued` after a successful rescue.
///      `usedNonces[user][nonce]` alone is not enough: it does not bind token, amount,
///      or which relayer executed the job. The receipt does.
interface IGasRescueSwapProof {
    struct RescueReceipt {
        address tokenIn;
        uint256 amountIn;
        address relayer;
    }

    function relayers(address relayer) external view returns (bool);

    function rescueReceipt(address user, uint256 nonce)
        external
        view
        returns (address tokenIn, uint256 amountIn, address relayer);
}
