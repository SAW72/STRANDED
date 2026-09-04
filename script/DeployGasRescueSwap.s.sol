// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";

/// @notice Deploy GasRescueSwap to Base Sepolia (84532) or Arb Sepolia (421614).
///         Refuses every other chain — no mainnet default.
///
/// Required env:
///   PRIVATE_KEY          deployer / owner key (must not equal RELAYER_ADDRESS)
///   RELAYER_ADDRESS      first allowlisted relayer (hot key ≠ owner)
///   WETH_ADDRESS         chain WETH (do not fall back to mainnet WETH)
/// Optional:
///   ROUTER_ADDRESS       allowlisted immediately after deploy
///   TOKEN_ADDRESS        marked EIP-2612-allowlisted after deploy
///   PERMIT2_ADDRESS      constructor-immutable (default address(0) = unwired)
///   PERMIT2_ENABLED      ignored at deploy; permit2Enabled always starts false
///
/// Testnet WETH references (set WETH_ADDRESS explicitly; not used as defaults):
///   Base Sepolia 84532:  0x4200000000000000000000000000000000000006
///   Arb Sepolia  421614: 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73
contract DeployGasRescueSwap is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    function run() external {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID,
            "DeployGasRescueSwap: testnet only (Base Sepolia 84532 or Arb Sepolia 421614)"
        );

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address weth = vm.envAddress("WETH_ADDRESS");
        require(relayer != address(0), "RELAYER_ADDRESS required");
        require(weth != address(0), "WETH_ADDRESS required");
        require(relayer != deployer, "owner must not be the relayer hot key");

        address permit2 = vm.envOr("PERMIT2_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);
        GasRescueSwap rescue = new GasRescueSwap(deployer, relayer, weth, permit2);

        address router = vm.envOr("ROUTER_ADDRESS", address(0));
        if (router != address(0)) {
            rescue.setRouterAllowed(router, true);
        }

        address token = vm.envOr("TOKEN_ADDRESS", address(0));
        if (token != address(0)) {
            rescue.setEip2612Token(token, true);
        }
        // permit2Enabled stays false. Do not call setPermit2 — it reverts.
        vm.stopBroadcast();

        console2.log("chain            ", chainId);
        console2.log("GasRescueSwap    ", address(rescue));
        console2.log("owner            ", deployer);
        console2.log("relayer          ", relayer);
        console2.log("weth             ", weth);
        if (router != address(0)) console2.log("router           ", router);
        if (token != address(0)) console2.log("eip2612 token    ", token);
        console2.log("permit2          ", permit2);
        console2.log("permit2Enabled   ", rescue.permit2Enabled());
    }
}
