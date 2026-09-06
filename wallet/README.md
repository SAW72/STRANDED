# Stranded Wallet UX (Base Sepolia + Arb Sepolia)

Vite + React + wagmi/viem frontend for a user who holds an allowlisted EIP-2612 ERC-20 on **Base Sepolia** (`84532`) or **Arb Sepolia** (`421614`) but has no native gas.

The product is **swap-for-gas + move-out**, not a fee-skim. A slice of the stranded token is swapped for native gas; the remainder is sent to `to`; native gas is delivered to `nativeTo` (not `safeRecipient`).

Flow:

1. Pick **Base Sepolia** or **Arb Sepolia**. Mainnet is not available.
2. Connect an injected wallet (MetaMask / Rabby / Coinbase). Wrong networks are prompted to switch to the selected testnet.
3. Read the stranded token balance when the wallet is on that testnet. The UI never invents a live balance.
4. Bind a quote:
   - **Live:** `POST {relayer}/v1/quotes` when the chain’s Relayer URL is set (`VITE_RELAYER_URL` on Base, `VITE_RELAYER_URL_ARB_SEPOLIA` on Arb).
   - **Fixture:** only when that chain’s Relayer URL is unset. Loads Relayer dry mocks (`mock-quotes-response-base.json` / `mock-quotes-response-arb.json`). Labeled **Sample · not live**.
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
| `VITE_RELAYER_URL` | for live Base quotes | Base Relayer origin. Leave unset for sample quotes on Base. |
| `VITE_RELAYER_URL_ARB_SEPOLIA` | for live Arb quotes | Arb Relayer origin (local `http://127.0.0.1:8788`). Leave unset for sample quotes on Arb. **Do not** reuse the Base Relayer URL. |
| `VITE_GAS_RESCUE_ADDRESS` | to sign on Base | Base Sepolia GasRescueSwap `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688`. |
| `VITE_TOKEN_ADDRESS` | to read/sign on Base | Base Sepolia MockERC20Permit `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166`. |
| `VITE_GAS_RESCUE_ADDRESS_ARB_SEPOLIA` | to sign on Arb | Arb Sepolia GasRescueSwap `0x65e712222745A8FCCbF038A90Fa75caB0867993D`. |
| `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` | to read/sign on Arb | Arb Sepolia MockERC20Permit **GRTT** `0x5649fF51123D534044aA7E6cBc8762698Ffed713`. |
| `VITE_BASE_SEPOLIA_RPC_URL` | no | Defaults to `https://sepolia.base.org` |
| `VITE_ARB_SEPOLIA_RPC_URL` | no | Defaults to `https://sepolia-rollup.arbitrum.io/rpc` |

Relayer URLs are public origins, not secrets. Aliases `RELAYER_BASE_URL` and `VITE_RELAYER_BASE_URL` still work for Base. **Do not** put private keys, Relayer keys, or mainnet RPC credentials in `.env`.

If a chain’s Relayer URL is unset, the wallet uses the Relayer dry-mock fixture for that chain (not a live price). Confirm details still gates the fixture path. If the URL is set, a failed POST does **not** invent a quote. Arb never falls back to the Base Relayer origin.

## Run

```bash
cd wallet
npm install
npm test
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). Connect a wallet on Base Sepolia or Arb Sepolia. For a live quote the Relayer must allow the wallet origin for CORS.

## Deploy (Render + domain)

See [DEPLOY.md](../DEPLOY.md). The wallet is a static build (`wallet/dist`). Relayer CORS must include the HTTPS origin of the deployed site.

Quote request:

```
POST {VITE_RELAYER_URL or VITE_RELAYER_URL_ARB_SEPOLIA}/v1/quotes
Content-Type: application/json
```

```json
{
  "chainId": 84532,
  "user": "0x1111111111111111111111111111111111111111",
  "tokenIn": "0x2222222222222222222222222222222222222222",
  "amountIn": "1000000000000000000",
  "amountSwap": "200000000000000000",
  "to": "0x1111111111111111111111111111111111111111",
  "nativeTo": "0x1111111111111111111111111111111111111111",
  "slippageBps": 100
}
```

Required request fields: `user`, `tokenIn`, `amountIn`. Optional: `chainId`, `amountSwap`, `to`, `nativeTo`, `slippageBps`.

The Relayer `QuoteResponse` must include Appendix A fields at the top level. Optional `eip712` must be `StewardGasRescue` / `1` with the frozen Order field order (`nativeTo`, not `safeRecipient`) and must agree with the top-level values.

Dry-mock amounts (also in `src/fixtures/sample-swap-quote.json` / `sample-swap-quote-arb.json`):

| Field | Value |
| --- | --- |
| `amountIn` | `1e18` |
| `amountSwap` | `0.2e18` |
| `feeAmount` | `0.01e18` |
| `amountRemainder` | `0.79e18` |
| `tokenSymbol` | `mPERMIT` (Base) / `GRTT` (Arb) |
| `pathHash` | `0xbbb…` (32 bytes) |
| `chainId` | `84532` or `421614` (fixtures pin the live deploy addrs below) |

Base Sepolia fixture / `.env.example` deploy addrs (84532):

| Role | Address |
| --- | --- |
| `tokenIn` / MockERC20Permit | `0xE36c35cbF0373D77D00732f7B92dB4fB8fd37166` |
| `feeTo` (Owner) | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| GasRescueSwap | `0x21A1ADf810e64B5bd1d530D31abA6856b8DEf688` |
| `router` | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |

Arb Sepolia fixture / `.env.example` deploy addrs (421614):

| Role | Address |
| --- | --- |
| `tokenIn` / MockERC20Permit **GRTT** | `0x5649fF51123D534044aA7E6cBc8762698Ffed713` |
| `feeTo` (Owner) | `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` |
| GasRescueSwap | `0x65e712222745A8FCCbF038A90Fa75caB0867993D` |
| `router` | `0x680410c7f64e06EB7e80dc7B5c149f7855e225A8` |

`amountSwap + feeAmount + amountRemainder` must equal `amountIn`. `safeRecipient` is not accepted. The old fee-skim shape (`amount` / `token` only) fails closed.

`displayBeforeConfirm`: `amountIn`, `amountSwap`, `amountRemainder`, `feeAmount`, `feeTo`, `to`, `nativeTo`, `minAmountOut`, `tokenSymbol`, `tokenDecimals`, `chainId`.

The wallet signs; it does not submit the rescue transaction. Hand the Order + permit to your Relayer.

## Tests

```bash
cd wallet
npm test
```

Covers POST `/v1/quotes` client, QuoteResponse parse (fail closed, including fee-skim bodies and disagreeing `eip712`), Base/Arb Relayer dry-mock fixtures, Confirm-details process gate, Order field sourcing, and end-user copy.

## Out of scope

Mainnet, Solidity / contracts, inventing live balances or live quotes, broadcasting the rescue.
