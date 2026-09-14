// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {ArbSepoliaDemoPath} from "../src/ArbSepoliaDemoPath.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract ArbSepoliaDemoPathTest is Test {
    address internal constant GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address internal constant DRY = 0x1111111111111111111111111111111111111111;
    bytes32 internal constant WALLET_DRY = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

    function test_selector_matchesMockRouter() public pure {
        assertEq(ArbSepoliaDemoPath.SWAP_EXACT_SELECTOR, MockSwapRouter.swapExact.selector);
        assertEq(ArbSepoliaDemoPath.SWAP_EXACT_SELECTOR, bytes4(keccak256("swapExact(address,uint256,address)")));
    }

    function test_encode_matchesAbiEncodeWithSelector() public pure {
        bytes memory got = ArbSepoliaDemoPath.encodeSwapExact(GRTT, 0.2 ether, DRY);
        bytes memory exp = abi.encodeWithSelector(MockSwapRouter.swapExact.selector, GRTT, uint256(0.2 ether), DRY);
        assertEq(keccak256(got), keccak256(exp));
        assertEq(got, exp);
    }

    function test_pathHash_grttAndGmockDiffer() public pure {
        bytes32 grtt = ArbSepoliaDemoPath.dryGrttFixturePathHash();
        bytes32 gmock = ArbSepoliaDemoPath.dryGmockFixturePathHash();
        assertTrue(grtt != bytes32(0));
        assertTrue(gmock != bytes32(0));
        assertTrue(grtt != gmock, "tokenIn is bound into pathHash");
        assertTrue(grtt != WALLET_DRY, "live formula is not the wallet dry placeholder");
        assertTrue(gmock != WALLET_DRY);
        assertTrue(ArbSepoliaDemoPath.isWalletDryPlaceholder(WALLET_DRY));
        assertFalse(ArbSepoliaDemoPath.isWalletDryPlaceholder(grtt));
    }

    function test_pathHash_bindsAmountAndNativeTo() public pure {
        bytes32 a = ArbSepoliaDemoPath.pathHash(GRTT, 0.2 ether, DRY);
        bytes32 b = ArbSepoliaDemoPath.pathHash(GRTT, 0.3 ether, DRY);
        bytes32 c = ArbSepoliaDemoPath.pathHash(GRTT, 0.2 ether, address(uint160(2)));
        assertTrue(a != b);
        assertTrue(a != c);
        assertEq(a, ArbSepoliaDemoPath.dryGrttPathHash(DRY));
        assertEq(a, ArbSepoliaDemoPath.dryDemoPathHash(GRTT, DRY));
    }

    function test_matches_rejectsDryPlaceholderAndWrongRoute() public pure {
        bytes32 live = ArbSepoliaDemoPath.dryGrttFixturePathHash();
        assertTrue(ArbSepoliaDemoPath.matches(GRTT, 0.2 ether, DRY, live));
        assertFalse(ArbSepoliaDemoPath.matches(GRTT, 0.2 ether, DRY, WALLET_DRY));
        assertFalse(ArbSepoliaDemoPath.matches(GMOCK, 0.2 ether, DRY, live));
        assertFalse(ArbSepoliaDemoPath.matches(GRTT, 0.2 ether, DRY, bytes32(0)));
    }

    function test_supportedTokens_onlyGrttAndGmock() public {
        assertTrue(ArbSepoliaDemoPath.isSupportedDemoToken(GRTT));
        assertTrue(ArbSepoliaDemoPath.isSupportedDemoToken(GMOCK));
        assertFalse(ArbSepoliaDemoPath.isSupportedDemoToken(ArbSepoliaDemoPath.WETH));
        vm.expectRevert(ArbSepoliaDemoPath.UnsupportedToken.selector);
        this.dryDemoPathHashExternal(ArbSepoliaDemoPath.WETH, DRY);
    }

    function test_encode_revertsZeroOrZeroAmount() public {
        vm.expectRevert(ArbSepoliaDemoPath.ZeroAddress.selector);
        this.encodeExternal(address(0), 1, DRY);
        vm.expectRevert(ArbSepoliaDemoPath.ZeroAddress.selector);
        this.encodeExternal(GRTT, 1, address(0));
        vm.expectRevert(ArbSepoliaDemoPath.InvalidAmount.selector);
        this.encodeExternal(GRTT, 0, DRY);
    }

    function test_demoAmounts_matchWalletDryMock() public pure {
        assertEq(ArbSepoliaDemoPath.DEMO_AMOUNT_IN, 1 ether);
        assertEq(ArbSepoliaDemoPath.DEMO_AMOUNT_SWAP, 2 * 10 ** 17);
        assertEq(ArbSepoliaDemoPath.DEMO_FEE_AMOUNT, 10 ** 16);
        assertEq(ArbSepoliaDemoPath.DEMO_AMOUNT_REMAINDER, 79 * 10 ** 16);
        assertEq(
            ArbSepoliaDemoPath.DEMO_AMOUNT_IN,
            ArbSepoliaDemoPath.DEMO_AMOUNT_SWAP + ArbSepoliaDemoPath.DEMO_FEE_AMOUNT
                + ArbSepoliaDemoPath.DEMO_AMOUNT_REMAINDER
        );
    }

    function test_liveAddresses_pinned() public pure {
        assertEq(ArbSepoliaDemoPath.CHAIN_ID, 421_614);
        assertEq(ArbSepoliaDemoPath.SWAP, 0x65e712222745A8FCCbF038A90Fa75caB0867993D);
        assertEq(ArbSepoliaDemoPath.ROUTER, 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8);
        assertEq(ArbSepoliaDemoPath.RELAYER, 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6);
        assertTrue(ArbSepoliaDemoPath.OWNER != ArbSepoliaDemoPath.RELAYER);
    }

    function encodeExternal(
        address tokenIn,
        uint256 amountSwap,
        address nativeTo
    ) external pure returns (bytes memory) {
        return ArbSepoliaDemoPath.encodeSwapExact(tokenIn, amountSwap, nativeTo);
    }

    function dryDemoPathHashExternal(
        address tokenIn,
        address nativeTo
    ) external pure returns (bytes32) {
        return ArbSepoliaDemoPath.dryDemoPathHash(tokenIn, nativeTo);
    }
}
