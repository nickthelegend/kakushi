// Bundle each command (with @fhish/sdk inlined) into dist/commands, embedding the deployments found
// in contracts/deployments. node-tfhe (loads its .wasm from disk), viem and the mm host stay external.
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const deps = fileURLToPath(new URL("../../contracts/deployments/", import.meta.url));
const read = (f) => (existsSync(deps + f) ? JSON.parse(readFileSync(deps + f, "utf8")) : undefined);
const deployments = {};
for (const n of ["testnet", "local"]) {
  const core = read(`${n}.json`);
  if (core) deployments[n] = { core: { oracle: core.oracle, chainId: core.chainId }, apps: read(`${n}-apps.json`) ?? {} };
}

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const entryPoints = walk("src/commands").filter((f) => f.endsWith(".ts"));
rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints,
  outdir: "dist/commands",
  outbase: "src/commands",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@metamask/agent-wallet", "@metamask/agent-wallet/*", "node-tfhe", "viem", "viem/*"],
  define: { __FHISH_DEPLOYMENTS__: JSON.stringify(deployments) },
  logLevel: "warning",
});
console.log(`built ${entryPoints.length} commands; embedded deployments: ${Object.keys(deployments).join(", ") || "none"}`);
for (const f of entryPoints) console.log("  ", relative("src/commands", f));
