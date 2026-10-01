// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title GatedDemoToken
/// @notice EIP-2612 demo token for the Arb Sepolia judge path. ERC20 name and
///         the EIP-2612 / EIP-712 permit domain are "Stranded Demo Token".
///         Symbol is "SDEMO". Both are immutable after deploy. `mint` is
///         owner-only. The live GRTT and gMOCK contracts expose public `mint`
///         and have no owner, so they cannot be gated in place.
///
///         A one-time public faucet would not close H1: each fresh address
///         could still mint once and take one router payout. Only the owner
///         (Spencer, `0x3046…bA9D`) can mint. `renounceOwnership` is disabled.
contract GatedDemoToken is ERC20, ERC20Permit, Ownable2Step {
    error ZeroAddress();
    error ZeroAmount();
    error OwnershipCannotBeRenounced();

    constructor(
        address initialOwner,
        address initialRecipient,
        uint256 initialAmount
    ) ERC20("Stranded Demo Token", "SDEMO") ERC20Permit("Stranded Demo Token") Ownable(initialOwner) {
        if (initialAmount > 0) {
            if (initialRecipient == address(0)) revert ZeroAddress();
            _mint(initialRecipient, initialAmount);
        }
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    /// @notice Mint demo inventory. Not a public faucet.
    function mint(
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }
}
