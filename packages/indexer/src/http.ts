import type { IncomingMessage, ServerResponse } from 'node:http';
import { Store, json } from './store.ts';
import { buildLedger, leaderboard, pointsView, questStates, referralView } from './points.ts';
import { chainStats, overview } from './stats.ts';
import { ADDRESS_RE, bindReferral } from './referral.ts';

export interface HttpOptions {
  /** body of GET /health */
  health: () => unknown;
  /** indexed chain ids (deployment records); each appears in /stats/chains even with no traffic */
  chainIds: () => number[];
  /** single allowed CORS origin (INDEXER_CORS_ORIGIN) */
  corsOrigin?: string;
  /** wall clock in ms (injectable for tests) */
  now?: () => number;
}

const MAX_BODY_BYTES = 4096;
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Strict non-negative integer query parameter; absent -> fallback, malformed -> 400. */
function intParam(url: URL, name: string, fallback: number, min: number, max: number, clamp: boolean): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, `${name} must be a non-negative integer`);
  const value = Number(raw);
  if (value < min || (!clamp && value > max)) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
  return Math.min(value, max);
}

function addressParam(url: URL, required: boolean): string | undefined {
  const raw = url.searchParams.get('address');
  if (raw === null || raw === '') { if (required) throw new HttpError(400, 'address is required'); return undefined; }
  if (!ADDRESS_RE.test(raw)) throw new HttpError(400, 'address must be a 0x-prefixed 20-byte hex address');
  return raw.toLowerCase();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Body must be JSON'); }
}

const snapshot = (store: Store) => buildLedger({ transfers: store.transfers(), events: store.events(), referrals: store.referrals() });

export function createHandler(store: Store, options: HttpOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const now = options.now ?? Date.now;
  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (options.corsOrigin) res.setHeader('Access-Control-Allow-Origin', options.corsOrigin);
    const methods = url.pathname === '/referral' ? ['GET', 'POST'] : ['GET'];
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      if (options.corsOrigin) {
        res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
        res.setHeader('Access-Control-Allow-Headers', 'content-type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.end();
      return;
    }
    if (!methods.includes(req.method ?? '')) { res.statusCode = 405; res.setHeader('Allow', methods.join(', ')); res.end(json({ error: `${methods.join(' or ')} required` })); return; }
    // Existing endpoints keep their lenient paging; the engagement endpoints validate strictly.
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
    let data: unknown;
    switch (url.pathname) {
      case '/health': data = options.health(); break;
      case '/transfers': {
        const maker = url.searchParams.get('maker')?.toLowerCase();
        const sender = url.searchParams.get('sender')?.toLowerCase();
        const transfers = store.transfers().filter(t => (!maker || String((t.source ?? t.payout)?.args.maker).toLowerCase() === maker) && (!sender || String(t.source?.args.sender).toLowerCase() === sender));
        data = { total: transfers.length, items: transfers.slice(offset, offset + limit) }; break;
      }
      case '/makers': data = { items: store.makers() }; break;
      case '/routes': data = { items: store.routes() }; break;
      case '/attestations': data = { items: store.attestations() }; break;
      case '/events': data = { items: store.events().slice(offset, offset + limit) }; break;
      case '/points': { const address = addressParam(url, true)!; data = pointsView(snapshot(store), address); break; }
      case '/quests': { const address = addressParam(url, false); data = { items: questStates(snapshot(store), address) }; break; }
      case '/leaderboard': {
        const l = intParam(url, 'limit', 50, 1, 200, true);
        const o = intParam(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER, false);
        const ranked = leaderboard(snapshot(store));
        data = { total: ranked.length, items: ranked.slice(o, o + l) }; break;
      }
      case '/stats/chains': {
        const hours = intParam(url, 'hours', 24, 1, 8760, false);
        data = chainStats(store.transfers(), options.chainIds(), Math.floor(now() / 1000), hours); break;
      }
      case '/stats/overview': data = overview(store.transfers(), Math.floor(now() / 1000)); break;
      case '/referral': {
        if (req.method === 'POST') {
          const result = await bindReferral(store, await readJson(req), now());
          res.statusCode = result.status; data = result.body; break;
        }
        data = referralView(snapshot(store), addressParam(url, true)!); break;
      }
      default: res.statusCode = 404; data = { error: 'Unknown endpoint' };
    }
    res.end(json(data));
  };
  return (req, res) => {
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('Indexer HTTP handler failed:', error);
      if (res.headersSent) { res.end(); return; }
      res.statusCode = status;
      res.end(json({ error: error instanceof HttpError ? error.message : 'Internal error' }));
    });
  };
}
