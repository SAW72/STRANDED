// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStrandedRegistry
/// @notice Permissionless *index* of known stranded ERC-20 balances + finder bounty.
///         Claims are NOT permissionless: `claimFind` requires a completed
///         GasRescueSwap rescue receipt bound to the find (holder, token, amount)
///         and may only be submitted by the relayer that executed that rescue.
///         Testnet only (Base Sepolia 84532, Arb Sepolia 421614).
///         Non-production scaffold — do not deploy to mainnet.
interface IStrandedRegistry {
    struct Find {
        address poster;
        address holder;
        address token;
        uint256 amount;
        uint256 bounty;
        uint256 chainId;
        uint256 deadline;
        uint256 nonce;
        uint256 registeredAt;
    }

    function registerFind(
        address holder,
        address token,
        uint256 amount,
        uint256 bounty,
        uint256 chainId,
        uint256 deadline
    ) external payable returns (bytes32 findKey);

    /// @notice Claim a find after a matching GasRescueSwap rescue.
    /// @param findKey Registry key from `registerFind`.
    /// @param rescueNonce `Order.nonce` of the completed rescue (receipt key).
    /// @dev Bounty is paid to `msg.sender`, who must be the receipt's relayer.
    function claimFind(bytes32 findKey, uint256 rescueNonce) external;

    function depositBond() external payable;
    function withdrawBond(uint256 amount) external;

    function setFinderFeeBps(uint256 bps) external;
    function setMinBond(uint256 amount) external;
    function pause() external;
    function unpause() external;

    function finds(bytes32 findKey) external view returns (Find memory);
    function claimed(bytes32 findKey) external view returns (bool);
    function findBond(bytes32 findKey) external view returns (uint256);
    function posterBond(address poster) external view returns (uint256);
    function usedRescueProof(address holder, uint256 nonce) external view returns (bool);
    function finderFeeBps() external view returns (uint256);
    function minBond() external view returns (uint256);
    function gasRescueSwap() external view returns (address);
}
