// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title GatedDemoToken
/// @notice Fixed-supply EIP-2612 demo token for the Arb Sepolia judge path.
///         Name and permit domain are "Stranded Demo Token". Symbol is "SDEMO".
///         Both are immutable. The constructor creates the only 20 SDEMO:
///         2 to the demo wallet and 18 to the Steward wallet. There is no
///         `mint`, no owner, and no function that creates more supply.
///         Live GRTT and gMOCK stay publicly mintable, so they are delisted
///         in a later owner transaction on `GasRescueSwap`.
contract GatedDemoToken is ERC20, ERC20Permit {
    /// @dev Spencer's demo/QA EOA. Was allowlisted as a relayer in the past.
    address public constant DEMO_WALLET = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;
    /// @dev Wallet operated for Steward of the King LLC. Sends SDEMO onward.
    address public constant STEWARD_WALLET = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    uint256 public constant DEMO_ALLOCATION = 2 ether;
    uint256 public constant STEWARD_ALLOCATION = 18 ether;
    uint256 public constant TOTAL_SUPPLY = 20 ether;

    constructor() ERC20("Stranded Demo Token", "SDEMO") ERC20Permit("Stranded Demo Token") {
        _mint(DEMO_WALLET, DEMO_ALLOCATION);
        _mint(STEWARD_WALLET, STEWARD_ALLOCATION);
        assert(totalSupply() == TOTAL_SUPPLY);
        assert(balanceOf(DEMO_WALLET) == DEMO_ALLOCATION);
        assert(balanceOf(STEWARD_WALLET) == STEWARD_ALLOCATION);
    }
}
