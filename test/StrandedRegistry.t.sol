// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
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
    uint256 constant BASE_SEPOLIA = 84_532;
    uint256 constant BOND = 0.001 ether;
    /// @dev Native-wei bounty (H-2). Must be <= BOND and is intentionally larger
    ///      than `FIND_AMOUNT / 10` so a token-unit cap would reject it.
    uint256 constant BOUNTY = 0.0004 ether;
    uint256 constant RESCUE_NONCE = 1;
    uint256 constant FIND_AMOUNT = 1_000e6;

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
        assertEq(registry.lockedBond(poster), BOND);
        assertEq(registry.availableBond(poster), 0);
    }

    function test_registerFind_revertsOnWrongChain() public {
        vm.chainId(1); // mainnet
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.NotAllowedTestnet.selector);
        registry.registerFind{value: BOND}(holder, address(token), FIND_AMOUNT, 0, 1, block.timestamp + 1 days);
    }

    function test_registerFind_revertsOnOtherAllowedTestnet() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.ChainIdMismatch.selector);
        registry.registerFind{value: BOND}(
            holder, address(token), FIND_AMOUNT, 0, BASE_SEPOLIA, block.timestamp + 1 days
        );
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
        assertEq(registry.lockedBond(poster), 0);
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
        assertEq(registry.lockedBond(poster), BOND + BOND);
        assertEq(registry.availableBond(poster), extra);
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
        assertEq(registry.lockedBond(poster), BOND);
        assertEq(registry.posterBond(poster), BOND + extra);
        assertEq(poster.balance, posterBefore + (BOND - BOUNTY));

        mockSwap.recordRescue(holder, 2, address(token), 2_000e6, rescuer);
        vm.prank(rescuer);
        registry.claimFind(keyB, 2);
        assertTrue(registry.claimed(keyB));
        assertEq(registry.findBond(keyB), 0);
        assertEq(registry.lockedBond(poster), 0);
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
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.registerFind{value: BOND}(holder, address(token), FIND_AMOUNT, 0, ARB_SEPOLIA, block.timestamp + 1 days);
    }

    // --- H-1 withdrawBond must respect findBond locks --------------------------------

    function test_H1_withdrawBond_revertsWhenFindBondLocked() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        assertEq(registry.availableBond(poster), 0);

        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondLocked.selector);
        registry.withdrawBond(BOND);

        assertEq(registry.findBond(key), BOND);
        assertEq(registry.lockedBond(poster), BOND);
        assertEq(registry.posterBond(poster), BOND);
        assertEq(address(registry).balance, BOND);
    }

    function test_H1_withdrawBond_allowsUnusedDeposit_claimStaysSolvent() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        uint256 extra = 0.005 ether;
        vm.prank(poster);
        registry.depositBond{value: extra}();

        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondLocked.selector);
        registry.withdrawBond(BOND + extra);

        uint256 posterBeforeWithdraw = poster.balance;
        vm.prank(poster);
        registry.withdrawBond(extra);
        assertEq(poster.balance, posterBeforeWithdraw + extra);
        assertEq(registry.availableBond(poster), 0);
        assertEq(registry.findBond(key), BOND);
        assertEq(address(registry).balance, BOND);

        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        uint256 rescuerBefore = rescuer.balance;
        uint256 posterBeforeClaim = poster.balance;
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);

        assertEq(rescuer.balance, rescuerBefore + BOUNTY);
        assertEq(poster.balance, posterBeforeClaim + (BOND - BOUNTY));
        assertEq(registry.lockedBond(poster), 0);
        assertEq(address(registry).balance, 0);
    }

    function test_H1_withdrawBond_revertsIfAmountExceedsPosterBond() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.InsufficientBond.selector);
        registry.withdrawBond(1);
    }

    // --- H-2 bounty is native wei, capped by the find bond ---------------------------

    function test_H2_bountyIsNativeWei_notCappedByTokenAmount() public {
        // Pre-fix `bounty > amount / 10` treated bounty as token units and would
        // revert a valid wei bounty (BOUNTY = 4e14, FIND_AMOUNT / 10 = 1e8).
        assertGt(BOUNTY, FIND_AMOUNT / 10);
        assertLe(BOUNTY, BOND);

        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        assertEq(registry.finds(key).bounty, BOUNTY);

        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        uint256 rescuerBefore = rescuer.balance;
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);
        assertEq(rescuer.balance, rescuerBefore + BOUNTY);
    }

    function test_H2_bountyGreaterThanBondReverts() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BountyTooHigh.selector);
        registry.registerFind{value: BOND}(
            holder, address(token), FIND_AMOUNT, BOND + 1, ARB_SEPOLIA, block.timestamp + 1 days
        );
    }

    function test_H2_fullBondBountyIsSolvent() public {
        bytes32 key = _register(FIND_AMOUNT, BOND);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        uint256 rescuerBefore = rescuer.balance;
        uint256 posterBefore = poster.balance;
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);

        assertEq(rescuer.balance, rescuerBefore + BOND);
        assertEq(poster.balance, posterBefore);
        assertEq(registry.posterBond(poster), 0);
        assertEq(address(registry).balance, 0);
    }

    // --- M-3 receive credits unused posterBond --------------------------------------

    function test_M3_receiveCreditsPosterBond() public {
        uint256 gift = 0.002 ether;
        vm.prank(poster);
        (bool ok,) = address(registry).call{value: gift}("");
        assertTrue(ok);

        assertEq(registry.posterBond(poster), gift);
        assertEq(registry.lockedBond(poster), 0);
        assertEq(registry.availableBond(poster), gift);

        uint256 posterBefore = poster.balance;
        vm.prank(poster);
        registry.withdrawBond(gift);
        assertEq(poster.balance, posterBefore + gift);
        assertEq(address(registry).balance, 0);
    }

    function test_M3_receiveDoesNotUnlockFindBond() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        uint256 gift = 0.002 ether;
        vm.prank(poster);
        (bool ok,) = address(registry).call{value: gift}("");
        assertTrue(ok);

        assertEq(registry.availableBond(poster), gift);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondLocked.selector);
        registry.withdrawBond(BOND + gift);
        assertEq(registry.findBond(key), BOND);
    }

    // --- M-4 reclaimExpired ----------------------------------------------------------

    function test_M4_reclaimExpired_returnsBondToPoster() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        vm.warp(block.timestamp + 2 days);

        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondLocked.selector);
        registry.withdrawBond(BOND);

        uint256 posterBefore = poster.balance;
        vm.prank(poster);
        registry.reclaimExpired(key);

        assertTrue(registry.claimed(key));
        assertEq(registry.findBond(key), 0);
        assertEq(registry.lockedBond(poster), 0);
        assertEq(registry.posterBond(poster), 0);
        assertEq(poster.balance, posterBefore + BOND);
        assertEq(address(registry).balance, 0);
    }

    function test_M4_reclaimExpired_revertsBeforeDeadline() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.FindNotExpired.selector);
        registry.reclaimExpired(key);
    }

    function test_M4_reclaimExpired_onlyPoster() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        vm.warp(block.timestamp + 2 days);
        vm.prank(stranger);
        vm.expectRevert(StrandedRegistry.NotPoster.selector);
        registry.reclaimExpired(key);
        assertEq(registry.findBond(key), BOND);
    }

    function test_M4_reclaimExpired_blocksLaterClaim() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        vm.warp(block.timestamp + 2 days);

        vm.prank(poster);
        registry.reclaimExpired(key);

        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.AlreadyClaimed.selector);
        registry.claimFind(key, RESCUE_NONCE);
        assertEq(registry.usedRescueProof(holder, RESCUE_NONCE), false);
    }

    function test_M4_reclaimExpired_revertsIfAlreadyClaimed() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);
        vm.prank(rescuer);
        registry.claimFind(key, RESCUE_NONCE);

        vm.warp(block.timestamp + 2 days);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.AlreadyClaimed.selector);
        registry.reclaimExpired(key);
    }

    function test_M4_reclaimExpired_worksWhilePaused() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        vm.prank(owner);
        registry.pause();
        vm.warp(block.timestamp + 2 days);

        uint256 posterBefore = poster.balance;
        vm.prank(poster);
        registry.reclaimExpired(key);
        assertEq(poster.balance, posterBefore + BOND);
    }

    // --- L-4 claimFind requires find.chainId == block.chainid ------------------------

    function test_L4_claimFind_requiresChainIdMatch() public {
        bytes32 key = _register(FIND_AMOUNT, BOUNTY);
        _recordRescue(RESCUE_NONCE, FIND_AMOUNT);

        vm.chainId(BASE_SEPOLIA);
        vm.prank(rescuer);
        vm.expectRevert(StrandedRegistry.ChainIdMismatch.selector);
        registry.claimFind(key, RESCUE_NONCE);

        assertFalse(registry.claimed(key));
        assertEq(registry.findBond(key), BOND);
    }

    function test_L4_reclaimExpired_requiresChainIdMatch() public {
        bytes32 key = _register(FIND_AMOUNT, 0);
        vm.warp(block.timestamp + 2 days);
        vm.chainId(BASE_SEPOLIA);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.ChainIdMismatch.selector);
        registry.reclaimExpired(key);
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
