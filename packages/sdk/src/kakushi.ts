// The Kakushi client: one object holding the deployments and per-chain clients.
import { type Hex, type PublicClient, zeroAddress } from "viem";
import { CHAINS, type ChainKey, CHAIN_LIST, type Network, chainById } from "@kakushi/config";
import type { Deployments } from "@kakushi/config/deployments";
import { type ChainAttestConfig, encodeGross, splitCode } from "@kakushi/attest-core";
import { ebcAbi, mdcAbi, attestationOracleAbi, disputeModuleAbi } from "./abi.ts";
import { publicClient } from "./clients.ts";
import { allMakers, type ChainCtx } from "./attestations.ts";
import type { MakerQuote, PairInfo } from "./types.ts";

export interface Classification {
  kind: number; // 0 NONE, 1 FILL, 2 REFUND
  pairId: Hex;
  expected: bigint;
  obligationChainId: number;
  payToken: Hex;
  withholding: bigint;
  bps: bigint;
  code: number;
  marginToken: Hex;
  priceFeed: Hex;
  srcDecimals: number;
}

export class Kakushi {
  readonly network: Network;
  readonly d: Deployments;
  private rpcOverrides: Partial<Record<ChainKey, string>>;

  constructor(opts: { network: Network; deployments: Deployments; rpc?: Partial<Record<ChainKey, string>> }) {
    this.network = opts.network;
    this.d = opts.deployments;
    this.rpcOverrides = opts.rpc ?? {};
  }

  client(key: ChainKey): PublicClient {
    return publicClient(key, this.network, this.rpcOverrides[key]);
  }

  clientById(chainId: number): PublicClient {
    return this.client(chainById(chainId).key);
  }

  get hub(): PublicClient {
    return this.client("monadTestnet");
  }

  get fillWindow(): bigint {
    return BigInt(this.d.hub.fillWindow);
  }
  get disputeWindow(): bigint {
    return BigInt(this.d.hub.disputeWindow);
  }
  get clockSkew(): bigint {
    return BigInt(this.d.hub.clockSkew);
  }
  get bond(): bigint {
    return BigInt(this.d.hub.bond);
  }

  /** Attestation config for a chain (same inputs the CRE workflow uses). */
  async chainCtx(chainId: number, makers?: Hex[]): Promise<ChainCtx> {
    const c = chainById(chainId);
    const dep = this.d.chains[chainId]!;
    const cfg: ChainAttestConfig = {
      chainId,
      payoutRouter: dep.payoutRouter,
      sourceRouter: dep.sourceRouter,
      tokens: [c.usdc.address],
      makers: makers ?? (await allMakers(this.hub, this.d.hub.ebc)),
    };
    return { client: this.client(c.key), cfg };
  }

  // ---------------------------------------------------------------- hub reads

  async classify(maker: Hex, srcChainId: number, srcToken: Hex, gross: bigint, ts: bigint): Promise<Classification> {
    const c = (await this.hub.readContract({
      address: this.d.hub.ebc,
      abi: ebcAbi,
      functionName: "classify",
      args: [maker, BigInt(srcChainId), srcToken, gross, ts],
    })) as any;
    return {
      kind: Number(c.kind),
      pairId: c.pairId,
      expected: c.expected,
      obligationChainId: Number(c.obligationChainId),
      payToken: c.payToken,
      withholding: c.withholding,
      bps: c.bps,
      code: Number(c.code),
      marginToken: c.marginToken,
      priceFeed: c.priceFeed,
      srcDecimals: Number(c.srcDecimals),
    };
  }

  async makers(): Promise<Hex[]> {
    return allMakers(this.hub, this.d.hub.ebc);
  }

  async pairs(maker: Hex): Promise<PairInfo[]> {
    const ids = (await this.hub.readContract({ address: this.d.hub.ebc, abi: ebcAbi, functionName: "makerPairs", args: [maker] })) as Hex[];
    const now = BigInt(Math.floor(Date.now() / 1000));
    const block = await this.hub.getBlock();
    const ts = block.timestamp > now ? block.timestamp : now;
    return Promise.all(
      ids.map(async (pairId) => {
        const [p, prm, active] = await Promise.all([
          this.hub.readContract({ address: this.d.hub.ebc, abi: ebcAbi, functionName: "getPair", args: [pairId] }) as Promise<any>,
          this.hub.readContract({ address: this.d.hub.ebc, abi: ebcAbi, functionName: "paramsAt", args: [pairId, block.timestamp] }) as Promise<any>,
          this.hub.readContract({ address: this.d.hub.ebc, abi: ebcAbi, functionName: "isActiveAt", args: [pairId, block.timestamp] }) as Promise<boolean>,
        ]);
        const mc = (await this.hub.readContract({
          address: this.d.hub.ebc,
          abi: ebcAbi,
          functionName: "marginConfigOf",
          args: [maker, p.srcChainId, p.srcToken],
        })) as any;
        void ts;
        return {
          pairId,
          maker: p.maker,
          srcChainId: Number(p.srcChainId),
          srcToken: p.srcToken,
          dstChainId: Number(p.dstChainId),
          dstToken: p.dstToken,
          identCode: Number(p.identCode),
          withholdingFee: prm[0].withholdingFee,
          tradingFeeBps: BigInt(prm[0].tradingFeeBps),
          minAmount: prm[0].minAmount,
          maxAmount: prm[0].maxAmount,
          active,
          marginToken: mc.marginToken,
          priceFeed: mc.priceFeed,
          srcDecimals: Number(mc.srcDecimals),
        } satisfies PairInfo;
      }),
    );
  }

  async margin(maker: Hex, token: Hex): Promise<{ margin: bigint; required: bigint | null; openDisputes: bigint }> {
    const [margin, openDisputes] = await Promise.all([
      this.hub.readContract({ address: this.d.hub.mdc, abi: mdcAbi, functionName: "margin", args: [maker, token] }) as Promise<bigint>,
      this.hub.readContract({ address: this.d.hub.mdc, abi: mdcAbi, functionName: "openDisputes", args: [maker] }) as Promise<bigint>,
    ]);
    let required: bigint | null = null;
    try {
      required = (await this.hub.readContract({ address: this.d.hub.mdc, abi: mdcAbi, functionName: "required", args: [maker, token] })) as bigint;
    } catch {
      required = null; // stale price feed: withdrawals are blocked (fail safe)
    }
    return { margin, required, openDisputes };
  }

  async payoutCoveredUntil(chainId: number): Promise<bigint> {
    return (await this.hub.readContract({
      address: this.d.hub.attestationOracle,
      abi: attestationOracleAbi,
      functionName: "payoutCoveredUntil",
      args: [BigInt(chainId)],
    })) as bigint;
  }

  async dispute(key: Hex): Promise<{ opener: Hex; maker: Hex; openedAt: bigint; status: number; bond: bigint; srcRef: Hex; settled: boolean }> {
    const [d, settled] = await Promise.all([
      this.hub.readContract({ address: this.d.hub.disputeModule, abi: disputeModuleAbi, functionName: "disputes", args: [key] }) as Promise<any>,
      this.hub.readContract({ address: this.d.hub.disputeModule, abi: disputeModuleAbi, functionName: "settled", args: [key] }) as Promise<boolean>,
    ]);
    return { opener: d[0], maker: d[1], openedAt: d[2], status: Number(d[3]), bond: d[4], srcRef: d[5], settled };
  }

  // ---------------------------------------------------------------- quotes

  /** Ask Maker nodes for quotes and keep the ones the hub agrees with; best net first. */
  async quote(args: { srcChainId: number; dstChainId: number; token: "USDC" | "NATIVE"; amount: bigint; makerUrls: string[] }): Promise<MakerQuote[]> {
    const src = chainById(args.srcChainId);
    const srcToken = args.token === "USDC" ? src.usdc.address : zeroAddress;
    const qs = await Promise.all(
      args.makerUrls.map(async (u) => {
        try {
          const url = `${u.replace(/\/$/, "")}/quote?src=${args.srcChainId}&dst=${args.dstChainId}&token=${srcToken}&amount=${args.amount}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) return null;
          return (await r.json()) as MakerQuote;
        } catch {
          return null;
        }
      }),
    );
    const valid: MakerQuote[] = [];
    for (const q of qs) {
      if (!q) continue;
      // never trust the Maker's arithmetic: the hub classifies the exact gross
      const c = await this.classify(q.maker, args.srcChainId, srcToken, BigInt(q.gross), BigInt(Math.floor(Date.now() / 1000)));
      if (c.kind === 1 && c.expected === BigInt(q.net)) valid.push(q);
      else valid.push({ ...q, quotable: false, reason: q.reason ?? "hub classification disagrees" });
    }
    return valid.sort((a, b) => Number(b.quotable) - Number(a.quotable) || (BigInt(b.net) > BigInt(a.net) ? 1 : -1));
  }
}

/** The exact amount to send: principal rounded to 10^4 base units plus the destination code. */
export function buildGross(amount: bigint, dstChainId: number): { gross: bigint; code: number } {
  const code = chainById(dstChainId).identCode;
  return { gross: encodeGross(amount, code), code };
}

export function describeGross(gross: bigint): { code: number; principal: bigint } {
  return splitCode(gross);
}

export { CHAINS, CHAIN_LIST };
