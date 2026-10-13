// The relayer: validate, simulate with eth_call, then submit KakushiPool.withdraw (or, for a
// request with `call`, KakushiPool.withdrawAndCall) from its own key.
import { type Hex, type PublicClient, type Transport, type WalletClient, createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, zeroAddress } from "viem";
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
  /** pool -> whether it holds the chain's native coin (then the fee must cover the gas) */
  private nativePool = new Map<string, Promise<boolean>>();
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

  /**
   * The fee to ask for each pool right now: the configured minimum, and for native-coin pools at
   * least the gas a withdrawal costs at the current gas price. A token pool whose gas is over its
   * maxGasWei, or a pool whose chain cannot be read, is left out rather than quoted too low.
   */
  async quote(): Promise<RelayerInfo> {
    const info = this.info();
    await Promise.all(
      this.pools.map(async (p) => {
        const byChain = info.feeByPool[String(p.chainId)]!;
        try {
          const gasPrice = await this.clients.get(p.chainId)!.public.getGasPrice();
          const cost = (QUOTE_GAS * gasPrice * 110n) / 100n;
          if (await this.isNative(p.chainId, p.pool)) {
            if (cost > p.minFee) byChain[p.pool] = cost.toString();
          } else if (p.maxGasWei === undefined || cost > p.maxGasWei) delete byChain[p.pool];
        } catch {
          delete byChain[p.pool];
        }
      }),
    );
    return info;
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
    const args = req.call
      ? ([req.proof, a.root, a.nullifierHash, a.relayer, a.fee, req.call.target, req.call.data, req.call.refundTo] as const)
      : ([req.proof, a.root, a.nullifierHash, a.recipient, a.relayer, a.fee, a.refund] as const);
    const value = req.call ? 0n : a.refund;
    let gas: bigint;
    let gasPrice: bigint;
    try {
      await c.public.simulateContract({ account: this.account, address: req.pool.pool, abi: kakushiPoolAbi, functionName: fn, args: args as never, value } as never);
      const data = encodeFunctionData({ abi: kakushiPoolAbi, functionName: fn, args: args as never });
      // Monad bills the gas limit, not the gas used: keep it to the estimate plus 15%
      [gas, gasPrice] = await Promise.all([c.public.estimateGas({ account: this.account, to: req.pool.pool, data, value }).then((g) => (g * 115n) / 100n), c.public.getGasPrice()]);
    } catch (e) {
      throw new RelayError(422, `${fn} would revert: ${oneLine(e)}`);
    }
    // The relayer must not pay more gas than it is paid, or anyone could drain it with withdrawals.
    // A native fee is compared with the gas directly; a token fee has no price here, so the operator
    // caps the gas per relay for that pool (maxGasWei) or it is not relayed at all.
    const cost = gas * gasPrice;
    if (await this.isNative(req.chainId, req.pool.pool)) {
      if (a.fee < cost) throw new RelayError(402, `fee ${a.fee} is below the gas cost of about ${cost} wei on chain ${req.chainId}; withdraw from your own wallet, or raise the fee`);
    } else if (req.pool.maxGasWei === undefined || cost > req.pool.maxGasWei) {
      throw new RelayError(402, `this relayer does not pay ${cost} wei of gas for a withdrawal from pool ${req.pool.pool}; withdraw from your own wallet`);
    }
    let txHash: Hex;
    try {
      txHash = await c.wallet.writeContract({ account: this.account, chain: c.wallet.chain, address: req.pool.pool, abi: kakushiPoolAbi, functionName: fn, args: args as never, value, gas } as never);
    } catch (e) {
      throw new RelayError(502, `submission failed: ${oneLine(e)}`);
    }
    this.log(`chain ${req.chainId} pool ${req.pool.pool} ${fn} nullifierHash ${a.nullifierHash} fee ${a.fee}${req.call ? ` target ${req.call.target}` : ""} -> ${txHash}`);
    return { txHash };
  }

  private isNative(chainId: number, pool: Hex): Promise<boolean> {
    const key = `${chainId}:${pool}`;
    let p = this.nativePool.get(key);
    if (!p) {
      p = this.clients
        .get(chainId)!
        .public.readContract({ address: pool, abi: tokenAbi, functionName: "token" })
        .then((t) => t === zeroAddress);
      p.catch(() => this.nativePool.delete(key)); // retry on the next request after an RPC failure
      this.nativePool.set(key, p);
    }
    return p.catch((e) => {
      throw new RelayError(502, `could not read the pool's token: ${oneLine(e)}`);
    });
  }
}

/** gas limit quoted for one withdrawal: an UltraHonk verify is ~6.2M gas on Monad, withdrawAndCall a little more, plus the 15% margin */
const QUOTE_GAS = 8_000_000n;
const tokenAbi = parseAbi(["function token() view returns (address)"]);
const oneLine = (e: unknown): string => errText(e).replace(/\s+/g, " ").trim();
