// Builds the on-device FHE encryptor that runs inside a hidden WebView (Hermes has no WebAssembly).
//
// Input:  node-tfhe 1.8.1 (Zama's single-threaded wasm-bindgen build; same tfhe-rs version as the
//         Fhish engine, so ciphertext lists are compatible). Unlike the browser `tfhe` package it does
//         not need SharedArrayBuffer / cross-origin isolation, which a WebView cannot guarantee.
// Output: src/fhe/encryptorHtml.generated.ts, exporting ENCRYPTOR_HTML: one self-contained HTML page
//         with the tfhe JS (gzip+base64) and the tfhe wasm (gzip+base64) inlined (~1.9 MB).
//         It needs no network and no file access, so the same string works in a native WebView
//         (source={{ html }}), in an <iframe srcDoc> on Expo web, and in Node (scripts/verify-fork.ts
//         runs the exact same <script> in a vm context).
//
// The only edit to Zama's JS: the trailing synchronous `fs.readFileSync` + `new WebAssembly.Module`
// is replaced by an async `__init(bytes)` (large synchronous wasm compiles are refused on the main
// thread by some engines).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));
const pkgDir = dirname(require.resolve("node-tfhe/package.json"));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
if (version !== "1.8.1") throw new Error(`node-tfhe ${version}: the Fhish network runs tfhe-rs 1.8.1`);

let js = readFileSync(join(pkgDir, "tfhe.js"), "utf8");
const tail = /const wasmPath = `\$\{__dirname\}\/tfhe_bg\.wasm`;\s*const wasmBytes = require\('fs'\)\.readFileSync\(wasmPath\);\s*const wasmModule = new WebAssembly\.Module\(wasmBytes\);\s*let wasm = new WebAssembly\.Instance\(wasmModule, __wbg_get_imports\(\)\)\.exports;\s*wasm\.__wbindgen_start\(\);\s*$/;
if (!tail.test(js)) throw new Error("node-tfhe tail changed; update build-tfhe-webview.mjs");
js = js.replace(
  tail,
  "let wasm;\nexports.__init = async function (bytes) {\n  const r = await WebAssembly.instantiate(bytes, __wbg_get_imports());\n  wasm = r.instance.exports;\n  wasm.__wbindgen_start();\n};\n",
);
const wasm = readFileSync(join(pkgDir, "tfhe_bg.wasm"));
const jsB64 = gzipSync(Buffer.from(js), { level: 9 }).toString("base64");
const wasmB64 = gzipSync(wasm, { level: 9 }).toString("base64");

// The page script. Protocol (JSON strings both ways):
//   in : {id, op:"setKey", key:<b64 CompactPublicKey>} | {id, op:"encrypt", type:0|3|4, value:"<decimal>"} | {id, op:"ping"}
//   out: {id, ok:true, data?:<b64>, ms?} | {id, ok:false, error} | {ready:true, ms} (once, after wasm init)
// Input arrives through window.__fhish.handle(msg) (native: injectJavaScript) or a window "message"
// event (web iframe). Output goes to window.ReactNativeWebView.postMessage or parent.postMessage.
const script = String.raw`
(function () {
  var JS_GZ = "${jsB64}";
  var WASM_GZ = "${wasmB64}";
  var LIMIT = BigInt(1) << BigInt(31);
  function out(o) {
    var s = JSON.stringify(o);
    if (typeof window !== "undefined" && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (typeof window !== "undefined" && window.parent && window.parent !== window) window.parent.postMessage(s, "*");
    else if (typeof globalThis.__fhishOut === "function") globalThis.__fhishOut(s);
  }
  function b64ToBytes(b) { var s = atob(b); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function bytesToB64(u) { var s = ""; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  async function gunzip(u) {
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable (needs iOS 16.4+ / Chrome 80+)");
    var ds = new DecompressionStream("gzip");
    var buf = await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  var t0 = Date.now();
  var tfhe = null, pk = null, pkB64 = null;
  var ready = (async function () {
    var src = new TextDecoder().decode(await gunzip(b64ToBytes(JS_GZ)));
    var module = { exports: {} };
    new Function("module", "exports", "require", "__dirname", src)(module, module.exports, function () { throw new Error("require unavailable"); }, "");
    await module.exports.__init(await gunzip(b64ToBytes(WASM_GZ)));
    tfhe = module.exports;
    return tfhe;
  })();
  ready.then(function () { out({ ready: true, ms: Date.now() - t0 }); }, function (e) { out({ ready: false, error: String(e && e.message || e) }); });
  async function handle(raw) {
    var m = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!m || m.id === undefined) return;
    try {
      await ready;
      if (m.op === "ping") return out({ id: m.id, ok: true });
      if (m.op === "setKey") {
        if (m.key !== pkB64) { pk = tfhe.TfheCompactPublicKey.safe_deserialize(b64ToBytes(m.key), LIMIT); pkB64 = m.key; }
        return out({ id: m.id, ok: true });
      }
      if (m.op === "encrypt") {
        if (!pk) throw new Error("no network public key (setKey first)");
        var t = Date.now();
        var b = tfhe.CompactCiphertextList.builder(pk);
        if (m.type === 0) b.push_boolean(m.value === "1" || m.value === "true");
        else if (m.type === 3) b.push_u32(Number(m.value));
        else b.push_u64(BigInt(m.value));
        var bytes = b.build().safe_serialize(LIMIT);
        return out({ id: m.id, ok: true, data: bytesToB64(bytes), ms: Date.now() - t });
      }
      throw new Error("unknown op " + m.op);
    } catch (e) {
      out({ id: m.id, ok: false, error: String(e && e.message || e) });
    }
  }
  globalThis.__fhish = { handle: handle, ready: ready };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("message", function (ev) { if (typeof ev.data === "string" && ev.data.indexOf('"op"') > 0) handle(ev.data); });
  }
})();
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>fhish encryptor</title></head><body><script>${script}</script></body></html>`;

const outDir = join(root, "src", "fhe");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "encryptorHtml.generated.ts"),
  `// GENERATED by scripts/build-tfhe-webview.mjs from node-tfhe ${version}. Do not edit.\n` +
    `export const TFHE_VERSION = "${version}";\nexport const ENCRYPTOR_HTML: string = ${JSON.stringify(html)};\n`,
);
console.log(`tfhe webview encryptor: node-tfhe ${version}, ${(html.length / 1e6).toFixed(2)} MB -> src/fhe/encryptorHtml.generated.ts`);
