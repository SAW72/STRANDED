// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {DeployLockedDemoSwapRouter} from "../script/DeployLockedDemoSwapRouter.s.sol";
import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";

/// @dev Local `GasRescueSwap` stand-in. Same owner / allowlist surface the script calls.
contract MockRescueRouterAdmin {
    address public owner;
    mapping(address => bool) public allowedRouters;

    error NotOwner();

    constructor(
        address owner_
    ) {
        owner = owner_;
    }

    function setRouterAllowed(
        address router,
        bool allowed
    ) external {
        if (msg.sender != owner) revert NotOwner();
        allowedRouters[router] = allowed;
    }
}

/// @notice Calls `deploy(Config)` directly. No `vm.setEnv`.
contract DeployLockedDemoSwapRouterTest is Test {
    DeployLockedDemoSwapRouter internal script;
    MockRescueRouterAdmin internal rescue;

    function setUp() public {
        vm.chainId(421_614);
        rescue = new MockRescueRouterAdmin(address(this));
        script = new DeployLockedDemoSwapRouter();
    }

    function test_deploy_wrongChain_reverts() public {
        vm.chainId(1);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"));
        script.deploy(_arbCfg(makeAddr("prior")));
    }

    function test_deploy_nonOwner_reverts() public {
        address prior = makeAddr("prior");
        rescue.setRouterAllowed(prior, true);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: sender must be the GasRescueSwap owner to allowlist"));
        vm.prank(makeAddr("stranger"));
        script.deploy(_arbCfg(prior));
    }

    function test_deploy_defaultSender_reverts() public {
        address prior = makeAddr("prior");
        rescue.setRouterAllowed(prior, true);
        address defaultSender = script.DEFAULT_SCRIPT_SENDER();
        assertEq(defaultSender, DEFAULT_SENDER);
        assertEq(defaultSender, 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: refusing Foundry default sender"));
        vm.prank(defaultSender);
        script.deploy(_arbCfg(prior));
    }

    function test_deploy_arb_requiresForce() public {
        address prior = makeAddr("prior");
        rescue.setRouterAllowed(prior, true);
        DeployLockedDemoSwapRouter.Config memory cfg = _arbCfg(prior);
        cfg.forceNew = false;
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: DLDSR_FORCE_NEW_ROUTER=true required on 421614"));
        script.deploy(cfg);
        assertTrue(rescue.allowedRouters(prior), "failed guard does not delist");
    }

    function test_deploy_arb_requiresExplicitPrior() public {
        DeployLockedDemoSwapRouter.Config memory cfg = _arbCfg(address(0));
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: DLDSR_PRIOR_LOCKED_ROUTER required on 421614"));
        script.deploy(cfg);
    }

    function test_deploy_refusesRetiredOpenRouter() public {
        address openRouter = script.LIVE_ARB_OPEN_ROUTER();
        rescue.setRouterAllowed(openRouter, true);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: DLDSR_PRIOR_LOCKED_ROUTER is the retired open router"));
        script.deploy(_arbCfg(openRouter));
        assertTrue(rescue.allowedRouters(openRouter), "open router stays allowlisted");
    }

    function test_deploy_priorNotAllowlisted_reverts() public {
        address prior = makeAddr("notListed");
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: DLDSR_PRIOR_LOCKED_ROUTER not allowlisted"));
        script.deploy(_arbCfg(prior));
        assertFalse(rescue.allowedRouters(prior));
    }

    function test_deploy_forcedRun_delistsPriorAndAllowlistsNew() public {
        address prior = makeAddr("priorLocked");
        address openRouter = script.LIVE_ARB_OPEN_ROUTER();
        rescue.setRouterAllowed(prior, true);
        rescue.setRouterAllowed(openRouter, true);

        LockedDemoSwapRouter deployed = script.deploy(_arbCfg(prior));

        assertTrue(rescue.allowedRouters(address(deployed)), "new router allowlisted");
        assertFalse(rescue.allowedRouters(prior), "prior locked router delisted");
        assertTrue(rescue.allowedRouters(openRouter), "retired open router is not the delist target");
        assertEq(deployed.owner(), address(this));
        assertEq(deployed.rescue(), address(rescue));
        assertEq(deployed.payAmount(), 0.0001 ether);
    }

    function test_deploy_secondForcedRun_usesFirstRouterAsPrior() public {
        address prior = makeAddr("priorLocked");
        rescue.setRouterAllowed(prior, true);

        LockedDemoSwapRouter first = script.deploy(_arbCfg(prior));
        assertTrue(rescue.allowedRouters(address(first)));
        assertFalse(rescue.allowedRouters(prior));

        LockedDemoSwapRouter second = script.deploy(_arbCfg(address(first)));
        assertTrue(rescue.allowedRouters(address(second)), "second router allowlisted");
        assertFalse(rescue.allowedRouters(address(first)), "first new router delisted");
        assertTrue(address(second) != address(first));
    }

    function test_deploy_arb_allowlistFalse_isOverridden() public {
        address prior = makeAddr("priorLocked");
        rescue.setRouterAllowed(prior, true);
        DeployLockedDemoSwapRouter.Config memory cfg = _arbCfg(prior);
        cfg.allowlist = false;

        LockedDemoSwapRouter deployed = script.deploy(cfg);

        assertTrue(rescue.allowedRouters(address(deployed)), "421614 overrides DLDSR_ALLOWLIST_ON_RESCUE=false");
        assertFalse(rescue.allowedRouters(prior), "prior is still delisted");
    }

    function test_deploy_arb_zeroFundRevertsWhenPriorHoldsEth() public {
        address prior = makeAddr("priorLocked");
        rescue.setRouterAllowed(prior, true);
        vm.deal(prior, 0.0195 ether);
        DeployLockedDemoSwapRouter.Config memory cfg = _arbCfg(prior);
        cfg.fundWei = 0;

        vm.expectRevert(
            bytes(
                "DeployLockedDemoSwapRouter: DLDSR_FUND_WEI is 0 and DLDSR_PRIOR_LOCKED_ROUTER still holds ETH; withdrawEth from the prior router and set DLDSR_FUND_WEI first"
            )
        );
        script.deploy(cfg);

        assertTrue(rescue.allowedRouters(prior), "guard does not delist");
        assertEq(prior.balance, 0.0195 ether, "guard does not move the prior inventory");
    }

    function test_deploy_arb_forceWithFundWei_allowsPriorThatHoldsEth() public {
        address prior = makeAddr("priorLocked");
        rescue.setRouterAllowed(prior, true);
        vm.deal(prior, 0.0195 ether);
        vm.deal(address(this), 1 ether);
        DeployLockedDemoSwapRouter.Config memory cfg = _arbCfg(prior);
        cfg.fundWei = 0.02 ether;

        LockedDemoSwapRouter deployed = script.deploy(cfg);

        assertEq(address(deployed).balance, 0.02 ether, "new router funded");
        assertEq(prior.balance, 0.0195 ether, "prior inventory stays until withdrawEth");
        assertTrue(rescue.allowedRouters(address(deployed)));
        assertFalse(rescue.allowedRouters(prior));
    }

    function test_readConfig_defaults() public {
        DeployLockedDemoSwapRouter.Config memory arb = script.readConfig();
        assertEq(arb.rescue, script.LIVE_ARB_RESCUE(), "421614 defaults the rescue");
        assertEq(arb.rateNumerator, 500_000_000_000_000);
        assertEq(arb.rateDenominator, 1e18);
        assertEq(arb.maxPayout, 0.001 ether);
        assertEq(arb.fundWei, 0);
        assertTrue(arb.allowlist, "DLDSR_ALLOWLIST_ON_RESCUE defaults true");
        assertFalse(arb.forceNew, "DLDSR_FORCE_NEW_ROUTER defaults false");
        assertEq(arb.priorLocked, address(0), "DLDSR_PRIOR_LOCKED_ROUTER has no default");

        vm.chainId(84_532);
        DeployLockedDemoSwapRouter.Config memory base = script.readConfig();
        assertEq(base.rescue, address(0), "Base Sepolia has no rescue default");
        assertEq(base.rateNumerator, arb.rateNumerator);
        assertEq(base.rateDenominator, arb.rateDenominator);
        assertEq(base.maxPayout, arb.maxPayout);
        assertEq(base.fundWei, 0);
        assertTrue(base.allowlist);
        assertFalse(base.forceNew);
        assertEq(base.priorLocked, address(0));
    }

    function test_deploy_baseSepolia_allowlistsWithoutForceOrPrior() public {
        vm.chainId(84_532);
        DeployLockedDemoSwapRouter.Config memory cfg = _baseCfg();
        cfg.allowlist = true;
        cfg.forceNew = false;
        cfg.priorLocked = address(0);

        LockedDemoSwapRouter deployed = script.deploy(cfg);

        assertTrue(rescue.allowedRouters(address(deployed)));
        assertEq(deployed.rescue(), address(rescue));
        assertEq(block.chainid, 84_532);
    }

    function test_deploy_allowlistFalse_skipsAllowlistOnBase() public {
        vm.chainId(84_532);
        DeployLockedDemoSwapRouter.Config memory cfg = _baseCfg();
        cfg.allowlist = false;

        LockedDemoSwapRouter deployed = script.deploy(cfg);

        assertFalse(rescue.allowedRouters(address(deployed)), "flag skips the allowlist");
        assertEq(deployed.owner(), address(this));
    }

    function test_deploy_fundWei_sendsInventory() public {
        vm.chainId(84_532);
        vm.deal(address(this), 1 ether);
        DeployLockedDemoSwapRouter.Config memory cfg = _baseCfg();
        cfg.allowlist = false;
        cfg.fundWei = 0.02 ether;

        LockedDemoSwapRouter deployed = script.deploy(cfg);

        assertEq(address(deployed).balance, 0.02 ether);
        assertEq(address(this).balance, 1 ether - 0.02 ether);
    }

    function _arbCfg(
        address prior
    ) internal view returns (DeployLockedDemoSwapRouter.Config memory cfg) {
        cfg = _baseCfg();
        cfg.allowlist = true;
        cfg.forceNew = true;
        cfg.priorLocked = prior;
    }

    function _baseCfg() internal view returns (DeployLockedDemoSwapRouter.Config memory cfg) {
        cfg.rescue = address(rescue);
        cfg.rateNumerator = 500_000_000_000_000;
        cfg.rateDenominator = 1e18;
        cfg.maxPayout = 0.001 ether;
        cfg.fundWei = 0;
        cfg.allowlist = false;
        cfg.forceNew = false;
        cfg.priorLocked = address(0);
    }
}
