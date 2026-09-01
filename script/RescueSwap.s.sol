// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";

/// @notice Demo / operator script: sign Order + EIP-2612 permit as USER, submit as RELAYER.
///         Testnet only (Base Sepolia / Arb Sepolia). No mainnet path.
///
/// Env (never commit real values):
///   PRIVATE_KEY                 relayer key (pays gas; must be allowlisted)
///   USER_PRIVATE_KEY            stuck user's test key (signs only; not broadcast)
///   GAS_RESCUE_SWAP_ADDRESS     deployed GasRescueSwap
///   TOKEN_ADDRESS               EIP-2612 allowlisted ERC-20
///   ORDER_AMOUNT_IN             raw token units pulled
///   ORDER_FEE_AMOUNT            in-token fee to feeTo
///   ORDER_FEE_TO                fee sink
///   ORDER_AMOUNT_SWAP           slice swapped for native
///   ORDER_MIN_AMOUNT_OUT        min native wei credited to nativeTo
///   ORDER_TO                    remainder ERC-20 destination (same-chain move-out)
///   ORDER_NATIVE_TO             native gas recipient (field name is nativeTo)
///   ORDER_ROUTER                allowlisted router
///   ORDER_SWAP_DATA             hex calldata; keccak256 must equal the signed pathHash
///   ORDER_DEADLINE              unix seconds
///   ORDER_NONCE                 unused GasRescueSwap nonce for this user
contract RescueSwapWithPermit is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function run() external {
        require(
            block.chainid == BASE_SEPOLIA_CHAIN_ID || block.chainid == ARB_SEPOLIA_CHAIN_ID,
            "RescueSwap.s.sol: testnet only (84532 or 421614)"
        );

        uint256 relayerKey = vm.envUint("PRIVATE_KEY");
        uint256 userKey = vm.envUint("USER_PRIVATE_KEY");
        address user = vm.addr(userKey);

        GasRescueSwap rescue = GasRescueSwap(payable(vm.envAddress("GAS_RESCUE_SWAP_ADDRESS")));
        address token = vm.envAddress("TOKEN_ADDRESS");
        bytes memory swapData = vm.envBytes("ORDER_SWAP_DATA");

        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: user,
            tokenIn: token,
            amountIn: vm.envUint("ORDER_AMOUNT_IN"),
            feeAmount: vm.envUint("ORDER_FEE_AMOUNT"),
            feeTo: vm.envAddress("ORDER_FEE_TO"),
            amountSwap: vm.envUint("ORDER_AMOUNT_SWAP"),
            minAmountOut: vm.envUint("ORDER_MIN_AMOUNT_OUT"),
            to: vm.envAddress("ORDER_TO"),
            nativeTo: vm.envAddress("ORDER_NATIVE_TO"),
            router: vm.envAddress("ORDER_ROUTER"),
            pathHash: keccak256(swapData),
            chainId: block.chainid,
            deadline: vm.envUint("ORDER_DEADLINE"),
            nonce: vm.envUint("ORDER_NONCE")
        });

        bytes memory orderSig = _signOrder(rescue, order, userKey);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, address(rescue), order, userKey);

        vm.startBroadcast(relayerKey);
        rescue.rescueWithPermit(order, orderSig, v, r, s, swapData);
        vm.stopBroadcast();

        console2.log("rescued for", user);
        console2.log("tokenIn   ", token);
        console2.log("to        ", order.to);
        console2.log("nativeTo  ", order.nativeTo);
        console2.log("nonce     ", order.nonce);
    }

    function _signOrder(
        GasRescueSwap rescue,
        IGasRescueSwap.Order memory order,
        uint256 userKey
    ) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, rescue.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(
        address token,
        address spender,
        IGasRescueSwap.Order memory order,
        uint256 userKey
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 domainSeparator = IERC20Permit(token).DOMAIN_SEPARATOR();
        uint256 permitNonce = IERC20Permit(token).nonces(order.user);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, order.user, spender, order.amountIn, permitNonce, order.deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(userKey, digest);
    }
}
