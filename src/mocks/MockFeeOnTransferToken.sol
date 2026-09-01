// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev EIP-2612 token that burns `feeBps` of every peer-to-peer transfer.
///      GasRescue must measure balance delta instead of trusting `order.amount`.
contract MockFeeOnTransferToken is ERC20, ERC20Permit {
    uint256 public immutable FEE_BPS;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    error FeeTooHigh();

    constructor(string memory name_, string memory symbol_, uint256 feeBps_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (feeBps_ >= BPS_DENOMINATOR) revert FeeTooHigh();
        FEE_BPS = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && FEE_BPS > 0) {
            uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
            super._update(from, to, amount - fee);
            if (fee > 0) {
                super._update(from, address(0), fee);
            }
        } else {
            super._update(from, to, amount);
        }
    }
}
