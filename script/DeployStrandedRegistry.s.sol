// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {StrandedRegistry} from "../src/StrandedRegistry.sol";

/// @notice Deploy StrandedRegistry to Base Sepolia (84532) or Arb Sepolia (421614).
///         Refuses every other chain — no mainnet default.
///
///         Phase-2 scaffold only. Auditor: testnet approved, mainnet rejected.
///         Broadcast = Spencer keys only. Agents must never pass --broadcast.
///
/// Required env (no committed / test keys, no hardcoded addresses):
///   PRIVATE_KEY        deployer / initialOwner key
///   GAS_RESCUE_SWAP    existing GasRescueSwap the registry binds to
///
///         forge script script/DeployStrandedRegistry.s.sol:DeployStrandedRegistry \
///           --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast --chain-id 421614
contract DeployStrandedRegistry is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    function run() external {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID,
            "DeployStrandedRegistry: testnet only (Base Sepolia 84532 or Arb Sepolia 421614)"
        );

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address gasRescueSwap = vm.envAddress("GAS_RESCUE_SWAP");
        require(deployer != address(0), "PRIVATE_KEY required");
        require(gasRescueSwap != address(0), "GAS_RESCUE_SWAP required");

        vm.startBroadcast(deployerKey);
        StrandedRegistry registry = new StrandedRegistry(deployer, gasRescueSwap);
        vm.stopBroadcast();

        console2.log("chain            ", chainId);
        console2.log("StrandedRegistry ", address(registry));
        console2.log("owner            ", deployer);
        console2.log("gasRescueSwap    ", gasRescueSwap);
        console2.log("Spencer keys only - agent must never broadcast.");
    }
}
