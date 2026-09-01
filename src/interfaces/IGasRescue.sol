// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGasRescue
/// @notice Destination-only ERC-20 gas-deadlock rescue on Base Sepolia.
///         Relayer pays native gas; user signs an EIP-712 Order plus an EIP-2612 permit.
interface IGasRescue {
    /// @dev EIP-712 typehash string:
    ///      Order(address user,address token,uint256 amount,uint256 feeAmount,address feeTo,uint256 deadline,uint256 nonce)
    struct Order {
        address user;
        address token;
        uint256 amount;
        uint256 feeAmount;
        address feeTo;
        uint256 deadline;
        uint256 nonce;
    }

    /// @notice Relayer submits a signed Order: permit-pull `amount`, send `feeAmount` to
    ///         `feeTo`, return the remainder to `user`. Token must be allowlisted.
    function rescueWithPermit(Order calldata order, bytes calldata orderSignature, uint8 v, bytes32 r, bytes32 s)
        external;
}
