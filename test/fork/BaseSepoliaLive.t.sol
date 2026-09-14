// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IGasRescueSwapViews} from "../../src/interfaces/IGasRescueSwapViews.sol";

/// @notice Optional fork smoke against documented Base Sepolia `GasRescueSwap`.
///         Skips when `BASE_SEPOLIA_RPC_URL` is unset. No broadcast.
contract BaseSepoliaLiveTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    address internal constant LIVE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant LIVE_WETH = 0x4200000000000000000000000000000000000006;
    address internal constant LIVE_TOKEN = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address internal constant LIVE_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    IGasRescueSwapViews internal swap;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        swap = IGasRescueSwapViews(LIVE_SWAP);
    }

    function test_liveBase_immutablesAndPolicy() public view {
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        assertEq(swap.owner(), LIVE_OWNER);
        assertFalse(swap.paused());
        assertEq(swap.weth(), LIVE_WETH);
        assertEq(swap.permit2(), address(0));
        assertFalse(swap.permit2Enabled(), "Permit2 stays disabled");
        assertTrue(swap.relayers(LIVE_RELAYER));
        assertTrue(swap.allowedTokens(LIVE_TOKEN));
        assertTrue(swap.eip2612Tokens(LIVE_TOKEN));
        assertTrue(swap.allowedRouters(LIVE_ROUTER));
    }
}
