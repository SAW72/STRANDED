// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TestDemoToken
/// @notice Testnet-only demo token. Never mainnet. No monetary value.
///         Deployed only on Base Sepolia (84532) or Arbitrum Sepolia (421614).
///         Name and permit domain are "Stranded TEST Demo — No Value".
///         Symbol is "tDEMO". The constructor mints the only supply, 1e12
///         tDEMO, to the faucet. There is no `mint`, no owner, and no
///         function that creates more supply.
contract TestDemoToken is ERC20, ERC20Permit {
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    /// @dev 1e12 tokens, 18 decimals. Minted once, all to `faucet`.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000_000 ether;

    /// @notice Testnet only. No monetary value. Not for sale. Not a reward.
    string public constant NOTICE =
        "Testnet only (Base Sepolia 84532 or Arbitrum Sepolia 421614). No monetary value. Not for sale. Not a reward.";

    address public immutable faucet;

    error WrongChain(uint256 chainId);
    error ZeroAddress();

    constructor(
        address faucet_
    ) ERC20(unicode"Stranded TEST Demo — No Value", "tDEMO") ERC20Permit(unicode"Stranded TEST Demo — No Value") {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID && block.chainid != ARB_SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (faucet_ == address(0)) revert ZeroAddress();
        faucet = faucet_;
        _mint(faucet_, TOTAL_SUPPLY);
        assert(totalSupply() == TOTAL_SUPPLY);
        assert(balanceOf(faucet_) == TOTAL_SUPPLY);
    }
}
