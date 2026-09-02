// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev Minimal WETH for swap-for-gas tests (deposit / withdraw / EIP-2612).
contract MockWETH is ERC20, ERC20Permit {
    constructor() ERC20("Wrapped Ether", "WETH") ERC20Permit("Wrapped Ether") {}

    receive() external payable {
        _mint(msg.sender, msg.value);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(
        uint256 wad
    ) external {
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
    }
}
