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
    address internal feeTo;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);

        owner = makeAddr("owner");
        relayer = vm.addr(RELAYER_PK);
        user = vm.addr(USER_PK);
        stranger = vm.addr(STRANGER_PK);
        feeTo = makeAddr("feeTo");

        vm.deal(user, 0);
        vm.deal(relayer, 10 ether);

        rescue = new GasRescue(owner, relayer);
        token = new MockERC20Permit("Mock USD", "mUSD");
        assertEq(token.decimals(), 18);
        token.mint(user, 1_000 ether);

        vm.prank(owner);
        rescue.setTokenAllowed(address(token), true);
    }

    function test_happyPath_rescueWithPermit() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);

        assertEq(token.balanceOf(user), 997 ether, "unspent + remainder return to user");
        assertEq(token.balanceOf(feeTo), 3 ether, "feeAmount to feeTo");
        assertEq(token.balanceOf(relayer), 0, "relayer is not the fee sink");
        assertEq(token.balanceOf(address(rescue)), 0);
        assertTrue(rescue.usedNonces(user, order.nonce));
        assertEq(user.balance, 0);
    }

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
        mutated.feeAmount = 4 ether;
        (bytes memory orderSig2, uint8 v2, bytes32 r2, bytes32 s2) =
            _signOrderAndPermit(mutated, address(token), USER_PK);

        vm.expectRevert(GasRescue.UsedNonce.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(mutated, orderSig2, v2, r2, s2);
    }

    function test_wrongRelayer_reverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.NotRelayer.selector);
        vm.prank(stranger);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function test_tokenNotAllowed_reverts() public {
        MockERC20Permit other = new MockERC20Permit("Other", "OTH");
        other.mint(user, 100 ether);
        IGasRescue.Order memory order = _defaultOrder(address(other), 100 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(other), USER_PK);

        vm.expectRevert(GasRescue.TokenNotAllowed.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_setTokenAllowed_onlyOwner() public {
        MockERC20Permit other = new MockERC20Permit("Other", "OTH");
        other.mint(user, 100 ether);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.setTokenAllowed(address(other), true);

        vm.prank(owner);
        rescue.setTokenAllowed(address(other), true);
        assertTrue(rescue.allowedTokens(address(other)));

        IGasRescue.Order memory order = _defaultOrder(address(other), 100 ether, 3 ether, 2);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(other), USER_PK);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertEq(other.balanceOf(feeTo), 3 ether);
        assertEq(other.balanceOf(user), 97 ether);
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
        assertEq(token.balanceOf(feeTo), 3 ether);
        assertEq(token.balanceOf(stranger), 0);
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

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vm.prank(newOwner);
        rescue.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.acceptOwnership();

        vm.prank(newOwner);
        rescue.acceptOwnership();

        assertEq(rescue.owner(), newOwner);
        assertEq(rescue.pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        rescue.setTokenAllowed(address(token), false);

        vm.prank(newOwner);
        rescue.pause();
        assertTrue(rescue.paused());
        vm.prank(newOwner);
        rescue.unpause();
        assertFalse(rescue.paused());
    }

    function test_renounceOwnership_reverts() public {
        vm.expectRevert(GasRescue.OwnershipCannotBeRenounced.selector);
        vm.prank(owner);
        rescue.renounceOwnership();
        assertEq(rescue.owner(), owner);

        vm.expectRevert(GasRescue.OwnershipCannotBeRenounced.selector);
        vm.prank(stranger);
        rescue.renounceOwnership();
        assertEq(rescue.owner(), owner);
    }

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
        assertFalse(rescue.usedNonces(user, 1));

        vm.prank(owner);
        rescue.unpause();

        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertTrue(rescue.usedNonces(user, 1));
    }

    function test_feeOnTransfer_revertsMismatch() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken("Fee Token", "FOT", 1_000);
        fot.mint(user, 1_000 ether);
        vm.prank(owner);
        rescue.setTokenAllowed(address(fot), true);

        IGasRescue.Order memory order = _defaultOrder(address(fot), 100 ether, 5 ether, 3);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(fot), USER_PK);

        vm.expectRevert(GasRescue.FoTOrBalanceMismatch.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 3), "full revert restores nonce");
    }

    function test_reentrancy_onPermitReverts() public {
        _assertReentrantAttack(true, false);
    }

    function test_reentrancy_onTransferFromReverts() public {
        _assertReentrantAttack(false, true);
    }

    function test_permitBoundToOrder_wrongPermitValueReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        bytes memory orderSig = _signOrder(order, USER_PK);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, 50 ether, order.deadline, USER_PK);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 1), "permit failure reverts nonce write");
    }

    function test_invalidOrderSignature_doesNotBurnNonce() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        bytes memory orderSig = _signOrder(order, STRANGER_PK);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(token), user, order.amount, order.deadline, USER_PK);

        vm.expectRevert(GasRescue.InvalidSignature.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 1), "nonce write is after a valid sig");
    }

    function test_underfunded_doesNotBurnNonce() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 2_000 ether, 3 ether, 1);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.Underfunded.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_expiredDeadlineReverts() public {
        IGasRescue.Order memory order = _defaultOrder(address(token), 100 ether, 3 ether, 1);
        order.deadline = block.timestamp - 1;
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(token), USER_PK);

        vm.expectRevert(GasRescue.ExpiredDeadline.selector);
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        assertFalse(rescue.usedNonces(user, 1));
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
        assertFalse(rescue.usedNonces(user, 1));
    }

    function test_pause_onlyOwnerUnpause() public {
        vm.prank(owner);
        rescue.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        rescue.unpause();
    }

    function test_orderTypehashMatchesApprovedString() public {
        assertEq(
            rescue.ORDER_TYPEHASH(),
            keccak256(
                "Order(address user,address token,uint256 amount,uint256 feeAmount,address feeTo,uint256 deadline,uint256 nonce)"
            )
        );
    }

    function _assertReentrantAttack(bool onPermit, bool onTransfer) internal {
        ReentrantToken evil = new ReentrantToken();
        evil.mint(user, 1_000 ether);
        vm.prank(owner);
        rescue.setTokenAllowed(address(evil), true);

        IGasRescue.Order memory order = _defaultOrder(address(evil), 100 ether, 3 ether, 9);
        (bytes memory orderSig, uint8 v, bytes32 r, bytes32 s) = _signOrderAndPermit(order, address(evil), USER_PK);

        evil.configureAttack(rescue, order, orderSig, v, r, s, onPermit, onTransfer);

        vm.expectRevert();
        vm.prank(relayer);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
    }

    function _defaultOrder(address token_, uint256 amount, uint256 feeAmount, uint256 nonce)
        internal
        view
        returns (IGasRescue.Order memory)
    {
        return IGasRescue.Order({
            user: user,
            token: token_,
            amount: amount,
            feeAmount: feeAmount,
            feeTo: feeTo,
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
