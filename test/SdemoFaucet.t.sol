// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {GatedDemoToken} from "../src/GatedDemoToken.sol";
import {SdemoFaucet} from "../src/SdemoFaucet.sol";

contract PlainErc20 is ERC20 {
    constructor() ERC20("Stranded Demo Token", "SDEMO") {}
}

contract SdemoFaucetTest is Test {
    uint256 internal constant ARB_SEPOLIA_CHAIN_ID = 421_614;
    bytes4 internal constant MINT_ADDRESS_UINT = 0x40c10f19;
    bytes4 internal constant OWNER = 0x8da5cb5b;

    address internal constant LIVE = 0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C;

    SdemoFaucet internal faucet;
    address internal tester = makeAddr("tester");

    function setUp() public {
        vm.chainId(ARB_SEPOLIA_CHAIN_ID);
        vm.warp(1_000_000);
        vm.etch(LIVE, type(PlainErc20).runtimeCode);
        faucet = new SdemoFaucet(LIVE);
        deal(LIVE, address(faucet), 4 ether);
    }

    function test_drip_paysExactlyTwo() public {
        vm.prank(tester);
        faucet.drip();
        assertEq(IERC20(LIVE).balanceOf(tester), 2 ether);
        assertEq(IERC20(LIVE).balanceOf(address(faucet)), 2 ether);
        assertEq(faucet.nextDrip(tester), block.timestamp + 1 days);
    }

    function test_secondDrip_revertsUntil24h() public {
        vm.startPrank(tester);
        faucet.drip();
        vm.expectRevert(abi.encodeWithSelector(SdemoFaucet.DripCooldown.selector, block.timestamp + 1 days));
        faucet.drip();
        vm.warp(block.timestamp + 1 days);
        faucet.drip();
        vm.stopPrank();
        assertEq(IERC20(LIVE).balanceOf(tester), 4 ether);
    }

    function test_empty_revertsFaucetEmpty() public {
        deal(LIVE, address(faucet), 1 ether);
        vm.prank(tester);
        vm.expectRevert(SdemoFaucet.FaucetEmpty.selector);
        faucet.drip();
    }

    function test_wrongToken_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(SdemoFaucet.WrongToken.selector, address(this)));
        new SdemoFaucet(address(this));
    }

    function test_wrongChain_reverts() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(SdemoFaucet.WrongChain.selector, 1));
        new SdemoFaucet(LIVE);
    }

    function test_faucet_hasNoMintAndNoOwner() public view {
        assertFalse(_codeHas(address(faucet), MINT_ADDRESS_UINT), "mint");
        assertFalse(_codeHas(address(faucet), OWNER), "owner");
    }

    function test_liveToken_stillHasNoMintInSource() public {
        GatedDemoToken sample = new GatedDemoToken();
        assertEq(sample.totalSupply(), 20 ether);
        assertFalse(_codeHas(address(sample), MINT_ADDRESS_UINT), "sdemo mint");
    }

    function _codeHas(address target, bytes4 selector) internal view returns (bool) {
        return _contains(target.code, abi.encodePacked(selector));
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || haystack.length < needle.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
