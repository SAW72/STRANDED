// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWETH} from "../interfaces/IWETH.sol";

/// @dev Minimal router: pulls `tokenIn` and pays native or WETH per `payAmount`.
///      `pathHash` in tests is `keccak256` of the `swapExact` calldata.
contract MockSwapRouter {
    uint256 public payAmount;
    bool public payAsWeth;
    IWETH public weth;
    bool public customPull;
    uint256 public pullAmount;

    bool public reenter;
    address public attackTarget;
    bytes public attackCalldata;

    receive() external payable {}

    function setPayAmount(
        uint256 amount
    ) external {
        payAmount = amount;
    }

    function setPayAsWeth(
        bool enabled,
        address weth_
    ) external {
        payAsWeth = enabled;
        weth = IWETH(weth_);
    }

    function configureReenter(
        address target,
        bytes calldata data
    ) external {
        reenter = true;
        attackTarget = target;
        attackCalldata = data;
    }

    function setPullAmount(
        uint256 amount
    ) external {
        customPull = true;
        pullAmount = amount;
    }

    function swapExact(
        address tokenIn,
        uint256 amountIn,
        address
    ) external {
        if (reenter) {
            reenter = false;
            (bool ok,) = attackTarget.call(attackCalldata);
            require(ok, "reenter failed");
        }

        uint256 take = customPull ? pullAmount : amountIn;
        if (take > 0) {
            require(IERC20(tokenIn).transferFrom(msg.sender, address(this), take), "pull failed");
        }

        uint256 amount = payAmount;
        if (payAsWeth) {
            weth.deposit{value: amount}();
            require(weth.transfer(msg.sender, amount), "weth pay failed");
        } else {
            (bool sent,) = payable(msg.sender).call{value: amount}("");
            require(sent, "native pay failed");
        }
    }
}
