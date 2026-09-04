// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../src/interfaces/IGasRescueSwap.sol";

/// @notice Sign-only operator script for the stranded-user wallet.
///         Builds the EIP-712 Order, signs it with USER_PRIVATE_KEY, signs the
///         EIP-2612 permit, and writes a JSON payload for the relayer to submit.
///         Does NOT broadcast. The relayer (allowlisted hot key) submits later.
///
/// Env (never commit real values):
///   USER_PRIVATE_KEY            stranded user's test key (signs only)
///   GAS_RESCUE_SWAP_ADDRESS     deployed GasRescueSwap (verifyingContract)
///   TOKEN_ADDRESS               EIP-2612 allowlisted ERC-20 (GRTT)
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
///   OUTPUT_PATH                 optional; default ./signed-order.json
contract SignOrder is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function run() external {
        require(
            block.chainid == BASE_SEPOLIA_CHAIN_ID || block.chainid == ARB_SEPOLIA_CHAIN_ID,
            "SignOrder.s.sol: testnet only (84532 or 421614)"
        );

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

        string memory json = _buildJson(order, orderSig, v, r, s, swapData);
        string memory outPath = vm.envOr("OUTPUT_PATH", string("./signed-order.json"));
        vm.writeFile(outPath, json);

        console2.log("signed order written to", outPath);
        console2.log("user        ", user);
        console2.log("tokenIn     ", token);
        console2.log("amountIn    ", order.amountIn);
        console2.log("amountSwap  ", order.amountSwap);
        console2.log("feeAmount   ", order.feeAmount);
        console2.log("minAmountOut", order.minAmountOut);
        console2.log("to          ", order.to);
        console2.log("nativeTo    ", order.nativeTo);
        console2.log("router      ", order.router);
        console2.log("nonce       ", order.nonce);
        console2.log("deadline    ", order.deadline);
        console2.log("pathHash    ", order.pathHash);
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

    function _buildJson(
        IGasRescueSwap.Order memory order,
        bytes memory orderSig,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes memory swapData
    ) internal pure returns (string memory) {
        string memory out = string.concat(
            "{\n",
            '  "order": {\n',
            '    "user": "', vm.toString(order.user), '",\n',
            '    "tokenIn": "', vm.toString(order.tokenIn), '",\n',
            '    "amountIn": "', vm.toString(order.amountIn), '",\n',
            '    "feeAmount": "', vm.toString(order.feeAmount), '",\n',
            '    "feeTo": "', vm.toString(order.feeTo), '",\n',
            '    "amountSwap": "', vm.toString(order.amountSwap), '",\n',
            '    "minAmountOut": "', vm.toString(order.minAmountOut), '",\n',
            '    "to": "', vm.toString(order.to), '",\n',
            '    "nativeTo": "', vm.toString(order.nativeTo), '",\n',
            '    "router": "', vm.toString(order.router), '",\n',
            '    "pathHash": "', vm.toString(order.pathHash), '",\n',
            '    "chainId": "', vm.toString(order.chainId), '",\n',
            '    "deadline": "', vm.toString(order.deadline), '",\n',
            '    "nonce": "', vm.toString(order.nonce), '\n',
            '  },\n',
            '  "orderSignature": "', vm.toString(orderSig), '",\n',
            '  "permit": {\n',
            '    "v": "', vm.toString(v), '",\n',
            '    "r": "', vm.toString(r), '",\n',
            '    "s": "', vm.toString(s), '\n',
            '  },\n',
            '  "swapData": "', vm.toString(swapData), '\n',
            '}\n'
        );
        return out;
    }
}
