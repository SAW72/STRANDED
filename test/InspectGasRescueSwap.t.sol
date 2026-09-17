// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {InspectGasRescueSwap} from "../script/InspectGasRescueSwap.s.sol";
import {SignOrder} from "../script/SignOrder.s.sol";

/// @notice Day-5 judge-path notes on the read-only inspector, plus a compile
///         gate for `SignOrder` (`console2.log(string, bytes32)` used to break
///         full-tree `forge build`).
contract InspectGasRescueSwapTest is Test {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;

    InspectGasRescueSwap internal inspect;

    function setUp() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        inspect = new InspectGasRescueSwap();
    }

    function test_judgeNotes_underfunded_recommendsFixtureDemo() public {
        vm.deal(LIVE_RELAYER, 0.015 ether);
        string memory notes = inspect.judgeNotes();
        assertTrue(_contains(notes, '"hotWalletUnderfunded":true'));
        assertTrue(_contains(notes, '"liveSubmitBlocked":true'));
        assertTrue(_contains(notes, '"recommendedJudgePath":"fixture-demo-no-top-up"'));
        assertTrue(_contains(notes, '"demoVideoExists":true'));
        assertTrue(
            _contains(
                notes,
                '"judgeNote":"hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake"'
            )
        );
        assertEq(inspect.recommendedJudgePath(true), "fixture-demo-no-top-up");
        assertEq(
            inspect.judgeNote(true),
            "hot-wallet-underfunded-Spencer-blocked; recommended=fixture-demo-without-top-up; demo-video-exists-do-not-remake"
        );
    }

    function test_judgeNotes_funded_doesNotBlockSubmit() public {
        vm.deal(LIVE_RELAYER, 0.10 ether);
        string memory notes = inspect.judgeNotes();
        assertTrue(_contains(notes, '"hotWalletUnderfunded":false'));
        assertTrue(_contains(notes, '"liveSubmitBlocked":false'));
        assertTrue(_contains(notes, '"recommendedJudgePath":"live-submit-ok-if-user-funded"'));
        assertTrue(_contains(notes, '"hotWalletWei":"100000000000000000"'));
        assertTrue(
            _contains(
                notes,
                '"judgeNote":"hot-wallet-meets-0.10-ETH-floor; live-submit-still-Spencer-keys-only; fixture-demo-remains-valid"'
            )
        );
    }

    function test_signOrder_compiles_pathHashLoggedAsString() public {
        SignOrder script = new SignOrder();
        assertTrue(address(script) != address(0));
    }

    function _contains(
        string memory haystack,
        string memory needle
    ) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
