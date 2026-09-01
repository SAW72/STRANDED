// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescue} from "../src/GasRescue.sol";
import {IGasRescue} from "../src/interfaces/IGasRescue.sol";

/// @notice Demo / operator script: sign Order + EIP-2612 permit as USER, submit as RELAYER.
///
/// Env (never commit real values):
///   PRIVATE_KEY           relayer key (pays gas; must be allowlisted)
///   USER_PRIVATE_KEY      stuck user's test key (signs only; not broadcast)
///   GAS_RESCUE_ADDRESS    deployed GasRescue
///   TOKEN_ADDRESS         allowlisted EIP-2612 ERC-20
///   ORDER_AMOUNT          raw token units to permit-pull
///   ORDER_FEE_AMOUNT      in-token fee paid to feeTo
///   ORDER_FEE_TO          fee sink
///   ORDER_DEADLINE        unix seconds
///   ORDER_NONCE           unused GasRescue nonce for this user
contract RescueWithPermit is Script {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function run() external {
        uint256 relayerKey = vm.envUint("PRIVATE_KEY");
        uint256 userKey = vm.envUint("USER_PRIVATE_KEY");
        address user = vm.addr(userKey);

        GasRescue rescue = GasRescue(vm.envAddress("GAS_RESCUE_ADDRESS"));
        address token = vm.envAddress("TOKEN_ADDRESS");

        IGasRescue.Order memory order = IGasRescue.Order({
            user: user,
            token: token,
            amount: vm.envUint("ORDER_AMOUNT"),
            feeAmount: vm.envUint("ORDER_FEE_AMOUNT"),
            feeTo: vm.envAddress("ORDER_FEE_TO"),
            deadline: vm.envUint("ORDER_DEADLINE"),
            nonce: vm.envUint("ORDER_NONCE")
        });

        bytes memory orderSig = _signOrder(rescue, order, userKey);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, address(rescue), order, userKey);

        vm.startBroadcast(relayerKey);
        rescue.rescueWithPermit(order, orderSig, v, r, s);
        vm.stopBroadcast();

        console2.log("rescued for", user);
        console2.log("token      ", token);
        console2.log("feeTo      ", order.feeTo);
        console2.log("nonce      ", order.nonce);
    }

    function _signOrder(GasRescue rescue, IGasRescue.Order memory order, uint256 userKey)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, rescue.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(address token, address spender, IGasRescue.Order memory order, uint256 userKey)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 domainSeparator = IERC20Permit(token).DOMAIN_SEPARATOR();
        uint256 permitNonce = IERC20Permit(token).nonces(order.user);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, order.user, spender, order.amount, permitNonce, order.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(userKey, digest);
    }
}
