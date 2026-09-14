// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArbSepoliaDemoPath
/// @notice Known-good Arb Sepolia (421614) mock-router path for the judged
///         `GasRescueSwap` demo: GRTT / gMOCK → WETH/native via `swapExact`.
///         Pure encoding — no deploy, no keys, no broadcast.
///
///         Live relayer (`relayer/server.mjs`) and this library share:
///           swapData  = abi.encodeWithSelector(swapExact, tokenIn, amountSwap, nativeTo)
///           pathHash  = keccak256(swapData)
///
///         Wallet fixtures still use the dry placeholder `0xbbb…`. That hash is
///         **not** a live path. Do not submit it on-chain.
///
///         `pathHash` binds `nativeTo` and `amountSwap`. There is no single
///         global hash — compute per quote. Dry-mock amounts below match the
///         checked-in Relayer fixtures (`1e18` in / `0.2e18` swap / `0.01e18` fee).
library ArbSepoliaDemoPath {
    uint256 internal constant CHAIN_ID = 421_614;

    address internal constant SWAP = 0x65e712222745A8FCCbF038A90Fa75caB0867993D;
    address internal constant OWNER = 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D;
    address internal constant RELAYER = 0x8240124dc78a27c80354Ca813Df12aa2888A9AF6;
    address internal constant WETH = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address internal constant GRTT = 0x5649fF51123D534044aA7E6cBc8762698Ffed713;
    address internal constant GMOCK = 0x30006e29a23c713070136F56db1BDf2A8B82B318;
    address internal constant ROUTER = 0x680410c7f64e06EB7e80dc7B5c149f7855e225A8;

    /// @dev Fixture-only user / nativeTo used by wallet dry mocks. Not a live EOA.
    address internal constant DRY_NATIVE_TO = 0x1111111111111111111111111111111111111111;

    uint256 internal constant DEMO_AMOUNT_IN = 1 ether;
    uint256 internal constant DEMO_AMOUNT_SWAP = 0.2 ether;
    uint256 internal constant DEMO_FEE_AMOUNT = 0.01 ether;
    uint256 internal constant DEMO_AMOUNT_REMAINDER = 0.79 ether;

    /// @dev `swapExact(address,uint256,address)` — live mock router + `MockSwapRouter`.
    bytes4 internal constant SWAP_EXACT_SELECTOR = bytes4(keccak256("swapExact(address,uint256,address)"));

    /// @dev Wallet / Relayer dry-mock placeholder. Fails `PathMismatch` on-chain.
    bytes32 internal constant WALLET_DRY_PATH_HASH = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

    error ZeroAddress();
    error UnsupportedToken();
    error InvalidAmount();

    function encodeSwapExact(
        address tokenIn,
        uint256 amountSwap,
        address nativeTo
    ) internal pure returns (bytes memory) {
        if (tokenIn == address(0) || nativeTo == address(0)) revert ZeroAddress();
        if (amountSwap == 0) revert InvalidAmount();
        return abi.encodeWithSelector(SWAP_EXACT_SELECTOR, tokenIn, amountSwap, nativeTo);
    }

    function pathHash(
        address tokenIn,
        uint256 amountSwap,
        address nativeTo
    ) internal pure returns (bytes32) {
        return keccak256(encodeSwapExact(tokenIn, amountSwap, nativeTo));
    }

    function matches(
        address tokenIn,
        uint256 amountSwap,
        address nativeTo,
        bytes32 quotedHash
    ) internal pure returns (bool) {
        return quotedHash != bytes32(0) && quotedHash != WALLET_DRY_PATH_HASH
            && quotedHash == pathHash(tokenIn, amountSwap, nativeTo);
    }

    function isSupportedDemoToken(
        address tokenIn
    ) internal pure returns (bool) {
        return tokenIn == GRTT || tokenIn == GMOCK;
    }

    /// @notice Dry-mock amounts + caller-chosen `nativeTo` for GRTT or gMOCK.
    function dryDemoPathHash(
        address tokenIn,
        address nativeTo
    ) internal pure returns (bytes32) {
        if (!isSupportedDemoToken(tokenIn)) revert UnsupportedToken();
        return pathHash(tokenIn, DEMO_AMOUNT_SWAP, nativeTo);
    }

    function dryGrttPathHash(
        address nativeTo
    ) internal pure returns (bytes32) {
        return pathHash(GRTT, DEMO_AMOUNT_SWAP, nativeTo);
    }

    function dryGmockPathHash(
        address nativeTo
    ) internal pure returns (bytes32) {
        return pathHash(GMOCK, DEMO_AMOUNT_SWAP, nativeTo);
    }

    /// @notice Fixture `0x1111…` recipient — useful for printed HackQuest evidence.
    function dryGrttFixturePathHash() internal pure returns (bytes32) {
        return pathHash(GRTT, DEMO_AMOUNT_SWAP, DRY_NATIVE_TO);
    }

    function dryGmockFixturePathHash() internal pure returns (bytes32) {
        return pathHash(GMOCK, DEMO_AMOUNT_SWAP, DRY_NATIVE_TO);
    }

    function isWalletDryPlaceholder(
        bytes32 quotedHash
    ) internal pure returns (bool) {
        return quotedHash == WALLET_DRY_PATH_HASH;
    }
}
