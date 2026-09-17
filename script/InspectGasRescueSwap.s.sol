// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IGasRescueSwapViews} from "../src/interfaces/IGasRescueSwapViews.sol";

/// @notice Read-only live `GasRescueSwap` inspector. No broadcast. No keys.
///
///   forge script script/InspectGasRescueSwap.s.sol:InspectGasRescueSwap \
///     --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
///
/// Optional env: GAS_RESCUE_SWAP_ADDRESS (defaults to documented live swap for the chain).
/// Day-5: also prints hot-wallet underfund and the recommended fixture/demo
/// judge path so a live submit is not implied when the hot key is ~0.015 ETH.
contract InspectGasRescueSwap is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant LIVE_ARB_GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant LIVE_ARB_GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address internal constant LIVE_ARB_ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;
    address internal constant LIVE_BASE_TOKEN = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address internal constant LIVE_BASE_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    bytes4 internal constant PERMIT2_IMMUTABLE_SELECTOR = 0xe8d9f070;
    /// @dev Spencer / Chain Ops target before a live `rescueWithPermit` submit.
    uint256 internal constant HOT_WALLET_MIN_WEI = 0.10 ether;
    string internal constant JUDGE_PATH_FIXTURE = "fixture-demo-no-top-up";
    string internal constant JUDGE_PATH_LIVE = "live-submit-ok-if-user-funded";
    string internal constant JUDGE_NOTE_UNDERFUNDED =
        "hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake";
    string internal constant JUDGE_NOTE_FUNDED =
        "hot-wallet-meets-0.10-ETH-floor; live-submit-still-Spencer-keys-only; fixture-demo-remains-valid";

    function run() external view {
        uint256 chainId = block.chainid;
        require(
            chainId == ARB_SEPOLIA_CHAIN_ID || chainId == BASE_SEPOLIA_CHAIN_ID,
            "InspectGasRescueSwap: testnet only (84532 or 421614)"
        );

        address swapAddr = vm.envOr("GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (swapAddr == address(0)) {
            swapAddr = chainId == ARB_SEPOLIA_CHAIN_ID ? LIVE_ARB_SWAP : LIVE_BASE_SWAP;
        }
        IGasRescueSwapViews swap = IGasRescueSwapViews(swapAddr);

        console2.log("InspectGasRescueSwap (read-only, no broadcast)");
        console2.log("chain            ", chainId);
        console2.log("swap             ", swapAddr);
        console2.log("owner            ", swap.owner());
        console2.log("pendingOwner     ", swap.pendingOwner());
        console2.log("paused           ", swap.paused());
        console2.log("weth             ", swap.weth());
        console2.log("permit2          ", swap.permit2());
        console2.log("permit2Enabled   ", swap.permit2Enabled());
        console2.log("relayer allowed  ", swap.relayers(LIVE_RELAYER));
        console2.log("hot wallet       ", LIVE_RELAYER);
        console2.log("hot wallet wei   ", LIVE_RELAYER.balance);
        console2.log("hot underfunded  ", LIVE_RELAYER.balance < HOT_WALLET_MIN_WEI);
        console2.log("live submit blocked", LIVE_RELAYER.balance < HOT_WALLET_MIN_WEI);
        console2.log("recommended path ", recommendedJudgePath(LIVE_RELAYER.balance < HOT_WALLET_MIN_WEI));
        console2.log("judge note       ", judgeNote(LIVE_RELAYER.balance < HOT_WALLET_MIN_WEI));
        console2.log("demo video exists  true (do not remake)");
        console2.log("has CANONICAL_PERMIT2 getter", _hasSelector(swapAddr, bytes4(keccak256("CANONICAL_PERMIT2()"))));
        console2.log(
            "has rescueReceipt           ", _hasSelector(swapAddr, bytes4(keccak256("rescueReceipt(address,uint256)")))
        );
        console2.log("setPermit2 is F-1 immutable ", _setPermit2Immutable(swapAddr));

        if (chainId == ARB_SEPOLIA_CHAIN_ID) {
            console2.log("GRTT allowed     ", swap.allowedTokens(LIVE_ARB_GRTT));
            console2.log("GRTT eip2612     ", swap.eip2612Tokens(LIVE_ARB_GRTT));
            console2.log("gMOCK allowed    ", swap.allowedTokens(LIVE_ARB_GMOCK));
            console2.log("router allowed   ", swap.allowedRouters(LIVE_ARB_ROUTER));
        } else {
            console2.log("token allowed    ", swap.allowedTokens(LIVE_BASE_TOKEN));
            console2.log("token eip2612    ", swap.eip2612Tokens(LIVE_BASE_TOKEN));
            console2.log("router allowed   ", swap.allowedRouters(LIVE_BASE_ROUTER));
        }

        if (
            !_hasSelector(swapAddr, bytes4(keccak256("CANONICAL_PERMIT2()")))
                || !_hasSelector(swapAddr, bytes4(keccak256("rescueReceipt(address,uint256)")))
        ) {
            console2.log("DRIFT: live bytecode != tip src/GasRescueSwap.sol (F-5 getter and/or rescueReceipt).");
            console2.log("See docs/REDEPLOY-GASRESCUESWAP.md - Spencer keys only; agent never broadcasts.");
        }

        if (LIVE_RELAYER.balance < HOT_WALLET_MIN_WEI) {
            console2.log("JUDGE: hot wallet underfunded. Use fixture/demo without top-up. Do not remake the demo video.");
        }
    }

    /// @notice Testable judge-path notes. Same strings as HackQuestStatus Day-5.
    function judgeNotes() public view returns (string memory) {
        uint256 hotWei = LIVE_RELAYER.balance;
        bool underfunded = hotWei < HOT_WALLET_MIN_WEI;
        return string.concat(
            '{"hotWallet":"',
            vm.toString(LIVE_RELAYER),
            '","hotWalletWei":"',
            vm.toString(hotWei),
            '","hotWalletMinWei":"',
            vm.toString(HOT_WALLET_MIN_WEI),
            '","hotWalletUnderfunded":',
            underfunded ? "true" : "false",
            ',"liveSubmitBlocked":',
            underfunded ? "true" : "false",
            ',"recommendedJudgePath":"',
            recommendedJudgePath(underfunded),
            '","demoVideoExists":true',
            ',"judgeNote":"',
            judgeNote(underfunded),
            '"}'
        );
    }

    function recommendedJudgePath(
        bool hotUnderfunded
    ) public pure returns (string memory) {
        return hotUnderfunded ? JUDGE_PATH_FIXTURE : JUDGE_PATH_LIVE;
    }

    function judgeNote(
        bool hotUnderfunded
    ) public pure returns (string memory) {
        return hotUnderfunded ? JUDGE_NOTE_UNDERFUNDED : JUDGE_NOTE_FUNDED;
    }

    function _hasSelector(
        address target,
        bytes4 selector
    ) internal view returns (bool) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector, address(0), uint256(0)));
        if (ok) return true;
        return data.length > 0;
    }

    function _setPermit2Immutable(
        address target
    ) internal view returns (bool) {
        (bool ok, bytes memory data) =
            target.staticcall(abi.encodeWithSelector(bytes4(keccak256("setPermit2(address,bool)")), address(0), false));
        if (ok || data.length < 4) return false;
        bytes4 err;
        assembly {
            err := mload(add(data, 32))
        }
        return err == PERMIT2_IMMUTABLE_SELECTOR;
    }
}
