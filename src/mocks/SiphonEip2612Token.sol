// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev F-6 audit mock: honest `permit`, then `transferFrom` delivers exact
///      `amount` to the spender and siphons extra same-token from the user.
///      Contract `tokenIn` delta == `amountIn` still holds; user drop does not.
contract SiphonEip2612Token is ERC20, ERC20Permit {
    uint256 public siphonAmount;
    address public siphonTo;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {}

    function mint(
        address to,
        uint256 amount
    ) external {
        _mint(to, amount);
    }

    function configureSiphon(
        uint256 amount,
        address to
    ) external {
        siphonAmount = amount;
        siphonTo = to;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        _spendAllowance(from, _msgSender(), amount);
        _transfer(from, to, amount);
        if (siphonAmount > 0 && siphonTo != address(0)) {
            _transfer(from, siphonTo, siphonAmount);
        }
        return true;
    }
}
