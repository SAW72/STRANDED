// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {DeployLockedDemoSwapRouter} from "../../script/DeployLockedDemoSwapRouter.s.sol";
import {GasRescueSwap} from "../../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";
import {LockedDemoSwapRouter} from "../../src/LockedDemoSwapRouter.sol";
import {TestDemoFaucet} from "../../src/TestDemoFaucet.sol";
import {TestDemoToken} from "../../src/TestDemoToken.sol";

/// @notice Read-only Base Sepolia fork (chain 84532). No broadcast and no production key.
///         Signers are Anvil's published default accounts. Live calls use `vm.prank`.
///         Skips when `BASE_SEPOLIA_RPC_URL` is unset, same as `BaseSepoliaLiveTest`.
contract BaseSepoliaOptionCTest is Test {
    using stdStorage for StdStorage;

    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    /// @dev Head observed while reading `https://sepolia.base.org` on 2026-10-13.
    uint256 internal constant FORK_BLOCK = 48_077_171;

    address internal constant LIVE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant LIVE_WETH = 0x4200000000000000000000000000000000000006;
    address internal constant GMOCK = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address internal constant LIVE_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    /// @dev Revoked in `RelayerUpdated` logs. Not allowlisted at `FORK_BLOCK`.
    address internal constant REVOKED_DEMO_RELAYER = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;
    address internal constant REVOKED_OTHER_RELAYER = 0x6b1474a92910e483510ABA4EE5FAdd432035A170;

    /// @dev Uniswap v3 SwapRouter02 immutables on Base Sepolia (published deployment).
    address internal constant UNISWAP_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address internal constant UNISWAP_POSITION_MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;

    /// @dev Anvil dev account 0. Not a production key.
    uint256 internal constant ANVIL_0_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ANVIL_0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    /// @dev Anvil dev account 1. Used only as a non-relayer caller.
    address internal constant ANVIL_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    uint256 internal constant SLOT_RELAYERS = 6;
    uint256 internal constant SLOT_ALLOWED_TOKENS = 7;
    uint256 internal constant SLOT_EIP2612 = 8;
    uint256 internal constant SLOT_ROUTERS = 9;
    uint256 internal constant GMOCK_SUPPLY_SLOT = 2;
    uint256 internal constant GMOCK_NAME_SLOT = 3;
    uint256 internal constant GMOCK_SYMBOL_SLOT = 4;

    /// @dev 2 tDEMO quotes to exactly 0.0001 ETH. Larger amounts clip to `MAX_PAYOUT`.
    uint256 internal constant RATE_NUMERATOR = 1;
    uint256 internal constant RATE_DENOMINATOR = 20_000;
    uint256 internal constant MAX_PAYOUT = 0.0001 ether;
    uint256 internal constant B5_ROUTER_ETH = 0.05 ether;
    uint256 internal constant B5_RELAYER_ETH = 0.02 ether;

    bytes4 internal constant MINT_SELECTOR = 0x40c10f19;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    GasRescueSwap internal live;
    bool internal forked;
    StdStorage internal store;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        live = GasRescueSwap(payable(LIVE_SWAP));
        forked = true;
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function test_forkPinsBaseSepolia() public onlyFork {
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        assertEq(block.number, FORK_BLOCK);
        assertEq(address(uint160(uint256(vm.load(LIVE_SWAP, bytes32(0))))), LIVE_OWNER);
        assertEq(live.owner(), LIVE_OWNER);
        assertFalse(live.paused());
        assertEq(address(live.weth()), LIVE_WETH);
        assertEq(address(live.permit2()), address(0));
        assertFalse(live.permit2Enabled());
        assertFalse(_codeHas(LIVE_SWAP, bytes4(keccak256("CANONICAL_PERMIT2()"))));
        assertFalse(_codeHas(LIVE_SWAP, bytes4(keccak256("rescueReceipt(address,uint256)"))));
        assertFalse(_codeHas(LIVE_SWAP, bytes4(keccak256("relayer()"))));
        (bool canonOk,) = LIVE_SWAP.staticcall(abi.encodeWithSelector(bytes4(keccak256("CANONICAL_PERMIT2()"))));
        (bool relayerOk,) = LIVE_SWAP.staticcall(abi.encodeWithSelector(bytes4(keccak256("relayer()"))));
        assertFalse(canonOk);
        assertFalse(relayerOk);
    }

    /// @dev (1) Access control is the `relayers` mapping. `rescueWithPermit` reverts
    ///      `NotRelayer` for everyone else, including a funded user and the owner.
    ///      The documented relayer gets past that gate (`WrongChain` on an empty order).
    function test_item1_onlyMappedRelayerPassesTheGate() public onlyFork {
        assertTrue(_codeHas(LIVE_SWAP, GasRescueSwap.NotRelayer.selector));
        assertTrue(_codeHas(LIVE_SWAP, GasRescueSwap.rescueWithPermit.selector));
        assertFalse(_codeHas(LIVE_SWAP, GasRescueSwap.OwnerIsRelayer.selector));

        assertEq(_mapBool(LIVE_RELAYER, SLOT_RELAYERS), true);
        assertEq(live.relayers(LIVE_RELAYER), true);
        assertEq(_mapBool(LIVE_OWNER, SLOT_RELAYERS), false);
        assertEq(_mapBool(ANVIL_0, SLOT_RELAYERS), false);
        assertEq(_mapBool(ANVIL_1, SLOT_RELAYERS), false);
        assertEq(_mapBool(REVOKED_DEMO_RELAYER, SLOT_RELAYERS), false);
        assertEq(_mapBool(REVOKED_OTHER_RELAYER, SLOT_RELAYERS), false);
        assertFalse(live.relayers(LIVE_OWNER));
        assertFalse(live.relayers(REVOKED_DEMO_RELAYER));
        assertFalse(live.relayers(REVOKED_OTHER_RELAYER));

        IGasRescueSwap.Order memory empty = _emptyOrder();
        _expectNotRelayer(ANVIL_1, empty);
        _expectNotRelayer(LIVE_OWNER, empty);
        _expectNotRelayer(REVOKED_DEMO_RELAYER, empty);
        _expectNotRelayer(REVOKED_OTHER_RELAYER, empty);

        vm.deal(ANVIL_0, 1 ether);
        assertEq(ANVIL_0.balance, 1 ether);
        _expectNotRelayer(ANVIL_0, empty);

        vm.expectRevert(GasRescueSwap.WrongChain.selector);
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(empty, "", 0, bytes32(0), bytes32(0), "");
    }

    /// @dev (2a) gMOCK is allowlisted, EIP-2612, and publicly mintable.
    ///      Supply is 1e39 + 1e19 + 1000 wei, not the proposal's ~1e33 wei.
    function test_item2a_gmockAllowlistedAndPubliclyMintable() public onlyFork {
        _proveAllowlistSlots();

        assertEq(_mapBool(GMOCK, SLOT_ALLOWED_TOKENS), true);
        assertEq(_mapBool(GMOCK, SLOT_EIP2612), true);
        assertTrue(live.allowedTokens(GMOCK));
        assertTrue(live.eip2612Tokens(GMOCK));
        assertTrue(_codeHas(GMOCK, MINT_SELECTOR));
        assertFalse(_codeHas(GMOCK, bytes4(keccak256("owner()"))));
        (bool ownerOk,) = GMOCK.staticcall(abi.encodeWithSelector(bytes4(keccak256("owner()"))));
        assertFalse(ownerOk);

        assertEq(IERC20Metadata(GMOCK).symbol(), "gMOCK");
        assertEq(IERC20Metadata(GMOCK).name(), "GasRescue Mock");
        assertEq(IERC20Metadata(GMOCK).decimals(), 18);
        assertEq(bytes5(vm.load(GMOCK, bytes32(GMOCK_SYMBOL_SLOT))), "gMOCK");
        assertEq(bytes14(vm.load(GMOCK, bytes32(GMOCK_NAME_SLOT))), "GasRescue Mock");

        uint256 supply = IERC20(GMOCK).totalSupply();
        assertEq(supply, uint256(vm.load(GMOCK, bytes32(GMOCK_SUPPLY_SLOT))));
        assertEq(supply, 10 ** 39 + 10 ** 19 + 1000);
        assertTrue(supply != 10 ** 33);

        uint256 beforeBal = IERC20(GMOCK).balanceOf(ANVIL_1);
        vm.prank(ANVIL_1);
        (bool minted, bytes memory err) = GMOCK.call(abi.encodeWithSelector(MINT_SELECTOR, ANVIL_1, 1000));
        assertTrue(minted, string(err));
        assertEq(IERC20(GMOCK).balanceOf(ANVIL_1), beforeBal + 1000);
        assertEq(IERC20(GMOCK).totalSupply(), supply + 1000);
    }

    /// @dev (2b) Allowlisted, 0 ETH, and not the repo's capped router.
    ///      Identity is Uniswap v3 SwapRouter02: factory, position manager, and WETH match
    ///      the published Base Sepolia deployment. It has no `maxPayout` / `swapExact`.
    function test_item2b_routerIsUniswapNotCappedDemo() public onlyFork {
        _proveAllowlistSlots();
        assertEq(_mapBool(LIVE_ROUTER, SLOT_ROUTERS), true);
        assertTrue(live.allowedRouters(LIVE_ROUTER));
        assertEq(LIVE_ROUTER.balance, 0);
        assertGt(LIVE_ROUTER.code.length, 0);

        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("owner()"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("payAmount()"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("maxPayout()"))));
        assertFalse(_codeHas(LIVE_ROUTER, bytes4(keccak256("rescue()"))));
        assertFalse(_codeHas(LIVE_ROUTER, LockedDemoSwapRouter.swapExact.selector));
        assertTrue(
            _codeHas(
                LIVE_ROUTER,
                bytes4(keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"))
            )
        );

        (bool ownerOk,) = LIVE_ROUTER.staticcall(abi.encodeWithSelector(bytes4(keccak256("owner()"))));
        (bool payOk,) = LIVE_ROUTER.staticcall(abi.encodeWithSelector(bytes4(keccak256("payAmount()"))));
        (bool maxOk,) = LIVE_ROUTER.staticcall(abi.encodeWithSelector(bytes4(keccak256("maxPayout()"))));
        (bool rescueOk,) = LIVE_ROUTER.staticcall(abi.encodeWithSelector(bytes4(keccak256("rescue()"))));
        (bool swapOk,) = LIVE_ROUTER.staticcall(
            abi.encodeWithSelector(LockedDemoSwapRouter.swapExact.selector, GMOCK, uint256(1), LIVE_OWNER)
        );
        assertFalse(ownerOk);
        assertFalse(payOk);
        assertFalse(maxOk);
        assertFalse(rescueOk);
        assertFalse(swapOk);

        assertEq(ISwapRouter02Views(LIVE_ROUTER).WETH9(), LIVE_WETH);
        assertEq(ISwapRouter02Views(LIVE_ROUTER).factory(), UNISWAP_V3_FACTORY);
        assertEq(ISwapRouter02Views(LIVE_ROUTER).positionManager(), UNISWAP_POSITION_MANAGER);
    }

    function test_B1_fixedSupplyNoMintNoOwner() public onlyFork {
        (TestDemoToken token, TestDemoFaucet faucet) = _deployPair();
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        assertEq(token.name(), token.NAME());
        assertEq(token.symbol(), "tDEMO");
        assertEq(token.decimals(), 18);
        assertEq(token.NOTICE(), "Testnet only (Base Sepolia). No monetary value. Not for sale. Not a reward.");
        assertEq(token.totalSupply(), token.TOTAL_SUPPLY());
        assertEq(token.TOTAL_SUPPLY(), 1_000_000_000_000 ether);
        assertEq(token.balanceOf(address(faucet)), token.TOTAL_SUPPLY());
        assertEq(token.balanceOf(ANVIL_0), 0);
        assertFalse(_codeHas(address(token), MINT_SELECTOR));
        assertFalse(_codeHas(address(token), bytes4(keccak256("owner()"))));
        (bool minted,) = address(token).call(abi.encodeWithSelector(MINT_SELECTOR, ANVIL_0, 1));
        (bool ownerOk,) = address(token).staticcall(abi.encodeWithSelector(bytes4(keccak256("owner()"))));
        assertFalse(minted);
        assertFalse(ownerOk);

        (bytes1 fields, string memory name, string memory version, uint256 chainId, address verifying,,) =
            token.eip712Domain();
        assertEq(fields, hex"0f");
        assertEq(name, token.NAME());
        assertEq(version, "1");
        assertEq(chainId, BASE_SEPOLIA_CHAIN_ID);
        assertEq(verifying, address(token));
    }

    function test_B1_rejectsOtherChainsAndZeroFaucet() public onlyFork {
        // `new` in this contract does not stop at `expectRevert` (the revert unwinds the test).
        // An external deploy keeps the revert on the next call so the later cases still run.
        OptionCDeployer deployer = new OptionCDeployer();

        vm.chainId(1);
        vm.expectRevert(TestDemoToken.WrongChain.selector);
        deployer.deployToken(address(0xBEEF));

        vm.chainId(421_614);
        vm.expectRevert(TestDemoToken.WrongChain.selector);
        deployer.deployToken(address(0xBEEF));

        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(TestDemoToken.ZeroAddress.selector);
        deployer.deployToken(address(0));

        (TestDemoToken token,) = _deployPair();
        vm.chainId(1);
        vm.expectRevert(TestDemoFaucet.WrongChain.selector);
        deployer.deployFaucet(token);
        vm.chainId(BASE_SEPOLIA_CHAIN_ID);
        vm.expectRevert(TestDemoFaucet.ZeroAddress.selector);
        deployer.deployFaucet(IERC20(address(0)));
        assertEq(token.totalSupply(), token.TOTAL_SUPPLY());
    }

    /// @dev Proposal (a)/(c): 2 tDEMO, one claim per wallet per 24 hours. Not two claims.
    function test_B1_faucetTwoTokensOncePer24h() public onlyFork {
        (, TestDemoFaucet faucet) = _deployPair();
        TestDemoToken token = TestDemoToken(address(faucet.token()));

        vm.prank(ANVIL_0);
        faucet.drip();
        assertEq(token.balanceOf(ANVIL_0), 2 ether);
        assertEq(faucet.lastDrip(ANVIL_0), block.timestamp);

        vm.prank(ANVIL_1);
        faucet.drip();
        assertEq(token.balanceOf(ANVIL_1), 2 ether);

        uint256 next = faucet.lastDrip(ANVIL_0) + 24 hours;
        vm.warp(next - 1);
        vm.prank(ANVIL_0);
        vm.expectRevert(abi.encodeWithSelector(TestDemoFaucet.TooSoon.selector, next));
        faucet.drip();
        assertEq(token.balanceOf(ANVIL_0), 2 ether);

        vm.warp(next);
        vm.prank(ANVIL_0);
        faucet.drip();
        assertEq(token.balanceOf(ANVIL_0), 4 ether);
        assertEq(
            token.balanceOf(address(faucet)) + token.balanceOf(ANVIL_0) + token.balanceOf(ANVIL_1), token.TOTAL_SUPPLY()
        );

        assertFalse(_codeHas(address(faucet), bytes4(keccak256("withdraw(address)"))));
        assertFalse(_codeHas(address(faucet), bytes4(keccak256("owner()"))));
        (bool withdrew,) = address(faucet).call(abi.encodeWithSignature("withdraw(address)", ANVIL_0));
        assertFalse(withdrew);
    }

    function test_B1_faucetExhaustionDoesNotBurnTheWindow() public onlyFork {
        (, TestDemoFaucet faucet) = _deployPair();
        TestDemoToken token = TestDemoToken(address(faucet.token()));
        store.target(address(token)).sig("balanceOf(address)").with_key(address(faucet)).checked_write(uint256(1));
        assertEq(token.balanceOf(address(faucet)), 1);

        vm.prank(ANVIL_0);
        vm.expectRevert(TestDemoFaucet.InsufficientFaucetBalance.selector);
        faucet.drip();
        assertEq(faucet.lastDrip(ANVIL_0), 0);
        assertEq(token.balanceOf(ANVIL_0), 0);
    }

    function test_B2_cappedRouterAndScriptChainGuard() public onlyFork {
        LockedDemoSwapRouter router = _deployRouter();
        assertEq(router.rescue(), LIVE_SWAP);
        assertEq(router.owner(), LIVE_OWNER);
        assertEq(router.maxPayout(), MAX_PAYOUT);
        assertEq(router.maxPayout(), 1e14);
        assertTrue(router.maxPayout() != 0.001 ether);
        assertEq(address(router).balance, 0);
        assertEq(router.quote(0), 0);
        assertEq(router.quote(2 ether - 1), MAX_PAYOUT - 1);
        assertEq(router.quote(2 ether), MAX_PAYOUT);
        assertEq(router.quote(2 ether + RATE_DENOMINATOR), MAX_PAYOUT);
        assertEq(router.quote(type(uint256).max), MAX_PAYOUT);

        vm.expectRevert(LockedDemoSwapRouter.NotRescue.selector);
        vm.prank(ANVIL_0);
        router.swapExact(address(0xBEEF), 2 ether, ANVIL_0);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ANVIL_0));
        vm.prank(ANVIL_0);
        router.setMaxPayout(1 ether);

        DeployLockedDemoSwapRouter script = new DeployLockedDemoSwapRouter();
        vm.chainId(1);
        vm.expectRevert(bytes("DeployLockedDemoSwapRouter: testnet only (84532 or 421614)"));
        script.run();
    }

    function testFuzz_B2_quoteNeverExceedsMax(
        uint256 amountIn
    ) public onlyFork {
        LockedDemoSwapRouter router = _deployRouter();
        assertLe(router.quote(amountIn), MAX_PAYOUT);
    }

    /// @dev B3 allowlists tDEMO and the new router. B4 delists gMOCK and SwapRouter02
    ///      before any ETH is sent. B5 funds only the new router and the relayer hot wallet.
    ///      A funded non-relayer cannot rescue. The relayer can, and the payout is the cap.
    function test_B3_B4_B5_relayerRescueCapped_nonRelayerReverts() public onlyFork {
        (TestDemoToken token, TestDemoFaucet faucet) = _deployPair();
        LockedDemoSwapRouter router = _deployRouter();

        vm.prank(ANVIL_1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ANVIL_1));
        live.setTokenAllowed(address(token), true);
        assertFalse(live.allowedTokens(address(token)));

        vm.prank(ANVIL_0);
        faucet.drip();
        vm.warp(block.timestamp + 24 hours);
        vm.prank(ANVIL_0);
        faucet.drip();
        assertEq(token.balanceOf(ANVIL_0), 4 ether);

        (
            IGasRescueSwap.Order memory early,
            bytes memory earlySig,
            uint8 ev,
            bytes32 er,
            bytes32 es,
            bytes memory earlyData
        ) = _signedOrder(token, router, 4 ether, 1);
        vm.expectRevert(GasRescueSwap.TokenNotAllowed.selector);
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(early, earlySig, ev, er, es, earlyData);

        vm.startPrank(LIVE_OWNER);
        live.setTokenAllowed(address(token), true);
        live.setEip2612Token(address(token), true);
        live.setRouterAllowed(address(router), true);
        vm.stopPrank();
        assertEq(_mapBool(address(token), SLOT_ALLOWED_TOKENS), true);
        assertEq(_mapBool(address(token), SLOT_EIP2612), true);
        assertEq(_mapBool(address(router), SLOT_ROUTERS), true);
        assertTrue(live.allowedTokens(address(token)) && live.eip2612Tokens(address(token)));
        assertTrue(live.allowedRouters(address(router)));

        assertEq(LIVE_ROUTER.balance, 0);
        assertEq(address(router).balance, 0);
        vm.prank(ANVIL_1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ANVIL_1));
        live.setTokenAllowed(GMOCK, false);
        assertTrue(live.allowedTokens(GMOCK));
        assertEq(_mapBool(GMOCK, SLOT_ALLOWED_TOKENS), true);

        vm.startPrank(LIVE_OWNER);
        live.setTokenAllowed(GMOCK, false);
        live.setEip2612Token(GMOCK, false);
        live.setRouterAllowed(LIVE_ROUTER, false);
        vm.stopPrank();
        assertFalse(live.allowedTokens(GMOCK));
        assertFalse(live.eip2612Tokens(GMOCK));
        assertFalse(live.allowedRouters(LIVE_ROUTER));
        assertEq(_mapBool(GMOCK, SLOT_ALLOWED_TOKENS), false);
        assertEq(_mapBool(GMOCK, SLOT_EIP2612), false);
        assertEq(_mapBool(LIVE_ROUTER, SLOT_ROUTERS), false);
        assertEq(LIVE_ROUTER.balance, 0, "B4 before any funding; old router stays empty");

        (
            IGasRescueSwap.Order memory gmockOrder,
            bytes memory gmockSig,
            uint8 gv,
            bytes32 gr,
            bytes32 gs,
            bytes memory gmockData
        ) = _signedOrder(token, router, 4 ether, 2);
        gmockOrder.tokenIn = GMOCK;
        vm.expectRevert(GasRescueSwap.TokenNotAllowed.selector);
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(gmockOrder, gmockSig, gv, gr, gs, gmockData);

        (
            IGasRescueSwap.Order memory oldRouterOrder,
            bytes memory oldSig,
            uint8 ov,
            bytes32 orr,
            bytes32 os,
            bytes memory oldData
        ) = _signedOrder(token, router, 4 ether, 3);
        oldRouterOrder.router = LIVE_ROUTER;
        vm.expectRevert(GasRescueSwap.RouterNotAllowed.selector);
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(oldRouterOrder, oldSig, ov, orr, os, oldData);

        uint256 relayerBefore = LIVE_RELAYER.balance;
        vm.deal(LIVE_OWNER, 1 ether);
        vm.prank(LIVE_OWNER);
        (bool fundedRouter,) = payable(address(router)).call{value: B5_ROUTER_ETH}("");
        assertTrue(fundedRouter);
        vm.prank(LIVE_OWNER);
        (bool fundedRelayer,) = payable(LIVE_RELAYER).call{value: B5_RELAYER_ETH}("");
        assertTrue(fundedRelayer);
        assertEq(address(router).balance, B5_ROUTER_ETH);
        assertEq(LIVE_RELAYER.balance, relayerBefore + B5_RELAYER_ETH);
        assertEq(LIVE_ROUTER.balance, 0);

        (IGasRescueSwap.Order memory order, bytes memory sig, uint8 v, bytes32 r, bytes32 s, bytes memory swapData) =
            _signedOrder(token, router, 4 ether, 4);
        assertEq(router.quote(order.amountSwap), MAX_PAYOUT);

        vm.deal(ANVIL_0, 1 ether);
        uint256 routerBal = address(router).balance;
        uint256 tokensBefore = token.balanceOf(ANVIL_0);
        _expectNotRelayer(ANVIL_0, order, sig, v, r, s, swapData);
        _expectNotRelayer(ANVIL_1, order, sig, v, r, s, swapData);
        _expectNotRelayer(LIVE_OWNER, order, sig, v, r, s, swapData);
        _expectNotRelayer(REVOKED_DEMO_RELAYER, order, sig, v, r, s, swapData);
        assertEq(address(router).balance, routerBal);
        assertEq(token.balanceOf(ANVIL_0), tokensBefore);
        assertFalse(live.usedNonces(ANVIL_0, order.nonce));

        uint256 userEth = ANVIL_0.balance;
        uint256 relayerEth = LIVE_RELAYER.balance;
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(order, sig, v, r, s, swapData);

        assertEq(ANVIL_0.balance, userEth + MAX_PAYOUT);
        assertEq(LIVE_RELAYER.balance, relayerEth, "payout is not paid to the relayer");
        assertEq(address(router).balance, B5_ROUTER_ETH - MAX_PAYOUT);
        assertEq(token.balanceOf(address(router)), 4 ether);
        assertEq(token.balanceOf(ANVIL_0), 0);
        assertEq(address(live).balance, 0);
        assertTrue(live.usedNonces(ANVIL_0, order.nonce));
        assertEq(LIVE_ROUTER.balance, 0);
    }

    function _proveAllowlistSlots() internal {
        address probe = address(0xBEEF);
        assertEq(_mapBool(probe, SLOT_ALLOWED_TOKENS), false);
        assertEq(_mapBool(probe, SLOT_EIP2612), false);
        assertEq(_mapBool(probe, SLOT_ROUTERS), false);

        vm.prank(LIVE_OWNER);
        live.setTokenAllowed(probe, true);
        assertEq(_mapBool(probe, SLOT_ALLOWED_TOKENS), true);
        assertEq(_mapBool(probe, SLOT_EIP2612), false);
        assertTrue(live.allowedTokens(probe));
        assertFalse(live.eip2612Tokens(probe));

        vm.prank(LIVE_OWNER);
        live.setRouterAllowed(probe, true);
        assertEq(_mapBool(probe, SLOT_ROUTERS), true);
        assertTrue(live.allowedRouters(probe));
    }

    function _deployPair() internal returns (TestDemoToken token, TestDemoFaucet faucet) {
        uint256 nonce = vm.getNonce(address(this));
        address predicted = vm.computeCreateAddress(address(this), nonce + 1);
        token = new TestDemoToken(predicted);
        faucet = new TestDemoFaucet(token);
        assertEq(address(faucet), predicted);
        assertEq(token.balanceOf(predicted), token.TOTAL_SUPPLY());
    }

    function _deployRouter() internal returns (LockedDemoSwapRouter router) {
        router = new LockedDemoSwapRouter(LIVE_OWNER, LIVE_SWAP, RATE_NUMERATOR, RATE_DENOMINATOR, MAX_PAYOUT);
    }

    function _signedOrder(
        TestDemoToken token,
        LockedDemoSwapRouter router,
        uint256 amountIn,
        uint256 nonce
    )
        internal
        view
        returns (
            IGasRescueSwap.Order memory order,
            bytes memory sig,
            uint8 v,
            bytes32 r,
            bytes32 s,
            bytes memory swapData
        )
    {
        swapData = abi.encodeWithSelector(LockedDemoSwapRouter.swapExact.selector, address(token), amountIn, ANVIL_0);
        order = IGasRescueSwap.Order({
            user: ANVIL_0,
            tokenIn: address(token),
            amountIn: amountIn,
            feeAmount: 0,
            feeTo: LIVE_OWNER,
            amountSwap: amountIn,
            minAmountOut: MAX_PAYOUT,
            to: ANVIL_0,
            nativeTo: ANVIL_0,
            router: address(router),
            pathHash: keccak256(swapData),
            chainId: BASE_SEPOLIA_CHAIN_ID,
            deadline: block.timestamp + 1 hours,
            nonce: nonce
        });
        (uint8 ov, bytes32 orr, bytes32 os) = vm.sign(ANVIL_0_PK, live.hashOrder(order));
        sig = abi.encodePacked(orr, os, ov);
        (v, r, s) = _signPermit(token, amountIn, order.deadline);
    }

    function _signPermit(
        TestDemoToken token,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, ANVIL_0, LIVE_SWAP, value, token.nonces(ANVIL_0), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(ANVIL_0_PK, digest);
    }

    function _emptyOrder() internal pure returns (IGasRescueSwap.Order memory) {
        return IGasRescueSwap.Order({
            user: address(0),
            tokenIn: address(0),
            amountIn: 0,
            feeAmount: 0,
            feeTo: address(0),
            amountSwap: 0,
            minAmountOut: 0,
            to: address(0),
            nativeTo: address(0),
            router: address(0),
            pathHash: bytes32(0),
            chainId: 0,
            deadline: 0,
            nonce: 0
        });
    }

    function _expectNotRelayer(
        address caller,
        IGasRescueSwap.Order memory order
    ) internal {
        _expectNotRelayer(caller, order, "", 0, bytes32(0), bytes32(0), "");
    }

    function _expectNotRelayer(
        address caller,
        IGasRescueSwap.Order memory order,
        bytes memory sig,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes memory swapData
    ) internal {
        vm.expectRevert(GasRescueSwap.NotRelayer.selector);
        vm.prank(caller);
        live.rescueWithPermit(order, sig, v, r, s, swapData);
    }

    function _mapBool(
        address key,
        uint256 slot
    ) internal view returns (bool) {
        return uint256(vm.load(LIVE_SWAP, keccak256(abi.encode(key, slot)))) == 1;
    }

    function _codeHas(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        bytes memory code = target.code;
        bytes memory needle = abi.encodePacked(selector);
        if (needle.length == 0 || needle.length > code.length) return false;
        for (uint256 i = 0; i <= code.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (code[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}

interface ISwapRouter02Views {
    function WETH9() external view returns (address);
    function factory() external view returns (address);
    function positionManager() external view returns (address);
}

/// @dev External creates so constructor reverts stay inside `vm.expectRevert`.
contract OptionCDeployer {
    function deployToken(
        address faucet
    ) external returns (TestDemoToken) {
        return new TestDemoToken(faucet);
    }

    function deployFaucet(
        IERC20 token
    ) external returns (TestDemoFaucet) {
        return new TestDemoFaucet(token);
    }
}
