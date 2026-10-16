// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {
    A3_SetArbMaxPayout,
    B1_DeployTestDemoFaucet,
    B2_DeployBaseRouter,
    B3_AllowlistTestDemo,
    B4_DelistStaleAllowlist,
    B5_FundBaseRouter,
    SimulateArbSupply,
    SimulateBaseSupply,
    TestDemoSteps
} from "../script/TestDemoSupply.s.sol";

/// @dev Overrides the Foundry broadcast context and the broadcast env reads.
///      `forge test` is not a broadcast. Flag storage avoids `vm.setEnv`, which
///      is process-wide and races when tests run in parallel.
abstract contract ForcesBroadcast is TestDemoSteps {
    bool public forceBroadcast;
    string public okFlag;
    string public stepFlag;

    function setBroadcast(
        bool on
    ) external {
        forceBroadcast = on;
    }

    function setFlags(
        string memory ok,
        string memory step
    ) external {
        okFlag = ok;
        stepFlag = step;
    }

    function _isBroadcast() internal view virtual override returns (bool) {
        return forceBroadcast;
    }

    function _broadcastOkFlag() internal view virtual override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view virtual override returns (string memory) {
        return stepFlag;
    }
}

contract GuardHarness is ForcesBroadcast {
    function realBroadcastContext() external view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
    }

    function scriptResumeContext() external view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    function guard(
        address sender,
        uint256 chainId,
        string calldata stepId
    ) external view {
        _guardBroadcast(sender, chainId, stepId);
    }
}

interface ISetBroadcast {
    function setBroadcast(
        bool on
    ) external;
}

abstract contract RunBroadcast is ISetBroadcast {
    bool public forceBroadcast;
    string public okFlag;
    string public stepFlag;

    function setBroadcast(
        bool on
    ) external {
        forceBroadcast = on;
    }

    function setFlags(
        string memory ok,
        string memory step
    ) external {
        okFlag = ok;
        stepFlag = step;
    }

    function _broadcasting() internal view returns (bool) {
        return forceBroadcast;
    }
}

contract RunB4 is B4_DelistStaleAllowlist, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunB1 is B1_DeployTestDemoFaucet, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunB2 is B2_DeployBaseRouter, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunB3 is B3_AllowlistTestDemo, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunB5 is B5_FundBaseRouter, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunA3 is A3_SetArbMaxPayout, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunBaseAgg is SimulateBaseSupply, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

contract RunArbAgg is SimulateArbSupply, RunBroadcast {
    function _isBroadcast() internal view override returns (bool) {
        return _broadcasting();
    }

    function _broadcastOkFlag() internal view override returns (string memory) {
        return okFlag;
    }

    function _broadcastStepFlag() internal view override returns (string memory) {
        return stepFlag;
    }
}

/// @dev Production `_isBroadcast`. No override, so `forge test` hits the real `||`.
contract ProductionContext is TestDemoSteps {
    function isBroadcast() external view returns (bool) {
        return _isBroadcast();
    }
}

/// @dev Uses the real env reads. Only one test may call `vm.setEnv` for these names.
contract RealEnvHarness is TestDemoSteps {
    bool public forceBroadcast;

    function setBroadcast(
        bool on
    ) external {
        forceBroadcast = on;
    }

    function _isBroadcast() internal view override returns (bool) {
        return forceBroadcast;
    }
}

/// @notice Broadcast gate for the tDEMO steps. No RPC. Dry-run needs no env.
///         Mutation oracles: `test_broadcast_wrongChain_refuses`,
///         `test_broadcast_wrongStep_refuses`, `test_broadcast_flagVariants_refuse`,
///         `test_broadcast_wrongSender_refuses`, `test_aggregators_neverBroadcast`.
///         `test_productionIsBroadcast_falseUnderForgeTest` runs the production
///         body. It does not prove `ScriptResume`: `forge script --resume`
///         publishes a saved sequence, and a sequence only exists after a
///         broadcast that this suite never sends.
contract TestDemoBroadcastGuardTest is Test {
    uint256 internal constant BASE = 84_532;
    uint256 internal constant ARB = 421_614;
    address internal constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;

    GuardHarness internal steps;
    RunB4 internal b4;
    RunB1 internal b1;
    RunB2 internal b2;
    RunB3 internal b3;
    RunB5 internal b5;
    RunA3 internal a3;
    RunBaseAgg internal baseAgg;
    RunArbAgg internal arbAgg;

    function setUp() public {
        vm.chainId(BASE);
        steps = new GuardHarness();
        b4 = new RunB4();
        b1 = new RunB1();
        b2 = new RunB2();
        b3 = new RunB3();
        b5 = new RunB5();
        a3 = new RunA3();
        baseAgg = new RunBaseAgg();
        arbAgg = new RunArbAgg();
    }

    function test_realContext_isNotBroadcast() public view {
        assertFalse(steps.realBroadcastContext());
        assertFalse(steps.scriptResumeContext());
        assertFalse(steps.forceBroadcast());
    }

    /// @dev Calls the production `_isBroadcast` (no override). Under `forge test`
    ///      both script contexts are false, so the real `||` returns false.
    function test_productionIsBroadcast_falseUnderForgeTest() public {
        ProductionContext live = new ProductionContext();
        assertFalse(live.isBroadcast());
        assertFalse(vm.isContext(VmSafe.ForgeContext.ScriptBroadcast));
        assertFalse(vm.isContext(VmSafe.ForgeContext.ScriptResume));
    }

    function test_dryRun_needsNoFlag() public {
        address router = steps.deployBaseRouter(OWNER);
        assertEq(LockedDemoSwapRouter(payable(router)).maxPayout(), 0.0001 ether);
        assertEq(LockedDemoSwapRouter(payable(router)).quote(2 ether), 0.0001 ether);

        steps.setFlags("1", "B4");
        address again = steps.deployBaseRouter(OWNER);
        assertEq(LockedDemoSwapRouter(payable(again)).maxPayout(), 0.0001 ether);
    }

    function test_broadcast_noFlag_refusesEveryStep() public {
        _arm(b4);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b4.run();

        _arm(b1);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b1.run();

        vm.chainId(ARB);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b1.run();

        vm.chainId(BASE);
        _arm(b2);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b2.run();

        vm.setEnv("TOKEN_ADDRESS", vm.toString(address(0xBEEF)));
        vm.setEnv("ROUTER_ADDRESS", vm.toString(address(0xCAFE)));
        _arm(b3);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b3.run();

        vm.chainId(ARB);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b3.run();

        vm.chainId(BASE);
        _arm(b5);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        b5.run();

        vm.chainId(ARB);
        _arm(a3);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        vm.prank(OWNER);
        a3.run();
    }

    function test_broadcast_wrongStep_refuses() public {
        steps.setBroadcast(true);
        steps.setFlags("1", "B1");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.delistBase(OWNER);

        steps.setFlags("1", "B4");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.deployBaseRouter(OWNER);

        steps.setFlags("1", "A3");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.fundBase(OWNER, address(0xCAFE));

        vm.chainId(ARB);
        steps.setFlags("1", "A1");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.setArbMaxPayout(OWNER);

        steps.setFlags("1", "B4 ");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.guard(OWNER, ARB, "B4");

        steps.setFlags("1", "b4");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.guard(OWNER, ARB, "B4");

        steps.setFlags("1", "");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.guard(OWNER, ARB, "A1");
    }

    function test_broadcast_matchingStep_runs() public {
        steps.setBroadcast(true);
        steps.setFlags("1", "B2");
        address router = steps.deployBaseRouter(OWNER);
        assertEq(LockedDemoSwapRouter(payable(router)).maxPayout(), 0.0001 ether);

        vm.chainId(ARB);
        steps.setFlags("1", "A1");
        (address faucet, address demo) = steps.deployFaucet(OWNER);
        assertTrue(faucet != address(0) && demo != address(0));
    }

    function test_broadcast_wrongChain_refuses() public {
        steps.setBroadcast(true);

        vm.chainId(ARB);
        steps.setFlags("1", "B4");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB));
        steps.delistBase(OWNER);

        steps.setFlags("1", "B2");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB));
        steps.deployBaseRouter(OWNER);

        steps.setFlags("1", "B5");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB));
        steps.fundBase(OWNER, address(0xCAFE));

        vm.chainId(BASE);
        steps.setFlags("1", "A3");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, BASE));
        steps.setArbMaxPayout(OWNER);

        vm.chainId(1);
        steps.setFlags("1", "A1");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, uint256(1)));
        steps.deployFaucet(OWNER);

        vm.chainId(8453);
        steps.setFlags("1", "B1");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, uint256(8453)));
        steps.deployFaucet(OWNER);
    }

    function test_broadcast_wrongSender_refuses() public {
        steps.setBroadcast(true);
        steps.setFlags("1", "B4");

        vm.expectRevert(TestDemoSteps.FoundryDefaultSender.selector);
        steps.delistBase(DEFAULT_SENDER);

        address nope = makeAddr("nope");
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.SenderNotOwner.selector, nope));
        steps.delistBase(nope);

        b4.setBroadcast(true);
        vm.expectRevert(TestDemoSteps.FoundryDefaultSender.selector);
        vm.prank(DEFAULT_SENDER);
        b4.run();

        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.SenderNotOwner.selector, nope));
        vm.prank(nope);
        b4.run();
    }

    function test_broadcast_flagVariants_refuse() public {
        steps.setBroadcast(true);
        string[4] memory badOk = ["0", "true", "", "1 "];
        for (uint256 i = 0; i < badOk.length; i++) {
            steps.setFlags(badOk[i], "B2");
            vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
            steps.deployBaseRouter(OWNER);
        }
    }

    function test_realEnv_flagVariants_refuse() public {
        RealEnvHarness live = new RealEnvHarness();
        live.setBroadcast(true);
        vm.chainId(BASE);
        // Foundry trims env values before envOr, so "1 " arrives as "1".
        // The raw "1 " refusal is test_broadcast_flagVariants_refuse.
        string[3] memory badOk = ["0", "true", ""];
        for (uint256 i = 0; i < badOk.length; i++) {
            vm.setEnv("TEST_DEMO_BROADCAST_OK", badOk[i]);
            vm.setEnv("TEST_DEMO_BROADCAST_STEP", "B2");
            vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
            live.deployBaseRouter(OWNER);
        }
        vm.setEnv("TEST_DEMO_BROADCAST_OK", "1");
        vm.setEnv("TEST_DEMO_BROADCAST_STEP", "B1");
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        live.deployBaseRouter(OWNER);

        // Real `vm.envOr` accept path. This is the only test that sets both
        // flags to a matching pair. `RealEnvHarness` does not override the readers.
        vm.setEnv("TEST_DEMO_BROADCAST_OK", "1");
        vm.setEnv("TEST_DEMO_BROADCAST_STEP", "B2");
        address router = live.deployBaseRouter(OWNER);
        assertEq(LockedDemoSwapRouter(payable(router)).maxPayout(), 0.0001 ether);
        assertEq(LockedDemoSwapRouter(payable(router)).quote(2 ether), 0.0001 ether);
    }

    function test_aggregators_neverBroadcast() public {
        baseAgg.setFlags("1", "B4");
        baseAgg.setBroadcast(true);
        vm.deal(OWNER, 1 ether);
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        vm.prank(OWNER);
        baseAgg.run();
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        baseAgg.run();

        vm.chainId(ARB);
        arbAgg.setFlags("1", "A1");
        arbAgg.setBroadcast(true);
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        vm.prank(OWNER);
        arbAgg.run();
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        arbAgg.run();

        steps.setBroadcast(true);
        steps.setFlags("1", "B4");
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        steps.guard(DEFAULT_SENDER, BASE, "*");
        vm.expectRevert(TestDemoSteps.AggregatorNeverBroadcasts.selector);
        steps.guard(OWNER, BASE, "*");
    }

    function _arm(
        ISetBroadcast harness
    ) internal {
        harness.setBroadcast(true);
    }
}
