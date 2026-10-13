# How Kakushi uses Envio: a private inbox that loads in a second

*Kakushi · Monad Metropolis, Track 04 · live at https://kakushi.vercel.app*

Kakushi is the privacy provider for Monad. ZK hides *who*, through stealth addresses, a shielded pool and private calls. FHE hides *how much*, through encrypted balances and payments.

The simplest privacy feature is the **stealth payment**. You pay someone's wallet, and the money lands at a one-time address that nobody else can link to them. For that to work, the recipient must be able to **find** their payments.

## The problem: finding your payments means reading every announcement

A stealth payment announces itself on chain as an ERC-5564 `Announcement(schemeId, stealthAddress, caller, ephemeralPubKey, metadata)` log. Nobody can tell whom it is for. So the recipient's inbox has to read **every** announcement since the announcer was deployed and test each one against their viewing key, locally in the browser, without telling anyone which ones match.

On Monad that's a lot of history. Monad produces about 2.5 blocks a second, and its public RPC caps `eth_getLogs` at **100 blocks** per request. Our announcer was a day and a half old and already ~290,000 blocks deep, which meant about 2,900 sequential requests. While recording the demo, the live inbox ran for 15 minutes and gave up ("Couldn't reach Monad"). A privacy feature whose inbox doesn't load isn't a feature.

## How it works

### 1. One HyperSync query for the whole history

`packages/app/src/app/api/announcements/route.ts` asks Envio HyperSync for the announcer's logs, following `next_block` until it reaches HyperSync's archive height:

```ts
const r = await fetch(`${base}/query`, {   // base = https://10143.hypersync.xyz (Monad testnet)
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    from_block: next,
    logs: [{ address: [announcer], topics: [[ANNOUNCEMENT]] }],
    field_selection: { log: ["block_number", "transaction_hash", "log_index", "data", "topic0", "topic1", "topic2", "topic3"] },
  }),
});
```

The Envio token stays on the server. The route serves only the announcer recorded in Kakushi's own deployment, so it isn't an open proxy. It returns raw logs and the block they reach.

### 2. The inbox matches locally, then reads only the tip over RPC

`scanAnnouncements` in `@kakushi/sdk` takes an optional `history` source. The Receive page passes the HyperSync route:

```ts
scanAnnouncements(client, announcer, deployBlock, latest, keys, {
  withBalances: true,
  history: (from) => announcementHistory(chainId, from),   // GET /api/announcements
});
```

The SDK decodes each log, checks the view tag and the stealth address against the user's keys, and derives the spending key for each match. All of this happens in the browser. The handful of blocks after HyperSync's height are read over RPC, 12 requests at a time. If HyperSync is unavailable, the whole range falls back to RPC, so the inbox never depends on one provider. Both paths are covered by tests (`packages/sdk/test/scan-history.test.ts`).

### 3. The HyperIndex package for bridge analytics

`packages/indexer/envio` and `fhe/indexer` hold a HyperIndex v3 project for the bridge and the FHE app:
- the schema;
- lifecycle handlers for source payments, payouts, disputes and attestation windows;
- derived `MakerStats` and `RouteStats` (fill rate, latency, volume, slashes).

Codegen and its offline tests run in CI.

## Engineering notes

- **What the server learns.** HyperSync returns *all* announcements, and matching happens in the browser, so neither Envio nor Kakushi's server learns which payments are yours. That is essential for a privacy product, and it rules out the obvious design of indexing per recipient.
- **Monad's 100-block cap** is the reason this matters. The same cap broke two other slow paths we fixed this week: the shielded pool's Merkle-tree rebuild, and the bridge's attestation-window rebuild. Both now page in parallel.

## The value it brought

The Receive inbox went from never finishing to **350,352 Monad blocks scanned in 1.3 seconds**. That's the difference between a stealth-payment demo and a stealth-payment product. As Monad's history grows, the cost stays flat for the user.

## Live proof

- `https://kakushi.vercel.app/api/announcements?chainId=10143&from=70440000` returns the announcer's full history from HyperSync (`"source": "envio-hypersync"`, 10 announcements on 14 Oct 2026).
- A full inbox scan for a wallet with 4 stealth payments over 350,352 Monad blocks took 1.3 s. The announcements it finds include the stealth payment [0x7181caa5…8505](https://testnet.monadvision.com/tx/0x7181caa525a2f22f73cba6d07f5a402a6ecd20794077cb98d7584de9033b8505) and the team-seeded one [0x6be02b2a…0073](https://testnet.monadvision.com/tx/0x6be02b2aa450e679b3570a94b00b15d8cce822acce9cdd03843888d6d1680073).

**Honest scope.** The live integration is HyperSync. The HyperIndex package is built and tested but not deployed to Envio Cloud. The bridge statistics in the live app come from Kakushi's own RPC indexer on Railway.

Code: [`packages/app/src/app/api/announcements/route.ts`](../packages/app/src/app/api/announcements/route.ts), [`packages/sdk/src/stealth.ts`](../packages/sdk/src/stealth.ts) (`scanAnnouncements`), [`packages/indexer/envio`](../packages/indexer/envio).
