// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LockedDemoSwapRouter
/// @notice Testnet demo router for `GasRescueSwap`. Replaces the open
///         `MockSwapRouter` deployment, which anyone could reconfigure and
///         then empty with `swapExact` without delivering tokens.
///
///         Swaps are accepted only from the STRANDED rescue contract. The
///         caller must actually deliver `amountIn` of `tokenIn`. Native ETH
///         is paid back to `msg.sender` (the rescue), which forwards it to
///         the signed `nativeTo`. The third argument is bound into `pathHash`
///         and is not a payout address.
///
///         Payout is `amountIn * rateNumerator / rateDenominator`, then
///         capped by `maxPayout`. Settings and inventory withdrawal are
///         owner-only. `renounceOwnership` is disabled.
contract LockedDemoSwapRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Canonical demo slice (`amountIn / 5` when `amountIn` is 1 token).
    ///      `payAmount()` reports the quote for this size so a Relayer that
    ///      still reads the old getter stays aligned with the 0.2-token path.
    uint256 public constant DEMO_REFERENCE_IN = 0.2 ether;

    address public rescue;
    uint256 public rateNumerator;
    uint256 public rateDenominator;
    uint256 public maxPayout;

    event RescueUpdated(address indexed rescue);
    event RateUpdated(uint256 rateNumerator, uint256 rateDenominator);
    event MaxPayoutUpdated(uint256 maxPayout);
    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 ethOut);
    event Funded(address indexed from, uint256 amount);
    event EthWithdrawn(address indexed to, uint256 amount);
    event TokensSwept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error NotRescue();
    error NotEnoughTokens();
    error ZeroAmount();
    error ZeroPayout();
    error InsufficientEth();
    error EthTransferFailed();
    error InvalidRate();
    error OwnershipCannotBeRenounced();

    constructor(
        address initialOwner,
        address rescue_,
        uint256 rateNumerator_,
        uint256 rateDenominator_,
        uint256 maxPayout_
    ) payable Ownable(initialOwner) {
        if (initialOwner == address(0) || rescue_ == address(0)) revert ZeroAddress();
        _setRate(rateNumerator_, rateDenominator_);
        rescue = rescue_;
        maxPayout = maxPayout_;
        emit RescueUpdated(rescue_);
        emit MaxPayoutUpdated(maxPayout_);
        if (msg.value > 0) emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function setRescue(
        address rescue_
    ) external onlyOwner {
        if (rescue_ == address(0)) revert ZeroAddress();
        rescue = rescue_;
        emit RescueUpdated(rescue_);
    }

    function setRate(
        uint256 rateNumerator_,
        uint256 rateDenominator_
    ) external onlyOwner {
        _setRate(rateNumerator_, rateDenominator_);
    }

    function setMaxPayout(
        uint256 maxPayout_
    ) external onlyOwner {
        maxPayout = maxPayout_;
        emit MaxPayoutUpdated(maxPayout_);
    }

    /// @notice ETH this router would pay for `amountIn` tokens, after the cap.
    function quote(
        uint256 amountIn
    ) public view returns (uint256 ethOut) {
        if (amountIn == 0) return 0;
        ethOut = (amountIn * rateNumerator) / rateDenominator;
        if (ethOut > maxPayout) ethOut = maxPayout;
    }

    /// @notice Demo-slice payout. Not a setter and not the contract's balance.
    function payAmount() external view returns (uint256) {
        return quote(DEMO_REFERENCE_IN);
    }

    /// @notice Pull `amountIn` of `tokenIn` from the rescue and pay native ETH back to it.
    function swapExact(
        address tokenIn,
        uint256 amountIn,
        address nativeTo
    ) external nonReentrant {
        if (msg.sender != rescue) revert NotRescue();
        if (tokenIn == address(0) || nativeTo == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();

        uint256 ethOut = quote(amountIn);
        if (ethOut == 0) revert ZeroPayout();
        if (address(this).balance < ethOut) revert InsufficientEth();

        uint256 beforeBal = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (IERC20(tokenIn).balanceOf(address(this)) - beforeBal != amountIn) revert NotEnoughTokens();

        (bool sent,) = payable(msg.sender).call{value: ethOut}("");
        if (!sent) revert EthTransferFailed();
        emit Swapped(tokenIn, amountIn, ethOut);
    }

    function withdrawEth(
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > address(this).balance) revert InsufficientEth();
        (bool sent,) = payable(to).call{value: amount}("");
        if (!sent) revert EthTransferFailed();
        emit EthWithdrawn(to, amount);
    }

    function sweepToken(
        address token,
        address to
    ) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, bal);
        emit TokensSwept(token, to, bal);
    }

    function _setRate(
        uint256 rateNumerator_,
        uint256 rateDenominator_
    ) internal {
        if (rateDenominator_ == 0 || rateNumerator_ == 0) revert InvalidRate();
        rateNumerator = rateNumerator_;
        rateDenominator = rateDenominator_;
        emit RateUpdated(rateNumerator_, rateDenominator_);
    }
}
