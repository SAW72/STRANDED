// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {DeployLockedDemoSwapRouter} from "../script/DeployLockedDemoSwapRouter.s.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";

/// @dev Local `GasRescueSwap` stand-in. Same owner / allowlist surface the script calls.
contract MockRescueRouterAdmin {
    address public owner;
    mapping(address => bool) public allowedRouters;

    error NotOwner();

    constructor(
        address owner_
    ) {
        owner = owner_;
    }

    function setRouterAllowed(
        address router,
        bool allowed
    ) external {
        if (msg.sender != owner) revert NotOwner();
        allowedRouters[router] = allowed;
    }
}

/// @notice `vm.setEnv` is process-global, so these cases share one test and cannot
///         interleave. Each case still calls `DeployLockedDemoSwapRouter.run()`.
contract DeployLockedDemoSwapRouterTest is Test {
    DeployLockedDemoSwapRouter internal script;
    MockRescueRouterAdmin internal rescue;

    function setUp() public {
        vm.chainId(421_614);
        rescue = new MockRescueRouterAdmin(address(this));
        script = new DeployLockedDemoSwapRouter();
    }

    function test_run_wrongChain_nonOwner_defaultSender_happyPath_andRerun() public {
        _wrongChain();
        vm.chainId(421_614);
        _nonOwner();
        _defaultSender();
        _happyPath();
        _rerun();
        _refusesRetiredOpenRouter();
    }

    function _wrongChain() internal {
        vm.chainId(1);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"));
        script.run();
    }

    function _nonOwner() internal {
        _resetEnv();
        address stranger = makeAddr("stranger");
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: sender must be the GasRescueSwap owner to allowlist"));
        vm.prank(stranger);
        script.run();
    }

    function _defaultSender() internal {
        _resetEnv();
        address defaultSender = script.DEFAULT_SCRIPT_SENDER();
        assertEq(defaultSender, DEFAULT_SENDER);
        assertEq(defaultSender, 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: refusing Foundry default sender"));
        vm.prank(defaultSender);
        script.run();
    }

    function _happyPath() internal {
        _resetEnv();
        address prior = makeAddr("priorLocked");
        address openRouter = script.LIVE_ARB_OPEN_ROUTER();
        rescue.setRouterAllowed(prior, true);
        rescue.setRouterAllowed(openRouter, true);
        vm.setEnv("PRIOR_LOCKED_ROUTER", vm.toString(prior));

        LockedDemoSwapRouter deployed = script.run();

        assertTrue(rescue.allowedRouters(address(deployed)), "new router allowlisted");
        assertFalse(rescue.allowedRouters(prior), "prior locked router delisted");
        assertTrue(rescue.allowedRouters(openRouter), "retired open router is not the delist target");
        assertEq(deployed.owner(), address(this));
        assertEq(deployed.rescue(), address(rescue));
        assertEq(deployed.payAmount(), 0.0001 ether);
    }

    function _rerun() internal {
        _resetEnv();
        address locked = script.LIVE_ARB_LOCKED_ROUTER();
        address openRouter = script.LIVE_ARB_OPEN_ROUTER();
        rescue.setRouterAllowed(locked, true);
        rescue.setRouterAllowed(openRouter, true);

        vm.expectRevert(
            bytes("DeployLockedDemoSwapRouter: locked router already allowlisted; set FORCE_NEW_ROUTER=true")
        );
        script.run();
        assertTrue(rescue.allowedRouters(locked), "guard does not delist");
        assertTrue(rescue.allowedRouters(openRouter), "guard does not touch the open router");

        vm.setEnv("FORCE_NEW_ROUTER", "true");
        LockedDemoSwapRouter deployed = script.run();

        assertTrue(rescue.allowedRouters(address(deployed)), "forced run allowlists the new router");
        assertFalse(rescue.allowedRouters(locked), "forced run delists the prior locked router");
        assertTrue(rescue.allowedRouters(openRouter), "forced run does not delist 0x6804");
        assertTrue(address(deployed) != locked);
    }

    function _refusesRetiredOpenRouter() internal {
        _resetEnv();
        vm.setEnv("PRIOR_LOCKED_ROUTER", vm.toString(script.LIVE_ARB_OPEN_ROUTER()));
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: refusing to delist the retired open router"));
        script.run();
    }

    function _resetEnv() internal {
        vm.setEnv("GAS_RESCUE_SWAP_ADDRESS", vm.toString(address(rescue)));
        vm.setEnv("FORCE_NEW_ROUTER", "false");
        vm.setEnv("ALLOWLIST_ON_RESCUE", "true");
        vm.setEnv("FUND_WEI", "0");
        vm.setEnv("PRIOR_LOCKED_ROUTER", vm.toString(address(0)));
        vm.setEnv("RATE_NUMERATOR", "500000000000000");
        vm.setEnv("RATE_DENOMINATOR", "1000000000000000000");
        vm.setEnv("MAX_PAYOUT", "1000000000000000");
    }
}
