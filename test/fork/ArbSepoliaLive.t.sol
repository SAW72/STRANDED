// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {GasRescueLens} from "../../src/GasRescueLens.sol";
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

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        swap = IGasRescueSwapViews(LIVE_SWAP);
    }

    function test_live_immutablesAndPolicy() public view {
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

    function test_live_allowlists() public view {
        assertTrue(swap.allowedTokens(LIVE_GRTT), "GRTT is the demo token");
        assertTrue(swap.eip2612Tokens(LIVE_GRTT));
        assertTrue(swap.allowedTokens(LIVE_GMOCK), "gMOCK also allowlisted");
        assertTrue(swap.eip2612Tokens(LIVE_GMOCK));
        assertTrue(swap.allowedRouters(LIVE_ROUTER));
    }

    function test_live_criticalSelectors() public view {
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("paused()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("permit2Enabled()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("relayers(address)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("DOMAIN_SEPARATOR()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("setPermit2Enabled(bool)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("setPermit2(address,bool)"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("weth()"))));
        assertTrue(_hasSelector(LIVE_SWAP, bytes4(keccak256("owner()"))));
    }

    function test_live_hashOrder_nonzero() public view {
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

    function test_live_bytecodeDriftsFromTip_afterF5F6() public {
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
