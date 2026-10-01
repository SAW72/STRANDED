// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {GatedDemoToken} from "../src/GatedDemoToken.sol";

/// @notice H1 migration for the already-deployed Arb Sepolia rescue.
///         Simulate only from this repo. Spencer (`0x3046…bA9D`) signs.
///         No private key belongs in the repo. Do not pass `--broadcast`
///         from an agent.
///
///         Live GRTT `0x5649…d713` and gMOCK `0x3000…B318` both have public
///         `mint` and no `owner()` / mint gate. `setTokenAllowed` and
///         `setEip2612Token` exist on live `GasRescueSwap` `0x65e7…993D`.
///         This script does not redeploy the rescue or the router.
///
///         A fresh run deploys `GatedDemoToken` and then calls the setters
///         with the address `new` returned. It does not predict a CREATE
///         address from the owner nonce. If a run stops halfway, set
///         `EXISTING_TOKEN` to the address that run printed and run again.
///         That path does not deploy. It checks the token, then sends only
///         the setters that are not already applied.
///
///         `0x5BFd…BA37` is Spencer's demo/QA EOA. It was allowlisted as a
///         relayer in the past. On 2026-10-01 `relayers(address)` on the live
///         rescue returned false for it. The live relayer hot key is
///         `0x8240…9AF6`.
///
///         Keyless. `vm.startBroadcast()` uses `--sender` / `--account`.
///         Foundry's default sender is rejected.
///
///         Simulate (no key, no broadcast):
///
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///             --chain-id 421614 -vv
///
///         Spencer, on his machine, after reading the simulated address.
///         `--slow` waits for each transaction before sending the next one,
///         so a stopped run can be resumed from the address that landed:
///
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
///             --account <owner-keystore> \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///             --broadcast --slow
///
///         Resume after a partial run (no second deploy):
///
///           EXISTING_TOKEN=<printed address> \
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
///             --account <owner-keystore> \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///             --broadcast --slow
///
///         Then set `DEMO_TOKEN` (and the wallet / relayer token env) to the
///         address this run prints. Do not paste a nonce-predicted address.
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
}

contract MigrateH1GatedDemoToken is Script {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    /// @dev Spencer. Ownable2Step on the rescue was accepted. This key signs.
    address internal constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant LIVE_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant LIVE_GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    /// @dev Spencer's demo/QA EOA. Receives the constructor allocation. Was a
    ///      relayer in the past; `relayers` was false on 2026-10-01.
    address internal constant DEMO_HOLDER = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;
    /// @dev Foundry's unset script sender. Never a real owner key.
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;
    uint256 internal constant DEMO_ALLOCATION = 2 ether;
    uint256 internal constant STEWARD_ALLOCATION = 18 ether;
    uint256 internal constant TOTAL_SUPPLY = 20 ether;
    bytes4 internal constant MINT_ADDRESS_UINT = 0x40c10f19;
    bytes4 internal constant MINT_UINT = 0xa0712d68;

    /// @dev `existingToken == address(0)` deploys. Any other address resumes.
    ///      `sender` is the owner key. `run` copies `msg.sender`. Tests pass it
    ///      here so they do not `vm.prank` across `startBroadcast`.
    struct Config {
        address existingToken;
        address sender;
    }

    error FoundryDefaultSender();
    error SenderNotOwner(address sender);

    function run() external returns (address deployed) {
        return migrate(Config({existingToken: vm.envOr("EXISTING_TOKEN", address(0)), sender: msg.sender}));
    }

    /// @notice Tests pass `cfg` directly. `run` is the only env reader.
    function migrate(
        Config memory cfg
    ) public returns (address deployed) {
        require(block.chainid == ARB_SEPOLIA_CHAIN_ID, "MigrateH1: Arb Sepolia 421614 only");
        ILiveSwapAdmin swap = ILiveSwapAdmin(LIVE_SWAP);
        require(swap.owner() == OWNER, "MigrateH1: live owner is not bA9D");

        address sender = cfg.sender;
        if (sender == FOUNDRY_DEFAULT_SENDER) revert FoundryDefaultSender();
        if (sender != OWNER) revert SenderNotOwner(sender);

        console2.log("signer           ", sender);
        console2.log("demo allocation  ", DEMO_ALLOCATION);
        console2.log("steward allocation", STEWARD_ALLOCATION);
        console2.log("demo holder      ", DEMO_HOLDER);

        GatedDemoToken token;
        uint256 supplyBefore;
        uint256 demoBefore;
        uint256 stewardBefore;
        if (cfg.existingToken == address(0)) {
            vm.startBroadcast(sender);
            token = new GatedDemoToken();
            vm.stopBroadcast();
            require(token.totalSupply() == TOTAL_SUPPLY, "MigrateH1: fresh supply");
            require(token.balanceOf(DEMO_HOLDER) == DEMO_ALLOCATION, "MigrateH1: demo allocation");
            require(token.balanceOf(OWNER) == STEWARD_ALLOCATION, "MigrateH1: steward allocation");
        } else {
            token = GatedDemoToken(cfg.existingToken);
            _requireExisting(token);
            supplyBefore = token.totalSupply();
            demoBefore = token.balanceOf(DEMO_HOLDER);
            stewardBefore = token.balanceOf(OWNER);
        }
        deployed = address(token);

        bool allow = !swap.eip2612Tokens(deployed);
        bool delistGrtt = swap.allowedTokens(LIVE_GRTT);
        bool delistGmock = swap.allowedTokens(LIVE_GMOCK);

        bytes memory allowNew = abi.encodeCall(ILiveSwapAdmin.setEip2612Token, (deployed, true));
        bytes memory delistGrttData = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GRTT, false));
        bytes memory delistGmockData = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GMOCK, false));

        console2.log("deployed token   ", deployed);
        console2.log("set DEMO_TOKEN to the deployed address above. Do not use a predicted address.");
        if (allow) {
            console2.log("tx setEip2612Token(deployed, true)");
            console2.log("target", LIVE_SWAP);
            console2.logBytes(allowNew);
        } else {
            console2.log("skip setEip2612Token (already true)");
        }
        if (delistGrtt) {
            console2.log("tx setTokenAllowed(GRTT, false)  // also clears eip2612 on live bytecode");
            console2.log("target", LIVE_SWAP);
            console2.logBytes(delistGrttData);
        } else {
            console2.log("skip setTokenAllowed(GRTT) (already false)");
        }
        if (delistGmock) {
            console2.log("tx setTokenAllowed(gMOCK, false)");
            console2.log("target", LIVE_SWAP);
            console2.logBytes(delistGmockData);
        } else {
            console2.log("skip setTokenAllowed(gMOCK) (already false)");
        }

        if (allow || delistGrtt || delistGmock) {
            vm.startBroadcast(sender);
            if (allow) swap.setEip2612Token(deployed, true);
            if (delistGrtt) swap.setTokenAllowed(LIVE_GRTT, false);
            if (delistGmock) swap.setTokenAllowed(LIVE_GMOCK, false);
            vm.stopBroadcast();
        }

        require(!_hasMintSelector(deployed), "MigrateH1: mint selector");
        require(token.totalSupply() == TOTAL_SUPPLY, "MigrateH1: supply");
        if (cfg.existingToken == address(0)) {
            require(token.balanceOf(DEMO_HOLDER) == DEMO_ALLOCATION, "MigrateH1: demo allocation");
            require(token.balanceOf(OWNER) == STEWARD_ALLOCATION, "MigrateH1: steward allocation");
        } else {
            require(token.totalSupply() == supplyBefore, "MigrateH1: supply changed");
            require(token.balanceOf(DEMO_HOLDER) == demoBefore, "MigrateH1: demo balance changed");
            require(token.balanceOf(OWNER) == stewardBefore, "MigrateH1: steward balance changed");
        }
        require(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed), "MigrateH1: new token");
        require(!swap.allowedTokens(LIVE_GRTT) && !swap.eip2612Tokens(LIVE_GRTT), "MigrateH1: GRTT still allowed");
        require(!swap.allowedTokens(LIVE_GMOCK) && !swap.eip2612Tokens(LIVE_GMOCK), "MigrateH1: gMOCK still allowed");

        console2.log("holder balance   ", token.balanceOf(DEMO_HOLDER));
        console2.log("GRTT allowed     ", swap.allowedTokens(LIVE_GRTT));
        console2.log("gMOCK allowed    ", swap.allowedTokens(LIVE_GMOCK));
    }

    /// @dev Resume accepts a token with code, the SDEMO name and symbol, and
    ///      `totalSupply == 20e18`. The constructor split is 2e18 on the demo
    ///      wallet and 18e18 on the Steward wallet. If both balances are still
    ///      at least those amounts, supply forces them to be exact. If either
    ///      balance is lower, transfers already happened; the script still
    ///      accepts the token because it cannot recreate supply (no mint
    ///      selector) and this run does not move balances.
    function _requireExisting(
        GatedDemoToken token
    ) internal view {
        require(address(token).code.length > 0, "MigrateH1: EXISTING_TOKEN has no code");
        require(
            keccak256(bytes(token.name())) == keccak256(bytes("Stranded Demo Token")),
            "MigrateH1: EXISTING_TOKEN name"
        );
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("SDEMO")), "MigrateH1: EXISTING_TOKEN symbol");
        require(token.totalSupply() == TOTAL_SUPPLY, "MigrateH1: EXISTING_TOKEN supply");
        require(!_hasMintSelector(address(token)), "MigrateH1: EXISTING_TOKEN mint selector");
        bool splitIntact = token.balanceOf(DEMO_HOLDER) >= DEMO_ALLOCATION
            && token.balanceOf(OWNER) >= STEWARD_ALLOCATION;
        if (!splitIntact) {
            console2.log("EXISTING_TOKEN balances have moved since the constructor");
            console2.log("demo balance    ", token.balanceOf(DEMO_HOLDER));
            console2.log("steward balance ", token.balanceOf(OWNER));
        }
    }

    function _hasMintSelector(
        address token
    ) internal view returns (bool) {
        return _codeHas(token, MINT_ADDRESS_UINT) || _codeHas(token, MINT_UINT);
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
