// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWETH {
    function deposit() external payable;
    function withdraw(
        uint256 wad
    ) external;
    function balanceOf(
        address account
    ) external view returns (uint256);
    function transfer(
        address to,
        uint256 value
    ) external returns (bool);
}
