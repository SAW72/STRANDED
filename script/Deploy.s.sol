// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {GasRescue} from "../src/GasRescue.sol";

/// @notice Deploy GasRescue to Base Sepolia and seed the first allowlisted relayer.
///
/// Required env:
///   PRIVATE_KEY          deployer / owner key (do not commit)
///   RELAYER_ADDRESS      first allowlisted relayer
/// Optional:
///   TOKEN_ADDRESS        allowlisted immediately after deploy
contract DeployGasRescue is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    function run() external {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Deploy.s.sol: Base Sepolia only");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        require(relayer != address(0), "RELAYER_ADDRESS required");

        vm.startBroadcast(deployerKey);
        GasRescue rescue = new GasRescue(deployer, relayer);
        address token = vm.envOr("TOKEN_ADDRESS", address(0));
        if (token != address(0)) {
            rescue.setTokenAllowed(token, true);
        }
        vm.stopBroadcast();

        console2.log("GasRescue", address(rescue));
        console2.log("owner   ", deployer);
        console2.log("relayer ", relayer);
        if (token != address(0)) console2.log("token   ", token);
    }
}
