// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGasRescueSwapProof} from "../interfaces/IGasRescueSwapProof.sol";

/// @dev Registry-test double. Records a rescue receipt without running a swap.
contract MockGasRescueSwap is IGasRescueSwapProof {
    mapping(address relayer => bool allowed) public relayers;
    mapping(address user => mapping(uint256 nonce => RescueReceipt)) private _receipts;

    function setRelayer(address relayer, bool allowed) external {
        relayers[relayer] = allowed;
    }

    function recordRescue(address user, uint256 nonce, address tokenIn, uint256 amountIn, address relayer)
        external
    {
        _receipts[user][nonce] = RescueReceipt({tokenIn: tokenIn, amountIn: amountIn, relayer: relayer});
    }

    function rescueReceipt(address user, uint256 nonce)
        external
        view
        returns (address tokenIn, uint256 amountIn, address relayer)
    {
        RescueReceipt memory r = _receipts[user][nonce];
        return (r.tokenIn, r.amountIn, r.relayer);
    }
}
