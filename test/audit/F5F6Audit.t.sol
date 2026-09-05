// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescueSwap} from "../../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";
import {IPermit2} from "../../src/interfaces/IPermit2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockERC20Permit} from "../../src/mocks/MockERC20Permit.sol";
import {MockWETH} from "../../src/mocks/MockWETH.sol";
import {MockSwapRouter} from "../../src/mocks/MockSwapRouter.sol";
import {EvilDifferentTokenPermit2} from "../../src/mocks/EvilDifferentTokenPermit2.sol";
import {SiphonEip2612Token} from "../../src/mocks/SiphonEip2612Token.sol";

/// @notice Auditor PoCs + fix tests for F-5 (evil constructor Permit2) and
///         F-6 (EIP-2612 missing user-balance drop). After the fix: 4/4 PASS.
contract F5F6AuditTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant USER_PK = 0xA11CE;
    uint256 internal constant RELAYER_PK = 0xB0B;
    address internal constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    GasRescueSwap internal rescue;
    MockERC20Permit internal tokenIn;
    MockERC20 internal otherToken;
    MockWETH internal weth;
    MockSwapRouter internal router;

    address internal owner;
    address internal relayer;
    address internal user;
    address internal feeTo;
    address internal moveOut;
    address internal nativeTo;
    address internal attacker;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);

        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        user = vm.addr(USER_PK);
        feeTo = makeAddr("feeTo");
        moveOut = makeAddr("moveOut");
        nativeTo = makeAddr("nativeTo");
        attacker = makeAddr("attacker");

        vm.deal(relayer, 10 ether);

        weth = new MockWETH();
        router = new MockSwapRouter();
        vm.deal(address(router), 50 ether);
        router.setPayAmount(0.05 ether);

        rescue = new GasRescueSwap(owner, relayer, address(weth), address(0));
        tokenIn = new MockERC20Permit("Mock USD", "mUSD");
        otherToken = new MockERC20("Other", "OTH");
        tokenIn.mint(user, 1000 ether);
        otherToken.mint(user, 500 ether);

        vm.startPrank(owner);
        rescue.setEip2612Token(address(tokenIn), true);
        rescue.setRouterAllowed(address(router), true);
        vm.stopPrank();
    }

    /// @dev F-5 PoC (post-fix): an evil Permit2 still drains a different approved
    ///      token while delivering exact `tokenIn` `amountIn`. Constructor wiring
    ///      of that address is now rejected, so rescue cannot be pointed at it.
    function test_F5_evilPermit2_drains_different_token_while_amountIn_exact() public {
        EvilDifferentTokenPermit2 evil = new EvilDifferentTokenPermit2();
        evil.setLoot(address(otherToken), attacker, 500 ether);

        vm.startPrank(user);
        tokenIn.approve(address(evil), type(uint256).max);
        otherToken.approve(address(evil), type(uint256).max);
        vm.stopPrank();

        uint256 userTokenInBefore = tokenIn.balanceOf(user);
        uint256 contractTokenInBefore = tokenIn.balanceOf(address(this));

        IPermit2.PermitTransferFrom memory permit = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(tokenIn), amount: 100 ether}),
            nonce: 0,
            deadline: block.timestamp + 1 days
        });
        IPermit2.SignatureTransferDetails memory details =
            IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: 100 ether});
        evil.permitWitnessTransferFrom(permit, details, user, bytes32(uint256(1)), "Order witness)", hex"");

        assertEq(tokenIn.balanceOf(user), userTokenInBefore - 100 ether, "tokenIn drop is exact amountIn");
        assertEq(
            tokenIn.balanceOf(address(this)) - contractTokenInBefore, 100 ether, "contract tokenIn delta is amountIn"
        );
        assertEq(otherToken.balanceOf(attacker), 500 ether, "evil Permit2 drained a different approved token");
        assertEq(otherToken.balanceOf(user), 0);

        vm.expectRevert(GasRescueSwap.InvalidPermit2.selector);
        new GasRescueSwap(owner, relayer, address(weth), address(evil));
    }

    /// @dev F-5 fix: constructor accepts only address(0) or canonical Uniswap
    ///      Permit2. Post-deploy retarget stays closed; enable toggle is default false.
    function test_F5_fix_requireCanonicalWouldBlockEvilWiring() public {
        address evil = makeAddr("evilPermit2");
        vm.expectRevert(GasRescueSwap.InvalidPermit2.selector);
        new GasRescueSwap(owner, relayer, address(weth), evil);

        GasRescueSwap unwired = new GasRescueSwap(owner, relayer, address(weth), address(0));
        assertEq(address(unwired.permit2()), address(0));
        assertFalse(unwired.permit2Enabled());

        vm.prank(owner);
        vm.expectRevert(GasRescueSwap.Permit2Immutable.selector);
        unwired.setPermit2(evil, true);

        vm.prank(owner);
        vm.expectRevert(GasRescueSwap.ZeroAddress.selector);
        unwired.setPermit2Enabled(true);

        GasRescueSwap wired = new GasRescueSwap(owner, relayer, address(weth), CANONICAL_PERMIT2);
        assertEq(address(wired.permit2()), CANONICAL_PERMIT2);
        assertEq(wired.CANONICAL_PERMIT2(), CANONICAL_PERMIT2);
        assertFalse(wired.permit2Enabled(), "Permit2 stays disabled by default");

        vm.prank(owner);
        vm.expectRevert(GasRescueSwap.Permit2Immutable.selector);
        wired.setPermit2(CANONICAL_PERMIT2, true);

        vm.prank(owner);
        wired.setPermit2Enabled(true);
        assertTrue(wired.permit2Enabled());

        vm.prank(owner);
        wired.setPermit2Enabled(false);
        assertFalse(wired.permit2Enabled());
        assertEq(address(wired.permit2()), CANONICAL_PERMIT2, "toggle cannot retarget");
    }

    /// @dev F-6 PoC (post-fix): allowlisted hostile EIP-2612 token delivers exact
    ///      amountIn to the contract while siphoning extra same-token. Rescue reverts.
    function test_F6_maliciousEip2612_token_siphons_extra_same_token() public {
        SiphonEip2612Token siphon = _allowlistSiphonToken(5 ether);

        uint256 userBefore = siphon.balanceOf(user);
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _orderFor(address(siphon), 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(siphon), USER_PK);

        vm.expectRevert(GasRescueSwap.FoTOrBalanceMismatch.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(siphon.balanceOf(user), userBefore, "siphon rolls back atomically");
        assertEq(siphon.balanceOf(attacker), 0, "attacker keeps nothing");
        assertFalse(rescue.usedNonces(user, 1));
    }

    /// @dev F-6 fix: user `balanceOf` drop must equal `amountIn` on the EIP-2612
    ///      path (same class of check F-1 added on Permit2). Extra same-token
    ///      siphon reverts even when the contract delta is exact.
    function test_F6_fix_userBalanceDropCheckWouldRevert() public {
        SiphonEip2612Token siphon = _allowlistSiphonToken(1 ether);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(siphon), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: user,
            tokenIn: address(siphon),
            amountIn: 100 ether,
            feeAmount: 3 ether,
            feeTo: feeTo,
            amountSwap: 10 ether,
            minAmountOut: 0.01 ether,
            to: moveOut,
            nativeTo: nativeTo,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: block.chainid,
            deadline: block.timestamp + 1 days,
            nonce: 2
        });
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(siphon), USER_PK);

        // Isolate the pull accounting the fix checks: exact contract credit + extra user drop.
        uint256 userBefore = siphon.balanceOf(user);
        uint256 contractBefore = siphon.balanceOf(address(rescue));
        vm.prank(user);
        siphon.permit(user, address(rescue), order.amountIn, order.deadline, v, r, s);
        vm.prank(address(rescue));
        siphon.transferFrom(user, address(rescue), order.amountIn);
        assertEq(siphon.balanceOf(address(rescue)) - contractBefore, order.amountIn, "contract delta is exact amountIn");
        assertEq(userBefore - siphon.balanceOf(user), order.amountIn + 1 ether, "user drop exceeds amountIn");

        // Reset and show rescueWithPermit now reverts on that user-drop mismatch.
        vm.prank(address(rescue));
        siphon.transfer(user, order.amountIn);
        vm.prank(attacker);
        siphon.transfer(user, 1 ether);
        assertEq(siphon.balanceOf(user), userBefore);

        (uint8 v2, bytes32 r2, bytes32 s2) =
            _signPermit(address(siphon), user, address(rescue), order.amountIn, order.deadline, USER_PK);

        vm.expectRevert(GasRescueSwap.FoTOrBalanceMismatch.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v2, r2, s2, swapData);
    }

    function _allowlistSiphonToken(
        uint256 extra
    ) internal returns (SiphonEip2612Token siphon) {
        siphon = new SiphonEip2612Token("Siphon USD", "sUSD");
        siphon.mint(user, 1000 ether);
        siphon.configureSiphon(extra, attacker);
        vm.prank(owner);
        rescue.setEip2612Token(address(siphon), true);
    }

    function _orderFor(
        address token_,
        uint256 nonce
    ) internal view returns (IGasRescueSwap.Order memory order, bytes memory swapData) {
        swapData = abi.encodeWithSelector(MockSwapRouter.swapExact.selector, token_, 10 ether, nativeTo);
        order = IGasRescueSwap.Order({
            user: user,
            tokenIn: token_,
            amountIn: 100 ether,
            feeAmount: 3 ether,
            feeTo: feeTo,
            amountSwap: 10 ether,
            minAmountOut: 0.01 ether,
            to: moveOut,
            nativeTo: nativeTo,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: block.chainid,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
    }

    function _signOrderAndPermit(
        IGasRescueSwap.Order memory order,
        address token_,
        uint256 pk
    ) internal view returns (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = rescue.hashOrder(order);
        (uint8 ov, bytes32 or_, bytes32 os_) = vm.sign(pk, digest);
        orderSig = abi.encodePacked(or_, os_, ov);
        (v, r, s) = _signPermit(token_, order.user, address(rescue), order.amountIn, order.deadline, pk);
    }

    function _signPermit(
        address token_,
        address owner_,
        address spender,
        uint256 value,
        uint256 deadline,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 domainSeparator = IERC20Permit(token_).DOMAIN_SEPARATOR();
        uint256 nonce = IERC20Permit(token_).nonces(owner_);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
