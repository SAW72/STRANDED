// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStrandedRegistry
/// @notice Permissionless registry of known stranded ERC-20 balances + finder bounty.
///         Testnet only (Base Sepolia 84532, Arb Sepolia 421614).
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

    function claimFind(bytes32 findKey, address rescuer) external;

    function depositBond() external payable;
    function withdrawBond(uint256 amount) external;

    function setFinderFeeBps(uint256 bps) external;
    function setMinBond(uint256 amount) external;
    function pause() external;
    function unpause() external;

    function finds(bytes32 findKey) external view returns (Find memory);
    function claimed(bytes32 findKey) external view returns (bool);
    function posterBond(address poster) external view returns (uint256);
    function finderFeeBps() external view returns (uint256);
    function minBond() external view returns (uint256);
    function gasRescueSwap() external view returns (address);
}
