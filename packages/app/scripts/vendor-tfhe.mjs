// Copies Zama's tfhe 1.8.1 browser build (ESM glue, WASM, wasm-bindgen-rayon worker helper) into
// public/vendor/tfhe-<version>/ so the browser loads it as plain static ES modules. Bundling it is
// avoided on purpose: its thread pool self-spawns module workers that import the package back
// (a circular worker graph Turbopack stalls on), and served as-is it needs no bundler support.
// Runs as part of the dev and build scripts. Output is gitignored.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = dirname(createRequire(join(app, "package.json")).resolve("tfhe/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(app, "public", "vendor", `tfhe-${version}`);
if (existsSync(join(out, "tfhe_bg.wasm"))) process.exit(0);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["tfhe.js", "tfhe_bg.wasm", "snippets", "LICENSE"]) {
  if (existsSync(join(pkgDir, f))) cpSync(join(pkgDir, f), join(out, f), { recursive: true });
}
console.log(`vendored tfhe ${version} -> public/vendor/tfhe-${version}`);
