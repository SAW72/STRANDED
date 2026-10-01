// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {GasRescueSwap} from "../src/GasRescueSwap.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";

/// @notice One-shot pull of the open demo router's ETH into `newRouter`.
///         The live `MockSwapRouter` pays `payAmount` even when no tokens move.
///         This constructor uses that bug once, on testnet, and forwards the
///         entire balance. It is not a withdrawal for the locked router.
///         Broadcast = owner key only. Do not point it at any other protocol.
contract OpenDemoRouterMigrator {
    error WrongChain();
    error ZeroAddress();
    error NothingToMigrate();
    error CallFailed();

    constructor(
        address oldRouter,
        address newRouter,
        address tokenIn
    ) {
        if (block.chainid != 421_614 && block.chainid != 84_532) revert WrongChain();
        if (oldRouter == address(0) || newRouter == address(0) || tokenIn == address(0)) revert ZeroAddress();
        uint256 bal = oldRouter.balance;
        if (bal == 0) revert NothingToMigrate();

        (bool setOk,) = oldRouter.call(abi.encodeWithSignature("setPayAmount(uint256)", bal));
        if (!setOk) revert CallFailed();
        (bool swapOk,) = oldRouter.call(
            abi.encodeWithSignature("swapExact(address,uint256,address)", tokenIn, uint256(0), newRouter)
        );
        if (!swapOk) revert CallFailed();

        uint256 got = address(this).balance;
        (bool sent,) = payable(newRouter).call{value: got}("");
        if (!sent || address(this).balance != 0) revert CallFailed();
    }

    receive() external payable {}
}

/// @notice Deploy `LockedDemoSwapRouter` on Base Sepolia (84532) or Arb Sepolia (421614).
///         Refuses every other chain. No mainnet path.
///
///         Broadcast = Spencer's owner key only (`0x3046…bA9D` on the live Arb swap).
///         Agents must never pass `--broadcast`.
///
///         Default rate pays 0.0001 ETH for the canonical 0.2-token slice
///         (the live mock's `payAmount` on 2026-10-01) and caps a swap at 0.001 ETH.
///
/// Required env:
///   PRIVATE_KEY                 owner key. Must equal `GasRescueSwap.owner()` to allowlist.
///   GAS_RESCUE_SWAP_ADDRESS     live rescue the router will accept swaps from
/// Optional:
///   RATE_NUMERATOR              default 5e14 (0.0005 ETH per 1e18 token)
///   RATE_DENOMINATOR            default 1e18
///   MAX_PAYOUT                  default 0.001 ether
///   FUND_WEI                    extra ETH from the owner, on top of a migration
///   MIGRATE_OLD_ROUTER          default true. Pulls the open router's ETH in one tx.
///   OLD_ROUTER_ADDRESS          default Arb `0x6804…25A8` on chain 421614
///   TOKEN_ADDRESS               calldata-only for the zero-token legacy pull. Default Arb GRTT.
///   ALLOWLIST_ON_RESCUE         default true. Allow the new router and remove the old one.
contract DeployLockedDemoSwapRouter is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    address internal constant LIVE_ARB_RESCUE = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_ARB_OPEN_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    address internal constant LIVE_ARB_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;

    function run() external {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID,
            "DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"
        );

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address rescueAddr = vm.envOr("GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (rescueAddr == address(0) && chainId == ARB_SEPOLIA_CHAIN_ID) rescueAddr = LIVE_ARB_RESCUE;
        require(rescueAddr != address(0), "GAS_RESCUE_SWAP_ADDRESS required");

        uint256 rateNumerator = vm.envOr("RATE_NUMERATOR", uint256(500_000_000_000_000));
        uint256 rateDenominator = vm.envOr("RATE_DENOMINATOR", uint256(1e18));
        uint256 maxPayout = vm.envOr("MAX_PAYOUT", uint256(0.001 ether));
        uint256 fundWei = vm.envOr("FUND_WEI", uint256(0));
        bool migrate = vm.envOr("MIGRATE_OLD_ROUTER", true);
        bool allowlist = vm.envOr("ALLOWLIST_ON_RESCUE", true);

        address oldRouter = vm.envOr("OLD_ROUTER_ADDRESS", address(0));
        if (oldRouter == address(0) && chainId == ARB_SEPOLIA_CHAIN_ID) oldRouter = LIVE_ARB_OPEN_ROUTER;
        address tokenIn = vm.envOr("TOKEN_ADDRESS", address(0));
        if (tokenIn == address(0) && chainId == ARB_SEPOLIA_CHAIN_ID) tokenIn = LIVE_ARB_GRTT;

        GasRescueSwap rescue = GasRescueSwap(payable(rescueAddr));
        if (allowlist) {
            require(deployer == rescue.owner(), "PRIVATE_KEY must be the GasRescueSwap owner to allowlist");
        }

        vm.startBroadcast(deployerKey);
        LockedDemoSwapRouter router =
            new LockedDemoSwapRouter{value: fundWei}(deployer, rescueAddr, rateNumerator, rateDenominator, maxPayout);

        if (migrate && oldRouter != address(0) && oldRouter.balance > 0) {
            require(tokenIn != address(0), "TOKEN_ADDRESS required to migrate the open router");
            new OpenDemoRouterMigrator(oldRouter, address(router), tokenIn);
        }

        if (allowlist) {
            rescue.setRouterAllowed(address(router), true);
            if (oldRouter != address(0)) rescue.setRouterAllowed(oldRouter, false);
        }
        vm.stopBroadcast();

        console2.log("chain            ", chainId);
        console2.log("LockedDemoRouter ", address(router));
        console2.log("owner            ", deployer);
        console2.log("rescue           ", rescueAddr);
        console2.log("payAmount demo   ", router.payAmount());
        console2.log("maxPayout        ", router.maxPayout());
        console2.log("inventory        ", address(router).balance);
        if (oldRouter != address(0)) console2.log("old router       ", oldRouter);
    }
}
