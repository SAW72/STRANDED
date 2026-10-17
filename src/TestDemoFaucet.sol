// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {TestDemoToken} from "./TestDemoToken.sol";

/// @title TestDemoFaucet
/// @notice No-owner faucet for `TestDemoToken`. Testnet only (Base Sepolia
///         84532 or Arbitrum Sepolia 421614). Never mainnet.
///         `drip()` sends 2 tDEMO to `msg.sender` once per 24 hours.
///         There is no admin, no withdraw, and no mint. When the faucet
///         balance is below one drip, `drip()` reverts `FaucetEmpty`.
contract TestDemoFaucet {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    uint256 public constant DRIP_AMOUNT = 2 ether;
    uint256 public constant COOLDOWN = 1 days;

    TestDemoToken public immutable token;

    /// @dev Timestamp at which `account` may drip again. Zero before the first drip.
    mapping(address account => uint256 readyAt) public nextDrip;

    event Dripped(address indexed to, uint256 amount, uint256 nextDripAt);

    error WrongChain(uint256 chainId);
    error FaucetEmpty();
    error DripCooldown(uint256 readyAt);

    constructor() {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID && block.chainid != ARB_SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        token = new TestDemoToken(address(this));
    }

    /// @notice Send 2 tDEMO to the caller. One success per address per 24 hours.
    function drip() external {
        // EMPTY_GUARD
        if (token.balanceOf(address(this)) < DRIP_AMOUNT) revert FaucetEmpty();
        uint256 readyAt = nextDrip[msg.sender];
        if (block.timestamp < readyAt) revert DripCooldown(readyAt);
        uint256 nextReady = block.timestamp + COOLDOWN;
        nextDrip[msg.sender] = nextReady;
        IERC20(address(token)).safeTransfer(msg.sender, DRIP_AMOUNT);
        emit Dripped(msg.sender, DRIP_AMOUNT, nextReady);
    }
}
