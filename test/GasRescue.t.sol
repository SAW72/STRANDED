// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescue} from "../src/GasRescue.sol";
import {IGasRescue} from "../src/interfaces/IGasRescue.sol";
import {MockERC20Permit} from "../src/mocks/MockERC20Permit.sol";
import {MockFeeOnTransferToken} from "../src/mocks/MockFeeOnTransferToken.sol";
import {ReentrantToken} from "../src/mocks/ReentrantToken.sol";

contract GasRescueTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant USER_PK = 0xA11CE;
    uint256 internal constant RELAYER_PK = 0xB0B;
    uint256 internal constant STRANGER_PK = 0xC0FFEE;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    GasRescue internal rescue;
    MockERC20Permit internal token;

    address internal owner;
    address internal relayer;
    address internal user;
    address internal stranger;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);

        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        user = vm.addr(USER_PK);
        stranger = vm.addr(STRANGER_PK);

        vm.deal(user, 0);
        vm.deal(relayer, 10 ether);

        rescue = new GasRescue(owner, relayer);
        token = new MockERC20Permit("Mock USD", "mUSD");
        token.mint(user, 1_000 ether);
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_happyPath_rescueWithPermit() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);

        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        // recipient == user: 1000 pulled-from 100, then 97 remainder returned; net is fee only.
        assertEq(token.balanceOf(user), 997 ether, "user keeps unspent + rescued remainder");
        assertEq(token.balanceOf(relayer), 3 ether, "relayer in-token fee");
        assertEq(token.balanceOf(address(rescue)), 0, "contract does not retain tokens");
        assertTrue(rescue.usedNonces(user, order.nonce));
        assertEq(user.balance, 0, "user still has zero native ETH");
    }

    // -------------------------------------------------------------------------
    // Replay
    // -------------------------------------------------------------------------

    function test_replay_sameOrderReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        vm.expectRevert(GasRescue.UsedNonce.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_replay_sameNonceDifferentFeeReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 7);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        IGasRescue.Order memory mutated = order;
        mutated.fee = 4 ether;
        (bytes memory orderSig2, uint8 v2, bytes32 r2, bytes32 s2) = _signOrderAndPermit(mutated, address(token), USER_PK);

        vm.expectRevert(GasRescue.UsedNonce.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(mutated, orderSig2, v2, r2, s2);
    }

    // -------------------------------------------------------------------------
    // Allowlist
    // -------------------------------------------------------------------------

    function test_wrongAllowlist_reverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.NotRelayer.selector);
        vm.prank(stranger);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.setRelayer(stranger, true);

        vm.prank(owner);
        rescue.setRelayer(stranger, true);
        assertTrue(rescue.relayers(stranger));

        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 2);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);
        vm.prank(stranger);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertEq(token.balanceOf(stranger), 3 ether);
    }

    // -------------------------------------------------------------------------
    // Pause
    // -------------------------------------------------------------------------

    function test_pause_blocksRescueAndOnlyOwnerCanToggle() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.pause();

        vm.prank(owner);
        rescue.pause();

        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        vm.prank(owner);
        rescue.unpause();

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertTrue(rescue.usedNonces(user, 1));
    }

    // -------------------------------------------------------------------------
    // Fee-on-transfer
    // -------------------------------------------------------------------------

    function test_feeOnTransfer_usesBalanceDelta() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken("Fee Token", "FOT", 1_000); // 10%
        fot.mint(user, 1_000 ether);

        address recipient = makeAddr("fotRecipient");
        IGasRescue.Order memory order = _defaultOrder(address(fot), 100 ether, 5 ether, 3);
        order.recipient = recipient;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(fot), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        // Pull 100, inbound FoT burns 10, received = 90. Fee 5 / remainder 85 leave this contract.
        // Outbound transfers also burn 10%, so relayer gets 4.5 and recipient 76.5.
        assertEq(fot.balanceOf(user), 900 ether, "user debited full amount including inbound FoT");
        assertEq(fot.balanceOf(relayer), 4.5 ether);
        assertEq(fot.balanceOf(recipient), 76.5 ether);
        assertEq(fot.balanceOf(address(rescue)), 0);
    }

    function test_feeOnTransfer_insufficientReceivedReverts() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken("Fee Token", "FOT", 1_000);
        fot.mint(user, 1_000 ether);

        // amount 100, 10% FoT => received 90, fee 90 => remainder 0 => fail closed
        IGasRescue.Order memory order = _defaultOrder(address(fot), 100 ether, 90 ether, 4);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(fot), USER_PK);

        vm.expectRevert(GasRescue.InsufficientReceived.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        assertFalse(rescue.usedNonces(user, 4), "full revert restores nonce");
    }

    // -------------------------------------------------------------------------
    // Reentrancy
    // -------------------------------------------------------------------------

    function test_reentrancy_onPermitReverts() public {
        _assertReentrantAttack(true, false);
    }

    function test_reentrancy_onTransferFromReverts() public {
        _assertReentrantAttack(false, true);
    }

    // -------------------------------------------------------------------------
    // Permit binding + fail-closed controls
    // -------------------------------------------------------------------------

    function test_permitBoundToOrder_wrongPermitValueReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        bytes memory orderSig = _signOrder(order, USER_PK);
        // Permit signed for a different value than order.amount — must not succeed.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, 50 ether, order.deadline, USER_PK);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_invalidOrderSignatureReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        bytes memory orderSig = _signOrder(order, STRANGER_PK);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, order.amount, order.deadline, USER_PK);

        vm.expectRevert(GasRescue.InvalidSignature.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_expiredDeadlineReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        order.deadline = block.timestamp - 1;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.ExpiredDeadline.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_wrongChainReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.chainId(1);
        vm.expectRevert(GasRescue.WrongChain.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_invalidOrder_feeNotLessThanAmount() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 100 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.InvalidOrder.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_pause_onlyOwnerUnpause() public {
        vm.prank(owner);
        rescue.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.unpause();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _assertReentrantAttack(bool onPermit, bool onTransfer) internal {
        ReentrantToken evil = new ReentrantToken();
        evil.mint(user, 1_000 ether);

        IGasRescue.Order memory order = _defaultOrder(address(evil), 100 ether, 3 ether, 9);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(evil), USER_PK);

        evil.configureAttack(rescue, order, orderSig, v, r, s, onPermit, onTransfer);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function _defaultOrder(address token_, uint256 amount, uint256 fee, uint256 nonce)
        internal
        view
        returns (IGasRescue.Order memory)
    {
        return IGasRescue.Order({
            user: user,
            token: token_,
            amount: amount,
            fee: fee,
            recipient: user,
            deadline: block.timestamp + 1 days,
            nonce: nonce
        });
    }

    function _signOrderAndPermit(IGasRescue.Order memory order, address token_, uint256 pk)
        internal
        view
        returns (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s)
    {
        orderSig = _signOrder(order, pk);
        (v, r, s) = _signPermit(token_, order.user, order.amount, order.deadline, pk);
    }

    function _signOrder(IGasRescue.Order memory order, uint256 pk) internal view returns (bytes memory) {
        bytes32 digest = rescue.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(address token_, address owner_, uint256 value, uint256 deadline, uint256 pk)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 domainSeparator = IERC20Permit(token_).DOMAIN_SEPARATOR();
        uint256 nonce = IERC20Permit(token_).nonces(owner_);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner_, address(rescue), value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
