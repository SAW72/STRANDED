// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GatedDemoToken} from "../../src/GatedDemoToken.sol";
import {LockedDemoSwapRouter} from "../../src/LockedDemoSwapRouter.sol";

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
    address internal constant DEMO_HOLDER = 0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37;

    bytes4 internal constant MINT_SELECTOR = 0x40c10f19;
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
        assertTrue(swap.allowedTokens(LIVE_GRTT) && swap.eip2612Tokens(LIVE_GRTT));
        assertTrue(swap.allowedTokens(LIVE_GMOCK) && swap.eip2612Tokens(LIVE_GMOCK));
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
        GatedDemoToken token = new GatedDemoToken(LIVE_OWNER, DEMO_HOLDER, 2 ether);
        assertEq(token.owner(), LIVE_OWNER);
        assertEq(token.balanceOf(DEMO_HOLDER), 2 ether);

        vm.prank(LIVE_OWNER);
        swap.setEip2612Token(address(token), true);
        assertTrue(swap.allowedTokens(address(token)));
        assertTrue(swap.eip2612Tokens(address(token)));
        // The open tokens are still allowlisted until the script's later txs.
        assertTrue(swap.allowedTokens(LIVE_GRTT));
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
