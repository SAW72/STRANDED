// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {GasRescueSwap} from "../../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";

/// @notice Who can submit `rescueWithPermit` on the live swaps.
///
///         NOT A PROBLEM on Base Sepolia `0x21A1…f688` and on Arb Sepolia
///         `0x65e7…993D`. A stranger and the owner both revert `NotRelayer()`.
///         The allowlisted relayer `0x8240…9AF6` passes that gate and reverts
///         later on the dummy token (`TokenNotAllowed`). No extra gate is
///         proposed. Source of the gate: `onlyRelayer` in
///         src/GasRescueSwap.sol (modifier, applied on `rescueWithPermit`).
contract RescueSubmitAccessTest is Test {
    address internal constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant STRANGER = 0x1111111111111111111111111111111111111111;
    address internal constant BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;

    function test_base_onlyRelayerCanSubmit() public {
        _fork("BASE_SEPOLIA_RPC_URL", 84_532);
        _assertRelayerOnly(BASE_SWAP, 84_532);
    }

    function test_arb_onlyRelayerCanSubmit() public {
        _fork("ARB_SEPOLIA_RPC_URL", 421_614);
        _assertRelayerOnly(ARB_SWAP, 421_614);
    }

    function _assertRelayerOnly(
        address swap,
        uint256 chainId
    ) internal {
        assertEq(block.chainid, chainId);
        IGasRescueSwap rescue = IGasRescueSwap(swap);
        (IGasRescueSwap.Order memory order, bytes memory sig, uint8 v, bytes32 r, bytes32 s, bytes memory swapData) =
            _dummy(chainId);

        vm.prank(STRANGER);
        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);

        vm.prank(OWNER);
        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);

        vm.prank(RELAYER);
        vm.expectRevert(GasRescueSwap.TokenNotAllowed.selector);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
    }

    function _dummy(
        uint256 chainId
    )
        internal
        pure
        returns (
            IGasRescueSwap.Order memory order,
            bytes memory sig,
            uint8 v,
            bytes32 r,
            bytes32 s,
            bytes memory swapData
        )
    {
        order = IGasRescueSwap.Order({
            user: STRANGER,
            tokenIn: address(0x2222),
            amountIn: 1,
            feeAmount: 0,
            feeTo: address(0x3333),
            amountSwap: 1,
            minAmountOut: 1,
            to: address(0x4444),
            nativeTo: address(0x5555),
            router: address(0x6666),
            pathHash: bytes32(uint256(1)),
            chainId: chainId,
            deadline: type(uint256).max,
            nonce: 0
        });
        sig = hex"";
        v = 27;
        r = bytes32(uint256(1));
        s = bytes32(uint256(2));
        swapData = hex"";
    }

    function _fork(
        string memory envName,
        uint256 chainId
    ) internal {
        string memory rpc = vm.envOr(envName, string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, chainId);
    }
}
