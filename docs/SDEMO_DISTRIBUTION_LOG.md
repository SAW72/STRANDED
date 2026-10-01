# SDEMO distribution log

No SDEMO has been deployed. When the owner signs `script/MigrateH1GatedDemoToken.s.sol`, the constructor creates 20 SDEMO: 2 (`2e18`) to `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` and 18 (`18e18`) to `0x30466A210961c0C2C13AF0A9d35dfC6E8858bA9D`. There is no `mint` function. Judges receive 2 SDEMO each by transfer from that Steward wallet. Log each transfer here. The migration script does not move balances. There is no faucet and no liquidity pool.

`0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37` is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. The live relayer hot key is `0x8240…9AF6`.

| Date | Recipient | Amount | Tx hash |
| --- | --- | --- | --- |
| — | — | — | — |
