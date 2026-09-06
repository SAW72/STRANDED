/** End-user copy. Keep engineer terms (GET /quotes, clamp, raw field names) out of the UI. */

export const REVIEW_TITLE = "Review rescue";

export const REVIEW_SUBTITLE =
  "Check every line before you continue. A slice of your tokens is swapped for native gas; the rest is moved out. Your wallet will not ask you to sign until you confirm.";

export const REVIEW_TRUST_LINE =
  "Nothing moves until you confirm these details and approve the signatures in your wallet.";

export const AMOUNT_LABEL = "Amount to rescue";
export const AMOUNT_HELPER = "How many of your stranded tokens this rescue will use.";

export const AMOUNT_SWAP_LABEL = "Amount swapped for gas";
export const AMOUNT_SWAP_HELPER =
  "The slice sold for native gas so the rescue can pay its own way on this testnet.";

export const REMAINDER_LABEL = "Remainder";
export const REMAINDER_HELPER = "Tokens left after the swap slice and the rescue fee.";

export const REMAINDER_TO_LABEL = "Remainder destination";
export const REMAINDER_TO_HELPER = "Destination for leftover tokens after the rescue.";

export const FEE_LABEL = "Rescue fee";
export const FEE_HELPER = "Paid in your stranded tokens to the operator, as shown on this quote.";

export const FEE_TO_LABEL = "Fee destination";
export const FEE_TO_HELPER = "Destination that receives the rescue fee.";

export const NATIVE_TO_LABEL = "Native gas destination";
export const NATIVE_TO_HELPER = "Destination for native gas from the swap.";

export const MIN_OUT_LABEL = "Min native out";
export const MIN_OUT_HELPER =
  "Lowest native gas this rescue will accept. The swap is cancelled if the market pays less.";

export const TOKEN_LABEL = "Token";
export const TOKEN_HELPER = "The stranded token this quote is for.";

export const NETWORK_LABEL = "Network";
export const NETWORK_HELPER = "Testnet only. Mainnet is not available.";

export const USER_LABEL = "Your wallet";
export const USER_HELPER = "The address that signs this rescue.";

export const TOKEN_IN_LABEL = "Token contract";
export const TOKEN_IN_HELPER = "The token contract this Order pulls from.";

export const ROUTER_LABEL = "Swap router";
export const ROUTER_HELPER = "The router that sells the gas slice.";

export const PATH_HASH_LABEL = "Swap path";
export const PATH_HASH_HELPER = "A fingerprint of the swap route bound into the Order.";

export const DEADLINE_LABEL = "Quote expires";
export const DEADLINE_HELPER = "After this time the Order can no longer be submitted.";

export const NONCE_LABEL = "Order nonce";
export const NONCE_HELPER = "Stops this rescue from being replayed.";

export const QUOTE_LOADING = "Getting your rescue quote…";
export const QUOTE_ERROR = "Couldn’t load rescue details. Try again.";

export const QUOTE_IDLE_CONNECT =
  "Connect on Base Sepolia or Arb Sepolia and enter an amount to see the rescue plan.";
export const QUOTE_IDLE_AMOUNT = "Enter an amount to see the rescue plan.";
export const QUOTE_IDLE_UNAVAILABLE = "Rescue details aren’t available yet.";

export const FIXTURE_BANNER =
  "Sample quote — not live. These numbers are a fixture for review, not a Relayer price.";
export const FIXTURE_HELP =
  "No Relayer URL is set, so this is a sample rescue for review. It is not a live price.";
export const USE_SAMPLE_LABEL = "Use sample quote";
export const CLEAR_SAMPLE_LABEL = "Clear sample";
export const SAMPLE_BADGE = "Sample · not live";

export const CONFIRM_HINT = "Confirm these details before any wallet signature.";
export const CONFIRMED_HINT = "Details confirmed. You can sign next.";
export const SIGN_LOCKED = "Confirm the details above before you can sign.";
export const SIGN_LOCKED_MISSING = "A complete rescue quote is required before you can sign.";
export const SUBMITTING_RESCUE = "Sending the signed rescue to the Relayer…";
export const SUBMITTED_RESCUE = "Relayer has the signed rescue.";
export const SUBMIT_RESCUE_ERROR = "Couldn’t send the signed rescue to the Relayer.";

export const RECEIPT_TITLE = "Rescue complete";
export const RECEIPT_SUBTITLE =
  "The rescue is on-chain. Tokens moved; native gas was delivered.";
export const TX_HASH_LABEL = "Transaction";
export const TX_HASH_HELPER = "The on-chain receipt for this rescue.";
export const GAS_RECEIVED_LABEL = "Gas received";
export const GAS_RECEIVED_HELPER = "Native gas this rescue delivered from the swap.";
export const ANOTHER_RESCUE_LABEL = "Start another rescue";

export const CONNECT_LABEL = "Connect wallet";
export const CONNECTING_LABEL = "Connecting…";
export const PICK_WALLET_TITLE = "Choose a wallet";
export const PICK_WALLET_HELP =
  "Pick the wallet you want to use. Every wallet installed in this browser is listed.";
export const BROWSER_WALLET_LABEL = "Browser wallet";
export const NO_WALLET_FOUND =
  "No browser wallet found. Install MetaMask, Phantom, or another wallet, then refresh.";
export const CONNECT_HINT = "MetaMask, Phantom, or any other wallet installed in this browser.";
export const METAMASK_PENDING_HINT =
  "MetaMask is waiting in the Chrome toolbar. Click the fox icon, approve or reject, then pick MetaMask again.";

export const CANCEL_LABEL = "Cancel";
export const TRY_AGAIN_LABEL = "Try again";
export const COPY_LABEL = "Copy";
export const COPIED_LABEL = "Copied";

export const CHAIN_SWITCH_HINT = "Rescue on this testnet. Switch your wallet to match.";
export const WRONG_NETWORK = "Wrong network";
export const SWITCH_TO_PREFIX = "Switch to";
