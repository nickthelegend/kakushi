// Generates 1000 fee-math vectors, evaluates each in TypeScript AND by executing the Noir
// circuit (fee_math), asserts they agree, and writes packages/contracts/fixtures/fee_vectors.json
// for test/FeeMathParity.t.sol (which asserts FeeMath.sol agrees too).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { net, splitCode } from "../src/fees.ts";

const circuit = JSON.parse(await readFile(new URL("../circuits/fee_math.json", import.meta.url), "utf8")) as CompiledCircuit;
const noir = new Noir(circuit);

// deterministic xorshift PRNG
let s = 0x9e3779b97f4a7c15n;
const rnd = (bits: number): bigint => {
  s ^= (s << 13n) & 0xffffffffffffffffn;
  s ^= s >> 7n;
  s ^= (s << 17n) & 0xffffffffffffffffn;
  let out = 0n;
  for (let i = 0; i < Math.ceil(bits / 64); i++) {
    s ^= (s << 13n) & 0xffffffffffffffffn;
    s ^= s >> 7n;
    s ^= (s << 17n) & 0xffffffffffffffffn;
    out = (out << 64n) | s;
  }
  return out & ((1n << BigInt(bits)) - 1n);
};

const N = 1000;
const cols = { gross: [] as string[], withholding: [] as string[], bps: [] as string[], code: [] as string[], principal: [] as string[], net: [] as string[] };
for (let i = 0; i < N; i++) {
  // mix of 6-dp and 18-dp magnitudes plus edge cases
  const bits = [24, 40, 64, 90][i % 4]!;
  let gross = rnd(bits);
  let withholding = rnd(bits - 4);
  const bps = rnd(16) % 1001n;
  if (i % 50 === 0) withholding = gross; // principal <= withholding edge
  if (i % 77 === 0) gross = (gross / 10_000n) * 10_000n; // code 0000
  const { code, principal } = splitCode(gross);
  const tsNet = net(principal, withholding, bps);
  const { returnValue } = await noir.execute({ gross: gross.toString(), withholding: withholding.toString(), bps: bps.toString() });
  const [nc, np, nn] = (returnValue as string[]).map((x) => BigInt(x));
  if (nc !== BigInt(code) || np !== principal || nn !== tsNet) {
    throw new Error(`mismatch at ${i}: gross=${gross} w=${withholding} bps=${bps} ts=(${code},${principal},${tsNet}) noir=(${nc},${np},${nn})`);
  }
  cols.gross.push(gross.toString());
  cols.withholding.push(withholding.toString());
  cols.bps.push(bps.toString());
  cols.code.push(String(code));
  cols.principal.push(principal.toString());
  cols.net.push(tsNet.toString());
}
const dir = new URL("../../contracts/fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("fee_vectors.json", dir), JSON.stringify(cols));
console.log(`${N} vectors: TypeScript == Noir; wrote packages/contracts/fixtures/fee_vectors.json`);
