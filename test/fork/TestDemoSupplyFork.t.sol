// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

import {LockedDemoSwapRouter} from "../../src/LockedDemoSwapRouter.sol";
import {TestDemoFaucet} from "../../src/TestDemoFaucet.sol";
import {ILiveSwapAdmin, TestDemoSteps} from "../../script/TestDemoSupply.s.sol";
import {TestDemoToken} from "../../src/TestDemoToken.sol";

/// @notice Fork simulations of the Base B-steps and the Arb A-steps.
///         No broadcast. Skips when the chain RPC is unset.
contract TestDemoSupplyForkTest is Test {
    function test_base_simulatesB4ThenDeployAllowlistAndFund() public {
        TestDemoSteps steps = _fork("BASE_SEPOLIA_RPC_URL");
        assertEq(block.chainid, steps.BASE_SEPOLIA_CHAIN_ID());

        address owner = steps.OWNER();
        address gmock = steps.BASE_GMOCK();
        address stale = steps.BASE_STALE_ROUTER();
        ILiveSwapAdmin swap = ILiveSwapAdmin(steps.BASE_SWAP());
        assertTrue(swap.allowedTokens(gmock), "pre-state: gMOCK allowlisted");
        assertTrue(swap.allowedRouters(stale), "pre-state: 0x94cC allowlisted");
        console2.log("base owner balance", owner.balance);

        steps.delistBase(owner);
        assertFalse(swap.allowedTokens(gmock));
        assertFalse(swap.eip2612Tokens(gmock));
        assertFalse(swap.allowedRouters(stale));

        (address faucet, address demo) = steps.deployFaucet(owner);
        assertEq(TestDemoToken(demo).balanceOf(faucet), TestDemoToken(demo).totalSupply());
        address router = steps.deployBaseRouter(owner);
        steps.allowlist(owner, demo, router);
        assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
        assertTrue(swap.allowedRouters(router));
        assertFalse(swap.allowedRouters(stale));

        uint256 need = steps.BASE_ROUTER_FUND() + steps.BASE_RELAYER_FUND();
        if (owner.balance < need) {
            vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.Underfunded.selector, owner.balance));
            steps.fundBase(owner, router);
            vm.deal(owner, need);
        }
        uint256 relayerBefore = steps.RELAYER().balance;
        steps.fundBase(owner, router);
        assertEq(router.balance, steps.BASE_ROUTER_FUND());
        assertEq(steps.RELAYER().balance, relayerBefore + steps.BASE_RELAYER_FUND());
        assertEq(LockedDemoSwapRouter(payable(router)).quote(2 ether), steps.BASE_MAX_PAYOUT());

        vm.prank(address(0xB0B));
        TestDemoFaucet(faucet).drip();
        assertEq(TestDemoToken(demo).balanceOf(address(0xB0B)), 2 ether);
        console2.log("base fork owner balance before deal was under 0.07 ether");
        console2.log("base router", router);
        console2.log("base tDEMO", demo);
    }

    function test_arb_simulatesDeployAllowlistAndRecommendedCap() public {
        TestDemoSteps steps = _fork("ARB_SEPOLIA_RPC_URL");
        assertEq(block.chainid, steps.ARB_SEPOLIA_CHAIN_ID());

        address owner = steps.OWNER();
        address router = steps.ARB_ROUTER();
        ILiveSwapAdmin swap = ILiveSwapAdmin(steps.ARB_SWAP());
        LockedDemoSwapRouter live = LockedDemoSwapRouter(payable(router));
        uint256 balanceBefore = router.balance;
        assertEq(live.owner(), owner);
        assertEq(live.rescue(), steps.ARB_SWAP());
        assertEq(live.maxPayout(), 0.001 ether);
        assertEq(live.payAmount(), 0.0001 ether);
        assertEq(live.quote(2 ether), 0.001 ether);
        assertTrue(swap.allowedRouters(router));
        assertTrue(swap.allowedTokens(steps.ARB_SDEMO()) && swap.eip2612Tokens(steps.ARB_SDEMO()));
        assertEq(balanceBefore, 0.0195 ether);

        (address faucet, address demo) = steps.deployFaucet(owner);
        address used = steps.allowlist(owner, demo, address(0));
        assertEq(used, router, "A2 reuses 0xFE22");
        assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
        assertTrue(swap.allowedTokens(steps.ARB_SDEMO()) && swap.eip2612Tokens(steps.ARB_SDEMO()));
        assertEq(live.maxPayout(), 0.001 ether, "allowlist does not change the cap");

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        (bool strangerOk,) =
            address(live).call(abi.encodeCall(LockedDemoSwapRouter.setMaxPayout, (steps.ARB_RECOMMENDED_MAX_PAYOUT())));
        assertFalse(strangerOk, "stranger must not set maxPayout");

        steps.setArbMaxPayout(owner);
        assertEq(live.maxPayout(), 0.0001 ether);
        assertEq(live.quote(2 ether), 0.0001 ether);
        assertEq(live.payAmount(), 0.0001 ether, "0.2-token payout unchanged");
        assertEq(router.balance, balanceBefore, "cap change moves no ETH");
        assertEq(balanceBefore / live.maxPayout(), 195);

        vm.prank(address(0xB0B));
        TestDemoFaucet(faucet).drip();
        assertEq(TestDemoToken(demo).balanceOf(address(0xB0B)), 2 ether);
        console2.log("arb tDEMO", demo);
        console2.log("arb rescues at 0.0001", balanceBefore / 0.0001 ether);
    }

    function _fork(
        string memory envName
    ) internal returns (TestDemoSteps steps) {
        string memory rpc = vm.envOr(envName, string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        steps = new TestDemoSteps();
    }
}
