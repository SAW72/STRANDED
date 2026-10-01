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
///         One run deploys `GatedDemoToken` and then calls the three setters
///         with the address `new` returned. It does not predict a CREATE
///         address from the owner nonce.
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
///         Spencer, on his machine, after reading the deployed address:
///
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
///             --account <owner-keystore> \
///             --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
///             --broadcast
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
    /// @dev Demo GRTT holder. Receives the only tokens this script mints.
    address internal constant DEMO_HOLDER = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;
    /// @dev Foundry's unset script sender. Never a real owner key.
    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;
    /// @dev Two 1-token judge rescues (`amountIn` 1e18). Not a public supply.
    uint256 internal constant JUDGE_MINT = 2 ether;

    error FoundryDefaultSender();
    error SenderNotOwner(address sender);

    function run() external {
        require(block.chainid == ARB_SEPOLIA_CHAIN_ID, "MigrateH1: Arb Sepolia 421614 only");
        ILiveSwapAdmin swap = ILiveSwapAdmin(LIVE_SWAP);
        require(swap.owner() == OWNER, "MigrateH1: live owner is not bA9D");
        require(swap.allowedTokens(LIVE_GRTT) && swap.eip2612Tokens(LIVE_GRTT), "MigrateH1: GRTT not allowlisted");
        require(swap.allowedTokens(LIVE_GMOCK) && swap.eip2612Tokens(LIVE_GMOCK), "MigrateH1: gMOCK not allowlisted");

        address sender = msg.sender;
        if (sender == FOUNDRY_DEFAULT_SENDER) revert FoundryDefaultSender();
        if (sender != OWNER) revert SenderNotOwner(sender);

        console2.log("signer           ", sender);
        console2.log("judge mint       ", JUDGE_MINT);
        console2.log("demo holder      ", DEMO_HOLDER);

        vm.startBroadcast();

        GatedDemoToken token = new GatedDemoToken(OWNER, DEMO_HOLDER, JUDGE_MINT);
        address deployed = address(token);

        bytes memory allowNew = abi.encodeCall(ILiveSwapAdmin.setEip2612Token, (deployed, true));
        bytes memory delistGrtt = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GRTT, false));
        bytes memory delistGmock = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GMOCK, false));

        console2.log("deployed token   ", deployed);
        console2.log("set DEMO_TOKEN to the deployed address above. Do not use a predicted address.");
        console2.log("tx2 setEip2612Token(deployed, true)");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(allowNew);
        console2.log("tx3 setTokenAllowed(GRTT, false)  // also clears eip2612 on live bytecode");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(delistGrtt);
        console2.log("tx4 setTokenAllowed(gMOCK, false)");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(delistGmock);

        swap.setEip2612Token(deployed, true);
        swap.setTokenAllowed(LIVE_GRTT, false);
        swap.setTokenAllowed(LIVE_GMOCK, false);
        vm.stopBroadcast();

        require(token.owner() == OWNER, "MigrateH1: token owner");
        require(token.balanceOf(DEMO_HOLDER) == JUDGE_MINT, "MigrateH1: holder mint");
        require(swap.allowedTokens(deployed) && swap.eip2612Tokens(deployed), "MigrateH1: new token");
        require(!swap.allowedTokens(LIVE_GRTT) && !swap.eip2612Tokens(LIVE_GRTT), "MigrateH1: GRTT still allowed");
        require(!swap.allowedTokens(LIVE_GMOCK) && !swap.eip2612Tokens(LIVE_GMOCK), "MigrateH1: gMOCK still allowed");

        console2.log("holder balance   ", token.balanceOf(DEMO_HOLDER));
        console2.log("GRTT allowed     ", swap.allowedTokens(LIVE_GRTT));
        console2.log("gMOCK allowed    ", swap.allowedTokens(LIVE_GMOCK));
    }
}
