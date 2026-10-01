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
///         `msg.sender` from `--account` / `--sender`, and `deploy` broadcasts as
///         that account. Agents must never pass `--broadcast`.
///
///         forge script script/DeployLockedDemoSwapRouter.s.sol:DeployLockedDemoSwapRouter \
///           --account <keystore> \
///           --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///           --rpc-url "$ARB_SEPOLIA_RPC_URL" \
///           --chain-id 421614
///
///         `run()` only reads `DLDSR_*` env into `Config`. `deploy(Config)` does the work.
///
///         MIGRATION DONE (2026-10-01, chain 421614). The one-shot pull source was
///         removed. The migrator contract stays on chain at
///         `0x8f838a6A29EA8E8b0C6E2baCBdaD8b0cA3c25231` (tx
///         `0x9e1c8034cfd9697acfc5783e99926205a96a62efc15e078cea2400880203b9e6`).
///         Runtime `0x36156008575f80fd5b00` (empty calldata jumps to STOP). It
///         accepts plain ETH transfers and has no withdraw; anything sent is
///         unrecoverable. DO-NOT-FUND.
///
///         On 421614, `deploy` always requires `forceNew` (`DLDSR_FORCE_NEW_ROUTER=true`)
///         and an explicit `priorLocked` (`DLDSR_PRIOR_LOCKED_ROUTER`, no default).
///         That prior must already be `allowedRouters == true`. It must not be the
///         retired open router `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8`
///         (still open, DO-NOT-FUND). After broadcast the prior is delisted and
///         the new router is allowlisted.
///
///         Default rate pays 0.0001 ETH for the canonical 0.2-token slice and
///         caps a swap at 0.001 ETH.
///
/// Env (all optional; `DLDSR_` so other tests' env cannot collide):
///   DLDSR_GAS_RESCUE_SWAP_ADDRESS   defaults to the Arb swap on 421614
///   DLDSR_RATE_NUMERATOR            default 5e14 (0.0005 ETH per 1e18 token)
///   DLDSR_RATE_DENOMINATOR          default 1e18
///   DLDSR_MAX_PAYOUT                default 0.001 ether
///   DLDSR_FUND_WEI                  extra ETH from the owner
///   DLDSR_ALLOWLIST_ON_RESCUE       default true. On 421614 the script allowlists anyway.
///   DLDSR_FORCE_NEW_ROUTER          default false. Must be true on 421614.
///   DLDSR_PRIOR_LOCKED_ROUTER       required on 421614. No default.
contract DeployLockedDemoSwapRouter is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    address public constant LIVE_ARB_RESCUE = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    /// @dev Live locked router. Allowlisted 2026-10-01. Not an implicit delist default.
    address public constant LIVE_ARB_LOCKED_ROUTER = 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc;
    /// @dev Retired open router, still open, delisted Oct 1, 2026. Never a delist target.
    address public constant LIVE_ARB_OPEN_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    /// @dev Foundry's default script sender. `keccak256("foundry default caller")`.
    ///      Named apart from forge-std's internal `FOUNDRY_DEFAULT_SENDER` so the
    ///      public getter is visible to tests.
    address public constant DEFAULT_SCRIPT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    struct Config {
        address rescue;
        uint256 rateNumerator;
        uint256 rateDenominator;
        uint256 maxPayout;
        uint256 fundWei;
        bool allowlist;
        bool forceNew;
        address priorLocked;
    }

    function run() external returns (LockedDemoSwapRouter router) {
        router = deploy(readConfig());
    }

    /// @notice Env parsing only. Behavior lives in `deploy`.
    function readConfig() public view returns (Config memory cfg) {
        cfg.rescue = vm.envOr("DLDSR_GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (cfg.rescue == address(0) && block.chainid == ARB_SEPOLIA_CHAIN_ID) cfg.rescue = LIVE_ARB_RESCUE;
        cfg.rateNumerator = vm.envOr("DLDSR_RATE_NUMERATOR", uint256(500_000_000_000_000));
        cfg.rateDenominator = vm.envOr("DLDSR_RATE_DENOMINATOR", uint256(1e18));
        cfg.maxPayout = vm.envOr("DLDSR_MAX_PAYOUT", uint256(0.001 ether));
        cfg.fundWei = vm.envOr("DLDSR_FUND_WEI", uint256(0));
        cfg.allowlist = vm.envOr("DLDSR_ALLOWLIST_ON_RESCUE", true);
        cfg.forceNew = vm.envOr("DLDSR_FORCE_NEW_ROUTER", false);
        cfg.priorLocked = vm.envOr("DLDSR_PRIOR_LOCKED_ROUTER", address(0));
    }

    /// @notice Deploy, and on Arb Sepolia replace `cfg.priorLocked` with the new router.
    function deploy(
        Config memory cfg
    ) public returns (LockedDemoSwapRouter router) {
        uint256 chainId = block.chainid;
        require(
            chainId == BASE_SEPOLIA_CHAIN_ID || chainId == ARB_SEPOLIA_CHAIN_ID,
            "DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"
        );
        address sender = msg.sender;
        require(sender != DEFAULT_SCRIPT_SENDER, "DeployLockedDemoSwapRouter: refusing Foundry default sender");
        require(cfg.rescue != address(0), "DeployLockedDemoSwapRouter: rescue address required");

        bool arb = chainId == ARB_SEPOLIA_CHAIN_ID;
        // 421614 always swaps the allowlist. The flag only applies on Base Sepolia.
        bool allowlist = cfg.allowlist || arb;

        ILockedRouterRescue rescue = ILockedRouterRescue(cfg.rescue);
        if (allowlist) {
            require(
                sender == rescue.owner(),
                "DeployLockedDemoSwapRouter: sender must be the GasRescueSwap owner to allowlist"
            );
        }

        if (arb) {
            require(cfg.forceNew, "DeployLockedDemoSwapRouter: FORCE_NEW_ROUTER=true required on 421614");
            require(cfg.priorLocked != address(0), "DeployLockedDemoSwapRouter: PRIOR_LOCKED_ROUTER required on 421614");
        }
        if (allowlist && cfg.priorLocked == LIVE_ARB_OPEN_ROUTER) {
            revert("DeployLockedDemoSwapRouter: refusing to delist the retired open router");
        }
        if (arb) {
            require(
                rescue.allowedRouters(cfg.priorLocked),
                "DeployLockedDemoSwapRouter: prior locked router is not allowlisted"
            );
        }

        // `msg.sender` is the keystore account under
        // `forge script --account <keystore> --sender <owner>`.
        vm.startBroadcast(sender);
        router = new LockedDemoSwapRouter{value: cfg.fundWei}(
            sender, cfg.rescue, cfg.rateNumerator, cfg.rateDenominator, cfg.maxPayout
        );
        if (allowlist) {
            rescue.setRouterAllowed(address(router), true);
            if (cfg.priorLocked != address(0) && cfg.priorLocked != address(router)) {
                rescue.setRouterAllowed(cfg.priorLocked, false);
            }
        }
        vm.stopBroadcast();

        if (arb) {
            require(rescue.allowedRouters(address(router)), "DeployLockedDemoSwapRouter: new router not allowlisted");
            require(
                !rescue.allowedRouters(cfg.priorLocked), "DeployLockedDemoSwapRouter: prior router still allowlisted"
            );
        }

        console2.log("chain            ", chainId);
        console2.log("LockedDemoRouter ", address(router));
        console2.log("owner            ", sender);
        console2.log("rescue           ", cfg.rescue);
        console2.log("payAmount demo   ", router.payAmount());
        console2.log("maxPayout        ", router.maxPayout());
        console2.log("inventory        ", address(router).balance);
        console2.log("force new        ", cfg.forceNew);
        if (cfg.priorLocked != address(0)) console2.log("prior locked     ", cfg.priorLocked);
    }
}
