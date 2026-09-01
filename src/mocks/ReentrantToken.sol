// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import {IGasRescue} from "../interfaces/IGasRescue.sol";

/// @dev Attempts to re-enter `rescueWithPermit` from `permit` and/or `transferFrom`.
contract ReentrantToken is ERC20, ERC20Permit {
    IGasRescue public target;
    IGasRescue.Order public storedOrder;
    bytes public storedOrderSignature;
    uint8 public storedV;
    bytes32 public storedR;
    bytes32 public storedS;
    bool public attackOnPermit;
    bool public attackOnTransfer;

    constructor() ERC20("Reentrant", "RENT") ERC20Permit("Reentrant") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureAttack(
        IGasRescue target_,
        IGasRescue.Order calldata order_,
        bytes calldata orderSignature_,
        uint8 v_,
        bytes32 r_,
        bytes32 s_,
        bool attackOnPermit_,
        bool attackOnTransfer_
    ) external {
        target = target_;
        storedOrder = order_;
        storedOrderSignature = orderSignature_;
        storedV = v_;
        storedR = r_;
        storedS = s_;
        attackOnPermit = attackOnPermit_;
        attackOnTransfer = attackOnTransfer_;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        public
        override
    {
        if (attackOnPermit && address(target) != address(0)) {
            attackOnPermit = false;
            _reenter();
        }
        super.permit(owner, spender, value, deadline, v, r, s);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (attackOnTransfer && address(target) != address(0)) {
            attackOnTransfer = false;
            _reenter();
        }
        return super.transferFrom(from, to, value);
    }

    function _reenter() internal {
        target.rescueWithPermit(storedOrder, storedOrderSignature, storedV, storedR, storedS);
    }
}
