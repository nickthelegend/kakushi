import { createServer, type Server } from "node:http";
import type { Hex } from "viem";
import type { MakerEngine } from "./engine.ts";

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

/** GET /quote /health /payments /disputes; POST /admin/pause|resume (Bearer MAKER_ADMIN_TOKEN). */
export function makerServer(engine: MakerEngine, opts: { adminToken?: string; signerKind: string }): Server {
  return createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") return void res.end();
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return void res.end(json({ ok: true, name: engine.name, maker: engine.address, signer: opts.signerKind, paused: engine.paused, stats: engine.db.stats() }));
      }
      if (req.method === "GET" && url.pathname === "/quote") {
        const src = Number(url.searchParams.get("src"));
        const dst = Number(url.searchParams.get("dst"));
        const token = url.searchParams.get("token") as Hex | null;
        const amountStr = url.searchParams.get("amount") ?? "";
        if (!src || !dst || !token || !/^\d+$/.test(amountStr)) {
          res.statusCode = 400;
          return void res.end(json({ error: "usage: /quote?src=<chainId>&dst=<chainId>&token=<address>&amount=<base units>" }));
        }
        const q = await engine.quote({ src, dst, token, amount: BigInt(amountStr) });
        if ("error" in q) res.statusCode = 404;
        return void res.end(json(q));
      }
      if (req.method === "GET" && url.pathname === "/payments") return void res.end(json(engine.db.list(Number(url.searchParams.get("limit") ?? 100))));
      if (req.method === "GET" && url.pathname === "/disputes") return void res.end(json(engine.db.disputes()));
      if (req.method === "POST" && (url.pathname === "/admin/pause" || url.pathname === "/admin/resume")) {
        if (!opts.adminToken || req.headers.authorization !== `Bearer ${opts.adminToken}`) {
          res.statusCode = 401;
          return void res.end(json({ error: "admin token required" }));
        }
        engine.setPaused(url.pathname.endsWith("pause"));
        return void res.end(json({ paused: engine.paused }));
      }
      res.statusCode = 404;
      res.end(json({ error: "not found" }));
    } catch (e) {
      res.statusCode = 500;
      res.end(json({ error: (e as Error).message.split("\n")[0] }));
    }
  });
}
