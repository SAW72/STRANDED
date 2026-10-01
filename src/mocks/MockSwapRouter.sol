// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWETH} from "../interfaces/IWETH.sol";

/// @dev Test double for `GasRescueSwap`. The live Arb Sepolia deployment of
///      this contract had open setters, so anyone could set `payAmount` to
///      the balance and call `swapExact` with `amountIn = 0` to take the ETH.
///      Setters are owner-only (deployer). A swap that would take zero tokens
///      reverts. Production demo inventory belongs on `LockedDemoSwapRouter`.
///      `pathHash` in tests is `keccak256` of the `swapExact` calldata.
contract MockSwapRouter is Ownable {
    uint256 public payAmount;
    bool public payAsWeth;
    IWETH public weth;
    bool public customPull;
    uint256 public pullAmount;

    bool public reenter;
    address public attackTarget;
    bytes public attackCalldata;

    constructor() Ownable(msg.sender) {}

    receive() external payable {}

    function setPayAmount(
        uint256 amount
    ) external onlyOwner {
        payAmount = amount;
    }

    function setPayAsWeth(
        bool enabled,
        address weth_
    ) external onlyOwner {
        payAsWeth = enabled;
        weth = IWETH(weth_);
    }

    function configureReenter(
        address target,
        bytes calldata data
    ) external onlyOwner {
        reenter = true;
        attackTarget = target;
        attackCalldata = data;
    }

    function setPullAmount(
        uint256 amount
    ) external onlyOwner {
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
        require(take > 0, "tokens required");
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), take), "pull failed");

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
