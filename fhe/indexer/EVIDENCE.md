# Evidence: Fhish Pay indexer, end to end on a live Monad-testnet fork

Captured 2026-10-09 (IST) with Envio HyperIndex **3.14.0** (`envio start`), indexing the local anvil fork of
Monad testnet (chain 10143, RPC source `http://127.0.0.1:18810`, start block 69518347 = Fhish deploy block).
Everything below is real output, not mocked: the events were produced by `scripts/activity.ts` (and, at the
same time, by people using the Fhish Pay app on the same fork, which is why the totals are higher than what
the script alone sends).

How the stack ran on this machine: Postgres 16 (Homebrew, port 5442) + Hasura `hasura/graphql-engine:v2.43.0`
in Docker (port 8892) + `envio start` with `ENVIO_PG_*` / `HASURA_GRAPHQL_ENDPOINT` pointing at them (the
`envio dev` defaults 5433/8080 were taken). See README "Run it locally".

## 1. Data flowing in: the activity script

`node scripts/activity.ts` (14 transactions, explicit gas = estimate + 30%):

```
1. wrap: approve + wrap (public amounts)
  approve   0xc25a6f35…7e523 block 69519814     wrap 0x03b84f82…5d042f block 69519815   (alice, 2,000 AUSD)
  approve   0x5a705c10…39073 block 69519819     wrap 0xac886abd…442cd5 block 69519820   (bob, 500 AUSD)
2. private pay() with a public reference
  pay                    0x905c1156…436c2a68 block 69519825 gas 314698/409107
3. plain confidentialTransfer
  confidentialTransfer   0x22a18e32…6c6497 block 69519829 gas 332536/432296
4. pay links: two claimed by a new account (sponsored by carol), one left open
  createLink 0xc181e85b… 69519834 · createLink 0x9c6516df… 69519838 · claimLink 0x7a1dd006… 69519843
  claimLink 0xdc032a91… 69519850 · createLink 0x14cf6907… 69519851
  links #2 #3 claimed by 0x1E39571b0c5FD38dBEfcb8a9b7a62b0b56f3D012; #4 open
5. payroll run by an operator (carol) for alice
  setOperator 0x60169d2b… 69519855 · runPayrollFrom 0x6fac51c8…5acb9 block 69519856 gas 848341/1102843
6. unwrap (cash-out): burn, KMS reveal through the oracle, public payout
  unwrap 0x6327ca0a…5aee8 block 69519861 · reveal #7 delivered in 1382 ms
```

## 2. Correctness: every aggregate recomputed from raw chain logs

`node scripts/verify.ts` re-derives each aggregate from `eth_getLogs` (independently of the handlers) and
diffs it against the GraphQL API. Exit code 0:

```
blocks 69518347..69520145 · 50 token logs, 14 oracle logs, 207 executor logs

aggregate                            chain       indexer
ok  payments                            13            13
ok  pays                                 2             2
ok  payrollPayments                      7             7
ok  transfers                            1             1
ok  linkClaims                           3             3
ok  payrollRuns                          3             3
ok  linksCreated                         4             4
ok  linksClaimed                         3             3
ok  linksRefunded                        0             0
ok  linksOpen                            1             1
ok  wraps                                4             4
ok  unwrapsRequested                     2             2
ok  unwrapsSettled                       2             2
ok  publicWrapped               7600000000    7600000000
ok  publicUnwrapped               52000000      52000000
ok  publicTvl                   7548000000    7548000000
ok  reveals                              7             7
ok  revealsFulfilled                     7             7
ok  revealLatencySecondsTotal            26            26
ok  revealLatencyBlocksTotal            26            26
ok  fheOps                             207           207
ok  fheInputsVerified                   28            28
ok  payment amounts are 32-byte ciphertext handles (13 rows)
ok  no oracle cleartext appears in Payment/Reveal rows (6 distinct cleartexts checked)

ALL MATCH
```

## 3. Handler unit tests (Envio test indexer, simulated events, in-memory store)

`pnpm test` (vitest 4.1.0, `createTestIndexer()`): payment counting incl. TRANSFER -> PAY -> PAYROLL
reclassification, the pay-link state machine with claim latency (avg + median) and refunds, reveal latency
per delivery path with a no-cleartext assertion, TVL math per token and globally, FHE executor rollups.

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

A deliberately wrong expectation (avg claim time 141 instead of 140) makes the suite fail, so the tests
assert real values. `tsc --noEmit` is clean in `indexer/` and in `app/`.

## 4. Consumer: the app

```
GET /activity -> 200 23117B
GET /api/indexer -> 200 12360B
```

`/activity` (rendered in a browser, desktop and 375 px mobile, no horizontal scroll) shows the six live
totals, the payment feed with each amount as a sealed ciphertext handle (a lock icon plus `0x5d7f…a304`), pay links
with claim times, reveals with latency and delivery path, and FHE load per opcode. It polls `/api/indexer`
every 3 s; payroll runs made from the app's Payroll page appeared in the feed within one poll.
`POST /api/indexer` forwards read-only queries; mutations are rejected (`{"error":"only GraphQL queries are proxied"}`).

## 5. GraphQL queries and responses (Hasura, public role, `http://localhost:8892/v1/graphql`)

Numeric `BigInt`/`Float` columns come back as strings (`HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true`, as in Envio's own setup).

### Sync status

```graphql
{ chain_metadata { chain_id start_block latest_processed_block block_height num_events_processed is_hyper_sync } }
```

```json
{
    "data": {
        "chain_metadata": [
            {
                "chain_id": 10143,
                "start_block": 69518347,
                "latest_processed_block": 69520145,
                "block_height": 69520145,
                "num_events_processed": 273,
                "is_hyper_sync": false
            }
        ]
    }
}
```

### Protocol aggregates (GlobalStats)

```graphql
{ GlobalStats { payments pays payrollPayments linkClaims transfers uniquePayers accounts payrollRuns payrollRunsViaOperator linksCreated linksClaimed linksOpen linkClaimAvgSeconds linkClaimMedianSeconds wraps unwrapsSettled publicWrapped publicUnwrapped publicTvl reveals revealsFulfilled revealsPending revealsViaRelayer revealsViaCre revealAvgLatencySeconds revealAvgLatencyBlocks fheOps fheInputsVerified } }
```

```json
{
    "data": {
        "GlobalStats": [
            {
                "payments": 13,
                "pays": 2,
                "payrollPayments": 7,
                "linkClaims": 3,
                "transfers": 1,
                "uniquePayers": 2,
                "accounts": 6,
                "payrollRuns": 3,
                "payrollRunsViaOperator": 2,
                "linksCreated": 4,
                "linksClaimed": 3,
                "linksOpen": 1,
                "linkClaimAvgSeconds": "7.333333333333333",
                "linkClaimMedianSeconds": "5",
                "wraps": 4,
                "unwrapsSettled": 2,
                "publicWrapped": "7600000000",
                "publicUnwrapped": "52000000",
                "publicTvl": "7548000000",
                "reveals": 7,
                "revealsFulfilled": 7,
                "revealsPending": 0,
                "revealsViaRelayer": 7,
                "revealsViaCre": 0,
                "revealAvgLatencySeconds": "3.7142857142857144",
                "revealAvgLatencyBlocks": "3.7142857142857144",
                "fheOps": 207,
                "fheInputsVerified": 28
            }
        ]
    }
}
```

### Per-token TVL (Token)

```graphql
{ Token { symbol underlyingSymbol decimals publicWrapped publicUnwrapped publicTvl wraps unwrapsSettled payments } }
```

```json
{
    "data": {
        "Token": [
            {
                "symbol": "cAUSD",
                "underlyingSymbol": "AUSD",
                "decimals": 6,
                "publicWrapped": "7600000000",
                "publicUnwrapped": "52000000",
                "publicTvl": "7548000000",
                "wraps": 4,
                "unwrapsSettled": 2,
                "payments": 13
            }
        ]
    }
}
```

### Live payment feed: amounts are ciphertext handles only

```graphql
{ Payment(order_by: [{blockNumber: desc}, {logIndex: desc}], limit: 6) { kind from_id to_id amountHandle ref blockNumber txHash payrollRun { count viaOperator } link { linkId } } }
```

```json
{
    "data": {
        "Payment": [
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
                "amountHandle": "0x5d7f5a06fc67507601847499340f2f7dc51d1046124aa25d73056ad83271a304",
                "ref": "0x706179726f6c6c20323032362d31300000000000000000000000000000000000",
                "blockNumber": 69520095,
                "txHash": "0x07c0494d76eceed901301e607bc852305efc395e463e6bb1a96bbc49f8c166ce",
                "payrollRun": {
                    "count": 2,
                    "viaOperator": true
                },
                "link": null
            },
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "amountHandle": "0x81725b41268b84c97af22543211fd4ae9b6a7d9cb7397212283acfb97bb0c404",
                "ref": "0x706179726f6c6c20323032362d31300000000000000000000000000000000000",
                "blockNumber": 69520095,
                "txHash": "0x07c0494d76eceed901301e607bc852305efc395e463e6bb1a96bbc49f8c166ce",
                "payrollRun": {
                    "count": 2,
                    "viaOperator": true
                },
                "link": null
            },
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
                "amountHandle": "0x3ded1d953a69d508b0eef9d027d4d9d679a62a97ee6e335598dfee3d32bdd704",
                "ref": "0x706179726f6c6c20323032362d31300000000000000000000000000000000000",
                "blockNumber": 69520076,
                "txHash": "0x9ce19befa9c2b1f591f476001769a77254500f9495e5492ee2418335d3008427",
                "payrollRun": {
                    "count": 2,
                    "viaOperator": false
                },
                "link": null
            },
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "amountHandle": "0x4fb0bdfa8a5ce53525fd853be9907462c5c42535efa1062b4647582347e09d04",
                "ref": "0x706179726f6c6c20323032362d31300000000000000000000000000000000000",
                "blockNumber": 69520076,
                "txHash": "0x9ce19befa9c2b1f591f476001769a77254500f9495e5492ee2418335d3008427",
                "payrollRun": {
                    "count": 2,
                    "viaOperator": false
                },
                "link": null
            },
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x1e39571b0c5fd38dbefcb8a9b7a62b0b56f3d012",
                "amountHandle": "0xd1bdaa210c950246ae5889e1df607840294bd4edece4addd75f8566cdbf33604",
                "ref": "0x706179726f6c6c2d323032362d31300000000000000000000000000000000000",
                "blockNumber": 69519856,
                "txHash": "0x6fac51c8c237c5cdc0f68e9c4a24c2ceeb1912f235821cc6be992ad1a255acb9",
                "payrollRun": {
                    "count": 3,
                    "viaOperator": true
                },
                "link": null
            },
            {
                "kind": "PAYROLL",
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
                "amountHandle": "0xdffb84eb07eff83666bac2b8d974b98ec4bba945b6f40fc07af0bbc824905304",
                "ref": "0x706179726f6c6c2d323032362d31300000000000000000000000000000000000",
                "blockNumber": 69519856,
                "txHash": "0x6fac51c8c237c5cdc0f68e9c4a24c2ceeb1912f235821cc6be992ad1a255acb9",
                "payrollRun": {
                    "count": 3,
                    "viaOperator": true
                },
                "link": null
            }
        ]
    }
}
```

### Pay link state machine with claim latency

```graphql
{ PayLink(order_by: {createdAt: asc}) { linkId state sender_id claimedBy_id createdAt claimedAt claimSeconds claimBlocks amountHandle } }
```

```json
{
    "data": {
        "PayLink": [
            {
                "linkId": "1",
                "state": "CLAIMED",
                "sender_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "claimedBy_id": "0x4b4b984db8719dac1e8b28b159da75734f52a6a5",
                "createdAt": 1791544113,
                "claimedAt": 1791544114,
                "claimSeconds": 1,
                "claimBlocks": 1,
                "amountHandle": "0xc48f950ce8d18663156de42a78055624cf72a9cd7ff83378561a86d7fc5e0d04"
            },
            {
                "linkId": "2",
                "state": "CLAIMED",
                "sender_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "claimedBy_id": "0x1e39571b0c5fd38dbefcb8a9b7a62b0b56f3d012",
                "createdAt": 1791544139,
                "claimedAt": 1791544155,
                "claimSeconds": 16,
                "claimBlocks": 16,
                "amountHandle": "0xe03087164fd32f5cd09b0759a5d3a0c32ea6c32efddeb9c41e9d71c738627704"
            },
            {
                "linkId": "3",
                "state": "CLAIMED",
                "sender_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "claimedBy_id": "0x1e39571b0c5fd38dbefcb8a9b7a62b0b56f3d012",
                "createdAt": 1791544143,
                "claimedAt": 1791544148,
                "claimSeconds": 5,
                "claimBlocks": 5,
                "amountHandle": "0xc1fffae3e23c684eb925e4c714aeae0dfabcd80baf566d6d9cb61620269c7804"
            },
            {
                "linkId": "4",
                "state": "OPEN",
                "sender_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "claimedBy_id": null,
                "createdAt": 1791544156,
                "claimedAt": null,
                "claimSeconds": null,
                "claimBlocks": null,
                "amountHandle": "0xf212bd3a9cac974b79cdf87e6042d4f6b11d60069d6c8d098fb2d4660854ea04"
            }
        ]
    }
}
```

### Reveals (request -> callback latency) and the unwraps they settled

```graphql
{ Reveal(order_by: {requestedBlock: desc}, limit: 4) { requestId app handlesCount status path via latencySeconds latencyBlocks callbackOk } Unwrap { requestId account_id burnedHandle settled amount settleSeconds reveal { latencySeconds path } } }
```

```json
{
    "data": {
        "Reveal": [
            {
                "requestId": "7",
                "app": "cAUSD",
                "handlesCount": 1,
                "status": "FULFILLED",
                "path": "RELAYER",
                "via": "0x74056a101aad54f43d6721705c1baa87993cbf16",
                "latencySeconds": 5,
                "latencyBlocks": 5,
                "callbackOk": true
            },
            {
                "requestId": "6",
                "app": "cAUSD",
                "handlesCount": 1,
                "status": "FULFILLED",
                "path": "RELAYER",
                "via": "0x74056a101aad54f43d6721705c1baa87993cbf16",
                "latencySeconds": 3,
                "latencyBlocks": 3,
                "callbackOk": true
            },
            {
                "requestId": "5",
                "app": "app",
                "handlesCount": 1,
                "status": "FULFILLED",
                "path": "RELAYER",
                "via": "0x74056a101aad54f43d6721705c1baa87993cbf16",
                "latencySeconds": 3,
                "latencyBlocks": 3,
                "callbackOk": true
            },
            {
                "requestId": "4",
                "app": "app",
                "handlesCount": 2,
                "status": "FULFILLED",
                "path": "RELAYER",
                "via": "0x74056a101aad54f43d6721705c1baa87993cbf16",
                "latencySeconds": 4,
                "latencyBlocks": 4,
                "callbackOk": true
            }
        ],
        "Unwrap": [
            {
                "requestId": "6",
                "account_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "burnedHandle": "0x121664b9c5f3f3efb81678d0ffd161262ec7fd679d96b42fedabaa92d5ffbc04",
                "settled": true,
                "amount": "2000000",
                "settleSeconds": 3,
                "reveal": {
                    "latencySeconds": 3,
                    "path": "RELAYER"
                }
            },
            {
                "requestId": "7",
                "account_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "burnedHandle": "0x9d95daeea28adb29530e2e02cd5fcccb028a1c5727ace31159cf498b40633b04",
                "settled": true,
                "amount": "50000000",
                "settleSeconds": 5,
                "reveal": {
                    "latencySeconds": 5,
                    "path": "RELAYER"
                }
            }
        ]
    }
}
```

### Derived per-account view (relationships via @derivedFrom)

```graphql
{ Account(where: {id: {_eq: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"}}) { id paymentsSent paymentsReceived counterparties payrollsRun linksCreated wraps publicWrapped firstSeenBlock lastSeenBlock payrolls { count viaOperator operator_id } linksSent { linkId state } } PayPair(order_by: {count: desc}, limit: 4) { from_id to_id count } }
```

```json
{
    "data": {
        "Account": [
            {
                "id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "paymentsSent": 11,
                "paymentsReceived": 0,
                "counterparties": 4,
                "payrollsRun": 3,
                "linksCreated": 3,
                "wraps": 3,
                "publicWrapped": "7100000000",
                "firstSeenBlock": 69519798,
                "lastSeenBlock": 69520095,
                "payrolls": [
                    {
                        "count": 3,
                        "viaOperator": true,
                        "operator_id": "0x90f79bf6eb2c4f870365e785982e1f101e93b906"
                    },
                    {
                        "count": 2,
                        "viaOperator": false,
                        "operator_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
                    },
                    {
                        "count": 2,
                        "viaOperator": true,
                        "operator_id": "0x14dc79964da2c08b23698b3d3cc7ca32193d9955"
                    }
                ],
                "linksSent": [
                    {
                        "linkId": "1",
                        "state": "CLAIMED"
                    },
                    {
                        "linkId": "2",
                        "state": "CLAIMED"
                    },
                    {
                        "linkId": "4",
                        "state": "OPEN"
                    }
                ]
            }
        ],
        "PayPair": [
            {
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
                "count": 5
            },
            {
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
                "count": 3
            },
            {
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x1e39571b0c5fd38dbefcb8a9b7a62b0b56f3d012",
                "count": 2
            },
            {
                "from_id": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                "to_id": "0x4b4b984db8719dac1e8b28b159da75734f52a6a5",
                "count": 1
            }
        ]
    }
}
```

### FHE coprocessor load per opcode and per calling app

```graphql
{ FheOpStat(order_by: {count: desc}) { name opcode count scalarCount } FheCallerStat(order_by: {ops: desc}) { caller label ops selects inputsVerified } }
```

```json
{
    "data": {
        "FheOpStat": [
            {
                "name": "trivialEncrypt",
                "opcode": null,
                "count": 53,
                "scalarCount": 0
            },
            {
                "name": "add",
                "opcode": 1,
                "count": 34,
                "scalarCount": 0
            },
            {
                "name": "select",
                "opcode": null,
                "count": 32,
                "scalarCount": 0
            },
            {
                "name": "sub",
                "opcode": 2,
                "count": 30,
                "scalarCount": 0
            },
            {
                "name": "verifyInput",
                "opcode": null,
                "count": 28,
                "scalarCount": 0
            },
            {
                "name": "ge",
                "opcode": 15,
                "count": 28,
                "scalarCount": 0
            },
            {
                "name": "gt",
                "opcode": 16,
                "count": 2,
                "scalarCount": 0
            }
        ],
        "FheCallerStat": [
            {
                "caller": "0x85c5dd61585773423e378146d4bec6f8d149e248",
                "label": "cAUSD",
                "ops": 65,
                "selects": 19,
                "inputsVerified": 16
            },
            {
                "caller": "0x73eccd6288e117caca738bdad4fec51312166c1a",
                "label": "app",
                "ops": 17,
                "selects": 5,
                "inputsVerified": 4
            },
            {
                "caller": "0x1275d096b9dbf2347bd2a131fb6bdab0b4882487",
                "label": "app",
                "ops": 8,
                "selects": 2,
                "inputsVerified": 2
            },
            {
                "caller": "0x59f2f1fcfe2474fd5f0b9ba1e73ca90b143eb8d0",
                "label": "app",
                "ops": 2,
                "selects": 4,
                "inputsVerified": 3
            },
            {
                "caller": "0x90118d110b07abb82ba8980d1c5cc96eea810d2c",
                "label": "app",
                "ops": 2,
                "selects": 2,
                "inputsVerified": 3
            }
        ]
    }
}
```

### Daily rollup

```graphql
{ DailyStats { date payments pays payrollPayments linkClaims transfers uniquePayers payrollRuns linksCreated linksClaimed wraps publicWrapped publicUnwrapped reveals revealsFulfilled revealLatencySecondsTotal fheOps } }
```

```json
{
    "data": {
        "DailyStats": [
            {
                "date": "2026-10-09",
                "payments": 13,
                "pays": 2,
                "payrollPayments": 7,
                "linkClaims": 3,
                "transfers": 1,
                "uniquePayers": 2,
                "payrollRuns": 3,
                "linksCreated": 4,
                "linksClaimed": 3,
                "wraps": 4,
                "publicWrapped": "7600000000",
                "publicUnwrapped": "52000000",
                "reveals": 7,
                "revealsFulfilled": 7,
                "revealLatencySecondsTotal": 26,
                "fheOps": 207
            }
        ]
    }
}
```

