// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrandedRegistry} from "../src/StrandedRegistry.sol";
import {IStrandedRegistry} from "../src/interfaces/IStrandedRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract StrandedRegistryTest is Test {
    StrandedRegistry registry;
    MockERC20 token;
    address owner;
    address poster;
    address holder;
    address rescuer;
    address gasRescueSwap;

    uint256 constant ARB_SEPOLIA = 421_614;
    uint256 constant BOND = 0.001 ether;

    function setUp() public {
        owner = makeAddr("owner");
        poster = makeAddr("poster");
        holder = makeAddr("holder");
        rescuer = makeAddr("rescuer");
        gasRescueSwap = makeAddr("gasRescueSwap");

        vm.chainId(ARB_SEPOLIA);
        registry = new StrandedRegistry(owner, gasRescueSwap);
        token = new MockERC20("MockUSDC", "mUSDC");
        vm.deal(poster, 1 ether);
        vm.deal(rescuer, 1 ether);
    }

    function test_registerFind_happyPath() public {
        vm.startPrank(poster);
        bytes32 key = registry.registerFind{value: BOND}(
            holder, address(token), 1_000e6, 50e6, ARB_SEPOLIA, block.timestamp + 1 days
        );
        vm.stopPrank();

        IStrandedRegistry.Find memory f = registry.finds(key);
        assertEq(f.poster, poster);
        assertEq(f.holder, holder);
        assertEq(f.token, address(token));
        assertEq(f.amount, 1_000e6);
        assertEq(f.bounty, 50e6);
        assertEq(f.chainId, ARB_SEPOLIA);
        assertFalse(registry.claimed(key));
        assertEq(registry.posterBond(poster), BOND);
    }

    function test_registerFind_revertsOnWrongChain() public {
        vm.chainId(1); // mainnet
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.NotAllowedTestnet.selector);
        registry.registerFind{value: BOND}(holder, address(token), 1_000e6, 0, 1, block.timestamp + 1 days);
    }

    function test_registerFind_revertsOnLowBond() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.NotAllowedTestnet.selector); // chain check first
        // actually bond check comes after chain check; use correct chain
        vm.chainId(ARB_SEPOLIA);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondTooLow.selector);
        registry.registerFind{value: 0.0001 ether}(holder, address(token), 1_000e6, 0, ARB_SEPOLIA, block.timestamp + 1 days);
    }

    function test_claimFind_paysBountyAndRefundsBond() public {
        vm.prank(poster);
        bytes32 key = registry.registerFind{value: BOND}(
            holder, address(token), 1_000e6, 50e6, ARB_SEPOLIA, block.timestamp + 1 days
        );

        uint256 rescuerBefore = rescuer.balance;
        vm.prank(owner); // anyone can claim; use owner for simplicity
        registry.claimFind(key, rescuer);

        assertTrue(registry.claimed(key));
        // bounty 50e6 wei-equivalent paid in native for test (mock); bond refunded
        assertEq(rescuer.balance, rescuerBefore + 50e6);
        assertEq(registry.posterBond(poster), 0);
    }

    function test_claimFind_revertsIfAlreadyClaimed() public {
        vm.prank(poster);
        bytes32 key = registry.registerFind{value: BOND}(
            holder, address(token), 1_000e6, 0, ARB_SEPOLIA, block.timestamp + 1 days
        );
        vm.prank(owner);
        registry.claimFind(key, rescuer);
        vm.prank(owner);
        vm.expectRevert(StrandedRegistry.AlreadyClaimed.selector);
        registry.claimFind(key, rescuer);
    }

    function test_claimFind_revertsIfExpired() public {
        vm.prank(poster);
        bytes32 key = registry.registerFind{value: BOND}(
            holder, address(token), 1_000e6, 0, ARB_SEPOLIA, block.timestamp + 1 days
        );
        vm.warp(block.timestamp + 2 days);
        vm.prank(owner);
        vm.expectRevert(StrandedRegistry.ExpiredDeadline.selector);
        registry.claimFind(key, rescuer);
    }

    function test_setFinderFeeBps_capsAtMax() public {
        vm.prank(owner);
        vm.expectRevert(StrandedRegistry.InvalidFind.selector);
        registry.setFinderFeeBps(2_000); // > 10%
    }

    function test_pause_blocksRegistration() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(poster);
        vm.expectRevert("EnforcedPause()");
        registry.registerFind{value: BOND}(holder, address(token), 1_000e6, 0, ARB_SEPOLIA, block.timestamp + 1 days);
    }
}
