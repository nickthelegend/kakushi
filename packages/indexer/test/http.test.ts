import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { Store } from '../src/store.ts';
import { createHandler } from '../src/http.ts';
import { IndexerClient, IndexerHttpError } from '../src/client.ts';
import { referralMessage } from '../src/referral.ts';
import { BASE, MONAD, SEPOLIA, add, addr, bridge, usdc, usdcOf } from './fixtures.ts';

// Anvil development key: test-only.
const REFEREE = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const REFERRER = addr(0xfeed);
const SENDER = addr(0x51);
const NOW = 2_000_000;

let server: Server; let base: string; let store: Store; let client: IndexerClient;
beforeAll(async () => {
  store = new Store(':memory:');
  add(store, ...bridge({ ref: 'h1', sender: SENDER, chainId: SEPOLIA, gross: usdc(120, 9001), at: NOW - 60 }), ...bridge({ ref: 'h2', sender: addr(0x52), chainId: MONAD, gross: usdc(3, 9002), at: NOW - 90_000 }));
  server = createServer(createHandler(store, { health: () => ({ network: 'local' }), chainIds: () => [MONAD, SEPOLIA, BASE], corsOrigin: 'http://app.test', now: () => NOW * 1000 }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = new IndexerClient(base);
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });

const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as Record<string, unknown>, headers: r.headers }; };
const post = async (path: string, body: string) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); return { status: r.status, body: await r.json() as Record<string, unknown> }; };

describe('engagement HTTP routes', () => {
  it('GET /points returns the score shape; 400 without a valid address', async () => {
    const r = await get(`/points?address=${SENDER.toUpperCase().replace('0X', '0x')}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://app.test');
    // 10 base + 12 volume + first-bridge 50 + to-monad 25 + volume-100 100
    expect(r.body).toEqual({ address: SENDER, points: 197, rank: 1, transfers: 1, referralPoints: 0, breakdown: [
      { key: 'transfers', label: 'Completed transfers', points: 10 }, { key: 'volume', label: 'Volume bonus', points: 12 },
      { key: 'quest:first-bridge', label: 'Make your first bridge', points: 50 }, { key: 'quest:to-monad', label: 'Bridge to Monad', points: 25 },
      { key: 'quest:volume-100', label: 'Bridge 100 USDC', points: 100 }, { key: 'referral', label: 'Referral share', points: 0 }] });
    expect((await get('/points?address=0x123')).status).toBe(400);
    expect((await get('/points')).status).toBe(400);
    expect((await get(`/points?address=${addr(0x99)}`)).body).toMatchObject({ points: 0, rank: null, transfers: 0 });
  });
  it('GET /quests with and without address', async () => {
    const anon = await get('/quests');
    expect(anon.status).toBe(200);
    expect((anon.body.items as unknown[]).length).toBe(11);
    expect((anon.body.items as Record<string, unknown>[])[0]).toEqual({ id: 'first-bridge', title: 'Make your first bridge', description: 'Complete one bridge transfer.', points: 50, category: 'bridge', progress: null, completed: false });
    const mine = await get(`/quests?address=${SENDER}`);
    expect((mine.body.items as Record<string, unknown>[]).find(q => q.id === 'volume-100')).toMatchObject({ progress: { current: 100, target: 100 }, completed: true });
    expect((await get('/quests?address=bad')).status).toBe(400);
  });
  it('GET /leaderboard pages, caps limit and rejects malformed paging', async () => {
    expect(await get('/leaderboard')).toMatchObject({ status: 200, body: { total: 2, items: [{ rank: 1, address: SENDER, points: 197, transfers: 1 }, { rank: 2, address: addr(0x52), points: 10 + 50 + 25, transfers: 1 }] } });
    expect((await get('/leaderboard?limit=1&offset=1')).body).toEqual({ total: 2, items: [{ rank: 2, address: addr(0x52), points: 85, transfers: 1 }] });
    expect((await get('/leaderboard?limit=5000')).status).toBe(200);
    for (const q of ['limit=0', 'limit=abc', 'offset=-1', 'limit=1.5']) expect((await get(`/leaderboard?${q}`)).status).toBe(400);
  });
  it('GET /stats/chains and /stats/overview', async () => {
    const chains = await get('/stats/chains?hours=24');
    expect(chains.status).toBe(200);
    expect(chains.body).toEqual({ since: NOW - 86_400, hours: 24, items: [
      { chainId: SEPOLIA, transfers: 1, previous: 0, changePct: null, volumeByToken: { [`${SEPOLIA}:${usdcOf(SEPOLIA).toLowerCase()}`]: usdc(120, 9001).toString() } },
      { chainId: MONAD, transfers: 0, previous: 1, changePct: -100, volumeByToken: {} },
      { chainId: BASE, transfers: 0, previous: 0, changePct: null, volumeByToken: {} }] });
    expect((await get('/stats/chains')).body.hours).toBe(24);
    for (const q of ['hours=0', 'hours=x', 'hours=9000']) expect((await get(`/stats/chains?${q}`)).status).toBe(400);
    expect((await get('/stats/overview')).body).toEqual({ transfers24h: 1, transfersAll: 2, users: 2, filled: 2, medianLatencyMs: 2000, volumeByToken: {
      [`${SEPOLIA}:${usdcOf(SEPOLIA).toLowerCase()}`]: usdc(120, 9001).toString(), [`${MONAD}:${usdcOf(MONAD).toLowerCase()}`]: usdc(3, 9002).toString() } });
  });
  it('POST /referral binds with a valid signature; status codes for rejections; GET /referral view', async () => {
    const signature = await REFEREE.signMessage({ message: referralMessage(REFERRER, REFEREE.address) });
    expect(await post('/referral', '{bad json')).toMatchObject({ status: 400 });
    expect(await post('/referral', JSON.stringify({ referee: REFEREE.address, referrer: REFEREE.address, signature }))).toMatchObject({ status: 400, body: { code: 'self-referral' } });
    expect(await post('/referral', JSON.stringify({ referee: REFEREE.address, referrer: addr(1), signature }))).toMatchObject({ status: 401, body: { code: 'bad-signature' } });
    expect(await post('/referral', 'x'.repeat(5000))).toMatchObject({ status: 413 });
    expect(await post('/referral', JSON.stringify({ referee: REFEREE.address, referrer: REFERRER, signature }))).toEqual({ status: 200, body: { ok: true } });
    expect(await post('/referral', JSON.stringify({ referee: REFEREE.address, referrer: addr(2), signature: await REFEREE.signMessage({ message: referralMessage(addr(2), REFEREE.address) }) }))).toMatchObject({ status: 409, body: { code: 'already-referred' } });
    expect((await get(`/referral?address=${REFEREE.address}`)).body).toEqual({ address: REFEREE.address.toLowerCase(), referrer: REFERRER, referees: 0, activeReferees: 0, points: 0 });
    expect((await get(`/referral?address=${REFERRER}`)).body).toEqual({ address: REFERRER, referrer: null, referees: 1, activeReferees: 0, points: 0 });
    expect((await get('/referral')).status).toBe(400);
  });
  it('CORS preflight allows POST + content-type only on /referral; other routes stay GET-only', async () => {
    const pre = await fetch(`${base}/referral`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(pre.headers.get('access-control-allow-headers')).toBe('content-type');
    expect((await fetch(`${base}/points`, { method: 'OPTIONS' })).headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect((await post('/points', '{}')).status).toBe(405);
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/health')).body).toEqual({ network: 'local' });
  });
  it('typed client methods hit the same routes', async () => {
    expect((await client.points(SENDER)).points).toBe(197);
    expect((await client.quests()).items).toHaveLength(11);
    expect((await client.leaderboard({ limit: 1 })).items).toHaveLength(1);
    expect((await client.chainStats(24)).hours).toBe(24);
    expect((await client.overview()).transfersAll).toBe(2);
    expect((await client.referral(REFERRER)).referees).toBe(1);
    const err = await client.bindReferral({ referee: REFEREE.address, referrer: REFEREE.address, signature: '0x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndexerHttpError);
    expect(err).toMatchObject({ status: 400, code: 'invalid-input' });
  });
});
