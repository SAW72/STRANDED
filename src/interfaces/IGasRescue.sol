// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGasRescue
/// @notice Destination-only ERC-20 gas-deadlock rescue on Base Sepolia.
///         Relayer pays native gas; user signs an EIP-712 Order plus an EIP-2612 permit.
interface IGasRescue {
    /// @dev All fields are bound into the EIP-712 Order digest. The on-chain permit()
    ///      call uses `token`, `amount` (as value), `user` (as owner), and `deadline`
    ///      so the EIP-2612 signature cannot be swapped onto a different order.
    struct Order {
        address user;
        address token;
        uint256 amount;
        uint256 fee;
        address recipient;
        uint256 deadline;
        uint256 nonce;
    }

    /// @notice Consume a signed order: permit-pull `amount` of `token`, skim `fee` in-token
    ///         to the allowlisted relayer (`msg.sender`), send the measured remainder to
    ///         `recipient`. Fail-closed on replay, pause, bad allowlist, expired deadline,
    ///         invalid signature, or fee-on-transfer leaving too little.
    /// @param order EIP-712 order (token, amount, fee, recipient, deadline, nonce).
    /// @param orderSignature EIP-712 signature over `order` from `order.user`.
    /// @param v EIP-2612 permit signature v, bound to this order's token/amount/deadline.
    /// @param r EIP-2612 permit signature r.
    /// @param s EIP-2612 permit signature s.
    function rescueWithPermit(Order calldata order, bytes calldata orderSignature, uint8 v, bytes32 r, bytes32 s)
        external;
}
