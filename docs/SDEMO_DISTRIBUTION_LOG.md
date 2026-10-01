# SDEMO distribution log

SDEMO was deployed on Oct 1, 2026 at `0xE3cb1AC5EDc70D3a85250a8c00cBe3A45AFc616C` (tx `0xfc357a9aa4ef5092882ee806228edb6a03843b4cfa363f3eee9770a9851bb651`). The constructor created all 20 SDEMO: 2 to `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` and 18 to `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. There is no `mint`. Judges receive 2 SDEMO each by transfer from the Steward wallet, on request. Log each transfer below. No faucet and no liquidity pool.

`0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. The live relayer hot key is `0x8240…9AF6`.

Owner transactions on Oct 1, 2026, from `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D` to `GasRescueSwap` `0x65e712222745A8FCCbF038A90Fa75caB0867993D`:

| What | Tx |
| --- | --- |
| `setEip2612Token` (SDEMO allowed and EIP-2612) | `0x0d7bdd17973e2586b32b6bcc2880f9246332bbff27683a56ede02be926d8acdc` |
| Delist GRTT `0x5649fF51123D534044aA7E6cBc8762698Ffed713` (was delisted on Oct 1) | `0xde390ee6c3ecf112ec0044f0d9869d5eec0c16baadb95aa39cf73fdb61d3da1c` |
| Delist gMOCK `0x30006e29a23c713070136F56db1BDf2A8B82B318` (was delisted on Oct 1) | `0xd139e3fd4e88fff663e37c7187202a9cdabf285e84e05e49fdaeab789e52c0d2` |

No judge transfer has happened yet.

| Date | Recipient | Amount | Tx hash |
| --- | --- | --- | --- |
| — | — | — | — |
