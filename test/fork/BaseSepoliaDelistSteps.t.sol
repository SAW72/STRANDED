// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GasRescueSwap} from "../../src/GasRescueSwap.sol";

/// @notice Fork proof of the unsigned Base Sepolia delist steps.
///         Impersonates the live owner with `vm.prank`. No key, no signature, no broadcast.
///         Skips when `BASE_SEPOLIA_RPC_URL` is unset, same as `BaseSepoliaLiveTest`.
contract BaseSepoliaDelistStepsTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    /// @dev Same pin as `BaseSepoliaOptionCTest`.
    uint256 internal constant FORK_BLOCK = 48_077_171;

    address internal constant LIVE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant GMOCK = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address internal constant SWAP_ROUTER_02 = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    /// @dev `cast calldata "setTokenAllowed(address,bool)" 0xE36c…7166 false`
    bytes internal constant DELIST_GMOCK_CALLDATA =
        hex"15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000";
    /// @dev `cast calldata "setRouterAllowed(address,bool)" 0x94cC…2bc4 false`
    bytes internal constant DELIST_ROUTER_CALLDATA =
        hex"6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000";

    GasRescueSwap internal live;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        live = GasRescueSwap(payable(LIVE_SWAP));
        forked = true;
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    /// @dev Before: gMOCK allowlisted with ~1e39 supply; SwapRouter02 allowlisted with 0 ETH.
    ///      After step 1: `allowedTokens` and `eip2612Tokens` are false.
    ///      After step 2: `allowedRouters` is false and the router balance is still 0.
    function test_delistSteps_ownerImpersonation_beforeAndAfter() public onlyFork {
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        assertEq(block.number, FORK_BLOCK);
        assertEq(live.owner(), LIVE_OWNER);

        assertEq(abi.encodeWithSelector(GasRescueSwap.setTokenAllowed.selector, GMOCK, false), DELIST_GMOCK_CALLDATA);
        assertEq(
            abi.encodeWithSelector(GasRescueSwap.setRouterAllowed.selector, SWAP_ROUTER_02, false),
            DELIST_ROUTER_CALLDATA
        );
        assertTrue(_codeHas(LIVE_SWAP, GasRescueSwap.setTokenAllowed.selector));
        assertTrue(_codeHas(LIVE_SWAP, GasRescueSwap.setRouterAllowed.selector));
        assertFalse(_codeHas(LIVE_SWAP, bytes4(keccak256("setAllowedToken(address,bool)"))));

        bool tokenBefore = live.allowedTokens(GMOCK);
        bool eipBefore = live.eip2612Tokens(GMOCK);
        uint256 supplyBefore = IERC20(GMOCK).totalSupply();
        bool routerBefore = live.allowedRouters(SWAP_ROUTER_02);
        uint256 routerEthBefore = SWAP_ROUTER_02.balance;

        console2.log("before allowedTokens(gMOCK)", tokenBefore);
        console2.log("before eip2612Tokens(gMOCK)", eipBefore);
        console2.log("before gMOCK totalSupply", supplyBefore);
        console2.log("before allowedRouters(SwapRouter02)", routerBefore);
        console2.log("before SwapRouter02 balance", routerEthBefore);

        assertTrue(tokenBefore);
        assertTrue(eipBefore);
        assertEq(supplyBefore, 10 ** 39 + 10 ** 19 + 1000);
        assertTrue(routerBefore);
        assertEq(routerEthBefore, 0);
        assertFalse(_codeHas(SWAP_ROUTER_02, bytes4(keccak256("maxPayout()"))));

        vm.prank(LIVE_OWNER);
        live.setTokenAllowed(GMOCK, false);

        bool tokenAfter = live.allowedTokens(GMOCK);
        bool eipAfter = live.eip2612Tokens(GMOCK);
        console2.log("after step 1 allowedTokens(gMOCK)", tokenAfter);
        console2.log("after step 1 eip2612Tokens(gMOCK)", eipAfter);
        assertFalse(tokenAfter);
        assertFalse(eipAfter);
        assertEq(IERC20(GMOCK).totalSupply(), supplyBefore);

        vm.prank(LIVE_OWNER);
        live.setRouterAllowed(SWAP_ROUTER_02, false);

        bool routerAfter = live.allowedRouters(SWAP_ROUTER_02);
        uint256 routerEthAfter = SWAP_ROUTER_02.balance;
        console2.log("after step 2 allowedRouters(SwapRouter02)", routerAfter);
        console2.log("after step 2 SwapRouter02 balance", routerEthAfter);
        assertFalse(routerAfter);
        assertEq(routerEthAfter, 0);
    }

    function _codeHas(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        bytes memory code = target.code;
        bytes memory needle = abi.encodePacked(selector);
        if (needle.length > code.length) return false;
        for (uint256 i = 0; i <= code.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (code[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
