# Seeded activity, 13 Oct 2026 (Monad testnet)

**Seeded by the team for the demo.** These wallets are ours, funded from the deployer. They are not organic users. The point is that the 0.1 MON pool has an anonymity set larger than one, and that withdrawals go to addresses no depositor has touched. Produced by `scripts/seed-testnet.ts`.

Pool: 0.1 MON `0x5f859405D69F24385C0Cf2297a6b2D4c91be2950`.

| Wallet | Funded (from deployer) | Shield deposit |
| --- | --- | --- |
| 1: `0x38c52c31f8688CD60e3358d1519F9F8aE643430E` | `0xbbdb0b70f9320b4313ce0441e2c79013ab0f2f6963f2ef8c965cbe12c85cc4e4` | `0x71b760c390f88981d02160186eef1bec7f6f95096db2523fb7c1f5da364ab903` |
| 2: `0x98Ff44F8a70D24df7AB63D4A8ddA434257D4123f` | `0xdcdf3709efc5e07b5c7afa72255d008ce3d5e7d6b48151ee11d3cfda7e400a03` | `0xd6b2715cea70caa78129cca310b79347de1263c338e3a12ea25cf9bd358ead7c` |
| 3: `0x7A5D38DD901B00AdD7952959B65debD67818Cc3a` | `0xc60e7ae8ab1f7c6b1da6e178f8a90a8529efff0c0b3da6670ba0234b7d5f2877` | `0x42c5d17d3b4bdd8bfa4b2fe115f596020bd55d2e3cc67be100c61b44f25a427a` |
| 4: `0xDeC4f7A88809E0FF707C8c0c86985e15504E609B` | `0x069703d3da00d92998afb6f658441e0167bc7455aaadea00cab08e772d7b9f8c` | `0x84a0cda43ae5236e276d00f76758189676b4c3640a12658aa6dfdf0dc0a2cc9f` |
| 5: `0x615d910da4c5d411e913FDa8d94eD5b1B9A8F2BD` | `0xb23c31ecbcb7a38e2d4780f8df37a633647e243996e8b42a043d6a2790f6b369` | `0x1365e6de8087136c269830582efbc7c52c0109cdc06e1119f3f7a6ed9d5522c3` |

**Private withdrawals.** The relayer key `0x62BD…6613` sends each one, with no fee, to an address created for it. The proof shows only that the note is one of the pool's deposits, not which one.

- `0xd0902069958096c92a3ebf0a3fb5e1771e2dacbd38ee840d8d0ef887ed862a81` → `0x96C652b22BaBAd7d80805d654772B1496396C892` (0.1 MON)
- `0x259180ba65fa9f693692d6b82945b4460b4f67347d0bfbb3d4b325933d0cde91` → `0xC8A2E26696149409bd8cD2625C2b2dE60Df41e57` (0.1 MON)

**Stealth payment.** Wallet 1 paid 0.01 MON to a one-time stealth address of the deployer's registered meta-address: `0x6be02b2aa450e679b3570a94b00b15d8cce822acce9cdd03843888d6d1680073`.

**Limit.** The anonymity set is only as large as the pool's deposits. Every wallet here was funded by the same deployer, so a chain analyst can still group the depositors. Organic deposits are what make the set real.
