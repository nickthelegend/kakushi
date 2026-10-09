import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Relayer } from "./relayer.ts";
import { RelayError } from "./validate.ts";

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

/** Request bodies above this are rejected before parsing (a proof is ~16 KB of hex). */
export const MAX_BODY_BYTES = 128 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY_BYTES) {
        reject(new RelayError(413, `body larger than ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** POST /relay, GET /info, GET /health. */
export function relayerServer(relayer: Relayer): Server {
  return createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") return void res.end();
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (req.method === "GET" && url.pathname === "/health") return void res.end(json({ ok: true, address: relayer.address }));
      if (req.method === "GET" && url.pathname === "/info") return void res.end(json(relayer.info()));
      if (req.method === "POST" && url.pathname === "/relay") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof RelayError) throw e;
          throw new RelayError(400, "body must be JSON");
        }
        return void res.end(json(await relayer.relay(body)));
      }
      res.statusCode = 404;
      res.end(json({ error: "not found" }));
    } catch (e) {
      res.statusCode = e instanceof RelayError ? e.status : 500;
      res.end(json({ error: (e as Error).message.split("\n")[0] }));
    }
  });
}
