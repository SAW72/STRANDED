// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {GasRescueSwap} from "../../src/GasRescueSwap.sol";
import {IGasRescueSwap} from "../../src/interfaces/IGasRescueSwap.sol";

/// @notice Fork proof of docs/BASE-SEPOLIA-DELIST-STEPS.md.
///         Sends the doc's exact calldata. No key, no signature, no broadcast.
///         Uses `BASE_SEPOLIA_RPC_URL` when set. Otherwise uses the fork already
///         selected by `forge test --fork-url`, or the public Base Sepolia RPC.
contract BaseSepoliaDelistStepsTest is Test {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant FORK_BLOCK = 48_077_171;
    string internal constant PUBLIC_RPC = "https://sepolia.base.org";
    string internal constant DOC_PATH = "docs/BASE-SEPOLIA-DELIST-STEPS.md";

    address internal constant LIVE_SWAP = 0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688;
    address internal constant LIVE_OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    /// @dev EIP-7702 delegate read from the owner's code at `FORK_BLOCK`.
    address internal constant OWNER_DELEGATE = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address internal constant LIVE_RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant GMOCK = 0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166;
    address internal constant SWAP_ROUTER_02 = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    /// @dev Second live router, allowlisted at block 46,359,186 and still true at `FORK_BLOCK`.
    address internal constant OTHER_ROUTER = 0x48aB70F0eeb92082100EFA49189654663F48f285;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant STRANGER = 0x1111111111111111111111111111111111111111;
    /// @dev Not allowlisted on the live fork. The test allowlists it so a second token can stay true.
    address internal constant WITNESS_TOKEN = address(0xBEEF);

    bytes32 internal constant TOPIC_TOKEN_ALLOWED = 0x9a8e30a8658b96ab3f034ce4bac6806278b4aee5880ccdd1ac35e4ed5bb31d23;
    bytes32 internal constant TOPIC_EIP2612_ALLOWED =
        0x647301f4aeecbf064b3f4c62752f716c9b3f70ce0585c613d95bbe957576fb5c;
    bytes32 internal constant TOPIC_ROUTER_ALLOWED = 0x5ae067a93e2af6193017728cb7e9ef5af1d750a5beb7b16a05b54d56f6f355e3;

    /// @dev `cast calldata "setTokenAllowed(address,bool)" gMOCK false`
    bytes internal constant DELIST_GMOCK_CALLDATA =
        hex"15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000000";
    /// @dev `cast calldata "setRouterAllowed(address,bool)" SwapRouter02 false`
    bytes internal constant DELIST_ROUTER_CALLDATA =
        hex"6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000000";
    /// @dev `cast calldata "setTokenAllowed(address,bool)" gMOCK true`
    bytes internal constant ROLLBACK_TOKEN_CALLDATA =
        hex"15f69012000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000001";
    /// @dev `cast calldata "setEip2612Token(address,bool)" gMOCK true`
    bytes internal constant ROLLBACK_EIP2612_CALLDATA =
        hex"ae6dda45000000000000000000000000e36c35cbf0373d77d00732f7b92db4fb8fd371660000000000000000000000000000000000000000000000000000000000000001";
    /// @dev `cast calldata "setRouterAllowed(address,bool)" SwapRouter02 true`
    bytes internal constant ROLLBACK_ROUTER_CALLDATA =
        hex"6cc88edb00000000000000000000000094cc0aac535ccdb3c01d6787d6413c739ae12bc40000000000000000000000000000000000000000000000000000000000000001";

    GasRescueSwap internal live;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0 && block.chainid == BASE_SEPOLIA_CHAIN_ID) {
            if (block.number != FORK_BLOCK) vm.rollFork(FORK_BLOCK);
        } else {
            if (bytes(rpc).length == 0) rpc = PUBLIC_RPC;
            vm.createSelectFork(rpc, FORK_BLOCK);
        }
        live = GasRescueSwap(payable(LIVE_SWAP));
    }

    function test_docCalldataMatchesConstants() public view {
        string memory doc = vm.readFile(DOC_PATH);
        assertEq(_fromHex(_firstCalldataAfter(doc, "## Step 1")), DELIST_GMOCK_CALLDATA);
        assertEq(_fromHex(_firstCalldataAfter(doc, "## Step 2")), DELIST_ROUTER_CALLDATA);
        assertEq(_fromHex(_firstCalldataAfter(doc, "Rollback setTokenAllowed calldata")), ROLLBACK_TOKEN_CALLDATA);
        assertEq(_fromHex(_firstCalldataAfter(doc, "Rollback setEip2612Token calldata")), ROLLBACK_EIP2612_CALLDATA);
        assertEq(_fromHex(_firstCalldataAfter(doc, "Rollback setRouterAllowed calldata")), ROLLBACK_ROUTER_CALLDATA);
    }

    function test_nonOwner_exactCalldataReverts() public {
        _assertLiveBefore();

        vm.prank(STRANGER);
        (bool tokenOk, bytes memory tokenRet) = LIVE_SWAP.call(DELIST_GMOCK_CALLDATA);
        assertFalse(tokenOk);
        assertEq(tokenRet, abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));

        vm.prank(STRANGER);
        (bool routerOk, bytes memory routerRet) = LIVE_SWAP.call(DELIST_ROUTER_CALLDATA);
        assertFalse(routerOk);
        assertEq(routerRet, abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));

        assertTrue(live.allowedTokens(GMOCK));
        assertTrue(live.eip2612Tokens(GMOCK));
        assertTrue(live.allowedRouters(SWAP_ROUTER_02));
        assertTrue(live.allowedRouters(OTHER_ROUTER));
    }

    /// @dev Applies the doc bytes with `LIVE_SWAP.call`. gMOCK is the only live allowed
    ///      token, so a witness token is allowlisted first and must stay true.
    function test_ownerCalldata_delistsTargets_andRescueReverts() public {
        _assertLiveBefore();

        vm.prank(LIVE_OWNER);
        live.setTokenAllowed(WITNESS_TOKEN, true);
        assertTrue(live.allowedTokens(WITNESS_TOKEN));
        assertTrue(live.allowedRouters(OTHER_ROUTER));
        assertFalse(live.allowedTokens(WETH));
        assertFalse(live.allowedRouters(WETH));

        vm.recordLogs();
        vm.prank(LIVE_OWNER);
        (bool tokenOk,) = LIVE_SWAP.call(DELIST_GMOCK_CALLDATA);
        assertTrue(tokenOk);
        _assertTokenDelistLogs(vm.getRecordedLogs());

        console2.log("after step 1 allowedTokens(gMOCK)", live.allowedTokens(GMOCK));
        console2.log("after step 1 eip2612Tokens(gMOCK)", live.eip2612Tokens(GMOCK));
        console2.log("after step 1 allowedTokens(witness)", live.allowedTokens(WITNESS_TOKEN));
        console2.log("after step 1 allowedRouters(other)", live.allowedRouters(OTHER_ROUTER));

        assertFalse(live.allowedTokens(GMOCK));
        assertFalse(live.eip2612Tokens(GMOCK));
        assertTrue(live.allowedTokens(WITNESS_TOKEN));
        assertTrue(live.allowedRouters(SWAP_ROUTER_02));
        assertTrue(live.allowedRouters(OTHER_ROUTER));
        assertFalse(live.allowedTokens(WETH));
        assertEq(IERC20(GMOCK).totalSupply(), 10 ** 39 + 10 ** 19 + 1000);

        _expectRescueRevert(GMOCK, SWAP_ROUTER_02, GasRescueSwap.TokenNotAllowed.selector);

        vm.recordLogs();
        vm.prank(LIVE_OWNER);
        (bool routerOk,) = LIVE_SWAP.call(DELIST_ROUTER_CALLDATA);
        assertTrue(routerOk);
        _assertRouterDelistLogs(vm.getRecordedLogs());

        console2.log("after step 2 allowedRouters(SwapRouter02)", live.allowedRouters(SWAP_ROUTER_02));
        console2.log("after step 2 allowedRouters(other)", live.allowedRouters(OTHER_ROUTER));
        console2.log("after step 2 SwapRouter02 balance", SWAP_ROUTER_02.balance);

        assertFalse(live.allowedRouters(SWAP_ROUTER_02));
        assertTrue(live.allowedRouters(OTHER_ROUTER));
        assertTrue(live.allowedTokens(WITNESS_TOKEN));
        assertFalse(live.allowedTokens(GMOCK));
        assertFalse(live.allowedRouters(WETH));
        assertEq(SWAP_ROUTER_02.balance, 0);

        _expectRescueRevert(WITNESS_TOKEN, SWAP_ROUTER_02, GasRescueSwap.RouterNotAllowed.selector);
        _expectRescueRevert(WITNESS_TOKEN, OTHER_ROUTER, GasRescueSwap.PathMismatch.selector);
    }

    function _assertLiveBefore() internal view {
        assertEq(block.chainid, BASE_SEPOLIA_CHAIN_ID);
        assertEq(block.number, FORK_BLOCK);
        assertEq(live.owner(), LIVE_OWNER);
        assertEq(LIVE_OWNER.code, abi.encodePacked(hex"ef0100", OWNER_DELEGATE));
        assertTrue(live.relayers(LIVE_RELAYER));
        assertTrue(live.allowedTokens(GMOCK));
        assertTrue(live.eip2612Tokens(GMOCK));
        assertTrue(live.allowedRouters(SWAP_ROUTER_02));
        assertTrue(live.allowedRouters(OTHER_ROUTER));
        assertEq(SWAP_ROUTER_02.balance, 0);
        assertEq(IERC20(GMOCK).totalSupply(), 10 ** 39 + 10 ** 19 + 1000);
    }

    function _expectRescueRevert(
        address token,
        address router,
        bytes4 selector
    ) internal {
        IGasRescueSwap.Order memory order = IGasRescueSwap.Order({
            user: STRANGER,
            tokenIn: token,
            amountIn: 1,
            feeAmount: 0,
            feeTo: LIVE_OWNER,
            amountSwap: 1,
            minAmountOut: 1,
            to: STRANGER,
            nativeTo: STRANGER,
            router: router,
            pathHash: bytes32(0),
            chainId: BASE_SEPOLIA_CHAIN_ID,
            deadline: block.timestamp + 1 hours,
            nonce: 1
        });
        vm.expectRevert(selector);
        vm.prank(LIVE_RELAYER);
        live.rescueWithPermit(order, "", 0, bytes32(0), bytes32(0), "");
    }

    function _assertTokenDelistLogs(
        Vm.Log[] memory logs
    ) internal pure {
        assertEq(logs.length, 2);
        assertEq(logs[0].emitter, LIVE_SWAP);
        assertEq(logs[0].topics.length, 2);
        assertEq(logs[0].topics[0], TOPIC_EIP2612_ALLOWED);
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(GMOCK))));
        assertEq(logs[0].data, abi.encode(false));
        assertEq(logs[1].emitter, LIVE_SWAP);
        assertEq(logs[1].topics.length, 2);
        assertEq(logs[1].topics[0], TOPIC_TOKEN_ALLOWED);
        assertEq(logs[1].topics[1], bytes32(uint256(uint160(GMOCK))));
        assertEq(logs[1].data, abi.encode(false));
    }

    function _assertRouterDelistLogs(
        Vm.Log[] memory logs
    ) internal pure {
        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, LIVE_SWAP);
        assertEq(logs[0].topics.length, 2);
        assertEq(logs[0].topics[0], TOPIC_ROUTER_ALLOWED);
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(SWAP_ROUTER_02))));
        assertEq(logs[0].data, abi.encode(false));
    }

    function _firstCalldataAfter(
        string memory doc,
        string memory marker
    ) internal pure returns (string memory) {
        bytes memory hay = bytes(doc);
        uint256 from = _indexOf(hay, bytes(marker), 0);
        require(from != type(uint256).max, marker);
        for (uint256 i = from; i + 137 < hay.length; i++) {
            if (hay[i] != bytes1("0") || hay[i + 1] != bytes1("x")) continue;
            uint256 n = 0;
            while (i + 2 + n < hay.length && _isHex(hay[i + 2 + n])) n++;
            if (n != 136) continue;
            bytes memory out = new bytes(138);
            for (uint256 j = 0; j < 138; j++) {
                out[j] = hay[i + j];
            }
            return string(out);
        }
        revert(string.concat("missing calldata after ", marker));
    }

    function _fromHex(
        string memory src
    ) internal pure returns (bytes memory) {
        bytes memory s = bytes(src);
        require(s.length >= 2 && s[0] == "0" && s[1] == "x", "hex");
        require((s.length - 2) % 2 == 0, "odd hex");
        bytes memory out = new bytes((s.length - 2) / 2);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = bytes1(_nibble(s[2 + i * 2]) * 16 + _nibble(s[2 + i * 2 + 1]));
        }
        return out;
    }

    function _indexOf(
        bytes memory hay,
        bytes memory needle,
        uint256 from
    ) internal pure returns (uint256) {
        if (needle.length == 0 || hay.length < needle.length || from > hay.length - needle.length) {
            return type(uint256).max;
        }
        for (uint256 i = from; i <= hay.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return i;
        }
        return type(uint256).max;
    }

    function _isHex(
        bytes1 c
    ) internal pure returns (bool) {
        return (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
    }

    function _nibble(
        bytes1 c
    ) internal pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 48 && v <= 57) return v - 48;
        if (v >= 97 && v <= 102) return v - 87;
        if (v >= 65 && v <= 70) return v - 55;
        revert("nibble");
    }
}
