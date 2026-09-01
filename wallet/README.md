# GasRescue Wallet UX (Base Sepolia)

Thin-slice frontend for a user who holds an allowlisted EIP-2612 ERC-20 on **Base Sepolia** (chain id `84532`) but has no ETH for gas.

Flow:

1. Connect an injected wallet (MetaMask / Rabby / Coinbase). Wrong networks are prompted to switch to Base Sepolia.
2. Read the stranded token balance (`VITE_TOKEN_ADDRESS`, typically the deployed `MockERC20Permit`).
3. Fetch **Relayer `GET /quotes`**. Review `amount`, `feeAmount`, and `feeTo` in human decimals (`tokenDecimals` from the quote; expect 18).
4. Tap **Confirm details**. Only then does the app prompt the wallet.
5. One signature path: EIP-712 `Order`, then EIP-2612 `permit`.

This app does **not** invent a quotes endpoint, does **not** compute a fallback 1% fee, and does **not** default to mainnet. If `RELAYER_BASE_URL` is unset or `GET /quotes` fails / omits required fields, the sign path stays locked.

Fee helper copy (the quote still supplies the numbers):

> About 1% of the amount you rescue (testnet floor/ceiling apply in token units).

## Prerequisites

- Node 20+
- A Relayer that implements `GET /quotes` (this repo does not ship one)
- Deployed `GasRescue` + allowlisted token on Base Sepolia (see the root README)

## Configure

```bash
cd wallet
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `RELAYER_BASE_URL` | yes | Public Relayer origin. The app calls `{RELAYER_BASE_URL}/quotes`. |
| `VITE_GAS_RESCUE_ADDRESS` | yes | Deployed `GasRescue` on Base Sepolia |
| `VITE_TOKEN_ADDRESS` | yes | Allowlisted EIP-2612 ERC-20 (Scout mock is 18 decimals) |
| `VITE_BASE_SEPOLIA_RPC_URL` | no | Defaults to `https://sepolia.base.org` |

`RELAYER_BASE_URL` is a public origin, not a secret. **Do not** put private keys, Relayer keys, or mainnet RPC credentials in `.env`. Vite also accepts `VITE_RELAYER_BASE_URL` if you prefer the `VITE_` prefix.

## Run against Base Sepolia + Relayer

```bash
cd wallet
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). Connect a wallet that is on Base Sepolia and holds the configured token. The Relayer must allow the wallet origin for CORS.

Quote request:

```
GET {RELAYER_BASE_URL}/quotes?chainId=84532&token=<token>&amount=<raw>&user=<address>
```

Required JSON fields (string or number integers are accepted):

```json
{
  "amount": "100000000000000000000",
  "feeAmount": "1000000000000000000",
  "feeTo": "0x…",
  "tokenDecimals": 18
}
```

Optional: `deadline`, `nonce`, `token`, or a wrapper `{ "quote": { … } }` / `{ "quotes": [ … ] }`. `feeAmount` must be less than `amount` (same units the contract uses).

The wallet signs; it does not submit `rescueWithPermit`. Hand the Order + permit to your Relayer.

## Tests

```bash
cd wallet
npm test
```

Covers quote parsing (fail closed), the Confirm-details process gate, and Order field sourcing from the quote.

## Out of scope

Mainnet, Solana, spend flows, SaaS, and inventing `/quotes` responses.
