// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPermit2} from "../interfaces/IPermit2.sol";

/// @dev Test Permit2: pulls `requestedAmount` from `owner` (pre-approved in tests).
contract MockPermit2 is IPermit2 {
    bytes32 public lastWitness;
    string public lastWitnessTypeString;

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata
    ) external override {
        _pull(permit, transferDetails, owner);
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata
    ) external override {
        require(witness != bytes32(0), "witness required");
        lastWitness = witness;
        lastWitnessTypeString = witnessTypeString;
        _pull(permit, transferDetails, owner);
    }

    function _pull(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner
    ) internal {
        require(permit.permitted.amount >= transferDetails.requestedAmount, "permit amount");
        require(IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount));
    }
}
