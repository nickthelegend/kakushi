// Message bridge to the tfhe encryptor page (src/fhe/encryptorHtml.generated.ts).
// The host (WebView on native, iframe on web, a vm context in scripts/verify-fork.ts) calls
// `attach(send)` and forwards every message from the page to `receive`.
import { fromB64, toB64 } from "../lib/bytes.ts";
import type { Encryptor } from "../lib/fhe.ts";

type Pending = { resolve: (m: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class WebEncryptor implements Encryptor {
  private send: ((json: string) => void) | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private keyFor: Uint8Array | null = null;
  private readyWaiters: ((ok: boolean) => void)[] = [];
  ready = false;
  readyMs: number | null = null;
  error: string | null = null;
  lastEncryptMs: number | null = null;

  attach(send: (json: string) => void) {
    this.send = send;
  }

  /** The page reloaded (e.g. WebView content process restarted): forget per-page state. */
  reset() {
    this.ready = false;
    this.keyFor = null;
    for (const [, p] of this.pending) p.reject(new Error("encryptor restarted"));
    this.pending.clear();
  }

  receive(json: string) {
    let m: any;
    try {
      m = JSON.parse(json);
    } catch {
      return;
    }
    if ("ready" in m) {
      this.ready = !!m.ready;
      this.readyMs = m.ms ?? null;
      this.error = m.ready ? null : m.error;
      for (const w of this.readyWaiters.splice(0)) w(this.ready);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m);
    else p.reject(new Error(`encryptor: ${m.error}`));
  }

  whenReady(timeoutMs = 20_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.error) return Promise.reject(new Error(`encryptor: ${this.error}`));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("encryptor did not start (WebView)")), timeoutMs);
      this.readyWaiters.push((ok) => {
        clearTimeout(t);
        ok ? resolve() : reject(new Error(`encryptor: ${this.error}`));
      });
    });
  }

  private call(msg: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    if (!this.send) return Promise.reject(new Error("encryptor not mounted"));
    const id = ++this.seq;
    const send = this.send;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`encryptor: ${String(msg.op)} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      send(JSON.stringify({ id, ...msg }));
    });
  }

  async encrypt(publicKey: Uint8Array, type: number, value: bigint | boolean): Promise<Uint8Array> {
    await this.whenReady();
    if (this.keyFor !== publicKey) {
      await this.call({ op: "setKey", key: toB64(publicKey) });
      this.keyFor = publicKey;
    }
    const r = await this.call({ op: "encrypt", type, value: typeof value === "boolean" ? (value ? "1" : "0") : value.toString() });
    this.lastEncryptMs = r.ms ?? null;
    return fromB64(r.data);
  }
}

/** One encryptor per app; the host component mounts the page and wires it. */
export const encryptor = new WebEncryptor();
