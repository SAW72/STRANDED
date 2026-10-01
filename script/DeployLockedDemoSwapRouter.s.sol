// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";

/// @notice Owner surface this script calls on `GasRescueSwap`. A local mock with
///         the same three methods is enough for tests. Live Arb Sepolia uses
///         `0x65e712222745A8FCCbF038A90Fa75caB0867993D`.
interface ILockedRouterRescue {
    function owner() external view returns (address);
    function allowedRouters(
        address router
    ) external view returns (bool);
    function setRouterAllowed(
        address router,
        bool allowed
    ) external;
}

/// @notice Deploy `LockedDemoSwapRouter` on Base Sepolia (84532) or Arb Sepolia (421614).
///         Refuses every other chain. No mainnet path.
///
///         Keyless. This script does not read `PRIVATE_KEY`. `forge script` sets
///         `msg.sender` from `--account` / `--sender`, and `run()` broadcasts as
///         that account. Agents must never pass `--broadcast`.
///
///         forge script script/DeployLockedDemoSwapRouter.s.sol:DeployLockedDemoSwapRouter \
///           --account <keystore> \
///           --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///           --rpc-url "$ARB_SEPOLIA_RPC_URL" \
///           --chain-id 421614
///
///         MIGRATION DONE (2026-10-01, chain 421614). The one-shot pull source was
///         removed. The migrator contract stays on chain at
///         `0x8f838a6A29EA8E8b0C6E2baCBdaD8b0cA3c25231` (tx
///         `0x9e1c8034cfd9697acfc5783e99926205a96a62efc15e078cea2400880203b9e6`).
///         Its runtime rejects ETH. DO-NOT-FUND.
///
///         On 421614, `run()` reverts when `allowedRouters(0xFE22…f7fc)` is
///         already true unless `FORCE_NEW_ROUTER=true`. A forced re-run delists
///         `PRIOR_LOCKED_ROUTER` (default that locked router), never the retired
///         open router `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` (still open,
///         DO-NOT-FUND).
///
///         Default rate pays 0.0001 ETH for the canonical 0.2-token slice and
///         caps a swap at 0.001 ETH.
///
/// Optional env:
///   GAS_RESCUE_SWAP_ADDRESS     live rescue. Defaults to the Arb swap on 421614.
///   RATE_NUMERATOR              default 5e14 (0.0005 ETH per 1e18 token)
///   RATE_DENOMINATOR            default 1e18
///   MAX_PAYOUT                  default 0.001 ether
///   FUND_WEI                    extra ETH from the owner
///   ALLOWLIST_ON_RESCUE         default true. Allow the new router and delist the prior locked one.
///   FORCE_NEW_ROUTER            default false. Required on 421614 once 0xFE22…f7fc is allowlisted.
///   PRIOR_LOCKED_ROUTER         delist target when allowlisting. Default on 421614 is 0xFE22…f7fc.
contract DeployLockedDemoSwapRouter is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    address public constant LIVE_ARB_RESCUE = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    /// @dev Live locked router. Allowlisted 2026-10-01. Re-run guard reads this address.
    address public constant LIVE_ARB_LOCKED_ROUTER = 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc;
    /// @dev Retired open router, still open, delisted Oct 1, 2026. Never a delist target.
    address public constant LIVE_ARB_OPEN_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    /// @dev Foundry's default script sender. `keccak256("foundry default caller")`.
    ///      Named apart from forge-std's internal `FOUNDRY_DEFAULT_SENDER` so the
    ///      public getter is visible to tests.
    address public constant DEFAULT_SCRIPT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external returns (LockedDemoSwapRouter router) {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID,
            "DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"
        );
        require(msg.sender != DEFAULT_SCRIPT_SENDER, "DeployLockedDemoSwapRouter: refusing Foundry default sender");

        address rescueAddr = vm.envOr("GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (rescueAddr == address(0) && chainId == ARB_SEPOLIA_CHAIN_ID) rescueAddr = LIVE_ARB_RESCUE;
        require(rescueAddr != address(0), "GAS_RESCUE_SWAP_ADDRESS required");

        uint256 rateNumerator = vm.envOr("RATE_NUMERATOR", uint256(500_000_000_000_000));
        uint256 rateDenominator = vm.envOr("RATE_DENOMINATOR", uint256(1e18));
        uint256 maxPayout = vm.envOr("MAX_PAYOUT", uint256(0.001 ether));
        uint256 fundWei = vm.envOr("FUND_WEI", uint256(0));
        bool allowlist = vm.envOr("ALLOWLIST_ON_RESCUE", true);
        bool forceNew = vm.envOr("FORCE_NEW_ROUTER", false);

        address priorLocked = vm.envOr("PRIOR_LOCKED_ROUTER", address(0));
        if (priorLocked == address(0) && chainId == ARB_SEPOLIA_CHAIN_ID) priorLocked = LIVE_ARB_LOCKED_ROUTER;
        if (allowlist && priorLocked == LIVE_ARB_OPEN_ROUTER) {
            revert("DeployLockedDemoSwapRouter: refusing to delist the retired open router");
        }

        ILockedRouterRescue rescue = ILockedRouterRescue(rescueAddr);
        if (allowlist) {
            require(
                msg.sender == rescue.owner(),
                "DeployLockedDemoSwapRouter: sender must be the GasRescueSwap owner to allowlist"
            );
        }
        if (chainId == ARB_SEPOLIA_CHAIN_ID && rescue.allowedRouters(LIVE_ARB_LOCKED_ROUTER) && !forceNew) {
            revert("DeployLockedDemoSwapRouter: locked router already allowlisted; set FORCE_NEW_ROUTER=true");
        }

        // `msg.sender` is the keystore account under
        // `forge script --account <keystore> --sender <owner>`.
        // Passing it (instead of a bare `startBroadcast()`) keeps that same
        // account as the signer. A bare call would broadcast Foundry tests as
        // the default sender, which this guard rejects.
        address deployer = msg.sender;
        vm.startBroadcast(deployer);
        router =
            new LockedDemoSwapRouter{value: fundWei}(deployer, rescueAddr, rateNumerator, rateDenominator, maxPayout);

        if (allowlist) {
            rescue.setRouterAllowed(address(router), true);
            if (priorLocked != address(0) && priorLocked != address(router)) {
                rescue.setRouterAllowed(priorLocked, false);
            }
        }
        vm.stopBroadcast();

        console2.log("chain            ", chainId);
        console2.log("LockedDemoRouter ", address(router));
        console2.log("owner            ", deployer);
        console2.log("rescue           ", rescueAddr);
        console2.log("payAmount demo   ", router.payAmount());
        console2.log("maxPayout        ", router.maxPayout());
        console2.log("inventory        ", address(router).balance);
        console2.log("force new        ", forceNew);
        if (priorLocked != address(0)) console2.log("prior locked     ", priorLocked);
    }
}
