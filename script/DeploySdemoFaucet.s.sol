// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {SdemoFaucet} from "../src/SdemoFaucet.sol";

/// @notice Deploy `SdemoFaucet` for the live Arb Sepolia SDEMO token.
///         The faucet does not mint. After deploy, Spencer transfers SDEMO
///         into the faucet from the Steward wallet. Never broadcast from an agent.
///
///         Dry-run (no key):
///           forge script script/DeploySdemoFaucet.s.sol:DeploySdemoFaucet --sig "prepare()"
///
///         Spencer only, after reading the printed address:
///           forge script script/DeploySdemoFaucet.s.sol:DeploySdemoFaucet \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast --chain-id 421614
contract DeploySdemoFaucet is Script {
    address internal constant LIVE = 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C;

    function prepare() external view {
        if (block.chainid != 421_614) {
            revert SdemoFaucet.WrongChain(block.chainid);
        }
        console2.log("token", LIVE);
        console2.log("drip", uint256(2 ether));
        console2.log("constructor args:");
        console2.logBytes(abi.encode(LIVE));
    }

    function run() external {
        if (block.chainid != 421_614) {
            revert SdemoFaucet.WrongChain(block.chainid);
        }
        vm.startBroadcast();
        SdemoFaucet faucet = new SdemoFaucet(LIVE);
        vm.stopBroadcast();
        console2.log("faucet", address(faucet));
    }
}
