# SDEMO mint log

No SDEMO mint has been broadcast. When the owner signs `script/MigrateH1GatedDemoToken.s.sol`, the constructor mints 2 SDEMO (`2e18`) to `0x5BFd261b1eF7e61Bfea1ebfC87bDD8F4244BBA37`. That address is Spencer's demo/QA EOA. It was allowlisted as a relayer in the past. On 2026-10-01 `relayers(address)` on `GasRescueSwap` `0x65e7…993D` returned false for it. Fill that row, then add a row for every later mint. Outstanding supply means `totalSupply()` and stays at or under 20, including that constructor mint. SDEMO held by the router is never swept and re-minted. There is no faucet and no liquidity pool.

| Date | Recipient | Amount | Tx hash |
| --- | --- | --- | --- |
| — | — | — | — |
