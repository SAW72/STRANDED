// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {TestDemoFaucet} from "../src/TestDemoFaucet.sol";
import {TestDemoToken} from "../src/TestDemoToken.sol";
import {ILiveSwapAdmin, TestDemoSteps} from "../script/TestDemoSupply.s.sol";

/// @notice A2 refuses the live pre-A3 cap and accepts the post-A3 cap.
///         The script hard-codes `ARB_ROUTER` and `ARB_SWAP`, so these tests
///         copy freshly deployed bytecode and storage onto those addresses.
///         `test_a2_refusesHighCap` is the mutation oracle for `A2_CAP_GUARD`.
///         The sybil tests show the 0.001 ETH drain that guard closes. They
///         still pass if the require is deleted, so they are not the oracle.
contract TestDemoArbCapTest is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal constant PRE_A3_MAX_PAYOUT = 0.001 ether;
    uint256 internal constant ARB_RATE_NUMERATOR = 500_000_000_000_000;

    address internal constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant ARB_ROUTER = 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc;
    address internal constant ARB_SDEMO = 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C;

    TestDemoFaucet internal faucet;
    TestDemoToken internal token;
    GasRescueSwap internal swap;
    LockedDemoSwapRouter internal router;
    address internal demoOwner = makeAddr("owner");
    address internal demoRelayer = makeAddr("relayer");
    address internal nativeTo = makeAddr("nativeTo");
    address internal feeTo = makeAddr("feeTo");

    function test_a2_refusesHighCap() public {
        TestDemoSteps steps = _plantArb(PRE_A3_MAX_PAYOUT);
        (, address demo) = steps.deployFaucet(OWNER);
        vm.expectRevert(bytes("A2: sign A3 first"));
        steps.allowlist(OWNER, demo, address(0));
    }

    function test_a2_acceptsAfterA3Cap() public {
        TestDemoSteps steps = _plantArb(PRE_A3_MAX_PAYOUT);
        (, address demo) = steps.deployFaucet(OWNER);
        steps.setArbMaxPayout(OWNER);
        assertEq(LockedDemoSwapRouter(payable(ARB_ROUTER)).maxPayout(), steps.ARB_RECOMMENDED_MAX_PAYOUT());
        address used = steps.allowlist(OWNER, demo, address(0));
        assertEq(used, ARB_ROUTER);
        assertTrue(ILiveSwapAdmin(ARB_SWAP).allowedTokens(demo));
        assertTrue(ILiveSwapAdmin(ARB_SWAP).eip2612Tokens(demo));
        assertEq(LockedDemoSwapRouter(payable(ARB_ROUTER)).maxPayout(), steps.ARB_RECOMMENDED_MAX_PAYOUT());
    }

    /// @dev Pre-A3 router params: rate 5e14, maxPayout 0.001 ETH, balance 0.0195 ETH.
    ///      Nineteen faucet wallets take 0.019 ETH. The twentieth cannot.
    function test_arb_preA3_faucetSybilsDrainSharedRouter() public {
        _setup(421_614, ARB_RATE_NUMERATOR, PRE_A3_MAX_PAYOUT, 0.0195 ether);
        uint256 total;
        for (uint256 i = 0; i < 19; i++) {
            uint256 pk = 0x2000 + i;
            _drip(vm.addr(pk));
            total += _rescue(pk, 2 ether, 2 ether, 1, 0);
        }
        assertEq(total, 0.019 ether);
        assertEq(address(router).balance, 0.0005 ether);
        uint256 pk20 = 0x3000;
        _drip(vm.addr(pk20));
        vm.expectRevert();
        this.rescueExt(pk20, 2 ether, 2 ether, 1, 0);
    }

    /// @dev After A3, maxPayout is 0.0001 ETH. The same 2 tDEMO drip pays that cap.
    function test_arb_postA3_bound() public {
        _setup(421_614, ARB_RATE_NUMERATOR, 0.0001 ether, 0.0195 ether);
        uint256 pk = 0x4000;
        _drip(vm.addr(pk));
        assertEq(_rescue(pk, 2 ether, 2 ether, 1, 0), 0.0001 ether);
    }

    function rescueExt(
        uint256 pk,
        uint256 amountIn,
        uint256 amountSwap,
        uint256 nonce,
        uint256 permitNonce
    ) external {
        _rescue(pk, amountIn, amountSwap, nonce, permitNonce);
    }

    function _plantArb(
        uint256 maxPayout
    ) internal returns (TestDemoSteps steps) {
        vm.chainId(421_614);
        MockWETH weth = new MockWETH();
        GasRescueSwap liveSwap = new GasRescueSwap(OWNER, RELAYER, address(weth), address(0));
        vm.startPrank(OWNER);
        liveSwap.setRouterAllowed(ARB_ROUTER, true);
        liveSwap.setEip2612Token(ARB_SDEMO, true);
        vm.stopPrank();
        LockedDemoSwapRouter liveRouter = new LockedDemoSwapRouter(OWNER, ARB_SWAP, ARB_RATE_NUMERATOR, 1e18, maxPayout);

        _mirror(address(liveSwap), ARB_SWAP, 12);
        _mirrorMap(address(liveSwap), ARB_SWAP, ARB_ROUTER, 9);
        _mirrorMap(address(liveSwap), ARB_SWAP, ARB_SDEMO, 7);
        _mirrorMap(address(liveSwap), ARB_SWAP, ARB_SDEMO, 8);
        _mirror(address(liveRouter), ARB_ROUTER, 7);

        ILiveSwapAdmin planted = ILiveSwapAdmin(ARB_SWAP);
        assertEq(planted.owner(), OWNER);
        assertTrue(planted.allowedRouters(ARB_ROUTER));
        assertTrue(planted.allowedTokens(ARB_SDEMO) && planted.eip2612Tokens(ARB_SDEMO));
        LockedDemoSwapRouter plantedRouter = LockedDemoSwapRouter(payable(ARB_ROUTER));
        assertEq(plantedRouter.owner(), OWNER);
        assertEq(plantedRouter.rescue(), ARB_SWAP);
        assertEq(plantedRouter.maxPayout(), maxPayout);
        steps = new TestDemoSteps();
    }

    function _mirror(
        address from,
        address to,
        uint256 slots
    ) internal {
        vm.etch(to, from.code);
        for (uint256 i = 0; i < slots; i++) {
            vm.store(to, bytes32(i), vm.load(from, bytes32(i)));
        }
    }

    function _mirrorMap(
        address from,
        address to,
        address key,
        uint256 slot
    ) internal {
        bytes32 loc = keccak256(abi.encode(key, slot));
        vm.store(to, loc, vm.load(from, loc));
    }

    function _setup(
        uint256 chainId,
        uint256 numerator,
        uint256 maxPayout,
        uint256 routerEth
    ) internal {
        vm.chainId(chainId);
        vm.warp(1_000_000);
        faucet = new TestDemoFaucet();
        token = faucet.token();
        MockWETH weth = new MockWETH();
        swap = new GasRescueSwap(demoOwner, demoRelayer, address(weth), address(0));
        router = new LockedDemoSwapRouter(demoOwner, address(swap), numerator, 1e18, maxPayout);
        vm.deal(address(router), routerEth);
        vm.startPrank(demoOwner);
        swap.setEip2612Token(address(token), true);
        swap.setRouterAllowed(address(router), true);
        vm.stopPrank();
    }

    function _drip(
        address account
    ) internal {
        vm.prank(account);
        faucet.drip();
    }

    function _sign(
        uint256 pk,
        bytes32 digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permitDigest(
        address account,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, account, address(swap), value, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }

    function _rescue(
        uint256 pk,
        uint256 amountIn,
        uint256 amountSwap,
        uint256 nonce,
        uint256 permitNonce
    ) internal returns (uint256 paid) {
        address account = vm.addr(pk);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory swapData = abi.encodeCall(LockedDemoSwapRouter.swapExact, (address(token), amountSwap, nativeTo));
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: account,
            tokenIn: address(token),
            amountIn: amountIn,
            feeAmount: 0,
            feeTo: feeTo,
            amountSwap: amountSwap,
            minAmountOut: 1,
            to: account,
            nativeTo: nativeTo,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: block.chainid,
            deadline: deadline,
            nonce: nonce
        });
        bytes memory orderSig = _sign(pk, swap.hashOrder(order));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _permitDigest(account, amountIn, permitNonce, deadline));
        uint256 beforeBal = nativeTo.balance;
        vm.prank(demoRelayer);
        swap.rescueWithPermit(order, orderSig, v, r, s, swapData);
        paid = nativeTo.balance - beforeBal;
    }
}
