// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

import {LockedDemoSwapRouter} from "../../src/LockedDemoSwapRouter.sol";
import {TestDemoFaucet} from "../../src/TestDemoFaucet.sol";
import {ILiveSwapAdmin, TestDemoSteps} from "../../script/TestDemoSupply.s.sol";
import {TestDemoToken} from "../../src/TestDemoToken.sol";

/// @notice Fork simulations of the Base B-steps and the Arb A-steps.
///         No broadcast. Reverts `MissingRpc` when the chain RPC is unset.
///         Allowlist flags, Arb `maxPayout`, and the router balance change when
///         the owner signs. This job follows the chain head, so those values
///         are read at runtime instead of hard-coded.
contract TestDemoSupplyForkTest is Test {
    function test_base_simulatesB4ThenDeployAllowlistAndFund() public {
        TestDemoSteps steps = _fork("BASE_SEPOLIA_RPC_URL");
        assertEq(block.chainid, steps.BASE_SEPOLIA_CHAIN_ID());

        address owner = steps.OWNER();
        address gmock = steps.BASE_GMOCK();
        address stale = steps.BASE_STALE_ROUTER();
        ILiveSwapAdmin swap = ILiveSwapAdmin(steps.BASE_SWAP());
        // B4 writes both flags false. That post-state holds whether or not they
        // were still true when this fork was taken.
        console2.log("base gMOCK listed before B4", swap.allowedTokens(gmock));
        console2.log("base 0x94cC listed before B4", swap.allowedRouters(stale));
        console2.log("base owner balance", owner.balance);

        steps.delistBase(owner);
        assertFalse(swap.allowedTokens(gmock));
        assertFalse(swap.eip2612Tokens(gmock), "setTokenAllowed(false) clears the EIP-2612 flag");
        assertFalse(swap.allowedRouters(stale));

        (address faucet, address demo) = steps.deployFaucet(owner);
        assertEq(TestDemoToken(demo).balanceOf(faucet), TestDemoToken(demo).totalSupply());
        address router = steps.deployBaseRouter(owner);
        steps.allowlist(owner, demo, router);
        assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
        assertTrue(swap.allowedRouters(router));
        assertFalse(swap.allowedRouters(stale));

        uint256 transfers = steps.BASE_ROUTER_FUND() + steps.BASE_RELAYER_FUND();
        uint256 need = transfers + steps.BASE_FUND_HEADROOM();
        if (owner.balance < need) {
            vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.Underfunded.selector, owner.balance));
            steps.fundBase(owner, router);
        }
        vm.deal(owner, transfers);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.Underfunded.selector, transfers));
        steps.fundBase(owner, router);
        vm.deal(owner, need);
        uint256 relayerBefore = steps.RELAYER().balance;
        steps.fundBase(owner, router);
        assertEq(router.balance, steps.BASE_ROUTER_FUND());
        assertEq(steps.RELAYER().balance, relayerBefore + steps.BASE_RELAYER_FUND());
        assertEq(LockedDemoSwapRouter(payable(router)).quote(2 ether), steps.BASE_MAX_PAYOUT());

        vm.prank(address(0xB0B));
        TestDemoFaucet(faucet).drip();
        assertEq(TestDemoToken(demo).balanceOf(address(0xB0B)), 2 ether);
        console2.log("base fork funded with 0.001 ether headroom above the two transfers");
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
        uint256 capBefore = live.maxPayout();
        assertEq(live.owner(), owner);
        assertEq(live.rescue(), steps.ARB_SWAP());
        assertTrue(swap.allowedRouters(router));
        assertTrue(swap.allowedTokens(steps.ARB_SDEMO()) && swap.eip2612Tokens(steps.ARB_SDEMO()));
        console2.log("arb maxPayout before A3", capBefore);
        console2.log("arb router balance before A3", balanceBefore);

        (address faucet, address demo) = steps.deployFaucet(owner);
        if (capBefore > steps.ARB_RECOMMENDED_MAX_PAYOUT()) {
            vm.expectRevert(bytes("A2: sign A3 first"));
            steps.allowlist(owner, demo, address(0));
        }

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        (bool strangerOk,) =
            address(live).call(abi.encodeCall(LockedDemoSwapRouter.setMaxPayout, (steps.ARB_RECOMMENDED_MAX_PAYOUT())));
        assertFalse(strangerOk, "stranger must not set maxPayout");

        steps.setArbMaxPayout(owner);
        assertEq(live.maxPayout(), steps.ARB_RECOMMENDED_MAX_PAYOUT());
        assertEq(live.quote(2 ether), steps.ARB_RECOMMENDED_MAX_PAYOUT());
        assertEq(live.payAmount(), 0.0001 ether, "0.2-token payout stays 0.0001 ETH");
        assertEq(router.balance, balanceBefore, "A3 moves no ETH");

        address used = steps.allowlist(owner, demo, address(0));
        assertEq(used, router, "A2 reuses 0xFE22");
        assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
        assertTrue(swap.allowedTokens(steps.ARB_SDEMO()) && swap.eip2612Tokens(steps.ARB_SDEMO()));
        assertEq(live.maxPayout(), steps.ARB_RECOMMENDED_MAX_PAYOUT(), "A2 does not raise the cap");

        vm.prank(address(0xB0B));
        TestDemoFaucet(faucet).drip();
        assertEq(TestDemoToken(demo).balanceOf(address(0xB0B)), 2 ether);
        console2.log("arb tDEMO", demo);
        console2.log("arb rescues at the new cap", balanceBefore / live.maxPayout());
    }

    error MissingRpc(string envName);

    function _fork(
        string memory envName
    ) internal returns (TestDemoSteps steps) {
        string memory rpc = vm.envOr(envName, string(""));
        if (bytes(rpc).length == 0) revert MissingRpc(envName);
        vm.createSelectFork(rpc);
        steps = new TestDemoSteps();
    }
}
