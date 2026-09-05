// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {MockERC20Permit} from "../src/mocks/MockERC20Permit.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockFeeOnTransferToken} from "../src/mocks/MockFeeOnTransferToken.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {MockPermit2} from "../src/mocks/MockPermit2.sol";
import {ReentrantSwapToken} from "../src/mocks/ReentrantSwapToken.sol";

contract GasRescueSwapTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    uint256 internal constant USER_PK = 0xA11CE;
    uint256 internal constant RELAYER_PK = 0xB0B;
    uint256 internal constant STRANGER_PK = 0xC0FFEE;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant FROZEN_ORDER_TYPEHASH = keccak256(
        "Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)"
    );

    GasRescueSwap internal rescue;
    MockERC20Permit internal token;
    MockWETH internal weth;
    MockSwapRouter internal router;

    address internal owner;
    address internal relayer;
    address internal user;
    address internal stranger;
    address internal pauseGuardian;
    address internal feeTo;
    address internal moveOut;
    address internal nativeTo;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);

        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        user = vm.addr(USER_PK);
        stranger = vm.addr(STRANGER_PK);
        pauseGuardian = makeAddr("pauseGuardian");
        feeTo = makeAddr("feeTo");
        moveOut = makeAddr("moveOut");
        nativeTo = makeAddr("nativeTo");

        vm.deal(user, 0);
        vm.deal(relayer, 10 ether);

        weth = new MockWETH();
        router = new MockSwapRouter();
        vm.deal(address(router), 50 ether);
        router.setPayAmount(0.05 ether);

        rescue = new GasRescueSwap(owner, relayer, address(weth), address(0));
        token = new MockERC20Permit("Mock USD", "mUSD");
        token.mint(user, 1000 ether);

        vm.startPrank(owner);
        rescue.setEip2612Token(address(token), true);
        rescue.setRouterAllowed(address(router), true);
        vm.stopPrank();
    }

    function test_happyPath_mockSwap() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        uint256 relayerTokenBefore = token.balanceOf(relayer);
        uint256 relayerEthBefore = relayer.balance;

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(token.balanceOf(feeTo), 3 ether, "feeAmount in tokenIn to feeTo");
        assertEq(token.balanceOf(moveOut), 87 ether, "remainder ERC20 to `to`");
        assertEq(token.balanceOf(user), 900 ether, "unspent stays with user");
        assertEq(token.balanceOf(relayer), relayerTokenBefore, "never pay msg.sender tokens");
        assertEq(token.balanceOf(address(rescue)), 0);
        assertEq(weth.balanceOf(address(rescue)), 0);
        assertEq(address(rescue).balance, 0);
        assertEq(nativeTo.balance, 0.05 ether, "native credited to nativeTo");
        assertEq(user.balance, 0, "user is not an implicit native sink");
        assertEq(relayer.balance, relayerEthBefore, "relayer is not a native sink");
        assertTrue(rescue.usedNonces(user, order.nonce));
    }

    function test_happyPath_wethUnwrap() public {
        router.setPayAsWeth(true, address(weth));
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(2);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(nativeTo.balance, 0.05 ether);
        assertEq(weth.balanceOf(address(rescue)), 0);
        assertEq(address(rescue).balance, 0);
        assertEq(token.balanceOf(address(rescue)), 0);
        assertEq(token.balanceOf(moveOut), 87 ether);
    }

    function test_happyPath_arbSepolia() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(3);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(nativeTo.balance, 0.05 ether);
        assertEq(token.balanceOf(moveOut), 87 ether);
        assertEq(token.balanceOf(address(rescue)), 0);
        assertEq(weth.balanceOf(address(rescue)), 0);
        assertEq(address(rescue).balance, 0);
        assertTrue(rescue.usedNonces(user, 3));
    }

    function test_slippage_reverts() public {
        router.setPayAmount(0.001 ether);
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.Slippage.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1), "slippage reverts the nonce write");
    }

    function test_underfunded_doesNotBurnNonce() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        order.amountIn = 2000 ether;
        order.pathHash = keccak256(swapData);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.Underfunded.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_replay_sameOrderReverts() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        vm.expectRevert(GasRescueSwap.UsedNonce.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function test_replay_sameNonceDifferentFeeReverts() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(7);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        IGasRescueSwap.Order memory mutated = order;
        mutated.feeAmount = 4 ether;
        (bytes memory orderSig2, uint8 v2, bytes32 r2, bytes32 s2) =
            _signOrderAndPermit(mutated, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.UsedNonce.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(mutated, orderSig2, v2, r2, s2, swapData);
    }

    function test_wrongChainId_inOrder() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        order.chainId = ARB_SEPOLIA_CHAIN_ID;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.WrongChain.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_wrongChain_mainnetBlocked() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.chainId(1);
        vm.expectRevert(GasRescueSwap.WrongChain.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function test_wrongDomain_doesNotBurnNonce() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        bytes memory orderSig = _signOrderWithDomain(order, USER_PK, "GasRescue", "1");
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, order.amountIn, order.deadline, USER_PK);

        vm.expectRevert(GasRescueSwap.InvalidSignature.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_feePlusAmountSwap_overflow() public {
        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(token), uint256(1), nativeTo);
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: user,
            tokenIn: address(token),
            amountIn: type(uint256).max,
            feeAmount: 1,
            feeTo: feeTo,
            amountSwap: type(uint256).max,
            minAmountOut: 1,
            to: moveOut,
            nativeTo: nativeTo,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: block.chainid,
            deadline: block.timestamp + 1 days,
            nonce: 1
        });
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.InvalidOrder.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_feePlusAmountSwap_exceedsAmountIn() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        order.feeAmount = 50 ether;
        order.amountSwap = 51 ether;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.InvalidOrder.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_feeOnTransfer_revertsMismatch() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken("Fee Token", "FOT", 1000);
        fot.mint(user, 1000 ether);
        vm.prank(owner);
        rescue.setEip2612Token(address(fot), true);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(fot), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = _orderFor(address(fot), 3, swapData);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(fot), USER_PK);

        vm.expectRevert(GasRescueSwap.FoTOrBalanceMismatch.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 3), "full revert restores nonce");
    }

    function test_reentrancy_onPermitReverts() public {
        _assertReentrantAttack(true, false);
    }

    function test_reentrancy_onTransferFromReverts() public {
        _assertReentrantAttack(false, true);
    }

    function test_reentrancy_onRouterReverts() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(11);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        bytes memory attack =
            abi.encodeWithSelector(GasRescueSwap.rescueWithPermit.selector, order, orderSig, v, r, s, swapData);
        router.configureReenter(address(rescue), attack);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function test_nonPermit_failClosed() public {
        MockERC20 plain = new MockERC20("Plain", "PLN");
        plain.mint(user, 1000 ether);
        vm.prank(owner);
        rescue.setTokenAllowed(address(plain), true);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(plain), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = _orderFor(address(plain), 1, swapData);
        bytes memory orderSig = _signOrder(order, USER_PK);

        vm.expectRevert(GasRescueSwap.NoGaslessAuth.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, 0, bytes32(0), bytes32(0), swapData);
        assertFalse(rescue.usedNonces(user, 1));

        vm.expectRevert(GasRescueSwap.NoGaslessAuth.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit2(order, orderSig, 0, bytes(""), swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_permit2_disabled_failClosed() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        bytes memory orderSig = _signOrder(order, USER_PK);

        vm.expectRevert(GasRescueSwap.NoGaslessAuth.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit2(order, orderSig, 0, hex"aa", swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_permit2_happyPath_whenEnabled() public {
        MockPermit2 permit2 = new MockPermit2();
        GasRescueSwap p2rescue = _newSwapWithPermit2(address(permit2));

        vm.prank(user);
        token.approve(address(permit2), type(uint256).max);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(4);
        bytes memory orderSig = _signOrderFor(p2rescue, order, USER_PK);

        vm.prank(relayer);
        p2rescue.rescueWithPermit2(order, orderSig, 0, hex"00", swapData);

        assertEq(token.balanceOf(feeTo), 3 ether);
        assertEq(token.balanceOf(moveOut), 87 ether);
        assertEq(nativeTo.balance, 0.05 ether);
        assertEq(token.balanceOf(address(rescue)), 0);
        assertEq(weth.balanceOf(address(rescue)), 0);
        assertEq(address(rescue).balance, 0);
        assertTrue(p2rescue.usedNonces(user, 4));
        assertEq(permit2.lastWitness(), _hashOrderStruct(order), "Permit2 witness is Order struct hash");
        assertEq(permit2.lastWitnessTypeString(), p2rescue.PERMIT2_ORDER_WITNESS_TYPE_STRING());
    }

    function test_setPermit2_arbitraryAddressRejected() public {
        address arbitrary = makeAddr("evilPermit2");
        assertEq(address(rescue.permit2()), address(0));
        assertFalse(rescue.permit2Enabled());

        vm.prank(owner);
        vm.expectRevert(GasRescueSwap.Permit2Immutable.selector);
        rescue.setPermit2(arbitrary, true);

        vm.prank(owner);
        vm.expectRevert(GasRescueSwap.Permit2Immutable.selector);
        rescue.setPermit2(address(0), false);

        assertEq(address(rescue.permit2()), address(0), "permit2 address stays constructor value");
        assertFalse(rescue.permit2Enabled(), "permit2Enabled stays false");
    }

    function test_permit2Enabled_defaultsFalse() public {
        assertFalse(rescue.permit2Enabled());
        assertEq(address(rescue.permit2()), address(0));
    }

    function test_permit2_extraUserDrain_revertsMismatch() public {
        GreedyPermit2 greedy = new GreedyPermit2();
        greedy.setExtra(1 ether, stranger);
        GasRescueSwap p2rescue = _newSwapWithPermit2(address(greedy));

        vm.prank(user);
        token.approve(address(greedy), type(uint256).max);

        uint256 userBefore = token.balanceOf(user);
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(6);
        bytes memory orderSig = _signOrderFor(p2rescue, order, USER_PK);

        vm.expectRevert(GasRescueSwap.FoTOrBalanceMismatch.selector);
        vm.prank(relayer);
        p2rescue.rescueWithPermit2(order, orderSig, 0, hex"00", swapData);

        assertEq(token.balanceOf(user), userBefore, "extra drain rolls back atomically");
        assertFalse(p2rescue.usedNonces(user, 6));
        assertEq(token.balanceOf(stranger), 0);
    }

    function test_leftoverTokenIn_afterPartialSwap_reverts() public {
        router.setPullAmount(5 ether);
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        uint256 moveOutBefore = token.balanceOf(moveOut);

        vm.expectRevert(GasRescueSwap.SwapInputNotConsumed.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(token.balanceOf(moveOut), moveOutBefore, "leftover tokenIn must not land on `to`");
        assertEq(token.balanceOf(address(rescue)), 0);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_donatedEth_wrappedAndSweptToOwner_notNativeTo() public {
        vm.deal(address(rescue), 1 ether);
        uint256 ownerWethBefore = weth.balanceOf(owner);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(weth.balanceOf(owner), ownerWethBefore + 1 ether, "donated ETH wrapped to WETH and swept to owner");
        assertEq(address(rescue).balance, 0, "contract ETH zero after sweep");
        assertEq(weth.balanceOf(address(rescue)), 0, "contract WETH zero after sweep");
        assertEq(nativeTo.balance, 0.05 ether, "nativeTo only gets this job's native");
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_donatedWeth_sweptToOwner_notNativeTo() public {
        vm.deal(address(rescue), 1 ether);
        vm.prank(address(rescue));
        weth.deposit{value: 1 ether}();
        assertEq(weth.balanceOf(address(rescue)), 1 ether);

        uint256 ownerWethBefore = weth.balanceOf(owner);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(weth.balanceOf(owner), ownerWethBefore + 1 ether, "donated WETH swept to owner");
        assertEq(weth.balanceOf(address(rescue)), 0, "contract WETH zero after sweep");
        assertEq(nativeTo.balance, 0.05 ether, "nativeTo only gets this job's native");
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_wethAsTokenIn_donationSweptBeforePull() public {
        // tokenIn == WETH: donation is swept to owner BEFORE the pull (always sweep
        // WETH pre-pull). Donate 0.5 WETH; it must go to owner, not nativeTo.
        vm.deal(address(rescue), 0.5 ether);
        vm.prank(address(rescue));
        weth.deposit{value: 0.5 ether}();
        assertEq(weth.balanceOf(address(rescue)), 0.5 ether);

        vm.prank(owner);
        rescue.setEip2612Token(address(weth), true);
        vm.deal(user, 10 ether);
        vm.prank(user);
        weth.deposit{value: 10 ether}();

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(weth), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = _orderFor(address(weth), 6, swapData);
        order.amountIn = 10 ether;
        order.feeAmount = 0;
        order.amountSwap = 10 ether;
        order.pathHash = keccak256(swapData);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(weth), USER_PK);

        uint256 ownerWethBefore = weth.balanceOf(owner);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        // Donation (0.5) swept to owner; job-produced WETH (0.05) unwrapped to nativeTo.
        assertEq(weth.balanceOf(owner), ownerWethBefore + 0.5 ether, "WETH-as-tokenIn: donation swept to owner");
        assertEq(nativeTo.balance, 0.05 ether, "nativeTo gets job-only native");
        assertEq(weth.balanceOf(address(rescue)), 0);
        assertEq(address(rescue).balance, 0);
        assertTrue(rescue.usedNonces(user, 6));
    }

    function test_donatedTokenIn_sweptToOwner() public {
        // 1-wei donation of allowlisted tokenIn used to brick rescues via
        // SwapInputNotConsumed. Sweep to owner BEFORE the pull.
        token.mint(stranger, 1);
        vm.prank(stranger);
        token.transfer(address(rescue), 1);
        assertEq(token.balanceOf(address(rescue)), 1);

        uint256 ownerTokenBefore = token.balanceOf(owner);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(token.balanceOf(owner), ownerTokenBefore + 1, "donated tokenIn dust swept to owner");
        assertEq(token.balanceOf(address(rescue)), 0, "contract tokenIn zero after sweep");
        assertEq(nativeTo.balance, 0.05 ether, "nativeTo only gets this job's native");
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_endOfTx_zeroAsserts_tokenInWethEth() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(12);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(token.balanceOf(address(rescue)), 0, "tokenIn dust == 0");
        assertEq(weth.balanceOf(address(rescue)), 0, "WETH dust == 0");
        assertEq(address(rescue).balance, 0, "ETH dust == 0");
    }

    function test_permit2_bindsOrderAsWitness() public {
        MockPermit2 permit2 = new MockPermit2();
        GasRescueSwap p2rescue = _newSwapWithPermit2(address(permit2));

        vm.prank(user);
        token.approve(address(permit2), type(uint256).max);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(5);
        bytes memory orderSig = _signOrderFor(p2rescue, order, USER_PK);

        vm.prank(relayer);
        p2rescue.rescueWithPermit2(order, orderSig, 0, hex"00", swapData);

        assertEq(permit2.lastWitness(), _hashOrderStruct(order));
        assertEq(
            permit2.lastWitnessTypeString(),
            "Order witness)Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)TokenPermissions(address token,uint256 amount)"
        );
        assertTrue(permit2.lastWitness() != bytes32(0));
    }

    function test_wrongRelayer_reverts() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        vm.prank(stranger);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function test_constructor_ownerEqualsRelayerReverts() public {
        vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
        new GasRescueSwap(owner, owner, address(weth), address(0));
    }

    function test_setRelayer_ownerCannotBeRelayer() public {
        vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
        vm.prank(owner);
        rescue.setRelayer(owner, true);
    }

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.setRelayer(stranger, true);

        vm.prank(owner);
        rescue.setRelayer(stranger, true);
        assertTrue(rescue.relayers(stranger));
    }

    function test_transferOwnership_isTwoStep() public {
        address newOwner = makeAddr("newOwner");
        assertEq(rescue.owner(), owner);
        assertEq(rescue.pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.transferOwnership(newOwner);

        vm.prank(owner);
        rescue.transferOwnership(newOwner);

        assertEq(rescue.owner(), owner, "owner unchanged until accept");
        assertEq(rescue.pendingOwner(), newOwner);

        vm.expectRevert(GasRescueSwap.NotGuardianOrOwner.selector);
        vm.prank(newOwner);
        rescue.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.acceptOwnership();

        vm.prank(newOwner);
        rescue.acceptOwnership();

        assertEq(rescue.owner(), newOwner);
        assertEq(rescue.pendingOwner(), address(0));

        vm.expectRevert(GasRescueSwap.NotGuardianOrOwner.selector);
        vm.prank(owner);
        rescue.pause();

        vm.prank(newOwner);
        rescue.pause();
        assertTrue(rescue.paused());
        vm.prank(newOwner);
        rescue.unpause();
        assertFalse(rescue.paused());

        vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
        vm.prank(newOwner);
        rescue.setRelayer(newOwner, true);
    }

    function test_renounceOwnership_reverts() public {
        vm.expectRevert(GasRescueSwap.OwnershipCannotBeRenounced.selector);
        vm.prank(owner);
        rescue.renounceOwnership();
        assertEq(rescue.owner(), owner);

        vm.expectRevert(GasRescueSwap.OwnershipCannotBeRenounced.selector);
        vm.prank(stranger);
        rescue.renounceOwnership();
        assertEq(rescue.owner(), owner);
    }

    function test_transferOwnership_ontoRelayerDisablesHotKey() public {
        vm.prank(owner);
        rescue.transferOwnership(relayer);
        vm.prank(relayer);
        rescue.acceptOwnership();
        assertEq(rescue.owner(), relayer);

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.OwnerIsRelayer.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function test_routerNotAllowed_reverts() public {
        MockSwapRouter other = new MockSwapRouter();
        vm.deal(address(other), 1 ether);
        other.setPayAmount(0.05 ether);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(token), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = _orderFor(address(token), 1, swapData);
        order.router = address(other);
        order.pathHash = keccak256(swapData);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.RouterNotAllowed.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_pathMismatch_doesNotBurnNonce() public {
        (IGasRescueSwap.Order memory order,) = _defaultOrderAndPath(1);
        bytes memory wrong = hex"deadbeef";
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.PathMismatch.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, wrong);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_invalidSignature_doesNotBurnNonce() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        bytes memory orderSig = _signOrder(order, STRANGER_PK);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, order.amountIn, order.deadline, USER_PK);

        vm.expectRevert(GasRescueSwap.InvalidSignature.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_pause_blocksRescueAndOnlyOwnerCanToggle() public {
        vm.expectRevert(GasRescueSwap.NotGuardianOrOwner.selector);
        vm.prank(stranger);
        rescue.pause();

        vm.prank(owner);
        rescue.pause();

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));

        vm.prank(owner);
        rescue.unpause();

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_setGuardian_onlyOwnerAndNotOwnerAddress() public {
        assertEq(rescue.guardian(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.setGuardian(pauseGuardian);

        vm.expectRevert(GasRescueSwap.GuardianIsOwner.selector);
        vm.prank(owner);
        rescue.setGuardian(owner);

        vm.expectEmit(true, true, false, true);
        emit GasRescueSwap.GuardianUpdated(address(0), pauseGuardian);
        vm.prank(owner);
        rescue.setGuardian(pauseGuardian);
        assertEq(rescue.guardian(), pauseGuardian);

        vm.prank(owner);
        rescue.setGuardian(address(0));
        assertEq(rescue.guardian(), address(0));
    }

    function test_guardian_canPauseUnpause_nonGuardianReverts() public {
        vm.prank(owner);
        rescue.setGuardian(pauseGuardian);

        vm.expectRevert(GasRescueSwap.NotGuardianOrOwner.selector);
        vm.prank(stranger);
        rescue.pause();
        vm.expectRevert(GasRescueSwap.NotGuardianOrOwner.selector);
        vm.prank(stranger);
        rescue.unpause();

        vm.expectEmit(true, false, false, true);
        emit Pausable.Paused(pauseGuardian);
        vm.prank(pauseGuardian);
        rescue.pause();
        assertTrue(rescue.paused());

        vm.expectEmit(true, false, false, true);
        emit Pausable.Unpaused(pauseGuardian);
        vm.prank(pauseGuardian);
        rescue.unpause();
        assertFalse(rescue.paused());
    }

    function test_guardianPause_blocksRescue_unpauseRestores() public {
        vm.prank(owner);
        rescue.setGuardian(pauseGuardian);
        vm.prank(pauseGuardian);
        rescue.pause();

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));

        vm.prank(pauseGuardian);
        rescue.unpause();

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_owner_canOverrideGuardianPause() public {
        vm.prank(owner);
        rescue.setGuardian(pauseGuardian);
        vm.prank(pauseGuardian);
        rescue.pause();
        assertTrue(rescue.paused());

        vm.expectEmit(true, false, false, true);
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        rescue.unpause();
        assertFalse(rescue.paused());

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertTrue(rescue.usedNonces(user, 1));

        vm.prank(owner);
        rescue.pause();
        assertTrue(rescue.paused());
        vm.prank(pauseGuardian);
        rescue.unpause();
        assertFalse(rescue.paused());
    }

    function test_orderTypehashMatchesApprovedString() public {
        assertEq(rescue.ORDER_TYPEHASH(), FROZEN_ORDER_TYPEHASH);
    }

    function test_expiredDeadlineReverts() public {
        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        order.deadline = block.timestamp - 1;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescueSwap.ExpiredDeadline.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_ownerReceiveGrief_nonReceivingOwnerDoesNotBlock() public {
        // Owner is a contract with no receive/fallback — direct ETH push would revert.
        // Wrap-and-transfer path must still succeed; donated ETH becomes WETH on owner.
        NonReceivingOwner badOwner = new NonReceivingOwner();
        GasRescueSwap badRescue = new GasRescueSwap(address(badOwner), relayer, address(weth), address(0));

        vm.prank(address(badOwner));
        badRescue.setEip2612Token(address(token), true);
        vm.prank(address(badOwner));
        badRescue.setRouterAllowed(address(router), true);

        vm.deal(address(badRescue), 1 ether);
        uint256 ownerWethBefore = weth.balanceOf(address(badOwner));

        (IGasRescueSwap.Order memory order, bytes memory swapData) = _defaultOrderAndPath(1);
        bytes memory orderSig = _signOrderFor(badRescue, order, USER_PK);
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermitFor(address(token), user, address(badRescue), order.amountIn, order.deadline, USER_PK);

        vm.prank(relayer);
        badRescue.rescueWithPermit(order, orderSig, v, r, s, swapData);

        assertEq(weth.balanceOf(address(badOwner)), ownerWethBefore + 1 ether, "donated ETH wrapped to WETH on non-receiving owner");
        assertEq(address(badRescue).balance, 0, "contract ETH zero - rescue not blocked");
        assertEq(nativeTo.balance, 0.05 ether, "nativeTo only gets this job's native");
        assertTrue(badRescue.usedNonces(user, 1));
    }

    function _assertReentrantAttack(
        bool onPermit,
        bool onTransfer
    ) internal {
        ReentrantSwapToken evil = new ReentrantSwapToken();
        evil.mint(user, 1000 ether);
        vm.prank(owner);
        rescue.setEip2612Token(address(evil), true);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(evil), 10 ether, nativeTo);
        IGasRescueSwap.Order memory order = _orderFor(address(evil), 9, swapData);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(evil), USER_PK);

        evil.configureAttack(rescue, order, orderSig, v, r, s, swapData, onPermit, onTransfer);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
    }

    function _newSwapWithPermit2(
        address permit2_
    ) internal returns (GasRescueSwap p2rescue) {
        p2rescue = new GasRescueSwap(owner, relayer, address(weth), permit2_);
        vm.startPrank(owner);
        p2rescue.setEip2612Token(address(token), true);
        p2rescue.setRouterAllowed(address(router), true);
        p2rescue.setPermit2Enabled(true);
        vm.stopPrank();
    }

    function _defaultOrderAndPath(
        uint256 nonce
    ) internal view returns (IGasRescueSwap.Order memory order, bytes memory swapData) {
        swapData = abi.encodeWithSelector(MockSwapRouter.swapExact.selector, address(token), 10 ether, nativeTo);
        order = _orderFor(address(token), nonce, swapData);
    }

    function _orderFor(
        address tokenIn,
        uint256 nonce,
        bytes memory swapData
    ) internal view returns (IGasRescueSwap.Order memory) {
        return IGasRescueSwap.Order({
            user: user,
            tokenIn: tokenIn,
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
        orderSig = _signOrder(order, pk);
        (v, r, s) = _signPermit(token_, order.user, order.amountIn, order.deadline, pk);
    }

    function _hashOrderStruct(
        IGasRescueSwap.Order memory order
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FROZEN_ORDER_TYPEHASH,
                order.user,
                order.tokenIn,
                order.amountIn,
                order.feeAmount,
                order.feeTo,
                order.amountSwap,
                order.minAmountOut,
                order.to,
                order.nativeTo,
                order.router,
                order.pathHash,
                order.chainId,
                order.deadline,
                order.nonce
            )
        );
    }

    function _signOrder(
        IGasRescueSwap.Order memory order,
        uint256 pk
    ) internal view returns (bytes memory) {
        return _signOrderFor(rescue, order, pk);
    }

    function _signOrderFor(
        GasRescueSwap target,
        IGasRescueSwap.Order memory order,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 digest = target.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signOrderWithDomain(
        IGasRescueSwap.Order memory order,
        uint256 pk,
        string memory name,
        string memory version
    ) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(rescue)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                FROZEN_ORDER_TYPEHASH,
                order.user,
                order.tokenIn,
                order.amountIn,
                order.feeAmount,
                order.feeTo,
                order.amountSwap,
                order.minAmountOut,
                order.to,
                order.nativeTo,
                order.router,
                order.pathHash,
                order.chainId,
                order.deadline,
                order.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(
        address token_,
        address owner_,
        uint256 value,
        uint256 deadline,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        return _signPermitFor(token_, owner_, address(rescue), value, deadline, pk);
    }

    function _signPermitFor(
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

/// @dev Contract with no receive/fallback — cannot accept ETH pushes.
contract NonReceivingOwner {
    // intentionally empty
}

/// @dev Malicious Permit2: delivers `requestedAmount` to the rescue, then drains extra from the user.
contract GreedyPermit2 is IPermit2 {
    uint256 public extra;
    address public extraTo;

    function setExtra(uint256 amount, address to) external {
        extra = amount;
        extraTo = to;
    }

    function permitTransferFrom(
        PermitTransferFrom memory,
        SignatureTransferDetails calldata,
        address,
        bytes calldata
    ) external pure override {
        revert("unused");
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32,
        string calldata,
        bytes calldata
    ) external override {
        IERC20 token = IERC20(permit.permitted.token);
        require(token.transferFrom(owner, transferDetails.to, transferDetails.requestedAmount));
        if (extra > 0) {
            require(token.transferFrom(owner, extraTo, extra));
        }
    }
}
