// Latency metrics we publish (Zama and Fhenix publish none for request -> plaintext on-chain).
export class Metrics {
  private series = new Map<string, number[]>();
  counts = new Map<string, number>();
  add(name: string, ms: number) {
    const s = this.series.get(name) ?? [];
    s.push(ms);
    if (s.length > 500) s.shift();
    this.series.set(name, s);
  }
  inc(name: string, n = 1) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + n);
  }
  snapshot() {
    const out: Record<string, { n: number; p50: number; p95: number }> = {};
    for (const [k, v] of this.series) {
      const s = [...v].sort((a, b) => a - b);
      out[k] = { n: s.length, p50: s[Math.floor(s.length * 0.5)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0 };
    }
    return { latencyMs: out, counts: Object.fromEntries(this.counts) };
  }
}
