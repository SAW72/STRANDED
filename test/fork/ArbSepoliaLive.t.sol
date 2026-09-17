// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {ArbSepoliaDemoPath} from "../../src/ArbSepoliaDemoPath.sol";
import {GasRescueLens} from "../../src/GasRescueLens.sol";
import {HackQuestStatus} from "../../script/HackQuestStatus.s.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";
import {IGasRescueSwapViews} from "../../src/interfaces/IGasRescueSwapViews.sol";

/// @notice Fork smoke against live Arb Sepolia `GasRescueSwap`.
///         Skips cleanly when `ARB_SEPOLIA_RPC_URL` is unset (CI / default `forge test`).
///         Does not broadcast. Does not enable Permit2.
contract ArbSepoliaLiveTest is Test {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant LIVE_WETH = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address internal constant LIVE_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant LIVE_GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address internal constant LIVE_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    address internal constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 internal constant FROZEN_ORDER_TYPEHASH = keccak256(
        "Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)"
    );

    IGasRescueSwapViews internal swap;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            return;
        }
        vm.createSelectFork(rpc);
        swap = IGasRescueSwapViews(LIVE_SWAP);
        forked = true;
    }

    modifier onlyFork() {
        if (!forked) {
            vm.skip(true);
        }
        _;
    }

    function test_live_immutablesAndPolicy() public onlyFork {
        assertEq(block.chainid, ARB_SEPOLIA_CHAIN_ID);
        assertEq(swap.owner(), LIVE_OWNER);
        assertEq(swap.pendingOwner(), address(0));
        assertFalse(swap.paused(), "live swap must not be paused for demo");
        assertEq(swap.weth(), LIVE_WETH);
        assertEq(swap.permit2(), address(0), "Permit2 unwired");
        assertFalse(swap.permit2Enabled(), "Permit2 stays disabled");
        assertTrue(swap.relayers(LIVE_RELAYER));
        assertFalse(swap.relayers(LIVE_OWNER), "owner is not the relayer hot key");
        assertEq(swap.ARB_SEPOLIA_CHAIN_ID(), ARB_SEPOLIA_CHAIN_ID);
        assertEq(swap.ORDER_TYPEHASH(), FROZEN_ORDER_TYPEHASH);
        assertTrue(swap.DOMAIN_SEPARATOR() != bytes32(0));
    }

    function test_live_allowlists() public onlyFork {
        assertTrue(swap.allowedTokens(LIVE_GRTT), "GRTT is the demo token");
        assertTrue(swap.eip2612Tokens(LIVE_GRTT));
        assertTrue(swap.allowedTokens(LIVE_GMOCK), "gMOCK also allowlisted");
        assertTrue(swap.eip2612Tokens(LIVE_GMOCK));
        assertTrue(swap.allowedRouters(LIVE_ROUTER));
    }

    function test_live_criticalSelectors() public onlyFork {
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("paused()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("permit2Enabled()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("relayers(address)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("DOMAIN_SEPARATOR()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("setPermit2Enabled(bool)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("setPermit2(address,bool)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("weth()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("owner()"))));
    }

    function test_live_hashOrder_nonzero() public onlyFork {
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: LIVE_OWNER,
            tokenIn: LIVE_GRTT,
            amountIn: 1,
            feeAmount: 0,
            feeTo: LIVE_OWNER,
            amountSwap: 1,
            minAmountOut: 1,
            to: LIVE_OWNER,
            nativeTo: LIVE_OWNER,
            router: LIVE_ROUTER,
            pathHash: bytes32(uint256(1)),
            chainId: ARB_SEPOLIA_CHAIN_ID,
            deadline: 1,
            nonce: 0
        });
        assertTrue(swap.hashOrder(order) != bytes32(0));
    }

    function test_live_bytecodeDriftsFromTip_afterF5F6() public onlyFork {
        // 2026-09-14 live: F-1 immutable Permit2, but no public CANONICAL_PERMIT2 getter
        // and no rescueReceipt (added with StrandedRegistry proof-gate).
        assertFalse(_hasSelector(LIVE_SWAP, bytes4(keccak256("CANONICAL_PERMIT2()"))), "live lacks F-5 getter");
        assertFalse(
            _hasSelector(LIVE_SWAP, bytes4(keccak256("rescueReceipt(address,uint256)"))), "live lacks rescueReceipt"
        );
        assertTrue(_setPermit2Immutable(LIVE_SWAP), "live Arb has F-1 Permit2Immutable");

        GasRescueLens lens = new GasRescueLens(LIVE_SWAP);
        GasRescueLens.Status memory s = lens.status();
        assertTrue(s.boundToLiveArb);
        assertFalse(s.permit2Enabled);
        assertTrue(s.permit2IsCanonicalOrZero);
        assertEq(s.owner, LIVE_OWNER);

        GasRescueLens.BytecodeHints memory h = lens.bytecodeHints();
        assertTrue(h.tipMatchesLiveViews, "hints flag the 2026-09-14 live gap");
        assertTrue(h.setPermit2IsImmutable);
        assertFalse(h.hasCanonicalPermit2Getter);
        assertFalse(h.hasRescueReceipt);

        GasRescueLens.AllowlistCheck memory a = lens.arbDemoAllowlist(LIVE_OWNER, 0);
        assertTrue(a.relayerAllowed);
        assertTrue(a.tokenAllowed);
        assertTrue(a.tokenEip2612);
        assertTrue(a.routerAllowed);

        address dryNative = ArbSepoliaDemoPath.DRY_NATIVE_TO;
        GasRescueLens.HackQuestReport memory hq = lens.hackQuestReport(LIVE_OWNER, 0, 0, dryNative, bytes32(0));
        assertTrue(hq.swapStatus.boundToLiveArb);
        assertFalse(hq.swapStatus.permit2Enabled);
        assertTrue(hq.readiness.permit2Off);
        assertTrue(hq.readiness.notPaused);
        assertTrue(hq.readiness.relayerOk);
        assertTrue(hq.readiness.tokenAllowed);
        assertTrue(hq.readiness.tokenEip2612);
        assertTrue(hq.readiness.routerAllowed);
        assertFalse(hq.readiness.userFunded, "amountIn 0 is a probe; never funded");
        assertFalse(hq.readiness.ready, "ready requires amountIn>0 plus a real GRTT balance");
        assertFalse(hq.bytecode.hasRescueReceipt, "live still lacks rescueReceipt - do not claim redeploy");
        assertFalse(hq.receipt.supported);
        assertEq(hq.paths.grttPathHash, ArbSepoliaDemoPath.dryGrttPathHash(dryNative));
        assertEq(hq.paths.gmockPathHash, ArbSepoliaDemoPath.dryGmockPathHash(dryNative));
        assertTrue(lens.matchesDemoPath(LIVE_GRTT, 0.2 ether, dryNative, hq.paths.grttPathHash));
    }

    function test_live_hackQuestStatus_day4Fields() public onlyFork {
        HackQuestStatus script = new HackQuestStatus();
        vm.setEnv("GAS_RESCUE_SWAP_ADDRESS", vm.toString(LIVE_SWAP));

        string memory json = script.reportJson(LIVE_OWNER, 0, 0, ArbSepoliaDemoPath.DRY_NATIVE_TO, bytes32(0));
        assertTrue(_contains(json, '"product":"GasRescueSwap"'));
        assertTrue(_contains(json, '"buildathon":"2026-09-17-day4"'));
        assertTrue(_contains(json, '"boundToLiveArb":true'));
        assertTrue(_contains(json, '"probeOnly":true'));
        assertTrue(_contains(json, '"ready":false'));
        assertTrue(_contains(json, '"permit2Enabled":false'));
        assertTrue(
            _contains(json, '"liveVsTip":"live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy"'),
            "live still lacks tip getters — do not claim redeploy"
        );
        assertTrue(
            _contains(
                json,
                '"feePostureNote":"match=flat-1pct-tokenIn; amountSwap=20pct-gas-topup-not-fee; slip=100bps-fail-closed; usd-hybrid=deferred-not-a-relayer-bug; owner=Relayer-Backend-do-not-rewrite"'
            )
        );
        if (LIVE_RELAYER.balance < 0.10 ether) {
            assertTrue(_contains(json, '"hotWalletUnderfunded":true'), "KNOW: hot wallet still below ~0.10 ETH");
        } else {
            assertTrue(_contains(json, '"hotWalletUnderfunded":false'));
        }
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

    function _hasSelector(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector, address(0), uint256(0)));
        if (ok) return true;
        return data.length > 0;
    }

    function _setPermit2Immutable(
        address target
    ) internal view returns (bool) {
        (bool ok, bytes memory data) =
            target.staticcall(abi.encodeWithSelector(bytes4(keccak256("setPermit2(address,bool)")), address(0), false));
        if (ok || data.length < 4) return false;
        bytes4 err;
        assembly {
            err := mload(add(data, 32))
        }
        return err == bytes4(0xe8d9f070);
    }
}
