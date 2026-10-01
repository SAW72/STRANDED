# SDEMO migration runbook

Status (Oct 1, 2026): both phases ran. SDEMO is `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C`. GRTT and gMOCK were delisted that day. The steps below are the record of that run.

Spencer signs both phases from his machine. No key is stored in this repo. Do not `--broadcast` from CI or Cursor. Do not paste a nonce-predicted address. Record the SDEMO address from the Phase A CREATE receipt.

`script/MigrateH1GatedDemoToken.s.sol` is keyless (`--account` / `--sender` `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`) and reverts on Foundry's default sender `0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38`. Pass `--slow` on every broadcast. This runbook does not change `render.yaml`.

Between Phase A and Phase B, GRTT stayed drainable and H1 stayed open. Phase B closed that window on Oct 1, 2026.

The constructor creates the whole supply: 2 SDEMO (`2e18`) to `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` and 18 SDEMO (`18e18`) to `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. There is no `mint`. ETH out is at most `totalSupply()` times 0.0005 ETH, so 20 SDEMO draws at most 0.01 ETH. Remainders are returned and can be swapped again, so that ceiling is the full supply, not a count of small rescues.

## 1. Phase A

Spencer runs Phase A and records the SDEMO address from the CREATE receipt.

Simulate first, with no key and no `--broadcast`:

```bash
PHASE=A forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --chain-id 421614 -vv
```

Broadcast:

```bash
PHASE=A forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

Phase A creates SDEMO and calls `setEip2612Token(SDEMO, true)`. GRTT and gMOCK stayed allowlisted until Phase B. They were delisted Oct 1, 2026. If the run stops after the CREATE, resume with the receipt address. That path does not deploy a second token, and it skips `setEip2612Token` when it is already true:

```bash
PHASE=A EXISTING_TOKEN=<CREATE receipt address> \
forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```

## 2. Transfers

Spencer transfers 2 SDEMO per judge from the owner wallet (`0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`) and logs each transfer in [docs/SDEMO_DISTRIBUTION_LOG.md](SDEMO_DISTRIBUTION_LOG.md). The migration script does not move balances.

## 3. Static site

On the Render static site `stranded`, set `VITE_TOKEN_ADDRESS_ARB_SEPOLIA` to `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C` and rebuild.

## 4. Relayer

On the Render web service `stranded-relayer-arb`, set `TOKEN_ADDRESS` and `DEMO_TOKEN` to `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C`. `DEMO_TOKEN` wins. GRTT and gMOCK were delisted Oct 1, 2026. Restart the service.

## 5. Live check

One SDEMO quote and one SDEMO rescue on https://strandedtoken.trade. Then `HackQuestStatus` with `DEMO_TOKEN` set to that SDEMO address shows `ready=true`.

```bash
DEMO_TOKEN=0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C \
forge script script/HackQuestStatus.s.sol:HackQuestStatus \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614
```

Do not retarget `GasRescueLens.LIVE_ARB_GRTT`. That constant names GRTT, which was delisted Oct 1, 2026.

## 6. Phase B

Spencer runs Phase B with `EXISTING_TOKEN` set to the SDEMO address from the CREATE receipt. Phase B reverts if `EXISTING_TOKEN` is unset, and it refuses to delist unless Phase A is already applied. It then sets `setTokenAllowed(false)` for GRTT and gMOCK, skipping either token that is already delisted. That delist ran Oct 1, 2026.

```bash
PHASE=B EXISTING_TOKEN=<CREATE receipt address> \
forge script script/MigrateH1GatedDemoToken.s.sol:MigrateH1GatedDemoToken \
  --rpc-url "$ARB_SEPOLIA_RPC_URL" --chain-id 421614 \
  --account <owner-keystore> \
  --sender 0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D \
  --broadcast --slow
```
