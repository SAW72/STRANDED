// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrandedRegistry} from "../src/StrandedRegistry.sol";
import {IStrandedRegistry} from "../src/interfaces/IStrandedRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockGasRescueSwap} from "../src/mocks/MockGasRescueSwap.sol";

contract StrandedRegistryTest is Test {
    StrandedRegistry registry;
    MockGasRescueSwap mockSwap;
    MockERC20 token;
    address owner;
    address poster;
    address holder;
    address rescuer;
    address stranger;

    uint256 constant ARB_SEPOLIA = 421_614;
    uint256 constant BOND = 0.001 ether;
    uint256 constant RESCUE_NONCE = 1;
    uint256 constant FIND_AMOUNT = 1_000e6;
    uint256 constant BOUNTY = 50e6;

    function setUp() public {
        owner = makeAddr("owner");
        poster = makeAddr("poster");
        holder = makeAddr("holder");
        rescuer = makeAddr("rescuer");
        stranger = makeAddr("stranger");

        vm.chainId(ARB_SEPOLIA);
        mockSwap = new MockGasRescueSwap();
        mockSwap.setRelayer(rescuer, true);
        registry = new StrandedRegistry(owner, address(mockSwap));
        token = new MockERC20("MockUSDC", "mUSDC");
        vm.deal(poster, 10 ether);
        vm.deal(rescuer, 1 ether);
        vm.deal(stranger, 1 ether);
    }

    function test_registerFind_happyPath() public {
        vm.startPrank(poster);
        bytes32 key = registry.registerFind{value: BOND}(
            holder, address(token), FIND_AMOUNT, BOUNTY, ARB_SEPOLIA, block.timestamp + 1 days
        );
        vm.stopPrank();

        IStrandedRegistry.Find memory f = registry.finds(key);
        assertEq(f.poster, poster);
        assertEq(f.holder, holder);
        assertEq(f.token, address(token));
        assertEq(f.amount, FIND_AMOUNT);
        assertEq(f.bounty, BOUNTY);
        assertEq(f.chainId, ARB_SEPOLIA);
        assertFalse(registry.claimed(key));
        assertEq(registry.posterBond(poster), BOND);
        assertEq(registry.findBond(key), BOND);
    }

    function test_registerFind_revertsOnWrongChain() public {
        vm.chainId(1); // mainnet
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.NotAllowedTestnet.selector);
        registry.registerFind{value: BOND}(holder, address(token), FIND_AMOUNT, 0, 1, block.timestamp + 1 days);
    }

    function test_registerFind_revertsOnLowBond() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondTooLow.selector);
        registry.registerFind{value: 0.0001 ether}(
            holder, address(token), FIND_AMOUNT, 0, ARB_SEPOLIA, block.timestamp + 1 days
        );
    }

    function test_claimFind_paysBountyAndRefundsBond() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        uint256 rescuerBefore = rescuer.balance;
        uint256 posterBefore = poster.balance;
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);

        assertTrue(registry.claimed(key));
        assertTrue(registry.usedRescueProof(holder, RESCUE_NONCE));
        assertEq(registry.findBond(key), 0);
        // bounty paid in native from this find's bond (scaffold denomination)
        assertEq(rescuer.balance, rescuerBefore + BOUNTY);
        assertEq(poster.balance, posterBefore + (BOND - BOUNTY));
        assertEq(registry.posterBond(poster), 0);
    }

    function test_claimFind_revertsIfAlreadyClaimed() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);
        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.AlreadyClaimed.selector);
        registry.claimFind(key, RESCUE_NONCE);
    }

    function test_claimFind_revertsIfExpired() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        vm.warp(block.timestamp + 2 days);
        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.ExpiredDeadline.selector);
        registry.claimFind(key, RESCUE_NONCE);
    }

    function test_claimFind_strangerCannotClaim() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        uint256 rescuerBefore = rescuer.balance;
        uint256 strangerBefore = stranger.balance;
        uint256 posterBondBefore = registry.posterBond(poster);

        vm.prank(stranger);
        vm.expectRevert(StrandedRegistry.NotRelayer.selector);
        registry.claimFind(key, RESCUE_NONCE);

        assertFalse(registry.claimed(key));
        assertEq(registry.findBond(key), BOND);
        assertEq(registry.posterBond(poster), posterBondBefore);
        assertEq(rescuer.balance, rescuerBefore);
        assertEq(stranger.balance, strangerBefore);
    }

    function test_claimFind_relayerWithoutReceiptReverts() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);

        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.InvalidRescueProof.selector);
        registry.claimFind(key, RESCUE_NONCE);
        assertFalse(registry.claimed(key));
    }

    function test_claimFind_otherRelayerCannotStealBounty() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        address otherRelayer = makeAddr("otherRelayer");
        mockSwap.setRelayer(otherRelayer, true);

        vm.prank(otherRelayer);
        vm.expectRevert(StrandedRegistry.InvalidRescueProof.selector);
        registry.claimFind(key, RESCUE_NONCE);
        assertFalse(registry.claimed(key));
    }

    function test_claimFind_mismatchedTokenOrAmountReverts() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        mockSwap.recordRescue(holder, RESCUE_NONCE, address(token), FIND_AMOUNT - 1, rescuer);

        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.InvalidRescueProof.selector);
        registry.claimFind(key, RESCUE_NONCE);

        MockERC20 other = new MockERC20("Other", "OTH");
        mockSwap.recordRescue(holder, RESCUE_NONCE, address(other), FIND_AMOUNT, rescuer);
        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.InvalidRescueProof.selector);
        registry.claimFind(key, RESCUE_NONCE);
    }

    function test_claimFind_bondIsPerFind_otherFindAndDepositSurvive() public {
        bytes32 keyA = _register(FIND_AMOUNT, BOUNTY);
        bytes32 keyB = _register(2_000e6, 0);
        uint256 extra = 0.005 ether;
        vm.prank(poster);
        registry.depositBond{value: extra}();

        assertEq(registry.posterBond(poster), BOND + BOND + extra);
        assertEq(registry.findBond(keyA), BOND);
        assertEq(registry.findBond(keyB), BOND);

        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        uint256 posterBefore = poster.balance;
        vm.prank(rescuer);
        registry.claimFind(keyA, RESCUE_NONCE);

        assertTrue(registry.claimed(keyA));
        assertFalse(registry.claimed(keyB));
        assertEq(registry.findBond(keyA), 0);
        assertEq(registry.findBond(keyB), BOND);
        // find A: bounty to rescuer, leftover bond to poster; find B + extra deposit untouched
        assertEq(registry.posterBond(poster), BOND + extra);
        assertEq(poster.balance, posterBefore + (BOND - BOUNTY));

        mockSwap.recordRescue(holder, 2, address(token), 2_000e6, rescuer);
        vm.prank(rescuer);
        registry.claimFind(keyB, 2);
        assertTrue(registry.claimed(keyB));
        assertEq(registry.findBond(keyB), 0);
        assertEq(registry.posterBond(poster), extra);
    }

    function test_claimFind_sameRescueNonceCannotSettleTwoFinds() public {
        bytes32 keyA = _register(FIND_AMOUNT, 0);
        bytes32 keyB = _register(FIND_AMOUNT, 0);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        vm.prank(rescuer);
        registry.claimFind(keyA, RESCUE_NONCE);

        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.RescueProofAlreadyUsed.selector);
        registry.claimFind(keyB, RESCUE_NONCE);
        assertFalse(registry.claimed(keyB));
        assertEq(registry.findBond(keyB), BOND);
        assertEq(registry.posterBond(poster), BOND);
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
        registry.registerFind{value: BOND}(holder, address(token), FIND_AMOUNT, 0, ARB_SEPOLIA, block.timestamp + 1 days);
    }

    function _register(uint256 amount, uint256 bounty) internal returns (bytes32 key) {
        vm.prank(poster);
        key = registry.registerFind{value: BOND}(
            holder, address(token), amount, bounty, ARB_SEPOLIA, block.timestamp + 1 days
        );
    }

    function _recordRescue(uint256 nonce, uint256 amount) internal {
        mockSwap.recordRescue(holder, nonce, address(token), amount, rescuer);
    }
}
