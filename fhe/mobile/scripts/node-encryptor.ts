// Runs the app's tfhe encryptor page (src/fhe/encryptorHtml.generated.ts) in a Node vm context and
// wires it to the app's own WebEncryptor bridge: the exact <script> the WebView/iframe runs.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { WebEncryptor } from "../src/fhe/bridge.ts";

export async function nodeEncryptor(): Promise<WebEncryptor> {
  const gen = readFileSync(new URL("../src/fhe/encryptorHtml.generated.ts", import.meta.url), "utf8");
  const html: string = JSON.parse(gen.slice(gen.indexOf("ENCRYPTOR_HTML: string = ") + 25, gen.lastIndexOf(";")));
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const enc = new WebEncryptor();
  const sandbox: any = { atob, btoa, TextDecoder, TextEncoder, Response, Blob, DecompressionStream, WebAssembly, BigInt, Date, JSON, Uint8Array, String, Number, Promise, Error, Object, Array, Function, crypto: globalThis.crypto };
  sandbox.globalThis = sandbox;
  sandbox.__fhishOut = (s: string) => enc.receive(s);
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  enc.attach((json) => sandbox.__fhish.handle(json));
  await enc.whenReady();
  return enc;
}
