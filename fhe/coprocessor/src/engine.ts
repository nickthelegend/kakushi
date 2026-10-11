// HTTP client for kakushi-fhe-engine (native tfhe-rs). Localhost only.
export class Engine {
  readonly url: string;
  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
  }
  private async post(path: string, body: unknown): Promise<any> {
    const r = await fetch(`${this.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`engine ${path}: ${j.error ?? r.status}`);
    return j;
  }
  health(): Promise<{ ok: boolean; tfhe: string; threads: number }> {
    return fetch(`${this.url}/health`).then((r) => r.json());
  }
  async publicKey(): Promise<Uint8Array> {
    return new Uint8Array(await (await fetch(`${this.url}/public-key`)).arrayBuffer());
  }
  async has(handle: string): Promise<boolean> {
    return (await (await fetch(`${this.url}/has/${handle}`)).json()).has;
  }
  input(handle: string, type: number, listB64: string, index = 0) {
    return this.post("/input", { handle, type, list: listB64, index });
  }
  op(op: number, result: string, lhs: string, rhs: string | null, scalar: string | null) {
    return this.post("/op", { op, result, lhs, rhs, scalar });
  }
  select(result: string, control: string, ifTrue: string, ifFalse: string) {
    return this.post("/select", { result, control, if_true: ifTrue, if_false: ifFalse });
  }
  trivial(result: string, value: bigint, type: number) {
    return this.post("/trivial", { result, value: value.toString(), type });
  }
  alias(result: string, source: string) {
    return this.post("/alias", { result, source });
  }
  rand(result: string, seed: string, upperBound: bigint, type: number) {
    return this.post("/rand", { result, seed, upper_bound: upperBound.toString(), type });
  }
  async decrypt(handle: string): Promise<bigint> {
    return BigInt((await this.post("/decrypt", { handle })).value);
  }
}
