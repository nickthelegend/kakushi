// Monad testnet reserve-balance rule: a transaction that sends MON *value* reverts if it leaves the
// sender below min(10 MON, its starting balance), unless the sender is an undelegated EOA using the
// "emptying" exception, which is available once per 3 blocks. Gas is not value. The watchtower holds
// ~1.5 MON and posts 0.05 MON dispute bonds, possibly for several disputes back to back, so:
//   - every transaction from the watchtower account goes through one queue (this also keeps nonces
//     in order when several disputes are driven at once);
//   - a value-carrying transaction waits until at least `blocks` blocks and `ms` milliseconds have
//     passed since this account's previous transaction.
export interface SpacingOptions {
  /** blocks between this account's previous tx and a value send (Monad: 3; 0 disables the gap) */
  blocks: bigint;
  /** wall-clock floor for the same gap (Monad blocks are ~0.4 s: 3 blocks ~ 1.2 s) */
  ms: number;
  blockNumber: () => Promise<bigint>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

export class TxSpacer {
  private queue: Promise<unknown> = Promise.resolve();
  private last: { block: bigint; at: number } | null = null;
  private readonly o: SpacingOptions;
  constructor(o: SpacingOptions) {
    this.o = o;
  }

  /** Run `send` (which returns the mined block) after every earlier send; value sends keep the gap. */
  run<T extends { blockNumber: bigint }>(value: bigint, send: () => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      if (value > 0n && this.last && this.o.blocks > 0n) await this.waitGap(this.last);
      const r = await send();
      this.last = { block: r.blockNumber, at: (this.o.now ?? Date.now)() };
      return r;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async waitGap(last: { block: bigint; at: number }) {
    const now = this.o.now ?? Date.now;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (;;) {
      const head = await this.o.blockNumber();
      const waitMs = last.at + this.o.ms - now();
      if (head >= last.block + this.o.blocks && waitMs <= 0) return;
      await sleep(Math.max(waitMs, this.o.pollMs ?? 200));
    }
  }
}
