// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {GatedDemoToken} from "../src/GatedDemoToken.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {MockERC20Permit} from "../src/mocks/MockERC20Permit.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";

/// @notice H1: public mint + relayer-paid gas lets fresh 0-ETH addresses
///         empty `LockedDemoSwapRouter`. The gated token plus a delist stops it.
contract H1GatedDemoTokenTest is Test {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    uint256 internal constant RELAYER_PK = 0xB0B;
    uint256 internal constant RATE_NUMERATOR = 500_000_000_000_000; // live: 0.0005 ETH per 1 token
    uint256 internal constant RATE_DENOMINATOR = 1e18;
    uint256 internal constant MAX_PAYOUT = 0.001 ether; // live maxPayout
    uint256 internal constant ROUTER_INVENTORY = 0.0195 ether; // live router balance
    /// @dev amountSwap that quotes exactly `MAX_PAYOUT` at the live rate.
    uint256 internal constant DRAIN_IN = 2 ether;
    uint256 internal constant DEMO_IN = 1 ether;
    uint256 internal constant DEMO_SWAP = 0.2 ether;
    uint256 internal constant DEMO_FEE = 0.01 ether;
    uint256 internal constant DEMO_PAYOUT = 0.0001 ether; // quote(0.2 ether)

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    GasRescueSwap internal rescue;
    LockedDemoSwapRouter internal router;
    MockWETH internal weth;
    address internal owner;
    address internal relayer;
    address internal feeTo;

    function setUp() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        feeTo = makeAddr("feeTo");
        vm.deal(relayer, 1 ether);
        weth = new MockWETH();
        rescue = new GasRescueSwap(owner, relayer, address(weth), address(0));
        router = new LockedDemoSwapRouter{value: ROUTER_INVENTORY}(
            owner, address(rescue), RATE_NUMERATOR, RATE_DENOMINATOR, MAX_PAYOUT
        );
        vm.prank(owner);
        rescue.setRouterAllowed(address(router), true);
    }

    function test_openMintFreshAddressesDrainRouter() public {
        MockERC20Permit open = new MockERC20Permit("GasRescue Test Token", "GRTT");
        vm.prank(owner);
        rescue.setEip2612Token(address(open), true);

        uint256 inventory = address(router).balance;
        assertEq(inventory, ROUTER_INVENTORY);

        // 0.0195 / 0.001 = 19 full payouts, then 0.0005 ETH remains.
        for (uint256 i = 0; i < 19; i++) {
            address attacker = _fresh(i);
            assertEq(attacker.balance, 0, "attacker starts with 0 ETH");
            open.mint(attacker, DRAIN_IN);
            _rescue(address(open), attacker, _pk(i), DRAIN_IN, 0, DRAIN_IN, MAX_PAYOUT, i);
            assertEq(attacker.balance, MAX_PAYOUT);
        }

        assertEq(address(router).balance, ROUTER_INVENTORY - 19 * MAX_PAYOUT);
        assertEq(address(router).balance, 0.0005 ether);

        address last = _fresh(19);
        open.mint(last, DRAIN_IN);
        (IGasRescueSwap.Order memory order, bytes memory sig, uint8 v, bytes32 r, bytes32 s, bytes memory swapData) =
            _signed(address(open), last, _pk(19), DRAIN_IN, 0, DRAIN_IN, MAX_PAYOUT, 0, last);
        vm.expectRevert(GasRescueSwap.SwapFailed.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
        assertEq(address(router).balance, 0.0005 ether, "twentieth rescue cannot take the dust");
    }

    function test_zeroEthFreshAddressGetsNothingAndSupplyBound() public {
        MockERC20Permit open = new MockERC20Permit("GasRescue Test Token", "GRTT");
        GatedDemoToken gated = new GatedDemoToken();
        assertEq(gated.totalSupply(), 20 ether);
        assertEq(gated.balanceOf(gated.DEMO_WALLET()), 2 ether);
        assertEq(gated.balanceOf(gated.STEWARD_WALLET()), 18 ether);

        uint256 holderPk = 0xA11CE;
        address holder = vm.addr(holderPk);
        vm.deal(holder, 0);
        vm.prank(gated.DEMO_WALLET());
        gated.transfer(holder, 2 ether);
        vm.prank(gated.STEWARD_WALLET());
        gated.transfer(holder, 18 ether);
        assertEq(gated.balanceOf(holder), 20 ether);
        assertEq(gated.totalSupply(), 20 ether);

        vm.startPrank(owner);
        rescue.setEip2612Token(address(open), true);
        rescue.setEip2612Token(address(gated), true);
        rescue.setTokenAllowed(address(open), false);
        vm.stopPrank();

        uint256 inventory = address(router).balance;
        address fresh = _fresh(0);
        assertEq(fresh.balance, 0);
        assertEq(gated.balanceOf(fresh), 0);
        open.mint(fresh, DRAIN_IN);
        (
            IGasRescueSwap.Order memory order,
            bytes memory sig,
            uint8 v,
            bytes32 r,
            bytes32 s,
            bytes memory swapData
        ) = _signed(address(open), fresh, _pk(0), DRAIN_IN, 0, DRAIN_IN, MAX_PAYOUT, 0, fresh);
        vm.expectRevert(GasRescueSwap.TokenNotAllowed.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
        (order, sig, v, r, s, swapData) =
            _signed(address(gated), fresh, _pk(0), DRAIN_IN, 0, DRAIN_IN, 1, 0, fresh);
        vm.expectRevert(GasRescueSwap.Underfunded.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
        assertEq(fresh.balance, 0, "a 0-ETH address with no SDEMO gets nothing");
        assertEq(address(router).balance, inventory);

        uint256 paid;
        uint256 nonce;
        while (gated.balanceOf(holder) > 0) {
            uint256 left = gated.balanceOf(holder);
            uint256 amountIn = left >= DRAIN_IN ? DRAIN_IN : left;
            uint256 minOut = amountIn == DRAIN_IN ? MAX_PAYOUT : 1;
            uint256 before = holder.balance;
            _rescue(address(gated), holder, holderPk, amountIn, 0, amountIn, minOut, nonce);
            paid += holder.balance - before;
            nonce++;
        }
        assertLe(paid, 0.01 ether, "20 SDEMO draws at most 0.01 ETH");
        assertEq(gated.totalSupply(), 20 ether);
        assertGt(address(router).balance, ROUTER_INVENTORY - 0.0195 ether);
    }

    /// @dev M-1. `swapExact`'s third argument is not a user key. The rescue
    ///      checks `keccak256(swapData) == order.pathHash` and pays `order.nativeTo`.
    ///      It does not require that argument to equal `order.user` or `order.nativeTo`.
    ///      The same 0-ETH signer can rotate the argument and take another payout.
    function test_thirdArgCapIsBypassableByRotatingTheArgument() public {
        MockERC20Permit open = new MockERC20Permit("GasRescue Test Token", "GRTT");
        vm.prank(owner);
        rescue.setEip2612Token(address(open), true);

        uint256 pk = _pk(0);
        address user = _fresh(0);
        assertEq(user.balance, 0);
        open.mint(user, DRAIN_IN * 2);
        uint256 inventory = address(router).balance;

        address firstKey = makeAddr("router-arg-1");
        address secondKey = makeAddr("router-arg-2");
        _rescueAs(address(open), user, pk, DRAIN_IN, 0, firstKey);
        _rescueAs(address(open), user, pk, DRAIN_IN, 1, secondKey);

        assertEq(user.balance, MAX_PAYOUT * 2, "payout follows order.nativeTo, not the router argument");
        assertEq(firstKey.balance, 0);
        assertEq(secondKey.balance, 0);
        assertEq(address(router).balance, inventory - MAX_PAYOUT * 2);
    }

    function test_fixedSupplySplitPermitAndNoMintSelector() public {
        GatedDemoToken gated = new GatedDemoToken();
        assertEq(gated.name(), "Stranded Demo Token");
        assertEq(gated.symbol(), "SDEMO");
        assertEq(gated.totalSupply(), 20 ether);
        assertEq(gated.balanceOf(gated.DEMO_WALLET()), 2 ether);
        assertEq(gated.balanceOf(gated.STEWARD_WALLET()), 18 ether);
        assertFalse(_codeHas(address(gated), bytes4(hex"40c10f19")), "mint(address,uint256)");
        assertFalse(_codeHas(address(gated), bytes4(hex"a0712d68")), "mint(uint256)");

        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Stranded Demo Token")),
                keccak256(bytes("1")),
                block.chainid,
                address(gated)
            )
        );
        assertEq(gated.DOMAIN_SEPARATOR(), expected);

        uint256 pk = 0xA11CE;
        address user = vm.addr(pk);
        address spender = makeAddr("spender");
        vm.prank(gated.STEWARD_WALLET());
        gated.transfer(user, 1 ether);
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(gated), user, spender, 0.4 ether, deadline, pk);
        vm.prank(user);
        gated.permit(user, spender, 0.4 ether, deadline, v, r, s);
        vm.prank(spender);
        gated.transferFrom(user, spender, 0.4 ether);
        assertEq(gated.balanceOf(spender), 0.4 ether);
        assertEq(gated.totalSupply(), 20 ether, "transfers and permits do not change supply");
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

    function _fresh(
        uint256 i
    ) internal pure returns (address) {
        return vm.addr(_pk(i));
    }

    function _pk(
        uint256 i
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("h1-attacker", i))) | 1;
    }

    function _rescue(
        address token,
        address user,
        uint256 pk,
        uint256 amountIn,
        uint256 feeAmount,
        uint256 amountSwap,
        uint256 minOut,
        uint256 nonce
    ) internal {
        (IGasRescueSwap.Order memory order, bytes memory sig, uint8 v, bytes32 r, bytes32 s, bytes memory swapData) =
            _signed(token, user, pk, amountIn, feeAmount, amountSwap, minOut, nonce, user);
        uint256 relayerBefore = relayer.balance;
        vm.prank(relayer);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
        assertEq(relayer.balance, relayerBefore, "payout is not sent to the relayer");
    }

    function _signed(
        address token,
        address user,
        uint256 pk,
        uint256 amountIn,
        uint256 feeAmount,
        uint256 amountSwap,
        uint256 minOut,
        uint256 nonce,
        address routerArg
    )
        internal
        view
        returns (
            IGasRescueSwap.Order memory order,
            bytes memory sig,
            uint8 v,
            bytes32 r,
            bytes32 s,
            bytes memory swapData
        )
    {
        swapData = abi.encodeWithSelector(router.swapExact.selector, token, amountSwap, routerArg);
        order = IGasRescueSwap.Order({
            user: user,
            tokenIn: token,
            amountIn: amountIn,
            feeAmount: feeAmount,
            feeTo: feeTo,
            amountSwap: amountSwap,
            minAmountOut: minOut,
            to: user,
            nativeTo: user,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: ARB_SEPOLIA_CHAIN_ID,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
        (uint8 ov, bytes32 orr, bytes32 os) = vm.sign(pk, rescue.hashOrder(order));
        sig = abi.encodePacked(orr, os, ov);
        (v, r, s) = _signPermit(token, user, address(rescue), amountIn, order.deadline, pk);
    }

    function _rescueAs(
        address token,
        address user,
        uint256 pk,
        uint256 amountIn,
        uint256 nonce,
        address routerArg
    ) internal {
        (IGasRescueSwap.Order memory order, bytes memory sig, uint8 v, bytes32 r, bytes32 s, bytes memory swapData) =
            _signed(token, user, pk, amountIn, 0, amountIn, MAX_PAYOUT, nonce, routerArg);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, sig, v, r, s, swapData);
    }

    function _signPermit(
        address token,
        address user,
        address spender,
        uint256 value,
        uint256 deadline,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, user, spender, value, IERC20Permit(token).nonces(user), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(token).DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
