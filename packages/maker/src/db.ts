// Maker state in SQLite (node:sqlite). srcRef is UNIQUE: one source payment is handled
// (filled / refunded / ignored) at most once, across restarts.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PaymentStatus = "seen" | "filled" | "refunded" | "ignored" | "missed" | "failed" | "paused";

export interface PaymentRow {
  srcRef: string;
  srcChainId: number;
  txHash: string;
  logIndex: number;
  sender: string;
  token: string;
  gross: string;
  recipient: string;
  blockNumber: string;
  timestamp: number;
  via: string;
  kind: string;
  expected: string;
  obligationChainId: number;
  status: PaymentStatus;
  payoutTx: string | null;
  executedMs: number | null;
  seenAt: number;
  note: string | null;
}

export class MakerDb {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS payments (
        srcRef TEXT PRIMARY KEY,
        srcChainId INTEGER NOT NULL, txHash TEXT NOT NULL, logIndex INTEGER NOT NULL,
        sender TEXT NOT NULL, token TEXT NOT NULL, gross TEXT NOT NULL, recipient TEXT NOT NULL,
        blockNumber TEXT NOT NULL, timestamp INTEGER NOT NULL, via TEXT NOT NULL,
        kind TEXT NOT NULL, expected TEXT NOT NULL, obligationChainId INTEGER NOT NULL,
        status TEXT NOT NULL, payoutTx TEXT, executedMs INTEGER, seenAt INTEGER NOT NULL, note TEXT
      );
      CREATE TABLE IF NOT EXISTS cursors (chainId INTEGER PRIMARY KEY, nextBlock TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS disputes (key TEXT PRIMARY KEY, srcRef TEXT NOT NULL, status TEXT NOT NULL, tx TEXT, note TEXT, at INTEGER NOT NULL);
    `);
  }

  /** Insert if new. Returns false when this srcRef was already recorded (idempotency). */
  insert(p: Omit<PaymentRow, "status" | "payoutTx" | "executedMs" | "note">): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO payments (srcRef, srcChainId, txHash, logIndex, sender, token, gross, recipient, blockNumber, timestamp, via, kind, expected, obligationChainId, status, seenAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seen', ?)`,
      )
      .run(p.srcRef, p.srcChainId, p.txHash, p.logIndex, p.sender, p.token, p.gross, p.recipient, p.blockNumber, p.timestamp, p.via, p.kind, p.expected, p.obligationChainId, p.seenAt);
    return Number(r.changes) === 1;
  }

  /** Atomically claim a payment for payout: only one worker can move it from seen/paused. */
  claim(srcRef: string): boolean {
    const r = this.db.prepare(`UPDATE payments SET status = 'failed', note = 'in flight' WHERE srcRef = ? AND status IN ('seen', 'paused')`).run(srcRef);
    return Number(r.changes) === 1;
  }

  setStatus(srcRef: string, status: PaymentStatus, extra: { payoutTx?: string; executedMs?: number; note?: string } = {}): void {
    this.db
      .prepare(`UPDATE payments SET status = ?, payoutTx = COALESCE(?, payoutTx), executedMs = COALESCE(?, executedMs), note = ? WHERE srcRef = ?`)
      .run(status, extra.payoutTx ?? null, extra.executedMs ?? null, extra.note ?? null, srcRef);
  }

  get(srcRef: string): PaymentRow | undefined {
    return this.db.prepare(`SELECT * FROM payments WHERE srcRef = ?`).get(srcRef) as PaymentRow | undefined;
  }

  list(limit = 100): PaymentRow[] {
    return this.db.prepare(`SELECT * FROM payments ORDER BY seenAt DESC LIMIT ?`).all(limit) as unknown as PaymentRow[];
  }

  inFlight(): PaymentRow[] {
    return this.db.prepare(`SELECT * FROM payments WHERE status = 'failed' AND note = 'in flight'`).all() as unknown as PaymentRow[];
  }

  pending(): PaymentRow[] {
    return this.db.prepare(`SELECT * FROM payments WHERE status IN ('seen', 'paused')`).all() as unknown as PaymentRow[];
  }

  cursor(chainId: number): bigint | undefined {
    const r = this.db.prepare(`SELECT nextBlock FROM cursors WHERE chainId = ?`).get(chainId) as { nextBlock: string } | undefined;
    return r ? BigInt(r.nextBlock) : undefined;
  }

  setCursor(chainId: number, next: bigint): void {
    this.db.prepare(`INSERT INTO cursors (chainId, nextBlock) VALUES (?, ?) ON CONFLICT(chainId) DO UPDATE SET nextBlock = excluded.nextBlock`).run(chainId, next.toString());
  }

  recordDispute(key: string, srcRef: string, status: string, tx?: string, note?: string): void {
    this.db
      .prepare(`INSERT INTO disputes (key, srcRef, status, tx, note, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, tx = excluded.tx, note = excluded.note, at = excluded.at`)
      .run(key, srcRef, status, tx ?? null, note ?? null, Date.now());
  }

  dispute(key: string): { status: string } | undefined {
    return this.db.prepare(`SELECT status FROM disputes WHERE key = ?`).get(key) as { status: string } | undefined;
  }

  disputes(): unknown[] {
    return this.db.prepare(`SELECT * FROM disputes ORDER BY at DESC LIMIT 100`).all();
  }

  stats(): Record<string, number> {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS n FROM payments GROUP BY status`).all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}
