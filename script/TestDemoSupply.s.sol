// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {LockedDemoSwapRouter} from "../src/LockedDemoSwapRouter.sol";
import {TestDemoFaucet} from "../src/TestDemoFaucet.sol";
import {TestDemoToken} from "../src/TestDemoToken.sol";

/// @notice Shared Base Sepolia and Arb Sepolia addresses for the tDEMO supply
///         scripts. Arb Sepolia stays the main demo. These scripts do not
///         move or delete SDEMO, the Arb swap, or the Arb locked router.
///         Simulate only. Spencer (`0x3046…bA9D`) signs. No key in the repo.
///         Do not pass `--broadcast` from an agent.
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
    function setRouterAllowed(
        address router,
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

/// @notice Chain-parameterized steps. Tests call these with an explicit sender.
///         `run()` on each B/A contract reads `msg.sender` (`--sender` / `--account`).
contract TestDemoSteps is Script {
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 public constant ARB_SEPOLIA_CHAIN_ID = 421_614;

    /// @dev Spencer. Signs every B and A transaction. Same owner on both swaps.
    address public constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    /// @dev Relayer hot wallet. B5 sends it 0.02 ETH on Base. Not a signer here.
    address public constant RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address public constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    address public constant BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    /// @dev Stale Base allowlist. Public `mint`. Delist before funding.
    address public constant BASE_GMOCK = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    /// @dev Stale Base router. Unidentified, no payout cap, 0 ETH. Delist. Do not fund.
    address public constant BASE_STALE_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    address public constant ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    /// @dev Live Arb `LockedDemoSwapRouter`. Reuse. Do not deploy a second one.
    address public constant ARB_ROUTER = 0xFE22f32eF7a8f64B6c9E1CCAe31817B54184f7fc;
    /// @dev SDEMO. Leave allowlisted. These scripts never call a setter on it.
    address public constant ARB_SDEMO = 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C;

    /// @dev 2 tDEMO quotes exactly `BASE_MAX_PAYOUT` (5e13 wei ETH per 1e18 token).
    uint256 public constant BASE_RATE_NUMERATOR = 50_000_000_000_000;
    uint256 public constant BASE_RATE_DENOMINATOR = 1e18;
    uint256 public constant BASE_MAX_PAYOUT = 0.0001 ether;
    uint256 public constant BASE_ROUTER_FUND = 0.05 ether;
    /// @dev Left on the owner after the two B5 transfers so the funding txs can pay gas.
    uint256 public constant BASE_FUND_HEADROOM = 0.001 ether;
    uint256 public constant BASE_RELAYER_FUND = 0.02 ether;
    /// @dev Recommended Arb cap. 0.2 tDEMO still quotes 0.0001 ETH. 2 tDEMO hits this cap.
    uint256 public constant ARB_RECOMMENDED_MAX_PAYOUT = 0.0001 ether;

    error WrongChain(uint256 chainId);
    error BroadcastRefused();
    error FoundryDefaultSender();
    error SenderNotOwner(address sender);
    error Underfunded(uint256 balance);

    function _signer() internal view returns (address sender) {
        sender = msg.sender;
        if (sender == FOUNDRY_DEFAULT_SENDER) revert FoundryDefaultSender();
        if (sender != OWNER) revert SenderNotOwner(sender);
    }

    function _requireChain(
        uint256 chainId
    ) internal view {
        if (block.chainid != chainId) revert WrongChain(block.chainid);
    }

    /// @notice Broadcast is refused unless `TEST_DEMO_BROADCAST_OK=1` and `block.chainid`
    ///         is `intendedChain`, which itself must be 84532 or 421614.
    function authorizeBroadcast(
        uint256 intendedChain
    ) public view {
        if (keccak256(bytes(vm.envOr("TEST_DEMO_BROADCAST_OK", string("")))) != keccak256(bytes("1"))) {
            revert BroadcastRefused();
        }
        if (intendedChain != BASE_SEPOLIA_CHAIN_ID && intendedChain != ARB_SEPOLIA_CHAIN_ID) {
            revert WrongChain(intendedChain);
        }
        _requireChain(intendedChain);
    }

    function _swap() internal view returns (ILiveSwapAdmin) {
        if (block.chainid == BASE_SEPOLIA_CHAIN_ID) return ILiveSwapAdmin(BASE_SWAP);
        if (block.chainid == ARB_SEPOLIA_CHAIN_ID) return ILiveSwapAdmin(ARB_SWAP);
        revert WrongChain(block.chainid);
    }

    function _logCall(
        string memory label,
        address target,
        bytes memory data
    ) internal pure {
        console2.log(label);
        console2.log("target", target);
        console2.logBytes(data);
    }

    /// @notice B4. Base only. Remove gMOCK and the unidentified router. Run this first.
    function delistBase(
        address sender
    ) public {
        authorizeBroadcast(BASE_SEPOLIA_CHAIN_ID);
        ILiveSwapAdmin swap = ILiveSwapAdmin(BASE_SWAP);
        require(swap.owner() == OWNER, "B4: owner is not 0x3046...bA9D");

        bytes memory delistToken = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (BASE_GMOCK, false));
        bytes memory delistRouter = abi.encodeCall(ILiveSwapAdmin.setRouterAllowed, (BASE_STALE_ROUTER, false));
        _logCall("B4 setTokenAllowed(gMOCK, false)", BASE_SWAP, delistToken);
        _logCall("B4 setRouterAllowed(0x94cC...2bc4, false)", BASE_SWAP, delistRouter);
        console2.log("signer", sender);

        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        // setTokenAllowed(false) also clears eip2612Tokens. No second token call.
        swap.setTokenAllowed(BASE_GMOCK, false);
        uint256 g1 = gasleft();
        swap.setRouterAllowed(BASE_STALE_ROUTER, false);
        uint256 g2 = gasleft();
        vm.stopBroadcast();

        console2.log("B4 gas setTokenAllowed", g0 - g1);
        console2.log("B4 gas setRouterAllowed", g1 - g2);

        require(!swap.allowedTokens(BASE_GMOCK), "B4: gMOCK still listed");
        require(!swap.eip2612Tokens(BASE_GMOCK), "B4: eip2612 flag still set");
        require(!swap.allowedRouters(BASE_STALE_ROUTER), "B4: stale router still listed");
    }

    /// @notice B1 on Base, A1 on Arb. Deploy the faucet. The faucet deploys tDEMO.
    function deployFaucet(
        address sender
    ) public returns (address faucet, address demo) {
        authorizeBroadcast(block.chainid);
        string memory step = block.chainid == BASE_SEPOLIA_CHAIN_ID ? "B1" : "A1";
        console2.log(step, "deploy TestDemoFaucet + TestDemoToken");
        console2.log("signer", sender);
        console2.log("chain", block.chainid);

        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        TestDemoFaucet deployed = new TestDemoFaucet();
        vm.stopBroadcast();
        console2.log(string.concat(step, " gas deployFaucet"), g0 - gasleft());

        faucet = address(deployed);
        demo = address(deployed.token());
        TestDemoToken token = TestDemoToken(demo);
        require(token.faucet() == faucet, "deploy: faucet mismatch");
        require(token.totalSupply() == token.TOTAL_SUPPLY(), "deploy: supply");
        require(token.balanceOf(faucet) == token.TOTAL_SUPPLY(), "deploy: faucet balance");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("tDEMO")), "deploy: symbol");
        console2.log("faucet", faucet);
        console2.log("tDEMO", demo);
        console2.log("copy tDEMO from this receipt into TOKEN_ADDRESS. Do not use a predicted address.");
    }

    /// @notice B2. Base only. Deploy a new capped router. Do not allowlist or fund here.
    function deployBaseRouter(
        address sender
    ) public returns (address router) {
        authorizeBroadcast(BASE_SEPOLIA_CHAIN_ID);
        console2.log("B2 deploy LockedDemoSwapRouter");
        console2.log("signer", sender);
        console2.log("rescue", BASE_SWAP);
        console2.log("maxPayout", BASE_MAX_PAYOUT);
        console2.log("rateNumerator", BASE_RATE_NUMERATOR);

        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        LockedDemoSwapRouter deployed =
            new LockedDemoSwapRouter(sender, BASE_SWAP, BASE_RATE_NUMERATOR, BASE_RATE_DENOMINATOR, BASE_MAX_PAYOUT);
        vm.stopBroadcast();
        console2.log("B2 gas deployRouter", g0 - gasleft());

        router = address(deployed);
        require(deployed.rescue() == BASE_SWAP, "B2: rescue");
        require(deployed.owner() == sender, "B2: owner");
        require(deployed.maxPayout() == BASE_MAX_PAYOUT, "B2: maxPayout");
        require(deployed.quote(2 ether) == BASE_MAX_PAYOUT, "B2: 2 tDEMO must hit maxPayout");
        require(address(deployed).balance == 0, "B2: fund happens in B5, after allowlist");
        console2.log("router", router);
        console2.log("copy the router from this receipt into ROUTER_ADDRESS. Do not use a predicted address.");
    }

    /// @notice B3 on Base (token + new router). A2 on Arb (token only; reuse 0xFE22…f7fc).
    ///         On Arb, `router` must be the live router or `address(0)` (that same default).
    function allowlist(
        address sender,
        address demo,
        address router
    ) public returns (address used) {
        authorizeBroadcast(block.chainid);
        require(demo != address(0), "allowlist: TOKEN_ADDRESS required");
        ILiveSwapAdmin swap = _swap();
        require(swap.owner() == OWNER, "allowlist: owner is not 0x3046...bA9D");
        TestDemoToken token = TestDemoToken(demo);
        require(token.totalSupply() == token.TOTAL_SUPPLY(), "allowlist: supply");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("tDEMO")), "allowlist: symbol");

        bool base = block.chainid == BASE_SEPOLIA_CHAIN_ID;
        if (!base) {
            require(router == address(0) || router == ARB_ROUTER, "A2: refusing a new Arb router");
            router = ARB_ROUTER;
            require(LockedDemoSwapRouter(payable(ARB_ROUTER)).rescue() == ARB_SWAP, "A2: router rescue");
            require(swap.allowedRouters(ARB_ROUTER), "A2: Arb router not allowlisted");
            require(swap.allowedTokens(ARB_SDEMO) && swap.eip2612Tokens(ARB_SDEMO), "A2: SDEMO must stay");
        } else {
            require(router != address(0), "B3: ROUTER_ADDRESS required");
            require(router != BASE_STALE_ROUTER, "B3: refusing stale router 0x94cC");
            LockedDemoSwapRouter deployed = LockedDemoSwapRouter(payable(router));
            require(deployed.rescue() == BASE_SWAP, "B3: router rescue");
            require(deployed.maxPayout() == BASE_MAX_PAYOUT, "B3: maxPayout");
            require(!swap.allowedTokens(BASE_GMOCK), "B3: run B4 before allowlisting tDEMO");
            require(!swap.allowedRouters(BASE_STALE_ROUTER), "B3: run B4 before allowlisting the router");
        }

        string memory step = base ? "B3" : "A2";
        bytes memory allowToken = abi.encodeCall(ILiveSwapAdmin.setEip2612Token, (demo, true));
        _logCall(string.concat(step, " setEip2612Token(tDEMO, true)"), address(swap), allowToken);
        console2.log("signer", sender);

        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        swap.setEip2612Token(demo, true);
        uint256 g1 = gasleft();
        if (!swap.allowedTokens(demo)) {
            swap.setTokenAllowed(demo, true);
        }
        uint256 g2 = gasleft();
        if (base) {
            swap.setRouterAllowed(router, true);
        }
        uint256 g3 = gasleft();
        vm.stopBroadcast();

        console2.log(string.concat(step, " gas setEip2612Token"), g0 - g1);
        console2.log(string.concat(step, " gas setTokenAllowed"), g1 - g2);
        console2.log(string.concat(step, " gas setRouterAllowed"), g2 - g3);

        require(swap.allowedTokens(demo) && swap.eip2612Tokens(demo), "allowlist: tDEMO");
        require(swap.allowedRouters(router), "allowlist: router");
        if (!base) {
            require(swap.allowedTokens(ARB_SDEMO) && swap.eip2612Tokens(ARB_SDEMO), "A2: SDEMO dropped");
            require(router == ARB_ROUTER, "A2: deployed a new router");
        }
        console2.log("tDEMO allowed", swap.allowedTokens(demo));
        console2.log("tDEMO eip2612", swap.eip2612Tokens(demo));
        console2.log("router", router);
        used = router;
    }

    /// @notice B5. Base only. 0.05 ETH to the new router, 0.02 ETH to the relayer hot wallet.
    function fundBase(
        address sender,
        address router
    ) public {
        authorizeBroadcast(BASE_SEPOLIA_CHAIN_ID);
        require(router != address(0) && router != BASE_STALE_ROUTER, "B5: router");
        ILiveSwapAdmin swap = ILiveSwapAdmin(BASE_SWAP);
        require(swap.allowedRouters(router), "B5: allowlist the router in B3 before funding");
        require(!swap.allowedRouters(BASE_STALE_ROUTER), "B5: stale router still listed");
        require(!swap.allowedTokens(BASE_GMOCK), "B5: gMOCK still listed");
        LockedDemoSwapRouter deployed = LockedDemoSwapRouter(payable(router));
        require(deployed.maxPayout() == BASE_MAX_PAYOUT, "B5: maxPayout");

        uint256 need = BASE_ROUTER_FUND + BASE_RELAYER_FUND;
        console2.log("B5 fund router", BASE_ROUTER_FUND);
        console2.log("B5 fund relayer", BASE_RELAYER_FUND);
        console2.log("B5 headroom", BASE_FUND_HEADROOM);
        console2.log("B5 signer balance", sender.balance);
        console2.log("signer", sender);
        if (sender.balance < need + BASE_FUND_HEADROOM) revert Underfunded(sender.balance);

        uint256 routerBefore = address(deployed).balance;
        uint256 relayerBefore = RELAYER.balance;
        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        (bool routerOk,) = payable(router).call{value: BASE_ROUTER_FUND}("");
        require(routerOk, "B5: router transfer");
        uint256 g1 = gasleft();
        (bool relayerOk,) = payable(RELAYER).call{value: BASE_RELAYER_FUND}("");
        require(relayerOk, "B5: relayer transfer");
        uint256 g2 = gasleft();
        vm.stopBroadcast();

        console2.log("B5 gas fundRouter", g0 - g1);
        console2.log("B5 gas fundRelayer", g1 - g2);
        require(address(deployed).balance == routerBefore + BASE_ROUTER_FUND, "B5: router balance");
        require(RELAYER.balance == relayerBefore + BASE_RELAYER_FUND, "B5: relayer balance");
    }

    /// @notice A3. Arb only. Recommended: lower maxPayout on the existing router.
    ///         Does not deploy a router and does not move ETH.
    function setArbMaxPayout(
        address sender
    ) public {
        authorizeBroadcast(ARB_SEPOLIA_CHAIN_ID);
        LockedDemoSwapRouter router = LockedDemoSwapRouter(payable(ARB_ROUTER));
        require(router.owner() == OWNER, "A3: router owner");
        require(router.rescue() == ARB_SWAP, "A3: router rescue");
        require(ILiveSwapAdmin(ARB_SWAP).allowedRouters(ARB_ROUTER), "A3: router not allowlisted");

        uint256 balance = address(router).balance;
        uint256 previous = router.maxPayout();
        console2.log("A3 reuse router", ARB_ROUTER);
        console2.log("A3 balance", balance);
        console2.log("A3 maxPayout before", previous);
        console2.log("A3 payAmount before", router.payAmount());
        console2.log("A3 quote(2 tDEMO) before", router.quote(2 ether));
        if (previous > 0) console2.log("A3 full rescues before", balance / previous);
        console2.log("A3 full rescues after 0.0001 ETH cap", balance / ARB_RECOMMENDED_MAX_PAYOUT);
        bytes memory data = abi.encodeCall(LockedDemoSwapRouter.setMaxPayout, (ARB_RECOMMENDED_MAX_PAYOUT));
        _logCall("A3 setMaxPayout(0.0001 ether)", ARB_ROUTER, data);
        console2.log("signer", sender);

        uint256 g0 = gasleft();
        vm.startBroadcast(sender);
        router.setMaxPayout(ARB_RECOMMENDED_MAX_PAYOUT);
        vm.stopBroadcast();
        console2.log("A3 gas setMaxPayout", g0 - gasleft());

        require(router.maxPayout() == ARB_RECOMMENDED_MAX_PAYOUT, "A3: maxPayout");
        require(router.quote(2 ether) == ARB_RECOMMENDED_MAX_PAYOUT, "A3: 2 tDEMO cap");
        require(router.payAmount() == 0.0001 ether, "A3: 0.2-token payAmount changed");
        require(address(router).balance == balance, "A3: moved ETH");
        console2.log("A3 payAmount after", router.payAmount());
        console2.log("A3 quote(2 tDEMO) after", router.quote(2 ether));
    }
}

/// @notice B4. First Base transaction. Delist gMOCK and router 0x94cC…2bc4.
///         Keystore placeholder: `--account <owner-keystore> --sender 0x3046…bA9D`.
///         Simulate (no key, no broadcast):
///           forge script script/TestDemoSupply.s.sol:B4_DelistStaleAllowlist \
///             --rpc-url "$BASE_SEPOLIA_RPC_URL" --chain-id 84532 \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
contract B4_DelistStaleAllowlist is TestDemoSteps {
    function run() external {
        delistBase(_signer());
    }
}

/// @notice B1 on Base, A1 on Arb. Deploy tDEMO and the faucet.
///           forge script script/TestDemoSupply.s.sol:B1_DeployTestDemoFaucet \
///             --rpc-url "$RPC" --chain-id <84532|421614> \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D -vv
contract B1_DeployTestDemoFaucet is TestDemoSteps {
    function run() external returns (address faucet, address demo) {
        return deployFaucet(_signer());
    }
}

/// @notice B2. Base only. New LockedDemoSwapRouter, maxPayout 0.0001 ETH. No fund.
contract B2_DeployBaseRouter is TestDemoSteps {
    function run() external returns (address router) {
        return deployBaseRouter(_signer());
    }
}

/// @notice B3 on Base, A2 on Arb. Allowlist the deployed tDEMO.
///         Base also allowlists `ROUTER_ADDRESS` from the B2 receipt.
///         Env: TOKEN_ADDRESS (required). ROUTER_ADDRESS (Base only).
contract B3_AllowlistTestDemo is TestDemoSteps {
    function run() external returns (address router) {
        address demo = vm.envAddress("TOKEN_ADDRESS");
        address configured = block.chainid == BASE_SEPOLIA_CHAIN_ID ? vm.envAddress("ROUTER_ADDRESS") : ARB_ROUTER;
        return allowlist(_signer(), demo, configured);
    }
}

/// @notice B5. Base only. After B4, B1, B2, and B3. 0.05 ETH to the router, 0.02 ETH to 0x8240…9AF6.
///         Env: ROUTER_ADDRESS from the B2 receipt.
contract B5_FundBaseRouter is TestDemoSteps {
    function run() external {
        fundBase(_signer(), vm.envAddress("ROUTER_ADDRESS"));
    }
}

/// @notice A3. Arb only. Recommended owner call on the existing router. Not a new deploy.
contract A3_SetArbMaxPayout is TestDemoSteps {
    function run() external {
        setArbMaxPayout(_signer());
    }
}

/// @notice One simulation of Base order B4, B1, B2, B3, B5. Do not `--broadcast` this
///         aggregator. Spencer signs the five contracts above, in that order.
contract SimulateBaseSupply is TestDemoSteps {
    function run() external {
        address sender = _signer();
        delistBase(sender);
        (, address demo) = deployFaucet(sender);
        address router = deployBaseRouter(sender);
        allowlist(sender, demo, router);
        fundBase(sender, router);
    }
}

/// @notice One simulation of Arb order A1, A2, then recommended A3.
///         Do not `--broadcast` this aggregator.
contract SimulateArbSupply is TestDemoSteps {
    function run() external {
        address sender = _signer();
        (, address demo) = deployFaucet(sender);
        allowlist(sender, demo, ARB_ROUTER);
        setArbMaxPayout(sender);
    }
}
