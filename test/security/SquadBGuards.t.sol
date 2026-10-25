// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {GasRescue} from "../../src/GasRescue.sol";
import {GasRescueSwap} from "../../src/GasRescueSwap.sol";
import {StrandedRegistry} from "../../src/StrandedRegistry.sol";
import {IGasRescue} from "../../src/interfaces/IGasRescue.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockGasRescueSwap} from "../../src/mocks/MockGasRescueSwap.sol";
import {MockWETH} from "../../src/mocks/MockWETH.sol";

/// @notice Fuzz and boundary tests for the Squad B kill switch and owner gates.
contract SquadBGuardsTest is Test {
    uint256 internal constant ARB_SEPOLIA = 421_614;
    uint256 internal constant BASE_SEPOLIA = 84_532;
    uint256 internal constant BOND = 0.001 ether;

    GasRescue internal harness;
    GasRescueSwap internal swap;
    StrandedRegistry internal registry;
    MockWETH internal weth;
    MockGasRescueSwap internal mockSwap;
    MockERC20 internal token;

    address internal owner;
    address internal relayer;
    address internal poster;
    address internal holder;

    function setUp() public {
        owner = makeAddr("owner");
        relayer = makeAddr("relayer");
        poster = makeAddr("poster");
        holder = makeAddr("holder");

        vm.chainId(BASE_SEPOLIA);
        harness = new GasRescue(owner, relayer);

        weth = new MockWETH();
        swap = new GasRescueSwap(owner, relayer, address(weth), address(0));

        vm.chainId(ARB_SEPOLIA);
        mockSwap = new MockGasRescueSwap();
        mockSwap.setRelayer(relayer, true);
        registry = new StrandedRegistry(owner, address(mockSwap));
        token = new MockERC20("Mock", "M");
        vm.deal(poster, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    // --- pause authority: owner only, repeat reverts --------------------------------

    function testFuzz_pause_onlyOwner(
        address caller
    ) public {
        vm.assume(caller != owner);
        _expectUnauthorized(caller);
        harness.pause();
        _expectUnauthorized(caller);
        swap.pause();
        _expectUnauthorized(caller);
        registry.pause();
        assertFalse(harness.paused());
        assertFalse(swap.paused());
        assertFalse(registry.paused());
    }

    function testFuzz_unpause_onlyOwner(
        address caller
    ) public {
        vm.startPrank(owner);
        harness.pause();
        swap.pause();
        registry.pause();
        vm.stopPrank();

        vm.assume(caller != owner);
        _expectUnauthorized(caller);
        harness.unpause();
        _expectUnauthorized(caller);
        swap.unpause();
        _expectUnauthorized(caller);
        registry.unpause();
        assertTrue(harness.paused());
        assertTrue(swap.paused());
        assertTrue(registry.paused());
    }

    function test_pause_repeatReverts_unpauseRestores() public {
        vm.startPrank(owner);
        harness.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        harness.pause();
        harness.unpause();
        vm.expectRevert(Pausable.ExpectedPause.selector);
        harness.unpause();

        swap.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        swap.pause();
        swap.unpause();

        registry.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.pause();
        registry.unpause();
        vm.stopPrank();

        assertFalse(harness.paused());
        assertFalse(swap.paused());
        assertFalse(registry.paused());
    }

    function test_renounceOwnership_disabled() public {
        vm.startPrank(owner);
        vm.expectRevert(GasRescue.OwnershipCannotBeRenounced.selector);
        harness.renounceOwnership();
        vm.expectRevert(GasRescueSwap.OwnershipCannotBeRenounced.selector);
        swap.renounceOwnership();
        vm.expectRevert(bytes("OwnershipCannotBeRenounced"));
        registry.renounceOwnership();
        vm.stopPrank();
        assertEq(harness.owner(), owner);
        assertEq(swap.owner(), owner);
        assertEq(registry.owner(), owner);
    }

    // --- GasRescue admin + rescue gates ---------------------------------------------

    function testFuzz_harness_adminOnlyOwner(
        address caller,
        address target,
        bool allowed
    ) public {
        vm.assume(caller != owner);
        _expectUnauthorized(caller);
        harness.setRelayer(target, allowed);
        _expectUnauthorized(caller);
        harness.setTokenAllowed(target, allowed);
        assertEq(harness.owner(), owner);
    }

    function testFuzz_harness_setRelayer_repeatAndZero(
        address relayer_,
        bool first,
        bool second
    ) public {
        vm.startPrank(owner);
        if (relayer_ == address(0)) {
            vm.expectRevert(GasRescue.ZeroAddress.selector);
            harness.setRelayer(relayer_, first);
            vm.expectRevert(GasRescue.ZeroAddress.selector);
            harness.setTokenAllowed(relayer_, first);
        } else {
            harness.setRelayer(relayer_, first);
            harness.setRelayer(relayer_, second);
            assertEq(harness.relayers(relayer_), second);
            harness.setTokenAllowed(relayer_, first);
            harness.setTokenAllowed(relayer_, second);
            assertEq(harness.allowedTokens(relayer_), second);
        }
        vm.stopPrank();
    }

    function testFuzz_harness_rescue_unauthorizedOrPaused(
        address caller
    ) public {
        IGasRescue.Order memory order;
        vm.assume(caller != relayer);
        vm.prank(caller);
        vm.expectRevert(GasRescue.NotRelayer.selector);
        harness.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0));

        vm.prank(owner);
        harness.pause();
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        harness.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0));
        vm.prank(caller);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        harness.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0));
    }

    // --- GasRescueSwap admin, tombstone, receive, rescue gates ----------------------

    function testFuzz_swap_adminOnlyOwner(
        address caller,
        address target,
        bool allowed
    ) public {
        vm.assume(caller != owner);
        _expectUnauthorized(caller);
        swap.setRelayer(target, allowed);
        _expectUnauthorized(caller);
        swap.setTokenAllowed(target, allowed);
        _expectUnauthorized(caller);
        swap.setEip2612Token(target, allowed);
        _expectUnauthorized(caller);
        swap.setRouterAllowed(target, allowed);
        _expectUnauthorized(caller);
        swap.setPermit2Enabled(allowed);
    }

    function testFuzz_swap_setRelayer_repeatZeroAndOwner(
        address relayer_,
        bool first,
        bool second
    ) public {
        vm.startPrank(owner);
        if (relayer_ == address(0)) {
            vm.expectRevert(GasRescueSwap.ZeroAddress.selector);
            swap.setRelayer(address(0), first);
        } else if (relayer_ == owner) {
            if (first) {
                vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
                swap.setRelayer(owner, true);
            } else {
                swap.setRelayer(owner, false);
            }
            if (second) {
                vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
                swap.setRelayer(owner, true);
            } else {
                swap.setRelayer(owner, false);
            }
            assertFalse(swap.relayers(owner));
        } else {
            swap.setRelayer(relayer_, first);
            swap.setRelayer(relayer_, second);
            assertEq(swap.relayers(relayer_), second);
        }
        vm.stopPrank();
    }

    function testFuzz_setPermit2_revertsForEveryone(
        address caller,
        address permit2,
        bool enabled
    ) public {
        vm.prank(caller);
        vm.expectRevert(GasRescueSwap.Permit2Immutable.selector);
        swap.setPermit2(permit2, enabled);
        assertEq(address(swap.permit2()), address(0));
        assertFalse(swap.permit2Enabled());
    }

    function test_swap_ownerCanSetPermit2EnabledWhilePaused() public {
        vm.startPrank(owner);
        swap.pause();
        vm.expectRevert(GasRescueSwap.ZeroAddress.selector);
        swap.setPermit2Enabled(true);
        swap.setPermit2Enabled(false);
        swap.setRelayer(makeAddr("backup"), true);
        vm.stopPrank();
        assertTrue(swap.paused());
        assertFalse(swap.permit2Enabled());
        assertTrue(swap.relayers(makeAddr("backup")));
    }

    function testFuzz_swap_receive_pausedRejectsValue(
        uint96 raw
    ) public {
        uint256 amount = bound(uint256(raw), 1, 50 ether);
        vm.deal(poster, amount);
        vm.prank(owner);
        swap.pause();

        vm.prank(poster);
        (bool ok,) = address(swap).call{value: amount}("");
        assertFalse(ok);
        assertEq(address(swap).balance, 0);

        vm.prank(poster);
        (bool zeroOk,) = address(swap).call{value: 0}("");
        assertTrue(zeroOk);

        vm.prank(owner);
        swap.unpause();
        vm.prank(poster);
        (bool open,) = address(swap).call{value: amount}("");
        assertTrue(open);
        assertEq(address(swap).balance, amount);
    }

    function test_swap_receive_zeroAndMax() public {
        vm.prank(poster);
        (bool zeroOk,) = address(swap).call{value: 0}("");
        assertTrue(zeroOk);
        assertEq(address(swap).balance, 0);

        vm.deal(address(this), type(uint256).max);
        vm.deal(poster, type(uint256).max);
        vm.prank(poster);
        (bool maxOk,) = address(swap).call{value: type(uint256).max}("");
        assertTrue(maxOk);
        assertEq(address(swap).balance, type(uint256).max);

        vm.prank(owner);
        swap.pause();
        vm.deal(address(this), 1);
        vm.deal(poster, 1);
        vm.prank(poster);
        (bool pausedOk,) = address(swap).call{value: 1}("");
        assertFalse(pausedOk);
        assertEq(address(swap).balance, type(uint256).max);
    }

    function testFuzz_swap_rescue_unauthorizedOrPaused(
        address caller
    ) public {
        IGasRescueSwap.Order memory order;
        vm.assume(caller != relayer);
        vm.prank(caller);
        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        swap.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0), "");
        vm.prank(caller);
        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        swap.rescueWithPermit2(order, "", 0, "", "");

        vm.prank(owner);
        swap.pause();
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        swap.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0), "");
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        swap.rescueWithPermit2(order, "", 0, "", "");
    }

    /// @dev WETH9 `withdraw` pays with a 2300-gas transfer. The rescue path
    ///      warms the pause slot first; this direct withdraw is the cold path
    ///      and must still unwrap when the contract is not paused.
    function test_swap_directWethWithdraw_fitsUnpausedReceive() public {
        vm.deal(poster, 1 ether);
        vm.prank(poster);
        weth.deposit{value: 1 ether}();
        vm.prank(poster);
        weth.transfer(address(swap), 1 ether);

        vm.prank(address(swap));
        weth.withdraw(1 ether);
        assertEq(address(swap).balance, 1 ether);
        assertEq(weth.balanceOf(address(swap)), 0);
    }

    // --- StrandedRegistry value paths ------------------------------------------------

    function testFuzz_registry_adminOnlyOwner(
        address caller,
        uint256 bps,
        uint256 minBond_
    ) public {
        vm.assume(caller != owner);
        _expectUnauthorized(caller);
        registry.setFinderFeeBps(bps);
        _expectUnauthorized(caller);
        registry.setMinBond(minBond_);
        assertEq(registry.finderFeeBps(), registry.DEFAULT_FINDER_FEE_BPS());
        assertEq(registry.minBond(), registry.MIN_BOND());
    }

    function testFuzz_registry_setFinderFeeBps_capAndRepeat(
        uint256 bps
    ) public {
        vm.startPrank(owner);
        if (bps > registry.MAX_FINDER_FEE_BPS()) {
            vm.expectRevert(StrandedRegistry.InvalidFind.selector);
            registry.setFinderFeeBps(bps);
            assertEq(registry.finderFeeBps(), registry.DEFAULT_FINDER_FEE_BPS());
        } else {
            registry.setFinderFeeBps(bps);
            registry.setFinderFeeBps(bps);
            assertEq(registry.finderFeeBps(), bps);
        }
        vm.stopPrank();
    }

    function testFuzz_registry_setMinBond_ownerRepeat(
        uint256 amount
    ) public {
        vm.startPrank(owner);
        registry.setMinBond(amount);
        registry.setMinBond(amount);
        vm.stopPrank();
        assertEq(registry.minBond(), amount);

        vm.startPrank(owner);
        registry.pause();
        registry.setMinBond(0);
        registry.setFinderFeeBps(0);
        vm.stopPrank();
        assertEq(registry.minBond(), 0);
        assertEq(registry.finderFeeBps(), 0);
        assertTrue(registry.paused());
    }

    function test_registry_deposit_zeroAndMax() public {
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.BondTooLow.selector);
        registry.depositBond{value: 0}();

        vm.deal(address(this), type(uint256).max);
        vm.deal(poster, type(uint256).max);
        vm.prank(poster);
        registry.depositBond{value: type(uint256).max}();
        assertEq(registry.posterBond(poster), type(uint256).max);

        vm.deal(address(this), 1);
        vm.deal(poster, 1);
        vm.prank(poster);
        vm.expectRevert();
        registry.depositBond{value: 1}();
        assertEq(registry.posterBond(poster), type(uint256).max);
    }

    function testFuzz_registry_depositThenWithdraw(
        uint96 raw
    ) public {
        uint256 amount = bound(uint256(raw), BOND, 20 ether);
        vm.deal(address(this), amount);
        vm.deal(poster, amount);
        vm.prank(poster);
        registry.depositBond{value: amount}();
        assertEq(registry.posterBond(poster), amount);
        assertEq(registry.availableBond(poster), amount);

        vm.prank(poster);
        registry.withdrawBond(0);
        assertEq(registry.posterBond(poster), amount);

        uint256 beforeWithdraw = poster.balance;
        vm.prank(poster);
        registry.withdrawBond(amount);
        assertEq(poster.balance, beforeWithdraw + amount);
        assertEq(registry.posterBond(poster), 0);
        assertEq(address(registry).balance, 0);

        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.InsufficientBond.selector);
        registry.withdrawBond(amount);
    }

    function test_registry_withdraw_zeroAndMax() public {
        uint256 before = poster.balance;
        vm.prank(poster);
        registry.withdrawBond(0);
        assertEq(poster.balance, before);

        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.InsufficientBond.selector);
        registry.withdrawBond(type(uint256).max);

        vm.prank(poster);
        registry.depositBond{value: BOND}();
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.InsufficientBond.selector);
        registry.withdrawBond(type(uint256).max);
        assertEq(registry.posterBond(poster), BOND);
    }

    function testFuzz_registry_pausedBlocksValue(
        address caller,
        uint96 raw
    ) public {
        uint256 amount = bound(uint256(raw), 1, 5 ether);
        bytes32 key = _register(0);

        vm.prank(owner);
        registry.pause();

        vm.deal(caller, amount);
        vm.prank(caller);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.depositBond{value: amount}();

        vm.prank(poster);
        registry.withdrawBond(0);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.InsufficientBond.selector);
        registry.withdrawBond(type(uint256).max);

        uint256 credited = registry.posterBond(caller);
        vm.deal(caller, amount);
        vm.prank(caller);
        (bool ok,) = address(registry).call{value: amount}("");
        assertFalse(ok);
        assertEq(registry.posterBond(caller), credited);

        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.claimFind(key, 1);

        vm.warp(block.timestamp + 2 days);
        uint256 posterBefore = poster.balance;
        vm.prank(poster);
        registry.reclaimExpired(key);
        assertEq(poster.balance, posterBefore + BOND);
        assertEq(registry.findBond(key), 0);
        assertTrue(registry.claimed(key));

        vm.deal(poster, BOND);
        vm.prank(poster);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.registerFind{value: BOND}(holder, address(token), 1, 0, ARB_SEPOLIA, block.timestamp + 1 days);

        assertEq(address(registry).balance, 0);
    }

    function testFuzz_registry_reclaim_unauthorized(
        address caller
    ) public {
        bytes32 key = _register(0);
        vm.warp(block.timestamp + 2 days);
        vm.assume(caller != poster);
        vm.prank(caller);
        vm.expectRevert(StrandedRegistry.NotPoster.selector);
        registry.reclaimExpired(key);
        assertEq(registry.findBond(key), BOND);

        vm.prank(poster);
        registry.reclaimExpired(key);
        vm.prank(poster);
        vm.expectRevert(StrandedRegistry.AlreadyClaimed.selector);
        registry.reclaimExpired(key);
    }

    function test_registry_receive_zeroAndMax() public {
        vm.prank(poster);
        (bool zeroOk,) = address(registry).call{value: 0}("");
        assertTrue(zeroOk);
        assertEq(registry.posterBond(poster), 0);

        vm.deal(address(this), type(uint256).max);
        vm.deal(poster, type(uint256).max);
        vm.prank(poster);
        (bool maxOk,) = address(registry).call{value: type(uint256).max}("");
        assertTrue(maxOk);
        assertEq(registry.posterBond(poster), type(uint256).max);
        assertEq(registry.availableBond(poster), type(uint256).max);

        vm.deal(address(this), 1);
        vm.deal(poster, 1);
        vm.prank(poster);
        (bool again,) = address(registry).call{value: 1}("");
        assertFalse(again);
        assertEq(registry.posterBond(poster), type(uint256).max);
    }

    function _register(
        uint256 bounty
    ) internal returns (bytes32 key) {
        vm.prank(poster);
        key = registry.registerFind{value: BOND}(
            holder, address(token), 1000e6, bounty, ARB_SEPOLIA, block.timestamp + 1 days
        );
    }

    function _expectUnauthorized(
        address caller
    ) internal {
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
    }
}
