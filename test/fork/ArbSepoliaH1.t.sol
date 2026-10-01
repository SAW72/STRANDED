// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {ArbSepoliaDemoPath} from "../../src/ArbSepoliaDemoPath.sol";
import {GatedDemoToken} from "../../src/GatedDemoToken.sol";
import {GasRescueLens} from "../../src/GasRescueLens.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";
import {LockedDemoSwapRouter} from "../../src/LockedDemoSwapRouter.sol";
import {HackQuestStatus} from "../../script/HackQuestStatus.s.sol";
import {MigrateH1GatedDemoToken} from "../../script/MigrateH1GatedDemoToken.s.sol";

interface ILiveSwapAdmin {
    function owner() external view returns (address);
    function setTokenAllowed(
        address token,
        bool allowed
    ) external;
    function setEip2612Token(
        address token,
        bool allowed
    ) external;
    function allowedTokens(
        address token
    ) external view returns (bool);
    function eip2612Tokens(
        address token
    ) external view returns (bool);
    function allowedRouters(
        address router
    ) external view returns (bool);
}

/// @notice Fork checks for the H1 migration. Asserts the live setters the
///         simulate-only script calls. Does not broadcast.
contract ArbSepoliaH1Test is Test {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant LIVE_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant LIVE_GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address internal constant LIVE_ROUTER = 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant DEMO_HOLDER = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;
    address internal constant DRY_NATIVE_TO = 0x1111111111111111111111111111111111111111;
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    bytes4 internal constant MINT_SELECTOR = 0x40c10f19;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes4 internal constant OWNER_SELECTOR = 0x8da5cb5b;

    ILiveSwapAdmin internal swap;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARB_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        swap = ILiveSwapAdmin(LIVE_SWAP);
        forked = true;
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function test_live_openMintTokensHaveNoGate() public onlyFork {
        assertEq(block.chainid, ARB_SEPOLIA_CHAIN_ID);
        _assertPublicMint(LIVE_GRTT);
        _assertPublicMint(LIVE_GMOCK);
        assertFalse(_codeHas(LIVE_GRTT, OWNER_SELECTOR), "GRTT has no owner()");
        assertFalse(_codeHas(LIVE_GMOCK, OWNER_SELECTOR), "gMOCK has no owner()");
        assertFalse(_codeHas(LIVE_GRTT, bytes4(keccak256("setMintEnabled(bool)"))));
        assertFalse(_codeHas(LIVE_GMOCK, bytes4(keccak256("setMinter(address)"))));

        address attacker = makeAddr("zeroEth");
        vm.deal(attacker, 0);
        _mint(LIVE_GRTT, attacker, 1 ether);
        _mint(LIVE_GMOCK, attacker, 1 ether);
        assertEq(attacker.balance, 0);
        assertGe(IERC20(LIVE_GRTT).balanceOf(attacker), 1 ether);
        assertGe(IERC20(LIVE_GMOCK).balanceOf(attacker), 1 ether);
    }

    function test_live_adminSettersTheScriptUses() public onlyFork {
        assertEq(swap.owner(), LIVE_OWNER);
        assertTrue(_codeHas(LIVE_SWAP, bytes4(keccak256("setTokenAllowed(address,bool)"))));
        assertTrue(_codeHas(LIVE_SWAP, bytes4(keccak256("setEip2612Token(address,bool)"))));
        address demo = vm.envOr("DEMO_TOKEN", address(0));
        if (swap.allowedTokens(LIVE_GRTT)) {
            assertTrue(swap.eip2612Tokens(LIVE_GRTT));
            assertTrue(swap.allowedTokens(LIVE_GMOCK) && swap.eip2612Tokens(LIVE_GMOCK));
        } else {
            assertFalse(swap.eip2612Tokens(LIVE_GRTT));
            assertFalse(swap.allowedTokens(LIVE_GMOCK) || swap.eip2612Tokens(LIVE_GMOCK));
            if (demo != address(0)) {
                assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
            }
        }
        assertTrue(swap.allowedRouters(LIVE_ROUTER));
        assertGe(IERC20(LIVE_GRTT).balanceOf(DEMO_HOLDER), 1 ether);

        // No per-user cap, and no global hourly payout cap, on the live router or rescue.
        assertFalse(_codeHas(LIVE_SWAP, bytes4(keccak256("setUserPayoutCap(address,uint256)"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("setUserPayoutCap(address,uint256)"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("userPayout(address)"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("setMaxEthPerHour(uint256)"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("maxEthPerHour()"))));

        LockedDemoSwapRouter router = LockedDemoSwapRouter(payable(LIVE_ROUTER));
        assertEq(router.owner(), LIVE_OWNER);
        assertEq(router.rescue(), LIVE_SWAP);
        assertEq(router.maxPayout(), 0.001 ether);
        assertEq(router.rateNumerator(), 500_000_000_000_000);
        assertEq(router.rateDenominator(), 1e18);
        assertEq(router.payAmount(), 0.0001 ether);
        assertEq(router.quote(0.2 ether), 0.0001 ether);
        assertEq(router.quote(1 ether), 0.0005 ether);
        assertEq(router.quote(2 ether), 0.001 ether);
        assertEq(LIVE_ROUTER.balance, 0.0195 ether);
        assertTrue(_codeHas(LIVE_ROUTER, bytes4(keccak256("withdrawEth(address,uint256)"))));
        assertTrue(_codeHas(LIVE_ROUTER, bytes4(keccak256("setMaxPayout(uint256)"))));
        assertTrue(_codeHas(LIVE_ROUTER, bytes4(keccak256("setRate(uint256,uint256)"))));
    }

    function test_live_setTokenAllowedFalseClearsEip2612() public onlyFork {
        vm.prank(LIVE_OWNER);
        swap.setTokenAllowed(LIVE_GRTT, false);
        assertFalse(swap.allowedTokens(LIVE_GRTT));
        assertFalse(swap.eip2612Tokens(LIVE_GRTT), "one delist call clears EIP-2612");

        vm.prank(LIVE_OWNER);
        swap.setTokenAllowed(LIVE_GMOCK, false);
        assertFalse(swap.allowedTokens(LIVE_GMOCK));
        assertFalse(swap.eip2612Tokens(LIVE_GMOCK));
    }

    function test_live_setEip2612TokenAllowlistsGatedToken() public onlyFork {
        GatedDemoToken token = new GatedDemoToken();
        assertEq(token.balanceOf(DEMO_HOLDER), 2 ether);
        assertEq(token.balanceOf(LIVE_OWNER), 18 ether);

        bool grttWasAllowed = swap.allowedTokens(LIVE_GRTT);
        vm.prank(LIVE_OWNER);
        swap.setEip2612Token(address(token), true);
        assertTrue(swap.allowedTokens(address(token)));
        assertTrue(swap.eip2612Tokens(address(token)));
        // This setter does not delist. Before Phase B, GRTT stays allowed.
        assertEq(swap.allowedTokens(LIVE_GRTT), grttWasAllowed);
    }

    /// @dev The four owner txs, on a fork, using the address `new` returns.
    ///      Readiness stays true for the pre-funded holder once `DEMO_TOKEN`
    ///      is that address. A fresh 0-ETH address cannot mint it and cannot
    ///      get paid from the router.
    function test_live_afterH1Migration_readyWithNewToken() public onlyFork {
        uint256 inventory = LIVE_ROUTER.balance;
        // Full 20 SDEMO can draw at most 0.01 ETH. Inventory must cover that floor.
        assertGe(inventory, 0.01 ether);

        GatedDemoToken token = new GatedDemoToken();
        vm.startPrank(LIVE_OWNER);
        swap.setEip2612Token(address(token), true);
        swap.setTokenAllowed(LIVE_GRTT, false);
        swap.setTokenAllowed(LIVE_GMOCK, false);
        vm.stopPrank();

        assertEq(token.balanceOf(DEMO_HOLDER), 2 ether);
        assertTrue(swap.allowedTokens(address(token)) && swap.eip2612Tokens(address(token)));
        assertFalse(swap.allowedTokens(LIVE_GRTT) || swap.eip2612Tokens(LIVE_GRTT));
        assertFalse(swap.allowedTokens(LIVE_GMOCK) || swap.eip2612Tokens(LIVE_GMOCK));

        HackQuestStatus status = new HackQuestStatus();
        string memory json = status.reportJson(
            DEMO_HOLDER, 0, 1 ether, DRY_NATIVE_TO, bytes32(0), address(token), LIVE_SWAP, address(0)
        );

        assertTrue(_contains(json, '"ready":true'));
        assertTrue(_contains(json, '"tokenAllowed":true'));
        assertTrue(_contains(json, '"tokenEip2612":true'));
        assertTrue(_contains(json, '"userFunded":true'));
        assertTrue(_contains(json, '"routerAllowed":true'));
        assertTrue(_contains(json, string.concat('"demoToken":"', vm.toString(address(token)), '"')));

        GasRescueLens lens = new GasRescueLens(LIVE_SWAP);
        GasRescueLens.RescueReadiness memory holder =
            lens.rescueReadiness(LIVE_RELAYER, address(token), LIVE_ROUTER, DEMO_HOLDER, 0, 1 ether);
        assertTrue(holder.ready);
        assertTrue(holder.tokenAllowed && holder.tokenEip2612 && holder.userFunded && holder.routerAllowed);

        uint256 pk = uint256(keccak256("h1-fork-fresh")) | 1;
        address attacker = vm.addr(pk);
        vm.deal(attacker, 0);
        assertEq(token.balanceOf(attacker), 0);

        _mint(LIVE_GRTT, attacker, 1 ether);
        assertGe(IERC20(LIVE_GRTT).balanceOf(attacker), 1 ether);

        assertFalse(_rescue(LIVE_GRTT, attacker, pk), "delisted GRTT must not pay");
        assertFalse(_rescue(address(token), attacker, pk), "unfunded gated token must not pay");
        assertEq(LIVE_ROUTER.balance, inventory, "router inventory unchanged");
        assertEq(attacker.balance, 0, "fresh address received no ETH");

        GasRescueLens.RescueReadiness memory fresh =
            lens.rescueReadiness(LIVE_RELAYER, address(token), LIVE_ROUTER, attacker, 0, 1 ether);
        assertFalse(fresh.userFunded);
        assertFalse(fresh.ready);
    }

    function test_live_scriptRejectsFoundryDefaultSender() public onlyFork {
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        vm.prank(FOUNDRY_DEFAULT_SENDER);
        vm.expectRevert(MigrateH1GatedDemoToken.FoundryDefaultSender.selector);
        migration.run();

        address other = makeAddr("not-owner");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(MigrateH1GatedDemoToken.SenderNotOwner.selector, other));
        migration.run();
    }

    function test_live_phaseA_grttStillWorksAndSdemoWorks() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT)) {
            uint256 pk = uint256(keccak256("phase-a-grtt-closed")) | 1;
            address user = vm.addr(pk);
            vm.deal(user, 0);
            _mint(LIVE_GRTT, user, 1 ether);
            assertFalse(_rescue(LIVE_GRTT, user, pk), "delisted GRTT does not pay");
            address demo = _demoToken();
            assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
            uint256 spk = uint256(keccak256("phase-a-sdemo-closed")) | 1;
            address suser = vm.addr(spk);
            vm.deal(suser, 0);
            vm.prank(DEMO_HOLDER);
            GatedDemoToken(demo).transfer(suser, 1 ether);
            assertTrue(_rescue(demo, suser, spk), "SDEMO still rescues after Phase B");
            return;
        }
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        address deployed = migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.A));
        assertTrue(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed));
        assertTrue(swap.allowedTokens(LIVE_GRTT) && swap.eip2612Tokens(LIVE_GRTT), "Phase A must not delist");
        assertTrue(swap.allowedTokens(LIVE_GMOCK) && swap.eip2612Tokens(LIVE_GMOCK));

        uint256 grttPk = uint256(keccak256("phase-a-grtt")) | 1;
        address grttUser = vm.addr(grttPk);
        vm.deal(grttUser, 0);
        _mint(LIVE_GRTT, grttUser, 1 ether);
        assertTrue(_rescue(LIVE_GRTT, grttUser, grttPk), "GRTT still rescues after Phase A");
        assertEq(grttUser.balance, 0.0001 ether);

        uint256 sdemoPk = uint256(keccak256("phase-a-sdemo")) | 1;
        address sdemoUser = vm.addr(sdemoPk);
        vm.deal(sdemoUser, 0);
        vm.prank(DEMO_HOLDER);
        GatedDemoToken(deployed).transfer(sdemoUser, 1 ether);
        assertTrue(_rescue(deployed, sdemoUser, sdemoPk), "SDEMO rescues after Phase A");
        assertEq(sdemoUser.balance, 0.0001 ether);
        assertEq(GatedDemoToken(deployed).totalSupply(), 20 ether);
    }

    function test_live_phaseB_afterA() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT)) {
            _assertPhaseBNoop(_demoToken());
            return;
        }
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        address deployed = migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.A));
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        address again = migration.migrate(_cfg(deployed, MigrateH1GatedDemoToken.Phase.B));
        assertEq(again, deployed);
        assertEq(vm.getNonce(LIVE_OWNER), nonce + 2, "Phase B is the two delists");
        assertFalse(swap.allowedTokens(LIVE_GRTT) || swap.eip2612Tokens(LIVE_GRTT));
        assertFalse(swap.allowedTokens(LIVE_GMOCK) || swap.eip2612Tokens(LIVE_GMOCK));
        assertTrue(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed));
    }

    function test_live_phaseB_withoutA_reverts() public onlyFork {
        GatedDemoToken token = new GatedDemoToken();
        assertFalse(swap.allowedTokens(address(token)));
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        bool grtt = swap.allowedTokens(LIVE_GRTT);
        bool gmock = swap.allowedTokens(LIVE_GMOCK);
        vm.expectRevert(bytes("MigrateH1: Phase A not applied"));
        migration.migrate(_cfg(address(token), MigrateH1GatedDemoToken.Phase.B));
        assertEq(swap.allowedTokens(LIVE_GRTT), grtt, "refused delist leaves GRTT unchanged");
        assertEq(swap.allowedTokens(LIVE_GMOCK), gmock);
    }

    function test_live_phaseB_existingTokenUnset_reverts() public onlyFork {
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        bool grtt = swap.allowedTokens(LIVE_GRTT);
        bool gmock = swap.allowedTokens(LIVE_GMOCK);
        vm.expectRevert(bytes("MigrateH1: set EXISTING_TOKEN"));
        migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.B));
        assertEq(swap.allowedTokens(LIVE_GRTT), grtt);
        assertEq(swap.allowedTokens(LIVE_GMOCK), gmock);
    }

    function test_live_phaseA_rerunIsNoop() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT)) {
            address demo = _demoToken();
            MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
            vm.expectRevert(bytes("MigrateH1: Phase A delisted GRTT"));
            migration.migrate(_cfg(demo, MigrateH1GatedDemoToken.Phase.A));
            assertFalse(swap.allowedTokens(LIVE_GRTT));
            assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
            return;
        }
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        address first = migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.A));
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        address second = migration.migrate(_cfg(first, MigrateH1GatedDemoToken.Phase.A));
        assertEq(second, first);
        assertEq(vm.getNonce(LIVE_OWNER), nonce, "re-running Phase A sends nothing");
        assertTrue(swap.allowedTokens(LIVE_GRTT) && swap.allowedTokens(LIVE_GMOCK));
        assertTrue(swap.eip2612Tokens(first));
    }

    function test_live_phaseA_resumeAfterCreateOnly() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT)) {
            GatedDemoToken token = new GatedDemoToken();
            MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
            vm.expectRevert(bytes("MigrateH1: Phase A delisted GRTT"));
            migration.migrate(_cfg(address(token), MigrateH1GatedDemoToken.Phase.A));
            assertFalse(swap.eip2612Tokens(address(token)), "revert rolls the allowlist back");
            return;
        }
        GatedDemoToken token = new GatedDemoToken();
        assertFalse(swap.eip2612Tokens(address(token)));
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        address deployed = migration.migrate(_cfg(address(token), MigrateH1GatedDemoToken.Phase.A));
        assertEq(deployed, address(token));
        assertEq(vm.getNonce(LIVE_OWNER), nonce + 1, "resume after CREATE sends only setEip2612Token");
        assertTrue(swap.allowedTokens(LIVE_GRTT));
        assertEq(token.totalSupply(), 20 ether);
    }

    function test_live_phaseB_rerunIsNoop() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT)) {
            _assertPhaseBNoop(_demoToken());
            return;
        }
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        address deployed = migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.A));
        migration.migrate(_cfg(deployed, MigrateH1GatedDemoToken.Phase.B));
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        address again = migration.migrate(_cfg(deployed, MigrateH1GatedDemoToken.Phase.B));
        assertEq(again, deployed);
        assertEq(vm.getNonce(LIVE_OWNER), nonce, "re-running Phase B sends nothing");
        assertFalse(swap.allowedTokens(LIVE_GRTT) || swap.allowedTokens(LIVE_GMOCK));
        assertTrue(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed));
    }

    function test_live_phaseB_partialResume() public onlyFork {
        if (!swap.allowedTokens(LIVE_GRTT) && !swap.allowedTokens(LIVE_GMOCK)) {
            _assertPhaseBNoop(_demoToken());
            return;
        }
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        address deployed = migration.migrate(_cfg(address(0), MigrateH1GatedDemoToken.Phase.A));
        vm.prank(LIVE_OWNER);
        swap.setTokenAllowed(LIVE_GRTT, false);
        assertTrue(swap.allowedTokens(LIVE_GMOCK));
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        migration.migrate(_cfg(deployed, MigrateH1GatedDemoToken.Phase.B));
        assertEq(vm.getNonce(LIVE_OWNER), nonce + 1, "skips the token that is already delisted");
        assertFalse(swap.allowedTokens(LIVE_GRTT) || swap.allowedTokens(LIVE_GMOCK));
        assertTrue(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed));
    }

    function test_live_scriptExistingTokenWrongSupplyReverts() public onlyFork {
        NotFixedSdemo token = new NotFixedSdemo();
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        vm.expectRevert(bytes("MigrateH1: EXISTING_TOKEN supply"));
        migration.migrate(_cfg(address(token), MigrateH1GatedDemoToken.Phase.A));
    }

    function _cfg(
        address existingToken,
        MigrateH1GatedDemoToken.Phase phase
    ) internal pure returns (MigrateH1GatedDemoToken.Config memory) {
        return MigrateH1GatedDemoToken.Config({existingToken: existingToken, sender: LIVE_OWNER, phase: phase});
    }

    /// @dev After Phase B the suite reads `DEMO_TOKEN` instead of requiring GRTT.
    function _demoToken() internal view returns (address demo) {
        demo = vm.envOr("DEMO_TOKEN", address(0));
        assertTrue(demo != address(0), "set DEMO_TOKEN after GRTT is delisted");
    }

    function _assertPhaseBNoop(
        address demo
    ) internal {
        MigrateH1GatedDemoToken migration = new MigrateH1GatedDemoToken();
        uint256 nonce = vm.getNonce(LIVE_OWNER);
        address again = migration.migrate(_cfg(demo, MigrateH1GatedDemoToken.Phase.B));
        assertEq(again, demo);
        assertEq(vm.getNonce(LIVE_OWNER), nonce, "Phase B sends nothing once both tokens are delisted");
        assertFalse(swap.allowedTokens(LIVE_GRTT) || swap.eip2612Tokens(LIVE_GRTT));
        assertFalse(swap.allowedTokens(LIVE_GMOCK) || swap.eip2612Tokens(LIVE_GMOCK));
        assertTrue(swap.allowedTokens(demo) && swap.eip2612Tokens(demo));
    }

    function _rescue(
        address token,
        address user,
        uint256 pk
    ) internal returns (bool ok) {
        uint256 amountIn = 1 ether;
        uint256 amountSwap = 0.2 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory swapData = abi.encodeWithSelector(
            LockedDemoSwapRouter.swapExact.selector, token, amountSwap, user
        );
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: user,
            tokenIn: token,
            amountIn: amountIn,
            feeAmount: 0.01 ether,
            feeTo: LIVE_OWNER,
            amountSwap: amountSwap,
            minAmountOut: 0.0001 ether,
            to: user,
            nativeTo: user,
            router: LIVE_ROUTER,
            pathHash: keccak256(swapData),
            chainId: ARB_SEPOLIA_CHAIN_ID,
            deadline: deadline,
            nonce: 0
        });
        bytes32 orderHash = ILiveRescue(LIVE_SWAP).hashOrder(order);
        (uint8 ov, bytes32 orr, bytes32 os) = vm.sign(pk, orderHash);
        bytes memory sig = abi.encodePacked(orr, os, ov);
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(token, user, amountIn, deadline, pk);
        vm.prank(LIVE_RELAYER);
        (ok,) = LIVE_SWAP.call(
            abi.encodeCall(IGasRescueSwap.rescueWithPermit, (order, sig, v, r, s, swapData))
        );
    }

    function _signPermit(
        address token,
        address user,
        uint256 value,
        uint256 deadline,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, user, LIVE_SWAP, value, IERC20Permit(token).nonces(user), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(token).DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _contains(
        string memory haystack,
        string memory needle
    ) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    function _mint(
        address token,
        address to,
        uint256 amount
    ) internal {
        vm.prank(to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(MINT_SELECTOR, to, amount));
        assertTrue(ok, string(data));
    }

    function _assertPublicMint(
        address token
    ) internal view {
        assertGt(token.code.length, 0);
        assertTrue(_codeHas(token, MINT_SELECTOR), "mint(address,uint256) missing");
    }

    function _codeHas(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        bytes memory code = target.code;
        bytes memory needle = abi.encodePacked(selector);
        if (needle.length > code.length) return false;
        for (uint256 i = 0; i <= code.length - needle.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (code[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}

interface ILiveRescue {
    function hashOrder(
        IGasRescueSwap.Order calldata order
    ) external view returns (bytes32);
}

/// @dev Right name and symbol, wrong supply. Used to show EXISTING_TOKEN rejects it.
contract NotFixedSdemo {
    function name() external pure returns (string memory) {
        return "Stranded Demo Token";
    }

    function symbol() external pure returns (string memory) {
        return "SDEMO";
    }

    function totalSupply() external pure returns (uint256) {
        return 1;
    }

    function balanceOf(
        address
    ) external pure returns (uint256) {
        return 0;
    }
}
