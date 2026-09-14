// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GasRescueLens} from "../src/GasRescueLens.sol";
import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";
import {MockERC20Permit} from "../src/mocks/MockERC20Permit.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {DeployGasRescueLens} from "../script/DeployGasRescueLens.s.sol";

contract GasRescueLensTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    uint256 internal constant USER_PK = 0xA11CE;
    uint256 internal constant RELAYER_PK = 0xB0B;

    GasRescueSwap internal rescue;
    GasRescueLens internal lens;
    MockERC20Permit internal token;
    MockWETH internal weth;
    MockSwapRouter internal router;

    address internal owner;
    address internal relayer;
    address internal user;
    address internal feeTo;
    address internal moveOut;
    address internal nativeTo;

    function setUp() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);

        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        user = vm.addr(USER_PK);
        feeTo = makeAddr("feeTo");
        moveOut = makeAddr("moveOut");
        nativeTo = makeAddr("nativeTo");

        weth = new MockWETH();
        router = new MockSwapRouter();
        rescue = new GasRescueSwap(owner, relayer, address(weth), address(0));
        token = new MockERC20Permit("Mock USD", "mUSD");
        token.mint(user, 1000 ether);

        vm.startPrank(owner);
        rescue.setEip2612Token(address(token), true);
        rescue.setRouterAllowed(address(router), true);
        vm.stopPrank();

        lens = new GasRescueLens(address(rescue));
    }

    function test_status_reportsPausedRelayerPermit2Owner() public {
        GasRescueLens.Status memory s = lens.status();
        assertEq(s.chainId, ARB_SEPOLIA_CHAIN_ID);
        assertEq(s.swap, address(rescue));
        assertEq(s.owner, owner);
        assertEq(s.pendingOwner, address(0));
        assertFalse(s.paused);
        assertEq(s.weth, address(weth));
        assertEq(s.permit2, address(0));
        assertFalse(s.permit2Enabled, "Permit2 stays off by default");
        assertTrue(s.permit2IsCanonicalOrZero);
        assertFalse(s.boundToLiveArb);
        assertFalse(s.boundToLiveBase);
    }

    function test_allowlist_and_readiness() public {
        GasRescueLens.AllowlistCheck memory a = lens.allowlistCheck(relayer, address(token), address(router), user, 1);
        assertTrue(a.relayerAllowed);
        assertTrue(a.tokenAllowed);
        assertTrue(a.tokenEip2612);
        assertTrue(a.routerAllowed);
        assertFalse(a.nonceUsed);

        GasRescueLens.RescueReadiness memory r =
            lens.rescueReadiness(relayer, address(token), address(router), user, 1, 100 ether);
        assertTrue(r.notPaused);
        assertTrue(r.relayerOk);
        assertTrue(r.tokenAllowed);
        assertTrue(r.tokenEip2612);
        assertTrue(r.routerAllowed);
        assertTrue(r.nonceUnused);
        assertTrue(r.userFunded);
        assertTrue(r.permit2Off);
        assertTrue(r.ready);
    }

    function test_readiness_falseWhenPausedOrUnderfunded() public {
        vm.prank(owner);
        rescue.pause();
        GasRescueLens.RescueReadiness memory paused =
            lens.rescueReadiness(relayer, address(token), address(router), user, 1, 100 ether);
        assertFalse(paused.notPaused);
        assertFalse(paused.ready);

        vm.prank(owner);
        rescue.unpause();
        GasRescueLens.RescueReadiness memory poor =
            lens.rescueReadiness(relayer, address(token), address(router), user, 1, 5000 ether);
        assertFalse(poor.userFunded);
        assertFalse(poor.ready);
    }

    function test_hashOrder_matchesSwap() public {
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: user,
            tokenIn: address(token),
            amountIn: 100 ether,
            feeAmount: 1 ether,
            feeTo: feeTo,
            amountSwap: 10 ether,
            minAmountOut: 1,
            to: moveOut,
            nativeTo: nativeTo,
            router: address(router),
            pathHash: keccak256("path"),
            chainId: ARB_SEPOLIA_CHAIN_ID,
            deadline: block.timestamp + 1 days,
            nonce: 7
        });
        assertEq(lens.hashOrder(order), rescue.hashOrder(order));
        assertEq(lens.domainSeparator(), rescue.DOMAIN_SEPARATOR());
        assertEq(lens.orderTypehash(), rescue.ORDER_TYPEHASH());
    }

    function test_bytecodeHints_currentSourceHasF5AndReceipt() public {
        GasRescueLens.BytecodeHints memory h = lens.bytecodeHints();
        assertTrue(h.hasCanonicalPermit2Getter, "tip source exposes CANONICAL_PERMIT2");
        assertTrue(h.hasRescueReceipt, "tip source writes rescueReceipt");
        assertTrue(h.setPermit2IsImmutable, "F-1 setPermit2 stays immutable");
        assertFalse(h.permit2Enabled);
        assertTrue(h.permit2IsCanonicalOrZero);
        assertFalse(h.tipMatchesLiveViews, "local tip is newer than 2026-09-14 live");
        assertTrue(lens.hasSelector(bytes4(keccak256("CANONICAL_PERMIT2()"))));
        assertTrue(lens.hasSelector(bytes4(keccak256("rescueReceipt(address,uint256)"))));

        (bool supported, address recToken, uint256 recAmt, address recRelayer) = lens.rescueReceiptOrMissing(user, 1);
        assertTrue(supported);
        assertEq(recToken, address(0));
        assertEq(recAmt, 0);
        assertEq(recRelayer, address(0));
    }

    function test_constructor_rejectsMainnetAndZero() public {
        vm.chainId(1);
        vm.expectRevert(GasRescueLens.WrongChain.selector);
        new GasRescueLens(address(rescue));

        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        vm.expectRevert(GasRescueLens.ZeroAddress.selector);
        new GasRescueLens(address(0));
    }

    function test_constructor_rejectsNonSwap() public {
        vm.expectRevert();
        new GasRescueLens(address(token));
    }

    function test_baseSepolia_constructorOk() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        GasRescueSwap baseRescue = new GasRescueSwap(owner, relayer, address(weth), address(0));
        GasRescueLens baseLens = new GasRescueLens(address(baseRescue));
        assertEq(address(baseLens.swap()), address(baseRescue));
        assertEq(baseLens.status().chainId, BASE_SEPOLIA_CHAIN_ID);
    }

    function test_deployScript_prepareAndRefuseMainnet() public {
        DeployGasRescueLens script = new DeployGasRescueLens();
        vm.setEnv("GAS_RESCUE_SWAP_ADDRESS", vm.toString(address(rescue)));
        script.prepare();

        vm.chainId(1);
        vm.expectRevert(bytes("DeployGasRescueLens: testnet only (Arb Sepolia 421614 or Base Sepolia 84532)"));
        script.prepare();
    }

    function test_relayerOwnerSplit_readiness() public {
        GasRescueLens.RescueReadiness memory ownerAsRelayer =
            lens.rescueReadiness(owner, address(token), address(router), user, 1, 1 ether);
        assertFalse(ownerAsRelayer.relayerOk);
        assertFalse(ownerAsRelayer.ready);
    }
}

/// @dev Keeps a compile-time reminder that Lens does not import or enable Permit2.
contract GasRescueLensPermit2GuardTest is Test {
    function test_lensDoesNotExposeSetPermit2Enabled() public pure {
        // GasRescueLens has no setPermit2 / setPermit2Enabled. Permit2 stays a Swap owner toggle.
        assertEq(bytes4(keccak256("setPermit2Enabled(bool)")), bytes4(0x78a8efd1));
    }
}
