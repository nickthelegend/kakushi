// The relayer: validate, simulate with eth_call, then submit KakushiPool.withdraw (or, for a
// request with `call`, KakushiPool.withdrawAndCall) from its own key.
import { type Hex, type PublicClient, type Transport, type WalletClient, createPublicClient, createWalletClient, http } from "viem";
import type { LocalAccount } from "viem/accounts";
import { chainById, currentNetwork, rpcUrl, type Network } from "@kakushi/config";
import { errText, viemChain } from "@kakushi/sdk";
import type { PoolConfig } from "./config.ts";
import { kakushiPoolAbi } from "./pool-abi.ts";
import { RelayError, type RelayRequest, validateRelayRequest } from "./validate.ts";

export interface RelayerOptions {
  account: LocalAccount;
  pools: PoolConfig[];
  network?: Network;
  /** transport per chain; defaults to http(rpc) */
  transport?: (chainId: number, rpc: string) => Transport;
  log?: (msg: string) => void;
}

export interface RelayerInfo {
  address: Hex;
  /** chainId -> pool -> minimum fee (base units, decimal string) */
  feeByPool: Record<string, Record<string, string>>;
  chains: number[];
}

interface ChainClients {
  public: PublicClient;
  wallet: WalletClient;
}

export class Relayer {
  readonly account: LocalAccount;
  readonly pools: readonly PoolConfig[];
  private clients = new Map<number, ChainClients>();
  /** one submission at a time per chain, so nonces never collide */
  private queues = new Map<number, Promise<unknown>>();
  /** nullifierHashes with a submission in progress */
  private inFlight = new Set<string>();
  private log: (m: string) => void;

  constructor(opts: RelayerOptions) {
    this.account = opts.account;
    this.pools = opts.pools;
    this.log = opts.log ?? ((m) => console.log(`[relayer] ${m}`));
    const network = opts.network ?? currentNetwork();
    for (const chainId of new Set(opts.pools.map((p) => p.chainId))) {
      const override = opts.pools.find((p) => p.chainId === chainId && p.rpc)?.rpc;
      const rpc = override ?? rpcUrl(chainById(chainId), network);
      let chain;
      try {
        chain = viemChain(chainById(chainId), network, rpc);
      } catch {
        throw new Error(`chain ${chainId} is not in @kakushi/config`);
      }
      const transport = opts.transport ? opts.transport(chainId, rpc) : http(rpc, { retryCount: 2, retryDelay: 250 });
      this.clients.set(chainId, {
        public: createPublicClient({ chain, transport }) as PublicClient,
        wallet: createWalletClient({ account: this.account, chain, transport }),
      });
    }
  }

  get address(): Hex {
    return this.account.address;
  }

  info(): RelayerInfo {
    const feeByPool: RelayerInfo["feeByPool"] = {};
    for (const p of this.pools) (feeByPool[String(p.chainId)] ??= {})[p.pool] = p.minFee.toString();
    return { address: this.address, feeByPool, chains: [...this.clients.keys()] };
  }

  validate(body: unknown): RelayRequest {
    return validateRelayRequest(body, { relayer: this.address, pools: this.pools });
  }

  /** Validate, simulate, submit. Resolves with the transaction hash once the node accepted it. */
  async relay(body: unknown): Promise<{ txHash: Hex }> {
    const req = this.validate(body);
    const key = `${req.chainId}:${req.args.nullifierHash}`;
    if (this.inFlight.has(key)) throw new RelayError(409, "a withdrawal for this nullifierHash is already being relayed");
    this.inFlight.add(key);
    try {
      return await this.enqueue(req.chainId, () => this.submit(req));
    } finally {
      this.inFlight.delete(key);
    }
  }

  private enqueue<T>(chainId: number, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(chainId) ?? Promise.resolve();
    const next = prev.then(job, job);
    this.queues.set(chainId, next.catch(() => undefined));
    return next;
  }

  private async submit(req: RelayRequest): Promise<{ txHash: Hex }> {
    const c = this.clients.get(req.chainId)!;
    const a = req.args;
    const fn = req.call ? "withdrawAndCall" : "withdraw";
    let send: () => Promise<Hex>;
    try {
      if (req.call) {
        const { request } = await c.public.simulateContract({
          account: this.account,
          address: req.pool.pool,
          abi: kakushiPoolAbi,
          functionName: "withdrawAndCall",
          args: [req.proof, a.root, a.nullifierHash, a.relayer, a.fee, req.call.target, req.call.data, req.call.refundTo],
        });
        send = () => c.wallet.writeContract(request);
      } else {
        const { request } = await c.public.simulateContract({
          account: this.account,
          address: req.pool.pool,
          abi: kakushiPoolAbi,
          functionName: "withdraw",
          args: [req.proof, a.root, a.nullifierHash, a.recipient, a.relayer, a.fee, a.refund],
          value: a.refund,
        });
        send = () => c.wallet.writeContract(request);
      }
    } catch (e) {
      throw new RelayError(422, `${fn} would revert: ${oneLine(e)}`);
    }
    let txHash: Hex;
    try {
      txHash = await send();
    } catch (e) {
      throw new RelayError(502, `submission failed: ${oneLine(e)}`);
    }
    this.log(`chain ${req.chainId} pool ${req.pool.pool} ${fn} nullifierHash ${a.nullifierHash} fee ${a.fee}${req.call ? ` target ${req.call.target}` : ""} -> ${txHash}`);
    return { txHash };
  }
}

const oneLine = (e: unknown): string => errText(e).replace(/\s+/g, " ").trim();
