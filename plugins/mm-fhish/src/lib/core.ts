// Confidential trading on Monad, independent of the wallet host. The mm commands adapt the
// MetaMask Agent Wallet executor to `Port`; tests adapt a local key. Every value a user types
// (limit price, bid, amount) is encrypted on this machine with tfhe before anything is sent.
import { decodeEventLog, encodeFunctionData, type Hex, parseAbi, type PublicClient } from "viem";
import { FhishClient } from "@fhish/sdk";
import { nodeTfheEncryptor } from "@fhish/sdk/node";
import { auctionAbi, cusdcAbi, otcAbi } from "@fhish/sdk/apps";

export interface Port {
  address: Hex;
  chainId: number;
  client: PublicClient;
  /** Submit a transaction through the wallet; resolves with the hash once mined. */
  send(tx: { to: Hex; data: Hex; gasLimit: bigint }, summary: string): Promise<Hex>;
  signTypedData(typedData: ReturnType<typeof FhishClient.userDecryptTypedData>): Promise<Hex>;
}

export interface FhishEnv {
  network: string;
  gatewayUrl: string;
  oracle: Hex;
  apps: { auction?: Hex; cusdc?: Hex; otc?: Hex; usdc?: Hex };
}

const requestedAbi = parseAbi(["event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)"]);
const oracleAbi = parseAbi(["function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)"]);

export class Fhish {
  readonly fhe: FhishClient;
  readonly port: Port;
  readonly env: FhishEnv;
  constructor(port: Port, env: FhishEnv) {
    this.port = port;
    this.env = env;
    this.fhe = new FhishClient({ gatewayUrl: env.gatewayUrl, chainId: port.chainId, encryptor: nodeTfheEncryptor() });
  }

  private app(name: keyof FhishEnv["apps"]): Hex {
    const a = this.env.apps[name];
    if (!a) throw new Error(`no ${name} deployment configured for ${this.env.network} (set FHISH_APPS)`);
    return a;
  }

  /** Monad bills the gas LIMIT: estimate + 30%, explicit. */
  private async tx(to: Hex, abi: readonly unknown[], functionName: string, args: readonly unknown[], summary: string) {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const est = await this.port.client.estimateGas({ account: this.port.address, to, data });
    const hash = await this.port.send({ to, data, gasLimit: (est * 13n) / 10n }, summary);
    const rc = await this.port.client.waitForTransactionReceipt({ hash, pollingInterval: 250 });
    if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return rc;
  }

  private async waitForReveal(requestId: bigint, timeoutMs = 120_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const r = await this.port.client.readContract({ address: this.env.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] });
      if (r[2]) return;
      await new Promise((x) => setTimeout(x, 300));
    }
    throw new Error(`reveal ${requestId} not delivered within ${timeoutMs / 1000} s`);
  }

  async status() {
    const [health, block] = await Promise.all([
      fetch(`${this.env.gatewayUrl.replace(/\/$/, "")}/health`).then((r) => r.json() as Promise<{ ok: boolean; engine?: { tfhe?: string } }>).catch(() => null),
      this.port.client.getBlockNumber(),
    ]);
    return { network: this.env.network, chainId: this.port.chainId, account: this.port.address, block: block.toString(), gateway: this.env.gatewayUrl, gatewayOk: Boolean(health?.ok), tfhe: health?.engine?.tfhe ?? null, apps: this.env.apps };
  }

  async otcOrders() {
    const otc = this.app("otc");
    const n = (await this.port.client.readContract({ address: otc, abi: otcAbi, functionName: "orderCount" })) as bigint;
    const out: { id: number; maker: Hex; pair: string; size: string; open: boolean }[] = [];
    for (let i = 0n; i < n; i++) {
      const [maker, pair, size, open] = (await this.port.client.readContract({ address: otc, abi: otcAbi, functionName: "orderInfo", args: [i] })) as [Hex, string, bigint, boolean];
      out.push({ id: Number(i), maker, pair, size: size.toString(), open });
    }
    return out;
  }

  /** Post an order whose minimum price is encrypted: nobody, including the venue, can read it. */
  async otcPost(pair: string, size: bigint, minPrice: bigint) {
    const otc = this.app("otc");
    const enc = await this.fhe.encrypt("euint64", minPrice, otc, this.port.address);
    const rc = await this.tx(otc, otcAbi, "post", [pair, size, enc.handle, enc.proof], `Fhish: post ${size} ${pair} with a hidden minimum price`);
    const n = (await this.port.client.readContract({ address: otc, abi: otcAbi, functionName: "orderCount" })) as bigint;
    return { orderId: Number(n - 1n), tx: rc.transactionHash, encryptedMs: enc.ms.encrypt, handle: enc.handle };
  }

  /** Take an order with an encrypted maximum price. A miss reveals nothing; a cross reveals only the maker's price. */
  async otcTake(orderId: bigint, maxPrice: bigint) {
    const otc = this.app("otc");
    const enc = await this.fhe.encrypt("euint64", maxPrice, otc, this.port.address);
    const t0 = Date.now();
    const rc = await this.tx(otc, otcAbi, "take", [orderId, enc.handle, enc.proof], `Fhish: take order #${orderId} with a hidden maximum price`);
    const requestId = this.requestIdOf(rc.logs);
    await this.waitForReveal(requestId);
    const t = (await this.port.client.readContract({ address: otc, abi: otcAbi, functionName: "takes", args: [requestId] })) as [bigint, Hex, boolean, boolean, bigint];
    return { orderId: Number(orderId), crossed: t[3], price: t[3] ? t[4].toString() : null, revealMs: Date.now() - t0, tx: rc.transactionHash };
  }

  async auctionBid(amount: bigint) {
    const auction = this.app("auction");
    const enc = await this.fhe.encrypt("euint64", amount, auction, this.port.address);
    const rc = await this.tx(auction, auctionAbi, "bid", [enc.handle, enc.proof], "Fhish: place a sealed bid");
    return { tx: rc.transactionHash, handle: enc.handle, encryptedMs: enc.ms.encrypt };
  }

  /** Confidential transfer: the amount and both balances stay encrypted. */
  async cusdcSend(to: Hex, amount: bigint) {
    const cusdc = this.app("cusdc");
    const enc = await this.fhe.encrypt("euint64", amount, cusdc, this.port.address);
    const rc = await this.tx(cusdc, cusdcAbi, "confidentialTransfer", [to, enc.handle, enc.proof], "Fhish: confidential cUSDC transfer");
    return { tx: rc.transactionHash, to };
  }

  /** Reveal your own cUSDC balance to you alone (EIP-712 signature, result sealed to this process). */
  async cusdcBalance() {
    const cusdc = this.app("cusdc");
    const h = (await this.port.client.readContract({ address: cusdc, abi: cusdcAbi, functionName: "confidentialBalanceOf", args: [this.port.address] })) as Hex;
    if (/^0x0+$/.test(h)) return { handle: h, balance: "0", decimals: 6 };
    const out = await this.fhe.userDecryptWith([h], cusdc, this.port.address, (td) => this.port.signTypedData(td));
    return { handle: h, balance: (out[h.toLowerCase()] ?? 0n).toString(), decimals: 6 };
  }

  private requestIdOf(logs: readonly { address: Hex; data: Hex; topics: readonly Hex[] }[]): bigint {
    for (const l of logs) {
      if (l.address.toLowerCase() !== this.env.oracle.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: requestedAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        return ev.args.requestId;
      } catch {}
    }
    throw new Error("no DecryptionRequested in the receipt");
  }
}
