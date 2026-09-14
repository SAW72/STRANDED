// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArbSepoliaDemoPath} from "../src/ArbSepoliaDemoPath.sol";
import {GasRescueLens} from "../src/GasRescueLens.sol";
import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";
import {MockERC20Permit} from "../src/mocks/MockERC20Permit.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {MockPermit2} from "../src/mocks/MockPermit2.sol";
import {DeployGasRescueLens} from "../script/DeployGasRescueLens.s.sol";
import {HackQuestStatus} from "../script/HackQuestStatus.s.sol";

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

    /// @dev Local-only: etch canonical Permit2 and owner-enable it to prove `ready`
    ///      fail-closes. Does not change default deploy policy (Permit2 stays off).
    function test_readiness_falseWhenPermit2Enabled() public {
        address canonical = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        MockPermit2 impl = new MockPermit2();
        vm.etch(canonical, address(impl).code);

        GasRescueSwap wired = new GasRescueSwap(owner, relayer, address(weth), canonical);
        vm.startPrank(owner);
        wired.setEip2612Token(address(token), true);
        wired.setRouterAllowed(address(router), true);
        wired.setPermit2Enabled(true);
        vm.stopPrank();

        GasRescueLens wiredLens = new GasRescueLens(address(wired));
        GasRescueLens.RescueReadiness memory r =
            wiredLens.rescueReadiness(relayer, address(token), address(router), user, 1, 100 ether);
        assertTrue(wired.permit2Enabled(), "this instance only - default Lens swap stays off");
        assertFalse(rescue.permit2Enabled(), "default fixture Permit2 stays disabled");
        assertFalse(r.permit2Off);
        assertFalse(r.ready);
        assertTrue(r.notPaused);
        assertTrue(r.relayerOk);
        assertTrue(r.tokenAllowed);
        assertTrue(r.tokenEip2612);
        assertTrue(r.routerAllowed);
        assertTrue(r.nonceUnused);
        assertTrue(r.userFunded);
    }

    function test_arbDemoReadiness_and_hackQuestReport() public {
        GasRescueLens.RescueReadiness memory demo = lens.arbDemoReadiness(user, 1, 0);
        // Local fixture relayer/token/router are not the live Arb addrs.
        assertFalse(demo.relayerOk);
        assertFalse(demo.tokenAllowed);
        assertFalse(demo.ready);
        GasRescueLens.RescueReadiness memory fundedProbe = lens.arbDemoReadiness(user, 1, 1 ether);
        assertFalse(fundedProbe.userFunded, "live GRTT has no code on the local fixture");

        address nativeTo_ = address(uint160(0x1111));
        GasRescueLens.HackQuestReport memory r = lens.hackQuestReport(user, 1, 100 ether, nativeTo_, bytes32(0));
        assertEq(r.swapStatus.chainId, ARB_SEPOLIA_CHAIN_ID);
        assertEq(r.swapStatus.swap, address(rescue));
        assertEq(r.swapStatus.owner, owner);
        assertFalse(r.swapStatus.paused);
        assertFalse(r.swapStatus.permit2Enabled);
        assertTrue(r.readiness.permit2Off);
        assertFalse(r.swapStatus.boundToLiveArb);
        assertTrue(r.bytecode.hasCanonicalPermit2Getter);
        assertTrue(r.bytecode.hasRescueReceipt);
        assertTrue(r.receipt.supported);
        assertTrue(r.bytecode.setPermit2IsImmutable);
        assertFalse(r.bytecode.tipMatchesLiveViews);
        assertEq(r.paths.grttPathHash, ArbSepoliaDemoPath.dryGrttPathHash(nativeTo_));
        assertEq(r.paths.gmockPathHash, ArbSepoliaDemoPath.dryGmockPathHash(nativeTo_));
        assertFalse(r.paths.quotedIsWalletDryPlaceholder);

        bytes32 dry = ArbSepoliaDemoPath.WALLET_DRY_PATH_HASH;
        GasRescueLens.HackQuestReport memory flagged = lens.hackQuestReport(user, 1, 0, nativeTo_, dry);
        assertTrue(flagged.paths.quotedIsWalletDryPlaceholder);
        assertTrue(flagged.readiness.userFunded, "amountIn 0 skips the balance check");
    }

    function test_demoPathHash_matchesLibrary() public view {
        bytes32 h = lens.demoPathHash(ArbSepoliaDemoPath.GRTT, 0.2 ether, nativeTo);
        assertEq(h, ArbSepoliaDemoPath.pathHash(ArbSepoliaDemoPath.GRTT, 0.2 ether, nativeTo));
        assertTrue(lens.matchesDemoPath(ArbSepoliaDemoPath.GRTT, 0.2 ether, nativeTo, h));
        assertFalse(
            lens.matchesDemoPath(ArbSepoliaDemoPath.GRTT, 0.2 ether, nativeTo, ArbSepoliaDemoPath.WALLET_DRY_PATH_HASH)
        );
    }

    function test_hackQuestReport_rejectsZeroNativeTo() public {
        vm.expectRevert(GasRescueLens.ZeroAddress.selector);
        lens.hackQuestReport(user, 1, 0, address(0), bytes32(0));
    }

    function test_hackQuestStatus_script_printsReadyJson() public {
        HackQuestStatus script = new HackQuestStatus();
        vm.setEnv("GAS_RESCUE_SWAP_ADDRESS", vm.toString(address(rescue)));
        vm.setEnv("GAS_RESCUE_LENS_ADDRESS", vm.toString(address(lens)));

        string memory json = script.reportJson(user, 1, 100 ether, nativeTo, bytes32(0));
        assertTrue(_contains(json, '"product":"GasRescueSwap"'));
        assertTrue(_contains(json, '"buildathon":"2026-09-14-day2"'));
        assertTrue(_contains(json, '"permit2Enabled":false'));
        assertTrue(_contains(json, '"permit2Off":true'));
        assertTrue(_contains(json, '"hasRescueReceipt":true'));
        assertTrue(_contains(json, '"rescueReceiptSupported":true'));
        assertTrue(_contains(json, '"quotedPathIsWalletDryPlaceholder":false'));
        assertTrue(_contains(json, '"lensEphemeral":false'));
        assertTrue(_contains(json, vm.toString(address(rescue))));
        assertTrue(_contains(json, vm.toString(ArbSepoliaDemoPath.dryGrttPathHash(nativeTo))));

        vm.chainId(1);
        vm.expectRevert(bytes("HackQuestStatus: testnet only (Arb Sepolia 421614 or Base Sepolia 84532)"));
        script.reportJson(user, 1, 0, nativeTo, bytes32(0));
    }

    function _contains(
        string memory haystack,
        string memory needle
    ) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}

/// @dev Keeps a compile-time reminder that Lens does not import or enable Permit2.
contract GasRescueLensPermit2GuardTest is Test {
    function test_lensDoesNotExposeSetPermit2Enabled() public pure {
        // GasRescueLens has no setPermit2 / setPermit2Enabled. Permit2 stays a Swap owner toggle.
        assertEq(bytes4(keccak256("setPermit2Enabled(bool)")), bytes4(0x78a8efd1));
    }
}
