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
///         `mint` and no `owner()` / mint gate (checked against runtime
///         bytecode). `setTokenAllowed` and `setEip2612Token` do exist on
///         live `GasRescueSwap` `0x65e7…993D`. This script does not redeploy
///         the rescue or the router.
///
///         Simulate (no key, no broadcast):
///
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 -vv
///
///         Spencer, on his machine, after reading the simulated address:
///
///           forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
///             --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 --broadcast
///
///         `PRIVATE_KEY` must be the owner key for that broadcast. Unset, the
///         script simulates from the owner address.
///
///         The deploy address depends on the owner's nonce. Do not hardcode
///         it until this simulation's nonce still matches chain.
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
    /// @dev Two 1-token judge rescues (`amountIn` 1e18). Not a public supply.
    uint256 internal constant JUDGE_MINT = 2 ether;

    function run() external {
        require(block.chainid == ARB_SEPOLIA_CHAIN_ID, "MigrateH1: Arb Sepolia 421614 only");
        ILiveSwapAdmin swap = ILiveSwapAdmin(LIVE_SWAP);
        require(swap.owner() == OWNER, "MigrateH1: live owner is not bA9D");
        require(swap.allowedTokens(LIVE_GRTT) && swap.eip2612Tokens(LIVE_GRTT), "MigrateH1: GRTT not allowlisted");
        require(swap.allowedTokens(LIVE_GMOCK) && swap.eip2612Tokens(LIVE_GMOCK), "MigrateH1: gMOCK not allowlisted");

        uint256 nonce = vm.getNonce(OWNER);
        address predicted = vm.computeCreateAddress(OWNER, nonce);

        bytes memory allowNew = abi.encodeCall(ILiveSwapAdmin.setEip2612Token, (predicted, true));
        bytes memory delistGrtt = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GRTT, false));
        bytes memory delistGmock = abi.encodeCall(ILiveSwapAdmin.setTokenAllowed, (LIVE_GMOCK, false));

        console2.log("signer           ", OWNER);
        console2.log("owner nonce      ", nonce);
        console2.log("predicted token  ", predicted);
        console2.log("judge mint       ", JUDGE_MINT);
        console2.log("demo holder      ", DEMO_HOLDER);
        console2.log("tx1 deploy GatedDemoToken constructor args: owner, holder, 2e18");
        console2.log("tx2 setEip2612Token(predicted, true)");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(allowNew);
        console2.log("tx3 setTokenAllowed(GRTT, false)  // also clears eip2612 on live bytecode");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(delistGrtt);
        console2.log("tx4 setTokenAllowed(gMOCK, false)");
        console2.log("target", LIVE_SWAP);
        console2.logBytes(delistGmock);

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) {
            vm.startBroadcast(OWNER);
        } else {
            require(vm.addr(key) == OWNER, "PRIVATE_KEY must be owner 0x3046...bA9D");
            vm.startBroadcast(key);
        }

        GatedDemoToken token = new GatedDemoToken(OWNER, DEMO_HOLDER, JUDGE_MINT);
        swap.setEip2612Token(address(token), true);
        swap.setTokenAllowed(LIVE_GRTT, false);
        swap.setTokenAllowed(LIVE_GMOCK, false);
        vm.stopBroadcast();

        require(address(token) == predicted, "MigrateH1: deploy address mismatch");
        require(token.owner() == OWNER, "MigrateH1: token owner");
        require(token.balanceOf(DEMO_HOLDER) == JUDGE_MINT, "MigrateH1: holder mint");
        require(swap.allowedTokens(address(token)) && swap.eip2612Tokens(address(token)), "MigrateH1: new token");
        require(!swap.allowedTokens(LIVE_GRTT) && !swap.eip2612Tokens(LIVE_GRTT), "MigrateH1: GRTT still allowed");
        require(!swap.allowedTokens(LIVE_GMOCK) && !swap.eip2612Tokens(LIVE_GMOCK), "MigrateH1: gMOCK still allowed");

        console2.log("gated token      ", address(token));
        console2.log("holder balance   ", token.balanceOf(DEMO_HOLDER));
        console2.log("GRTT allowed     ", swap.allowedTokens(LIVE_GRTT));
        console2.log("gMOCK allowed    ", swap.allowedTokens(LIVE_GMOCK));
    }
}
