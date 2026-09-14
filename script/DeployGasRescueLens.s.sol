// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {GasRescueLens} from "../src/GasRescueLens.sol";

/// @notice Deploy `GasRescueLens` bound to a live `GasRescueSwap`.
///         Testnet only: Arb Sepolia (421614) primary, Base Sepolia (84532) optional.
///         Refuses every other chain — no mainnet path.
///
///         NEVER broadcast from an agent. Spencer only:
///           forge script script/DeployGasRescueLens.s.sol:DeployGasRescueLens \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --broadcast --chain-id 421614
///
///         Calldata / dry-run (no key required):
///           forge script script/DeployGasRescueLens.s.sol:DeployGasRescueLens \
///             --sig "prepare()" --rpc-url "$ARB_SEPOLIA_RPC_URL"
///
/// Required env:
///   GAS_RESCUE_SWAP_ADDRESS   existing swap (Arb default documented below)
/// For `run()` broadcast only:
///   PRIVATE_KEY               deployer key (Spencer). Must not be committed.
contract DeployGasRescueLens is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;

    function prepare() external view {
        _requireTestnet();
        address swap = _swap();
        bytes memory args = abi.encode(swap);
        console2.log("DeployGasRescueLens prepare (no broadcast)");
        console2.log("chain            ", block.chainid);
        console2.log("GasRescueSwap    ", swap);
        console2.log("constructor args:");
        console2.logBytes(args);
        console2.log("creation code bytes", type(GasRescueLens).creationCode.length);
        console2.log("Spencer broadcast only - do not run --broadcast from an agent.");
    }

    function run() external {
        _requireTestnet();
        address swap = _swap();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        GasRescueLens lens = new GasRescueLens(swap);
        vm.stopBroadcast();

        console2.log("chain            ", block.chainid);
        console2.log("GasRescueLens    ", address(lens));
        console2.log("bound swap       ", address(lens.swap()));
        console2.log("deployer         ", deployer);
        console2.log("permit2Enabled   ", lens.status().permit2Enabled);
        console2.log("Spencer keys only - agent must never broadcast.");
    }

    function _requireTestnet() internal view {
        uint256 chainId = block.chainid;
        require(
            chainId == ARB_SEPOLIA_CHAIN_ID || chainId == BASE_SEPOLIA_CHAIN_ID,
            "DeployGasRescueLens: testnet only (Arb Sepolia 421614 or Base Sepolia 84532)"
        );
    }

    function _swap() internal view returns (address swap) {
        swap = vm.envOr("GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (swap == address(0)) {
            swap = block.chainid == ARB_SEPOLIA_CHAIN_ID ? LIVE_ARB_SWAP : LIVE_BASE_SWAP;
        }
        require(swap != address(0), "GAS_RESCUE_SWAP_ADDRESS required");
    }
}
