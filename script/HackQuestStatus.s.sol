// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {ArbSepoliaDemoPath} from "../src/ArbSepoliaDemoPath.sol";
import {GasRescueLens} from "../src/GasRescueLens.sol";

/// @notice Read-only Lens consumer. Prints HackQuest-ready status JSON for the
///         live Arb Sepolia swap (or a local swap). No keys. No broadcast.
///
///   forge script script/HackQuestStatus.s.sol:HackQuestStatus \
///     --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
///
/// Optional env:
///   GAS_RESCUE_SWAP_ADDRESS   default documented live Arb swap
///   GAS_RESCUE_LENS_ADDRESS   if unset, constructs Lens in-script (not broadcast)
///   HACKQUEST_USER            readiness user (default fixture 0x1111…)
///   HACKQUEST_NONCE           default 0
///   HACKQUEST_AMOUNT_IN       default 0 = probe (userFunded/ready false; other
///                             flags still populate). Set >0 for a real-rescue
///                             preflight (`balanceOf(user) >= amountIn`).
///   HACKQUEST_NATIVE_TO       path-hash recipient (default fixture 0x1111…)
///   HACKQUEST_PATH_HASH       optional quoted hash (flags wallet dry 0xbbb…)
///
/// Day-5 JSON (no keys, no broadcast): Day-4 fields plus judge fixture path.
/// When the live hot wallet is underfunded (~0.015 vs 0.10 ETH),
/// `recommendedJudgePath=fixture-demo-no-top-up` and `liveSubmitBlocked=true`.
/// Do not remake the demo video. Do not rewrite Relayer fee math (#26 owns that).
contract HackQuestStatus is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_ARB_SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant LIVE_BASE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant DRY_NATIVE_TO = 0x1111111111111111111111111111111111111111;
    /// @dev Spencer / Chain Ops target before a live `rescueWithPermit` submit.
    uint256 internal constant HOT_WALLET_MIN_WEI = 0.10 ether;
    /// @dev Issue #24 Tokenomics: MATCH current Relayer numbers. USD-hybrid is
    ///      deferred (not a live Relayer bug). Do not rewrite fee math here.
    string internal constant FEE_POSTURE_NOTE =
        "match=flat-1pct-tokenIn; amountSwap=20pct-gas-topup-not-fee; slip=100bps-fail-closed; usd-hybrid=deferred-not-a-relayer-bug; owner=Relayer-Backend-do-not-rewrite";
    string internal constant JUDGE_PATH_FIXTURE = "fixture-demo-no-top-up";
    string internal constant JUDGE_PATH_LIVE = "live-submit-ok-if-user-funded";
    string internal constant JUDGE_NOTE_UNDERFUNDED =
        "hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake";
    string internal constant JUDGE_NOTE_FUNDED =
        "hot-wallet-meets-0.10-ETH-floor; live-submit-still-Spencer-keys-only; fixture-demo-remains-valid";

    function run() external {
        _requireTestnet();
        address user = vm.envOr("HACKQUEST_USER", DRY_NATIVE_TO);
        uint256 nonce = vm.envOr("HACKQUEST_NONCE", uint256(0));
        uint256 amountIn = vm.envOr("HACKQUEST_AMOUNT_IN", uint256(0));
        address nativeTo = vm.envOr("HACKQUEST_NATIVE_TO", DRY_NATIVE_TO);
        bytes32 quoted = vm.envOr("HACKQUEST_PATH_HASH", bytes32(0));

        string memory json = reportJson(user, nonce, amountIn, nativeTo, quoted);
        console2.log(json);
    }

    /// @notice Build the JSON blob. Deploys a local Lens when none is configured
    ///         (`new` is outside `startBroadcast` — never broadcast from here).
    function reportJson(
        address user,
        uint256 nonce,
        uint256 amountIn,
        address nativeTo,
        bytes32 quotedPathHash
    ) public returns (string memory) {
        _requireTestnet();
        (GasRescueLens lens, bool ephemeral) = _lens();
        GasRescueLens.HackQuestReport memory r = lens.hackQuestReport(user, nonce, amountIn, nativeTo, quotedPathHash);
        if (ephemeral) {
            console2.log("Lens constructed in-script (not broadcast, not on-chain).");
        }
        return _encode(r, address(lens), ephemeral, user, nonce, amountIn, nativeTo);
    }

    function _lens() internal returns (GasRescueLens lens, bool ephemeral) {
        address configured = vm.envOr("GAS_RESCUE_LENS_ADDRESS", address(0));
        if (configured != address(0)) {
            return (GasRescueLens(configured), false);
        }
        return (new GasRescueLens(_swap()), true);
    }

    function _swap() internal view returns (address swap) {
        swap = vm.envOr("GAS_RESCUE_SWAP_ADDRESS", address(0));
        if (swap == address(0)) {
            swap = block.chainid == ARB_SEPOLIA_CHAIN_ID ? LIVE_ARB_SWAP : LIVE_BASE_SWAP;
        }
        require(swap != address(0), "GAS_RESCUE_SWAP_ADDRESS required");
    }

    function _requireTestnet() internal view {
        uint256 chainId = block.chainid;
        require(
            chainId == ARB_SEPOLIA_CHAIN_ID || chainId == BASE_SEPOLIA_CHAIN_ID,
            "HackQuestStatus: testnet only (Arb Sepolia 421614 or Base Sepolia 84532)"
        );
    }

    function _encode(
        GasRescueLens.HackQuestReport memory r,
        address lens,
        bool lensEphemeral,
        address user,
        uint256 nonce,
        uint256 amountIn,
        address nativeTo
    ) internal view returns (string memory) {
        uint256 hotWei = LIVE_RELAYER.balance;
        bool hotUnderfunded = hotWei < HOT_WALLET_MIN_WEI;
        string memory drift = _liveVsTip(r);

        string memory head = string.concat(
            "{",
            '"product":"GasRescueSwap",',
            '"buildathon":"2026-09-17-day5",',
            '"chainId":',
            _u(r.swapStatus.chainId),
            ",",
            '"swap":"',
            _a(r.swapStatus.swap),
            '",',
            '"lens":"',
            _a(lens),
            '",',
            '"lensEphemeral":',
            _b(lensEphemeral),
            ",",
            '"owner":"',
            _a(r.swapStatus.owner),
            '",',
            '"user":"',
            _a(user),
            '",',
            '"nonce":',
            _u(nonce),
            ",",
            '"amountIn":"',
            _u(amountIn),
            '",',
            '"nativeTo":"',
            _a(nativeTo),
            '"'
        );
        string memory policy = string.concat(
            ',"paused":',
            _b(r.swapStatus.paused),
            ',"permit2Enabled":',
            _b(r.swapStatus.permit2Enabled),
            ',"permit2Off":',
            _b(r.readiness.permit2Off),
            ',"boundToLiveArb":',
            _b(r.swapStatus.boundToLiveArb),
            ',"ready":',
            _b(r.readiness.ready),
            ',"notPaused":',
            _b(r.readiness.notPaused),
            ',"relayerOk":',
            _b(r.readiness.relayerOk),
            ',"tokenAllowed":',
            _b(r.readiness.tokenAllowed),
            ',"tokenEip2612":',
            _b(r.readiness.tokenEip2612),
            ',"routerAllowed":',
            _b(r.readiness.routerAllowed),
            ',"nonceUnused":',
            _b(r.readiness.nonceUnused),
            ',"userFunded":',
            _b(r.readiness.userFunded),
            ',"amountInPositive":',
            _b(amountIn > 0),
            ',"probeOnly":',
            _b(amountIn == 0)
        );
        string memory ops = string.concat(
            ',"hotWallet":"',
            _a(LIVE_RELAYER),
            '","hotWalletWei":"',
            _u(hotWei),
            '","hotWalletMinWei":"',
            _u(HOT_WALLET_MIN_WEI),
            '","hotWalletUnderfunded":',
            _b(hotUnderfunded),
            ',"liveSubmitBlocked":',
            _b(hotUnderfunded),
            ',"recommendedJudgePath":"',
            recommendedJudgePath(hotUnderfunded),
            '","demoVideoExists":true',
            ',"judgeNote":"',
            judgeNote(hotUnderfunded),
            '","feePostureNote":"',
            FEE_POSTURE_NOTE,
            '"'
        );
        string memory receipt = string.concat(
            ',"hasCanonicalPermit2Getter":',
            _b(r.bytecode.hasCanonicalPermit2Getter),
            ',"hasRescueReceipt":',
            _b(r.bytecode.hasRescueReceipt),
            ',"setPermit2IsImmutable":',
            _b(r.bytecode.setPermit2IsImmutable),
            ',"tipMatchesLiveViews":',
            _b(r.bytecode.tipMatchesLiveViews),
            ',"rescueReceiptSupported":',
            _b(r.receipt.supported),
            ',"receiptTokenIn":"',
            _a(r.receipt.tokenIn),
            '","receiptAmountIn":"',
            _u(r.receipt.amountIn),
            '","receiptRelayer":"',
            _a(r.receipt.relayer),
            '"'
        );
        string memory paths = string.concat(
            ',"grttDemoPathHash":"',
            vm.toString(r.paths.grttPathHash),
            '","gmockDemoPathHash":"',
            vm.toString(r.paths.gmockPathHash),
            '","quotedPathIsWalletDryPlaceholder":',
            _b(r.paths.quotedIsWalletDryPlaceholder),
            ',"walletDryPathHash":"',
            vm.toString(ArbSepoliaDemoPath.WALLET_DRY_PATH_HASH),
            '","pathEncoding":"swapExact(address,uint256,address)",',
            '"liveVsTip":"',
            drift,
            '"}'
        );
        return string.concat(head, policy, ops, receipt, paths);
    }

    /// @notice Fixture/demo is the judge path while the hot wallet is underfunded.
    function recommendedJudgePath(
        bool hotUnderfunded
    ) public pure returns (string memory) {
        return hotUnderfunded ? JUDGE_PATH_FIXTURE : JUDGE_PATH_LIVE;
    }

    /// @notice ASCII-only note so solc / CI stay green (no Unicode dashes).
    function judgeNote(
        bool hotUnderfunded
    ) public pure returns (string memory) {
        return hotUnderfunded ? JUDGE_NOTE_UNDERFUNDED : JUDGE_NOTE_FUNDED;
    }

    /// @notice Live Arb `0x65e7…` (2026-09-17) lacks tip `rescueReceipt` and
    ///         `CANONICAL_PERMIT2()`. Judged v1 `rescueWithPermit` still OK.
    function _liveVsTip(
        GasRescueLens.HackQuestReport memory r
    ) internal pure returns (string memory) {
        bool receipt = r.bytecode.hasRescueReceipt;
        bool getter = r.bytecode.hasCanonicalPermit2Getter;
        if (receipt && getter) return "tip-has-rescueReceipt-and-canonicalPermit2";
        if (!receipt && !getter) {
            return "live-lacks-rescueReceipt-and-canonicalPermit2-do-not-claim-redeploy";
        }
        if (!receipt) return "live-lacks-rescueReceipt-do-not-claim-redeploy";
        return "live-lacks-canonicalPermit2-do-not-claim-redeploy";
    }

    function _b(
        bool v
    ) internal pure returns (string memory) {
        return v ? "true" : "false";
    }

    function _u(
        uint256 v
    ) internal pure returns (string memory) {
        return vm.toString(v);
    }

    function _a(
        address v
    ) internal pure returns (string memory) {
        return vm.toString(v);
    }
}
