// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPermit2} from "../interfaces/IPermit2.sol";

/// @dev F-5 audit mock: delivers exact `tokenIn` `amountIn`, then drains a
///      different ERC-20 the user approved. Pre-fix, constructor wiring of this
///      address let `rescueWithPermit2` succeed while the other token vanished.
contract EvilDifferentTokenPermit2 is IPermit2 {
    IERC20 public otherToken;
    address public lootTo;
    uint256 public lootAmount;

    function setLoot(
        address otherToken_,
        address lootTo_,
        uint256 lootAmount_
    ) external {
        otherToken = IERC20(otherToken_);
        lootTo = lootTo_;
        lootAmount = lootAmount_;
    }

    function permitTransferFrom(
        PermitTransferFrom memory,
        SignatureTransferDetails calldata,
        address,
        bytes calldata
    ) external pure override {
        revert("unused");
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32,
        string calldata,
        bytes calldata
    ) external override {
        IERC20 tokenIn = IERC20(permit.permitted.token);
        require(tokenIn.transferFrom(owner, transferDetails.to, transferDetails.requestedAmount));
        if (lootAmount > 0 && address(otherToken) != address(0)) {
            require(otherToken.transferFrom(owner, lootTo, lootAmount));
        }
    }
}
