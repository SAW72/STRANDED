// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SdemoFaucet
/// @notice No-owner drip for the already-deployed SDEMO token on Arbitrum
///         Sepolia. It does not mint. Supply stays 20. `drip()` sends 2 SDEMO
///         to the caller once per 24 hours, and only while this contract holds
///         enough. There is no admin and no withdraw. When the balance is
///         below one drip, `drip()` reverts `FaucetEmpty`.
contract SdemoFaucet {
    using SafeERC20 for IERC20;

    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    /// @dev Live SDEMO. Fixed supply, no mint.
    address public constant LIVE_SDEMO = 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C;
    uint256 public constant DRIP_AMOUNT = 2 ether;
    uint256 public constant COOLDOWN = 1 days;

    IERC20 public immutable token;

    mapping(address account => uint256 readyAt) public nextDrip;

    event Dripped(address indexed to, uint256 amount, uint256 nextDripAt);

    error WrongChain(uint256 chainId);
    error WrongToken(address token);
    error FaucetEmpty();
    error DripCooldown(uint256 readyAt);

    constructor(address token_) {
        if (block.chainid != ARB_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        if (token_ != LIVE_SDEMO) revert WrongToken(token_);
        token = IERC20(token_);
    }

    /// @notice Send 2 SDEMO to the caller. One success per address per 24 hours.
    function drip() external {
        if (token.balanceOf(address(this)) < DRIP_AMOUNT) revert FaucetEmpty();
        uint256 readyAt = nextDrip[msg.sender];
        if (block.timestamp < readyAt) revert DripCooldown(readyAt);
        uint256 nextReady = block.timestamp + COOLDOWN;
        nextDrip[msg.sender] = nextReady;
        token.safeTransfer(msg.sender, DRIP_AMOUNT);
        emit Dripped(msg.sender, DRIP_AMOUNT, nextReady);
    }
}
