// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TestDemoToken
/// @notice Fixed-supply Base Sepolia demo token for option (c). The constructor
///         mints once, entirely to the faucet. There is no `mint`, no owner,
///         and no other supply path. Testnet only. No monetary value.
contract TestDemoToken is ERC20, ERC20Permit {
    string public constant NAME = unicode"Stranded TEST Demo \u2014 No Value";
    string public constant SYMBOL = "tDEMO";
    /// @dev Wallet-facing disclaimer. Not a reward.
    string public constant NOTICE = "Testnet only (Base Sepolia). No monetary value. Not for sale. Not a reward.";

    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    /// @dev 1e12 tokens, 18 decimals. Finite, and far below uint256 max.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000_000 ether;

    error WrongChain();
    error ZeroAddress();

    /// @param faucet Receives the entire supply. Precompute this address; the faucet has no mint of its own.
    constructor(
        address faucet
    ) ERC20(NAME, SYMBOL) ERC20Permit(NAME) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain();
        if (faucet == address(0)) revert ZeroAddress();
        _mint(faucet, TOTAL_SUPPLY);
    }
}
