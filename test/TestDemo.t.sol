// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {B4_DelistStaleAllowlist} from "../script/TestDemoSupply.s.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {TestDemoFaucet} from "../src/TestDemoFaucet.sol";
import {TestDemoSteps} from "../script/TestDemoSupply.s.sol";
import {TestDemoToken} from "../src/TestDemoToken.sol";

/// @notice tDEMO supply, faucet limits, and the Base router cap.
///         Mutation oracles (see test/mutation/prove-test-demo-limits.sh):
///         `test_drip_paysExactlyTwo`, `test_secondDrip_revertsUntil24h`,
///         `test_empty_revertsFaucetEmpty`, `test_quote_aboveTwoTokens_isCapped`.
contract TestDemoTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    uint256 internal constant RATE_NUMERATOR = 50_000_000_000_000;
    uint256 internal constant RATE_DENOMINATOR = 1e18;
    uint256 internal constant MAX_PAYOUT = 0.0001 ether;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes4 internal constant MINT_ADDRESS_UINT = 0x40c10f19;
    bytes4 internal constant MINT_UINT = 0xa0712d68;
    bytes4 internal constant OWNER = 0x8da5cb5b;

    address internal constant SPENCER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;

    TestDemoFaucet internal faucet;
    TestDemoToken internal token;
    LockedDemoSwapRouter internal router;
    TestDemoSteps internal steps;
    address internal rescue;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.warp(1_000_000);
        faucet = new TestDemoFaucet();
        token = faucet.token();
        rescue = makeAddr("rescue");
        router = new LockedDemoSwapRouter(makeAddr("owner"), rescue, RATE_NUMERATOR, RATE_DENOMINATOR, MAX_PAYOUT);
        steps = new TestDemoSteps();
        vm.setEnv("TEST_DEMO_BROADCAST_OK", "1");
    }

    function test_token_fixedSupplyNoMintNoOwner() public view {
        assertEq(token.name(), unicode"Stranded TEST Demo — No Value");
        assertEq(token.symbol(), "tDEMO");
        assertEq(token.decimals(), 18);
        assertEq(token.NOTICE(), token.NOTICE());
        assertTrue(bytes(token.NOTICE()).length > 0);
        assertEq(token.TOTAL_SUPPLY(), 1_000_000_000_000 ether);
        assertEq(token.totalSupply(), 1_000_000_000_000 ether);
        assertEq(token.faucet(), address(faucet));
        assertEq(token.balanceOf(address(faucet)), token.totalSupply());
        assertFalse(_codeHas(address(token), MINT_ADDRESS_UINT), "mint(address,uint256)");
        assertFalse(_codeHas(address(token), MINT_UINT), "mint(uint256)");
        assertFalse(_codeHas(address(token), OWNER), "owner()");
        assertFalse(_codeHas(address(faucet), OWNER), "faucet owner()");
        assertFalse(_codeHas(address(faucet), MINT_ADDRESS_UINT), "faucet mint");
    }

    function test_notice_statesTestnetAndNoValue() public view {
        string memory notice = token.NOTICE();
        assertTrue(_contains(notice, "Testnet only"));
        assertTrue(_contains(notice, "84532"));
        assertTrue(_contains(notice, "421614"));
        assertTrue(_contains(notice, "No monetary value"));
        assertTrue(_contains(notice, "Not for sale"));
        assertTrue(_contains(notice, "Not a reward"));
    }

    function test_constructor_rejectsMainnetAndZeroFaucet() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(TestDemoToken.WrongChain.selector, uint256(1)));
        new TestDemoToken(address(1));
        vm.expectRevert(abi.encodeWithSelector(TestDemoFaucet.WrongChain.selector, uint256(1)));
        new TestDemoFaucet();

        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(TestDemoToken.ZeroAddress.selector);
        new TestDemoToken(address(0));
    }

    function test_deploysOnBothTestnets() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        TestDemoFaucet arb = new TestDemoFaucet();
        assertEq(arb.token().totalSupply(), arb.token().TOTAL_SUPPLY());
        assertEq(block.chainid, ARB_SEPOLIA_CHAIN_ID);

        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        TestDemoFaucet base = new TestDemoFaucet();
        assertEq(base.token().totalSupply(), 1_000_000_000_000 ether);
    }

    function test_permitDomain_usesNameAndChain() public {
        uint256 pk = 0xA11CE;
        address user = vm.addr(pk);
        vm.prank(address(faucet));
        token.transfer(user, 1 ether);

        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(unicode"Stranded TEST Demo — No Value")),
                keccak256(bytes("1")),
                BASE_SEPOLIA_CHAIN_ID,
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), expected);

        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(user, spender, 1 ether, deadline, pk);
        token.permit(user, spender, 1 ether, deadline, v, r, s);
        assertEq(token.allowance(user, spender), 1 ether);

        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        TestDemoToken arb = new TestDemoFaucet().token();
        assertTrue(arb.DOMAIN_SEPARATOR() != expected);
    }

    function test_drip_paysExactlyTwo() public {
        address user = makeAddr("user");
        uint256 supply = token.totalSupply();
        vm.prank(user);
        faucet.drip();
        assertEq(token.balanceOf(user), 2 ether);
        assertEq(token.balanceOf(address(faucet)), supply - 2 ether);
        assertEq(token.totalSupply(), supply);
        assertEq(faucet.nextDrip(user), block.timestamp + 1 days);
    }

    function test_secondDrip_revertsUntil24h() public {
        address user = makeAddr("user");
        uint256 started = block.timestamp;
        vm.prank(user);
        faucet.drip();
        // Hardcoded 24h. Reading COOLDOWN() would let a shorter constant pass.
        assertEq(faucet.nextDrip(user), started + 1 days);

        vm.warp(started + 1 days - 1);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(TestDemoFaucet.DripCooldown.selector, started + 1 days));
        faucet.drip();
        assertEq(token.balanceOf(user), 2 ether);

        vm.warp(started + 1 days);
        vm.prank(user);
        faucet.drip();
        assertEq(token.balanceOf(user), 4 ether);
    }

    function test_otherWallet_dripsDuringCooldown() public {
        address first = makeAddr("first");
        address second = makeAddr("second");
        vm.prank(first);
        faucet.drip();
        vm.prank(second);
        faucet.drip();
        assertEq(token.balanceOf(first), 2 ether);
        assertEq(token.balanceOf(second), 2 ether);
    }

    function test_empty_revertsFaucetEmpty() public {
        uint256 left = token.balanceOf(address(faucet));
        vm.prank(address(faucet));
        token.transfer(makeAddr("sink"), left - 1);
        assertEq(token.balanceOf(address(faucet)), 1);

        vm.expectRevert(TestDemoFaucet.FaucetEmpty.selector);
        faucet.drip();

        vm.prank(makeAddr("sink"));
        token.transfer(address(faucet), 2 ether - 1);
        assertEq(token.balanceOf(address(faucet)), 2 ether);
        faucet.drip();
        assertEq(token.balanceOf(address(this)), 2 ether);

        vm.expectRevert(TestDemoFaucet.FaucetEmpty.selector);
        faucet.drip();
    }

    function testFuzz_cooldownBoundary(
        uint256 elapsed
    ) public {
        elapsed = bound(elapsed, 0, 10 days);
        address user = makeAddr("fuzz-user");
        vm.prank(user);
        faucet.drip();
        uint256 ready = faucet.nextDrip(user);
        vm.warp(block.timestamp + elapsed);
        if (block.timestamp < ready) {
            vm.prank(user);
            vm.expectRevert(abi.encodeWithSelector(TestDemoFaucet.DripCooldown.selector, ready));
            faucet.drip();
            assertEq(token.balanceOf(user), 2 ether);
        } else {
            vm.prank(user);
            faucet.drip();
            assertEq(token.balanceOf(user), 4 ether);
        }
    }

    function testFuzz_supplyConserved(
        uint8 wallets,
        uint256 seed
    ) public {
        wallets = uint8(bound(wallets, 1, 16));
        uint256 supply = token.totalSupply();
        uint256 dripped;
        for (uint256 i = 0; i < wallets; i++) {
            address user = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 0x1000));
            if (user == address(faucet)) user = address(uint160(0xBEEF + i));
            vm.prank(user);
            faucet.drip();
            dripped += 2 ether;
            assertEq(token.balanceOf(user), 2 ether);
        }
        assertEq(token.balanceOf(address(faucet)) + dripped, supply);
        assertEq(token.totalSupply(), supply);
    }

    function test_quote_aboveTwoTokens_isCapped() public view {
        assertEq(router.quote(2 ether), MAX_PAYOUT);
        assertEq(router.quote(2 ether + 1), MAX_PAYOUT);
        assertEq(router.quote(100 ether), MAX_PAYOUT);
        assertEq(router.quote(1 ether), 0.000_05 ether);
        assertLt(router.quote(1 ether), MAX_PAYOUT);
    }

    function testFuzz_quoteNeverExceedsCap(
        uint256 amountIn
    ) public view {
        amountIn = bound(amountIn, 0, 1_000_000_000_000 ether);
        uint256 quoted = router.quote(amountIn);
        assertLe(quoted, MAX_PAYOUT);
        if (amountIn == 0) {
            assertEq(quoted, 0);
        } else if (amountIn >= 2 ether) {
            assertEq(quoted, MAX_PAYOUT);
        } else {
            assertEq(quoted, (amountIn * RATE_NUMERATOR) / RATE_DENOMINATOR);
        }
    }

    function test_swap_paysAtMostCap() public {
        vm.deal(address(router), 1 ether);
        uint256 amountIn = 10 ether;
        vm.prank(address(faucet));
        token.transfer(rescue, amountIn);
        vm.startPrank(rescue);
        token.approve(address(router), amountIn);
        router.swapExact(address(token), amountIn, rescue);
        vm.stopPrank();
        assertEq(rescue.balance, MAX_PAYOUT);
        assertEq(address(router).balance, 1 ether - MAX_PAYOUT);
    }

    function test_b2Script_deploysCappedRouter() public {
        address deployed = steps.deployBaseRouter(SPENCER);
        LockedDemoSwapRouter live = LockedDemoSwapRouter(payable(deployed));
        assertEq(live.maxPayout(), 0.0001 ether);
        assertEq(live.quote(2 ether), 0.0001 ether);
        assertEq(live.quote(10 ether), 0.0001 ether);
        assertEq(live.rescue(), 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688);
        assertEq(address(live).balance, 0);
    }

    function test_broadcast_refusesWithoutOptIn() public {
        vm.setEnv("TEST_DEMO_BROADCAST_OK", "");
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.authorizeBroadcast(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(TestDemoSteps.BroadcastRefused.selector);
        steps.deployBaseRouter(SPENCER);
    }

    function test_broadcast_refusesWrongChain() public {
        vm.setEnv("TEST_DEMO_BROADCAST_OK", "1");
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, uint256(1)));
        steps.authorizeBroadcast(1);
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB_SEPOLIA_CHAIN_ID));
        steps.authorizeBroadcast(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB_SEPOLIA_CHAIN_ID));
        steps.delistBase(SPENCER);
    }

    function test_scripts_rejectWrongChainAndSender() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB_SEPOLIA_CHAIN_ID));
        steps.delistBase(SPENCER);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, ARB_SEPOLIA_CHAIN_ID));
        steps.deployBaseRouter(SPENCER);
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, BASE_SEPOLIA_CHAIN_ID));
        steps.setArbMaxPayout(SPENCER);

        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.WrongChain.selector, uint256(1)));
        steps.deployFaucet(SPENCER);

        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        B4_DelistStaleAllowlist b4 = new B4_DelistStaleAllowlist();
        vm.prank(0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38);
        vm.expectRevert(TestDemoSteps.FoundryDefaultSender.selector);
        b4.run();
        vm.prank(makeAddr("nope"));
        vm.expectRevert(abi.encodeWithSelector(TestDemoSteps.SenderNotOwner.selector, makeAddr("nope")));
        b4.run();
    }

    function _signPermit(
        address user,
        address spender,
        uint256 value,
        uint256 deadline,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, user, spender, value, IERC20Permit(token).nonces(user), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
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

    function _contains(
        string memory haystack,
        string memory needle
    ) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
