"use client";

import { useCallback, useEffect, useState } from "react";
import { parseEventLogs, parseAbi, parseUnits, formatUnits, isAddress, type Hex } from "viem";
import { waitForDecryption } from "@kakushi/fhe-sdk";
import { useRt } from "@/lib/runtime";
import { auctionAbi, cusdcAbi, otcAbi } from "@/lib/abi";
import { Btn, Cipher, Field, Log, Panel, Revealed } from "@/components/ui";

const reqAbi = parseAbi(["event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)"]);
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

function useTx() {
  const rt = useRt();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const note = (s: string) => setLog((l) => [...l.slice(-7), s]);
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        note(`error: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]}`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  const write = async (address: Hex, abi: any, functionName: string, args: unknown[]) => {
    const w = rt.wallet!;
    const hash = await w.writeContract({ chain: w.chain, account: w.account!, address, abi, functionName, args, gas: 3_000_000n });
    const rc = await rt.client!.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${functionName} reverted`);
    return rc;
  };
  return { log, note, busy, run, write };
}

function Auction({ addr }: { addr: Hex }) {
  const rt = useRt();
  const t = useTx();
  const [amount, setAmount] = useState("1500");
  const [info, setInfo] = useState<{ item: string; end: number; bids: number; winner: Hex; price: bigint; settled: boolean } | null>(null);
  const [mine, setMine] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    const c = rt.client!;
    const r = (fn: string) => c.readContract({ address: addr, abi: auctionAbi, functionName: fn as never });
    const [item, end, bids, winner, price, settled] = await Promise.all([r("item"), r("endTime"), r("bidCount"), r("winner"), r("price"), r("settled")]);
    setInfo({ item: item as string, end: Number(end), bids: Number(bids), winner: winner as Hex, price: price as bigint, settled: settled as boolean });
  }, [rt.client, addr]);
  useEffect(() => {
    if (rt.client) void refresh();
  }, [rt.client, refresh]);
  return (
    <Panel title="Sealed-bid auction" sub={info ? `${info.item} · ${info.bids} sealed bid${info.bids === 1 ? "" : "s"} · ends ${new Date(info.end * 1000).toLocaleTimeString()}` : "Loading…"}>
      {info?.settled ? (
        <p>Winner {info.winner.slice(0, 8)}… paid <Revealed>{info.price.toString()}</Revealed>. Every other bid stays sealed.</p>
      ) : (
        <>
          <Field label="Your bid (only you will ever see it)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ""))} />
          <div className="flex flex-wrap gap-2">
            <Btn busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
              t.note("encrypting in your browser…");
              const enc = await rt.fhe!.encrypt("euint64", BigInt(amount || "0"), addr, rt.account!);
              t.note(`ciphertext ${enc.handle.slice(0, 12)}… encrypted in ${enc.ms.encrypt} ms, attested in ${enc.ms.attest} ms`);
              await t.write(addr, auctionAbi, "bid", [enc.handle, enc.proof]);
              t.note("bid placed: the chain holds a handle, not your number");
              await refresh();
            })}>Place sealed bid</Btn>
            <Btn tone="ghost" busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
              const h = (await rt.client!.readContract({ address: addr, abi: auctionAbi, functionName: "myBid", account: rt.account! })) as Hex;
              if (/^0x0+$/.test(h)) return t.note("you have not bid yet");
              const v = await rt.fhe!.userDecrypt([h], addr, rt.wallet as never);
              setMine(v[h.toLowerCase()]!);
              t.note("decrypted with your signature, sealed to a key only this tab holds");
            })}>Decrypt my bid</Btn>
            <Btn tone="lantern" busy={t.busy} disabled={!rt.account || !info || Date.now() / 1000 < info.end} onClick={() => t.run(async () => {
              const rc = await t.write(addr, auctionAbi, "close", []);
              const id = parseEventLogs({ abi: reqAbi, logs: rc.logs })[0]!.args.requestId;
              t.note(`reveal requested (#${id}); waiting for the KMS callback…`);
              const t0 = Date.now();
              await waitForDecryption(rt.client!, rt.cfg!.deployment!.oracle, id);
              t.note(`revealed on-chain ${Date.now() - t0} ms later`);
              await refresh();
            })}>Close and reveal winner</Btn>
          </div>
          {mine !== null && <p className="text-sm">Your bid: <Revealed>{mine.toString()}</Revealed> (visible to you alone)</p>}
        </>
      )}
      <Log lines={t.log} />
    </Panel>
  );
}

function ConfidentialUsdc({ addr, usdc }: { addr: Hex; usdc: Hex }) {
  const rt = useRt();
  const t = useTx();
  const [wrapAmt, setWrapAmt] = useState("25");
  const [to, setTo] = useState("");
  const [sendAmt, setSendAmt] = useState("10");
  const [pub, setPub] = useState<bigint | null>(null);
  const [handle, setHandle] = useState<Hex | null>(null);
  const [mine, setMine] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!rt.account) return;
    setPub((await rt.client!.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [rt.account] })) as bigint);
    setHandle((await rt.client!.readContract({ address: addr, abi: cusdcAbi, functionName: "confidentialBalanceOf", args: [rt.account] })) as Hex);
    setMine(null);
  }, [rt.client, rt.account, addr, usdc]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Panel title="Confidential USDC" sub="Real Monad testnet USDC, wrapped. Inside the wrapper every balance and transfer is ciphertext.">
      {!rt.account ? (
        <p className="text-sm text-tide">Connect to see your balances.</p>
      ) : (
        <p className="text-sm">
          Public USDC: <span className="tabular">{pub === null ? "…" : formatUnits(pub, 6)}</span> · cUSDC: {handle && !/^0x0+$/.test(handle) ? <Cipher handle={handle} /> : "none"} {mine !== null && <> = <Revealed>{formatUnits(mine, 6)}</Revealed></>}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Wrap (USDC)" value={wrapAmt} onChange={setWrapAmt} />
        <div className="flex items-end gap-2">
          <Btn busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
            const v = parseUnits(wrapAmt || "0", 6);
            await t.write(usdc, erc20, "approve", [addr, v]);
            await t.write(addr, cusdcAbi, "wrap", [v]);
            t.note(`wrapped ${wrapAmt} USDC: your cUSDC balance is now a ciphertext`);
            await refresh();
          })}>Wrap</Btn>
          <Btn tone="ghost" busy={t.busy} disabled={!rt.account || !handle || /^0x0+$/.test(handle)} onClick={() => t.run(async () => {
            const v = await rt.fhe!.userDecrypt([handle!], addr, rt.wallet as never);
            setMine(v[handle!.toLowerCase()]!);
            t.note("balance decrypted for you alone");
          })}>Reveal my balance</Btn>
        </div>
        <Field label="Send to (address)" value={to} onChange={setTo} mono />
        <Field label="Amount (stays encrypted)" value={sendAmt} onChange={setSendAmt} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn busy={t.busy} disabled={!rt.account || !isAddress(to)} onClick={() => t.run(async () => {
          const enc = await rt.fhe!.encrypt("euint64", parseUnits(sendAmt || "0", 6), addr, rt.account!);
          await t.write(addr, cusdcAbi, "confidentialTransfer", [to, enc.handle, enc.proof]);
          t.note(`sent an encrypted amount to ${to.slice(0, 8)}…: observers see a transfer, not how much`);
          await refresh();
        })}>Send privately</Btn>
        <Btn tone="lantern" busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
          const enc = await rt.fhe!.encrypt("euint64", parseUnits(sendAmt || "0", 6), addr, rt.account!);
          const rc = await t.write(addr, cusdcAbi, "unwrap", [enc.handle, enc.proof]);
          const id = parseEventLogs({ abi: reqAbi, logs: rc.logs })[0]!.args.requestId;
          await waitForDecryption(rt.client!, rt.cfg!.deployment!.oracle, id);
          t.note("unwrapped: only the amount you took out was revealed");
          await refresh();
        })}>Unwrap this amount</Btn>
      </div>
      <Log lines={t.log} />
    </Panel>
  );
}

function DarkOtc({ addr }: { addr: Hex }) {
  const rt = useRt();
  const t = useTx();
  const [ask, setAsk] = useState("3150");
  const [bid, setBid] = useState("3200");
  const [orderId, setOrderId] = useState("0");
  const [count, setCount] = useState<number | null>(null);
  const refresh = useCallback(async () => setCount(Number(await rt.client!.readContract({ address: addr, abi: otcAbi, functionName: "orderCount" }))), [rt.client, addr]);
  useEffect(() => {
    if (rt.client) void refresh();
  }, [rt.client, refresh]);
  return (
    <Panel title="Dark OTC desk" sub={`${count ?? "…"} order(s). Limit prices are encrypted. A miss reveals nothing at all.`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Maker: minimum price" value={ask} onChange={setAsk} />
        <Field label="Taker: order #" value={orderId} onChange={setOrderId} />
        <Field label="Taker: maximum price" value={bid} onChange={setBid} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
          const enc = await rt.fhe!.encrypt("euint64", BigInt(ask || "0"), addr, rt.account!);
          await t.write(addr, otcAbi, "post", ["WMON/USDC", 1000n, enc.handle, enc.proof]);
          t.note("order posted with a hidden limit");
          await refresh();
        })}>Post hidden ask</Btn>
        <Btn tone="lantern" busy={t.busy} disabled={!rt.account} onClick={() => t.run(async () => {
          const enc = await rt.fhe!.encrypt("euint64", BigInt(bid || "0"), addr, rt.account!);
          const rc = await t.write(addr, otcAbi, "take", [BigInt(orderId || "0"), enc.handle, enc.proof]);
          const id = parseEventLogs({ abi: reqAbi, logs: rc.logs })[0]!.args.requestId;
          await waitForDecryption(rt.client!, rt.cfg!.deployment!.oracle, id);
          const tk = (await rt.client!.readContract({ address: addr, abi: otcAbi, functionName: "takes", args: [id] })) as readonly unknown[];
          t.note(tk[3] ? `crossed at ${tk[4]}: the maker's price, revealed only because you matched` : "no match: nothing about either limit was revealed");
        })}>Take with hidden bid</Btn>
      </div>
      <Log lines={t.log} />
    </Panel>
  );
}

export default function Playground() {
  const rt = useRt();
  const apps = rt.cfg?.apps;
  return (
    <div className="mx-auto max-w-6xl px-5 pt-10">
      <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Playground</h1>
      <p className="mt-3 max-w-2xl text-tide">Every number below is encrypted in your browser and computed on as ciphertext by the Kakushi coprocessor. The amber ones are the only values that were ever decrypted.</p>
      {!rt.cfg?.deployment || !apps ? (
        <p className="mt-10 rounded-2xl border border-kelp p-6 text-tide">The Kakushi stack is not running. Start it with <code className="font-mono text-biolum">node scripts/e2e-local.ts --keep</code>.</p>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Auction addr={apps.auction} />
          <ConfidentialUsdc addr={apps.cusdc} usdc={apps.usdc} />
          <DarkOtc addr={apps.otc} />
        </div>
      )}
    </div>
  );
}
