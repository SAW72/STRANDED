# GasRescue Wallet UX (Base Sepolia + Arb Sepolia)

Vite + React + wagmi/viem frontend for a user who holds an allowlisted EIP-2612 ERC-20 on **Base Sepolia** (`84532`) or **Arb Sepolia** (`421614`) but has no native gas.

The product is **swap-for-gas + move-out**, not a fee-skim. A slice of the stranded token is swapped for native gas; the remainder is sent to `to`; native gas is delivered to `nativeTo` (not `safeRecipient`).

Flow:

1. Pick **Base Sepolia** or **Arb Sepolia**. Mainnet is not available.
2. Connect an injected wallet (MetaMask / Rabby / Coinbase). Wrong networks are prompted to switch to the selected testnet.
3. Read the stranded token balance when the wallet is on that testnet. The UI never invents a live balance.
4. Bind a quote:
   - **Live:** `GET {VITE_RELAYER_URL}/quotes` when `VITE_RELAYER_URL` is set.
   - **Sample:** if the Relayer URL is unset or the live quote fails, **Use sample quote** loads the checked-in fixture. It is labeled **Sample · not live**.
5. Review **every** EIP-712 Order field plus the display-before-confirm set. Tap **Confirm details**. Only then does the app prompt the wallet. **Cancel** steps back without signing.
6. One signature path: EIP-712 `Order` (domain `StewardGasRescue` / `1`), then EIP-2612 `permit`.

## Canonical Order (EIP-712)

```
Order(address user,address tokenIn,uint256 amountIn,uint256 feeAmount,address feeTo,uint256 amountSwap,uint256 minAmountOut,address to,address nativeTo,address router,bytes32 pathHash,uint256 chainId,uint256 deadline,uint256 nonce)
```

Domain: `name = StewardGasRescue`, `version = 1`, `chainId` = selected testnet, `verifyingContract` = configured rescue address.

The review screen shows human labels (Amount to rescue, Amount swapped for gas, Remainder goes to, Rescue fee, Fee goes to, Native gas to, Min native out, …) and shortened addresses with Copy.

## Configure

```bash
cd wallet
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_RELAYER_URL` | for live quotes | Public Relayer origin. The app calls `{VITE_RELAYER_URL}/quotes`. |
| `VITE_GAS_RESCUE_ADDRESS` | to sign | Deployed rescue contract on Base Sepolia (also used as Arb fallback). |
| `VITE_TOKEN_ADDRESS` | to read/sign | Allowlisted EIP-2612 ERC-20 on Base Sepolia (also used as Arb fallback). |
| `VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA` | no | Arb Sepolia rescue override. |
| `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` | no | Arb Sepolia token override. |
| `VITE_BASE_SEPOLIA_RPC_URL` | no | Defaults to `https://sepolia.base.org` |
| `VITE_ARB_SEPOLIA_RPC_URL` | no | Defaults to `https://sepolia-rollup.arbitrum.io/rpc` |

`VITE_RELAYER_URL` is a public origin, not a secret. Aliases `RELAYER_BASE_URL` and `VITE_RELAYER_BASE_URL` still work. **Do not** put private keys, Relayer keys, or mainnet RPC credentials in `.env`.

If `VITE_RELAYER_URL` is unset, the wallet starts in **sample quote** mode so you can walk the review screen. Sample numbers are a fixture, not a live price.

## Run

```bash
cd wallet
npm install
npm test
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). Connect a wallet on Base Sepolia or Arb Sepolia. For a live quote the Relayer must allow the wallet origin for CORS.

Quote request:

```
GET {VITE_RELAYER_URL}/quotes?chainId=84532|421614&token=<token>&amount=<raw>&user=<address>
```

Required JSON fields (string or number integers are accepted). Field names must match:

```json
{
  "quoteId": "…",
  "chainId": 84532,
  "tokenIn": "0x…",
  "tokenSymbol": "MOCK",
  "tokenDecimals": 18,
  "user": "0x…",
  "amountIn": "100000000000000000000",
  "amountSwap": "10000000000000000000",
  "feeAmount": "1000000000000000000",
  "feeTo": "0x…",
  "to": "0x…",
  "nativeTo": "0x…",
  "minAmountOut": "2500000000000000",
  "amountRemainder": "89000000000000000000",
  "router": "0x…",
  "pathHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "deadline": "1893456000",
  "nonce": "1"
}
```

`amountSwap + feeAmount + amountRemainder` must equal `amountIn`. `safeRecipient` is not accepted. The old fee-skim shape (`amount` / `token` only) fails closed.

`displayBeforeConfirm`: `amountIn`, `amountSwap`, `amountRemainder`, `feeAmount`, `feeTo`, `to`, `nativeTo`, `minAmountOut`, `tokenSymbol`, `tokenDecimals`, `chainId`.

The wallet signs; it does not submit the rescue transaction. Hand the Order + permit to your Relayer.

## Tests

```bash
cd wallet
npm test
```

Covers quote parsing (fail closed, including fee-skim bodies), fixture shape, Confirm-details process gate, Order field sourcing, domain name, and end-user copy.

## Out of scope

Mainnet, Solidity / contracts, inventing live balances or live quotes, broadcasting the rescue.
