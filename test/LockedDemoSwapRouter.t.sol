// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockFeeOnTransferToken} from "../src/mocks/MockFeeOnTransferToken.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract LockedDemoSwapRouterTest is Test {
    uint256 internal constant RATE_NUMERATOR = 500_000_000_000_000; // 0.0005 ETH per 1 token
    uint256 internal constant RATE_DENOMINATOR = 1e18;
    uint256 internal constant MAX_PAYOUT = 0.001 ether;

    LockedDemoSwapRouter internal router;
    MockERC20 internal token;
    address internal owner;
    address internal rescue;

    function setUp() public {
        owner = makeAddr("owner");
        rescue = makeAddr("rescue");
        token = new MockERC20("Gas Rescue Test Token", "GRTT");
        router = new LockedDemoSwapRouter(owner, rescue, RATE_NUMERATOR, RATE_DENOMINATOR, MAX_PAYOUT);
    }

    function test_nonOwnerCannotDrain() public {
        vm.deal(address(router), 1 ether);
        address attacker = makeAddr("attacker");
        uint256 inventory = address(router).balance;

        vm.startPrank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.setMaxPayout(inventory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.setRate(1, 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.setRescue(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.withdrawEth(attacker, inventory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.sweepToken(address(token), attacker);

        vm.expectRevert(LockedDemoSwapRouter.NotRescue.selector);
        router.swapExact(address(token), 0, attacker);
        vm.expectRevert(LockedDemoSwapRouter.NotRescue.selector);
        router.swapExact(address(token), 1 ether, attacker);
        vm.stopPrank();

        assertEq(address(router).balance, inventory);
        assertEq(attacker.balance, 0);
        assertEq(router.maxPayout(), MAX_PAYOUT);
        assertEq(router.rescue(), rescue);
    }

    function test_ownerCannotSwapWithoutBeingRescue() public {
        vm.deal(address(router), 0.5 ether);
        vm.prank(owner);
        vm.expectRevert(LockedDemoSwapRouter.NotRescue.selector);
        router.swapExact(address(token), 1 ether, owner);

        vm.prank(owner);
        router.withdrawEth(owner, 0.5 ether);
        assertEq(owner.balance, 0.5 ether);
        assertEq(address(router).balance, 0);
    }

    function test_rescueSwapTakesTokensAndPaysProportionally() public {
        vm.deal(address(router), 1 ether);
        uint256 amountIn = 0.2 ether;
        token.mint(rescue, amountIn);

        vm.startPrank(rescue);
        token.approve(address(router), amountIn);
        router.swapExact(address(token), amountIn, makeAddr("nativeTo"));
        vm.stopPrank();

        assertEq(token.balanceOf(address(router)), amountIn, "tokens taken");
        assertEq(token.balanceOf(rescue), 0);
        assertEq(rescue.balance, 0.0001 ether, "0.2 token -> 0.0001 ETH");
        assertEq(address(router).balance, 1 ether - 0.0001 ether);
        assertEq(router.payAmount(), 0.0001 ether);
        assertEq(router.quote(amountIn), 0.0001 ether);
    }

    function test_payoutIsCapped() public {
        vm.deal(address(router), 1 ether);
        uint256 amountIn = 10 ether;
        assertEq(router.quote(amountIn), MAX_PAYOUT);

        token.mint(rescue, amountIn);
        vm.startPrank(rescue);
        token.approve(address(router), amountIn);
        router.swapExact(address(token), amountIn, rescue);
        vm.stopPrank();

        assertEq(rescue.balance, MAX_PAYOUT);
        assertEq(token.balanceOf(address(router)), amountIn);
        assertEq(address(router).balance, 1 ether - MAX_PAYOUT);
    }

    function test_zeroAmountAndShortfallRevert() public {
        vm.deal(address(router), 1 ether);
        vm.prank(rescue);
        vm.expectRevert(LockedDemoSwapRouter.ZeroAmount.selector);
        router.swapExact(address(token), 0, rescue);

        MockFeeOnTransferToken fot = new MockFeeOnTransferToken("Fee", "FEE", 100);
        fot.mint(rescue, 1 ether);
        vm.startPrank(rescue);
        fot.approve(address(router), 1 ether);
        vm.expectRevert(LockedDemoSwapRouter.NotEnoughTokens.selector);
        router.swapExact(address(fot), 1 ether, rescue);
        vm.stopPrank();

        assertEq(address(router).balance, 1 ether);
    }

    function test_mockNonOwnerCannotDrain() public {
        MockSwapRouter mock = new MockSwapRouter();
        assertEq(mock.owner(), address(this));
        vm.deal(address(mock), 10 ether);
        mock.setPayAmount(10 ether);

        address attacker = makeAddr("attacker");
        vm.startPrank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        mock.setPayAmount(10 ether);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        mock.setPullAmount(0);
        vm.expectRevert(bytes("tokens required"));
        mock.swapExact(address(token), 0, attacker);
        vm.expectRevert();
        mock.swapExact(address(token), 1, attacker);
        vm.stopPrank();

        assertEq(address(mock).balance, 10 ether);
        assertEq(attacker.balance, 0);
    }
}
