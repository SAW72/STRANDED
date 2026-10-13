// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TestDemoFaucet
/// @notice Holds the fixed tDEMO supply and pays 2 tDEMO per wallet per 24 hours.
///         No owner, no admin, and no withdraw. Testnet only (Base Sepolia).
contract TestDemoFaucet {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant DRIP_AMOUNT = 2 ether;
    uint256 public constant COOLDOWN = 24 hours;

    IERC20 public immutable token;
    mapping(address wallet => uint256 timestamp) public lastDrip;

    error WrongChain();
    error ZeroAddress();
    error TooSoon(uint256 nextDrip);
    error InsufficientFaucetBalance();

    constructor(
        IERC20 token_
    ) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain();
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice One claim of `DRIP_AMOUNT` per `msg.sender` per `COOLDOWN`.
    ///         A failed balance check does not consume the window.
    function drip() external {
        uint256 last = lastDrip[msg.sender];
        if (last != 0 && block.timestamp < last + COOLDOWN) revert TooSoon(last + COOLDOWN);
        if (token.balanceOf(address(this)) < DRIP_AMOUNT) revert InsufficientFaucetBalance();
        lastDrip[msg.sender] = block.timestamp;
        token.safeTransfer(msg.sender, DRIP_AMOUNT);
    }
}
