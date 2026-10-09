import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { buildLedger, classifyAsset, destinationChainId, isCompleted, leaderboard, pointsView, questStates, referralView, scoreOf, volumeBonus } from '../src/points.ts';
import { chainStats, changePct, overview } from '../src/stats.ts';
import { bindReferral, referralMessage, verifyReferralSignature } from '../src/referral.ts';
import { ARB, BASE, MAKER, MONAD, NATIVE, SEPOLIA, add, addr, bridge, eth, ev, usdc, usdcOf } from './fixtures.ts';

const ledgerOf = (s: Store) => buildLedger({ transfers: s.transfers(), events: s.events(), referrals: s.referrals() });
const quest = (s: Store, address: string, id: string) => questStates(ledgerOf(s), address).find(q => q.id === id)!;

// Anvil's well-known development keys: test-only, never funded on a public network.
const REFEREE = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const OTHER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const REFERRER = addr(0xbeef);

describe('points math', () => {
  it('USDC: 1 point per full 10 USDC, capped at 100', () => {
    expect(volumeBonus('usdc', 9_999_999n, 6)).toBe(0);
    expect(volumeBonus('usdc', usdc(10, 9001), 6)).toBe(1);
    expect(volumeBonus('usdc', usdc(29, 9001), 6)).toBe(2);
    expect(volumeBonus('usdc', usdc(1000, 9001), 6)).toBe(100);
    expect(volumeBonus('usdc', usdc(50_000, 9001), 6)).toBe(100);
  });
  it('native ETH: 1 point per full 0.005 ETH, capped at 100; other assets get no bonus', () => {
    expect(volumeBonus('eth', 4_999_999_999_999_999n, 18)).toBe(0);
    expect(volumeBonus('eth', eth(5, 9003), 18)).toBe(1);
    expect(volumeBonus('eth', eth(100, 9003), 18)).toBe(20);
    expect(volumeBonus('eth', eth(5000, 9003), 18)).toBe(100);
    expect(volumeBonus('other', eth(5000, 9003), 18)).toBe(0);
  });
  it('classifies configured USDC and spoke-native ETH; Monad native MON is not ETH', () => {
    expect(classifyAsset(SEPOLIA, usdcOf(SEPOLIA).toLowerCase())).toBe('usdc');
    expect(classifyAsset(BASE, NATIVE)).toBe('eth');
    expect(classifyAsset(MONAD, NATIVE)).toBe('other');
    expect(classifyAsset(SEPOLIA, addr(5))).toBe('other');
    expect(classifyAsset(1, NATIVE)).toBe('other');
  });
  it('decodes the destination from the ident code, including the compliant lane', () => {
    expect(destinationChainId(usdc(5, 9001))).toBe(MONAD);
    expect(destinationChainId(usdc(5, 9002))).toBe(SEPOLIA);
    expect(destinationChainId(usdc(5, 9004))).toBe(ARB);
    expect(destinationChainId(usdc(5, 9101))).toBe(MONAD);
    expect(destinationChainId(usdc(5, 1234))).toBeNull();
  });
  it('per-transfer points: 10 base + volume bonus; USDC and ETH lanes sum', () => {
    const s = new Store(':memory:'); const a = addr(1);
    add(s, ...bridge({ ref: 'r1', sender: a, chainId: SEPOLIA, gross: usdc(25, 9001), at: 100 }), ...bridge({ ref: 'r2', sender: a, chainId: BASE, token: NATIVE, gross: eth(12, 9002), at: 110 }));
    const score = scoreOf(ledgerOf(s), a);
    expect(score.breakdown.find(b => b.key === 'transfers')?.points).toBe(20);
    expect(score.breakdown.find(b => b.key === 'volume')?.points).toBe(2 + 2);
    expect(score.points).toBe(score.breakdown.reduce((x, b) => x + b.points, 0));
    s.close();
  });
});

describe('completed transfers', () => {
  it('counts fills and won disputes; not refunds, pending, open disputes or payout-only', () => {
    const s = new Store(':memory:'); const a = addr(2);
    add(s,
      ...bridge({ ref: 'fill', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 100 }),
      ...bridge({ ref: 'refund', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 101, outcome: 'refund' }),
      ...bridge({ ref: 'pending', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 102, outcome: 'pending' }),
      ...bridge({ ref: 'open', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 103 }),
      ev('DisputeOpened', MONAD, 120, { disputeKey: 'k-open', srcRef: 'open', maker: MAKER, opener: a }),
      ...bridge({ ref: 'slashed', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 104, outcome: 'pending' }),
      ev('DisputeOpened', MONAD, 121, { disputeKey: 'k-slash', srcRef: 'slashed', maker: MAKER, opener: a }),
      ev('DisputeSlashed', MONAD, 122, { disputeKey: 'k-slash', maker: MAKER, sender: a }),
      ...bridge({ ref: 'proven', sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 105 }),
      ev('DisputeOpened', MONAD, 123, { disputeKey: 'k-proven', srcRef: 'proven', maker: MAKER, opener: addr(99) }),
      ev('DisputeMakerProven', MONAD, 124, { disputeKey: 'k-proven', maker: MAKER }),
      ev('Payout', MONAD, 125, { srcRef: 'orphan', maker: MAKER, recipient: a, token: usdcOf(MONAD), amount: '1', kind: 2 }));
    const byRef = Object.fromEntries(s.transfers().map(t => [t.srcRef, isCompleted(t)]));
    expect(byRef).toEqual({ fill: true, refund: false, pending: false, open: false, slashed: true, proven: true, orphan: false });
    expect(pointsView(ledgerOf(s), a).transfers).toBe(3);
    s.close();
  });
});

describe('quests', () => {
  it('bridge/explore/social quests progress from completed transfers', () => {
    const s = new Store(':memory:'); const a = addr(3); const friend = addr(4);
    const q = (id: string) => quest(s, a, id);
    expect(q('first-bridge')).toMatchObject({ progress: { current: 0, target: 1 }, completed: false });
    add(s, ...bridge({ ref: 'refunded', sender: a, chainId: MONAD, gross: usdc(500, 9002), at: 90, outcome: 'refund', recipient: friend }));
    expect(q('from-monad').completed).toBe(false);
    add(s, ...bridge({ ref: 'a1', sender: a, chainId: SEPOLIA, gross: usdc(60, 9001), at: 100 }));
    expect(q('first-bridge')).toMatchObject({ progress: { current: 1, target: 1 }, completed: true });
    expect(q('to-monad').completed).toBe(true);
    expect(q('from-monad').completed).toBe(false);
    expect(q('three-chains').progress).toEqual({ current: 2, target: 3 });
    expect(q('volume-100').progress).toEqual({ current: 60, target: 100 });
    expect(q('custom-recipient').completed).toBe(false);
    add(s, ...bridge({ ref: 'a2', sender: a, chainId: MONAD, gross: usdc(40, 9002), at: 110, recipient: friend }));
    expect(q('from-monad').completed).toBe(true);
    expect(q('custom-recipient').completed).toBe(true);
    expect(q('volume-100')).toMatchObject({ progress: { current: 100, target: 100 }, completed: true });
    expect(q('three-chains').completed).toBe(false);
    expect(q('eth-lane').completed).toBe(false);
    add(s, ...bridge({ ref: 'a3', sender: a, chainId: BASE, token: NATIVE, gross: eth(10, 9002), at: 120 }));
    expect(q('eth-lane').completed).toBe(true);
    expect(q('three-chains')).toMatchObject({ progress: { current: 3, target: 3 }, completed: true });
    expect(q('ten-transfers')).toMatchObject({ progress: { current: 3, target: 10 }, completed: false });
    for (let i = 0; i < 7; i++) add(s, ...bridge({ ref: `more${i}`, sender: a, chainId: SEPOLIA, gross: usdc(1, 9001), at: 200 + i }));
    expect(q('ten-transfers')).toMatchObject({ progress: { current: 10, target: 10 }, completed: true });
    expect(q('first-bridge').progress).toEqual({ current: 1, target: 1 });
    const points = pointsView(ledgerOf(s), a);
    // 10 transfers * 10 + volume (6 + 4 + 2 + 0*7) + quests (50+25+25+75+25+100+100+25)
    expect(points.points).toBe(100 + 12 + 425);
    expect(points.breakdown.filter(b => b.key.startsWith('quest:')).map(b => b.key)).toEqual(['quest:first-bridge', 'quest:to-monad', 'quest:from-monad', 'quest:three-chains', 'quest:eth-lane', 'quest:ten-transfers', 'quest:volume-100', 'quest:custom-recipient']);
    s.close();
  });
  it('compliant-lane ident 9101 counts as bridging to Monad', () => {
    const s = new Store(':memory:'); const a = addr(5);
    add(s, ...bridge({ ref: 'c', sender: a, chainId: SEPOLIA, gross: usdc(5, 9101), at: 100 }));
    expect(quest(s, a, 'to-monad').completed).toBe(true); s.close();
  });
  it('win-dispute goes to the opener of a slashed dispute only', () => {
    const s = new Store(':memory:'); const opener = addr(6); const sender = addr(7); const loser = addr(8);
    add(s, ...bridge({ ref: 'd1', sender, chainId: SEPOLIA, gross: usdc(5, 9001), at: 100, outcome: 'pending' }),
      ev('DisputeOpened', MONAD, 110, { disputeKey: 'k1', srcRef: 'd1', maker: MAKER, opener }),
      ev('DisputeSlashed', MONAD, 111, { disputeKey: 'k1', maker: MAKER, sender }),
      ...bridge({ ref: 'd2', sender, chainId: SEPOLIA, gross: usdc(5, 9001), at: 101 }),
      ev('DisputeOpened', MONAD, 112, { disputeKey: 'k2', srcRef: 'd2', maker: MAKER, opener: loser }),
      ev('DisputeMakerProven', MONAD, 113, { disputeKey: 'k2', maker: MAKER }));
    expect(quest(s, opener, 'win-dispute')).toMatchObject({ completed: true, progress: { current: 1, target: 1 } });
    expect(pointsView(ledgerOf(s), opener)).toMatchObject({ points: 150, transfers: 0 });
    expect(quest(s, loser, 'win-dispute').completed).toBe(false);
    expect(quest(s, sender, 'win-dispute').completed).toBe(false);
    expect(pointsView(ledgerOf(s), sender).transfers).toBe(2);
    s.close();
  });
  it('maker-fill needs a PairRegistered maker with a fill', () => {
    const s = new Store(':memory:'); const unregistered = addr(9);
    add(s, ...bridge({ ref: 'm1', sender: addr(10), chainId: SEPOLIA, gross: usdc(5, 9001), at: 100 }), ...bridge({ ref: 'm2', sender: addr(10), chainId: SEPOLIA, gross: usdc(5, 9001), at: 101, maker: unregistered }));
    expect(quest(s, MAKER, 'maker-fill').completed).toBe(false);
    add(s, ev('PairRegistered', MONAD, 90, { pairId: 'p', maker: MAKER, srcChainId: SEPOLIA, srcToken: usdcOf(SEPOLIA), dstChainId: MONAD, dstToken: usdcOf(MONAD), identCode: 9001 }));
    expect(quest(s, MAKER.toLowerCase(), 'maker-fill')).toMatchObject({ completed: true, progress: { current: 1, target: 1 } });
    expect(quest(s, unregistered, 'maker-fill')).toMatchObject({ completed: false, progress: { current: 0, target: 1 } });
    s.close();
  });
  it('quests without an address list definitions with null progress', () => {
    const s = new Store(':memory:');
    const items = questStates(ledgerOf(s));
    expect(items.map(q => [q.id, q.points, q.category])).toEqual([['first-bridge', 50, 'bridge'], ['to-monad', 25, 'bridge'], ['from-monad', 25, 'bridge'], ['three-chains', 75, 'explore'], ['eth-lane', 25, 'explore'], ['ten-transfers', 100, 'bridge'], ['volume-100', 100, 'bridge'], ['custom-recipient', 25, 'social'], ['win-dispute', 150, 'safety'], ['maker-fill', 200, 'maker'], ['refer-friend', 50, 'social']]);
    expect(items.every(q => q.progress === null && !q.completed)).toBe(true);
    s.close();
  });
});

describe('referral', () => {
  const sign = (account = REFEREE, referrer = REFERRER, referee = account.address) => account.signMessage({ message: referralMessage(referrer, referee) });
  it('message is exact and lowercase; viem verifies the referee personal_sign', async () => {
    expect(referralMessage('0xAbC0000000000000000000000000000000000000', REFEREE.address)).toBe(`Kakushi referral\nReferrer: 0xabc0000000000000000000000000000000000000\nAccount: ${REFEREE.address.toLowerCase()}`);
    const signature = await sign();
    expect(await verifyReferralSignature(REFEREE.address, REFERRER, signature)).toBe(true);
    expect(await verifyReferralSignature(OTHER.address, REFERRER, signature)).toBe(false);
    expect(await verifyReferralSignature(REFEREE.address, addr(1), signature)).toBe(false);
    expect(await verifyReferralSignature(REFEREE.address, REFERRER, '0x1234')).toBe(false);
  });
  it('binds once, rejects self-referral, bad signatures, rebinding, cycles and active users', async () => {
    const s = new Store(':memory:');
    expect(await bindReferral(s, { referee: REFEREE.address, referrer: REFEREE.address, signature: await sign(REFEREE, REFEREE.address) })).toMatchObject({ status: 400, body: { code: 'self-referral' } });
    expect(await bindReferral(s, { referee: REFEREE.address, referrer: REFERRER, signature: await sign(OTHER, REFERRER, REFEREE.address) })).toMatchObject({ status: 401, body: { code: 'bad-signature' } });
    expect(await bindReferral(s, { referee: 'nope', referrer: REFERRER, signature: '0x' })).toMatchObject({ status: 400, body: { code: 'invalid-input' } });
    expect(await bindReferral(s, null)).toMatchObject({ status: 400 });
    expect(await bindReferral(s, { referee: REFEREE.address, referrer: REFERRER, signature: await sign() }, 1000)).toEqual({ status: 200, body: { ok: true } });
    expect(s.referral(REFEREE.address)).toMatchObject({ referee: REFEREE.address.toLowerCase(), referrer: REFERRER, boundAt: 1000 });
    expect(await bindReferral(s, { referee: REFEREE.address, referrer: REFERRER, signature: await sign() })).toEqual({ status: 200, body: { ok: true } });
    expect(await bindReferral(s, { referee: REFEREE.address, referrer: addr(77), signature: await sign(REFEREE, addr(77)) })).toMatchObject({ status: 409, body: { code: 'already-referred' } });
    expect(s.referral(REFEREE.address)?.referrer).toBe(REFERRER);
    add(s, ...bridge({ ref: 'old', sender: OTHER.address, chainId: SEPOLIA, gross: usdc(5, 9001), at: 100 }));
    expect(await bindReferral(s, { referee: OTHER.address, referrer: REFERRER, signature: await sign(OTHER) })).toMatchObject({ status: 409, body: { code: 'not-new-user' } });
    expect(s.referral(OTHER.address)).toBeUndefined();
    s.close();
  });
  it('bindings persist across restart; replaying events leaves them untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kakushi-referral-')); const path = join(dir, 'db');
    let s = new Store(path);
    const events = bridge({ ref: 'r', sender: REFEREE.address, chainId: SEPOLIA, gross: usdc(50, 9001), at: 100 });
    expect((await bindReferral(s, { referee: REFEREE.address, referrer: REFERRER, signature: await sign() }, 5)).status).toBe(200);
    add(s, ...events); s.close();
    s = new Store(path); add(s, ...events);
    expect(s.referrals()).toEqual([{ referee: REFEREE.address.toLowerCase(), referrer: REFERRER, signature: await sign(), boundAt: 5 }]);
    expect(s.events()).toHaveLength(2);
    expect(referralView(ledgerOf(s), REFERRER)).toMatchObject({ referees: 1, activeReferees: 1, points: 1 });
    s.close(); rmSync(dir, { recursive: true });
  });
  it('rejects a direct cycle', async () => {
    const s = new Store(':memory:');
    expect((await bindReferral(s, { referee: REFEREE.address, referrer: OTHER.address, signature: await sign(REFEREE, OTHER.address) })).status).toBe(200);
    expect(await bindReferral(s, { referee: OTHER.address, referrer: REFEREE.address, signature: await sign(OTHER, REFEREE.address) })).toMatchObject({ status: 409, body: { code: 'referral-cycle' } });
    s.close();
  });
  it('a pending (not completed) payment does not block binding; referrer earns floor 10% of transfer points only', async () => {
    const s = new Store(':memory:');
    add(s, ...bridge({ ref: 'p', sender: REFEREE.address, chainId: SEPOLIA, gross: usdc(25, 9001), at: 100, outcome: 'pending' }));
    expect((await bindReferral(s, { referee: REFEREE.address, referrer: REFERRER, signature: await sign() })).status).toBe(200);
    expect(referralView(ledgerOf(s), REFERRER)).toEqual({ address: REFERRER, referrer: null, referees: 1, activeReferees: 0, points: 0 });
    expect(quest(s, REFERRER, 'refer-friend').completed).toBe(false);
    add(s, ev('Payout', MONAD, 105, { srcRef: 'p', maker: MAKER, recipient: REFEREE.address, token: usdcOf(MONAD), amount: '1', kind: 2 }));
    add(s, ...bridge({ ref: 'q', sender: REFEREE.address, chainId: SEPOLIA, gross: usdc(30, 9001), at: 110 }));
    // referee transfer points: (10 + 2) + (10 + 3) = 25 -> referrer floor(2.5) = 2; quest bonuses of the referee are excluded
    const ledger = ledgerOf(s);
    expect(referralView(ledger, REFERRER)).toEqual({ address: REFERRER, referrer: null, referees: 1, activeReferees: 1, points: 2 });
    expect(referralView(ledger, REFEREE.address)).toMatchObject({ referrer: REFERRER, referees: 0 });
    expect(pointsView(ledger, REFERRER)).toMatchObject({ referralPoints: 2, points: 2 + 50, transfers: 0 });
    expect(pointsView(ledger, REFERRER).breakdown).toContainEqual({ key: 'quest:refer-friend', label: 'Refer a friend', points: 50 });
    s.close();
  });
});

describe('rank', () => {
  it('orders by points, then earlier first completed transfer, then address; zero points unranked', () => {
    const s = new Store(':memory:');
    const [early, late, tieB, tieA] = [addr(0x20), addr(0x21), addr(0x23), addr(0x22)];
    add(s, ...bridge({ ref: 'l', sender: late, chainId: SEPOLIA, gross: usdc(5, 9001), at: 200 }), ...bridge({ ref: 'e', sender: early, chainId: SEPOLIA, gross: usdc(5, 9001), at: 100 }),
      ...bridge({ ref: 'tb', sender: tieB, chainId: SEPOLIA, gross: usdc(5, 9001), at: 300 }), ...bridge({ ref: 'ta', sender: tieA, chainId: SEPOLIA, gross: usdc(5, 9001), at: 300 }),
      ...bridge({ ref: 'big', sender: addr(0x30), chainId: SEPOLIA, gross: usdc(500, 9001), at: 400 }), ...bridge({ ref: 'none', sender: addr(0x31), chainId: SEPOLIA, gross: usdc(500, 9001), at: 50, outcome: 'refund' }));
    const ranked = leaderboard(ledgerOf(s));
    expect(ranked.map(r => [r.rank, r.address])).toEqual([[1, addr(0x30)], [2, early], [3, late], [4, tieA], [5, tieB]]);
    expect(ranked[1]).toEqual({ rank: 2, address: early, points: 10 + 50 + 25, transfers: 1 });
    expect(pointsView(ledgerOf(s), addr(0x31))).toMatchObject({ points: 0, rank: null, transfers: 0 });
    expect(pointsView(ledgerOf(s), late.toUpperCase().replace('0X', '0x')).rank).toBe(3);
    s.close();
  });
});

describe('chain stats', () => {
  it('counts source-side transfers in the window vs the previous equal window', () => {
    const s = new Store(':memory:'); const now = 1_000_000; const a = addr(0x40);
    add(s,
      ...bridge({ ref: 'c1', sender: a, chainId: SEPOLIA, gross: usdc(5, 9001), at: now - 100 }),
      ...bridge({ ref: 'c2', sender: a, chainId: SEPOLIA, gross: usdc(7, 9001), at: now - 3600, outcome: 'pending' }),
      ...bridge({ ref: 'c3', sender: a, chainId: SEPOLIA, token: NATIVE, gross: eth(1, 9003), at: now - 10 }),
      ...bridge({ ref: 'p1', sender: a, chainId: SEPOLIA, gross: usdc(5, 9001), at: now - 3601 }),
      ...bridge({ ref: 'p2', sender: a, chainId: MONAD, gross: usdc(5, 9002), at: now - 7200 }),
      ...bridge({ ref: 'x', sender: a, chainId: MONAD, gross: usdc(5, 9002), at: now - 7201 }),
      ...bridge({ ref: 'f', sender: a, chainId: BASE, gross: usdc(5, 9001), at: now + 10 }));
    const view = chainStats(s.transfers(), [MONAD, SEPOLIA, BASE, ARB], now, 1);
    expect(view).toMatchObject({ since: now - 3600, hours: 1 });
    expect(view.items).toEqual([
      { chainId: SEPOLIA, transfers: 3, previous: 1, changePct: 200, volumeByToken: { [`${SEPOLIA}:${usdcOf(SEPOLIA).toLowerCase()}`]: (usdc(5, 9001) + usdc(7, 9001)).toString(), [`${SEPOLIA}:${NATIVE}`]: eth(1, 9003).toString() } },
      { chainId: MONAD, transfers: 0, previous: 1, changePct: -100, volumeByToken: {} },
      { chainId: BASE, transfers: 0, previous: 0, changePct: null, volumeByToken: {} },
      { chainId: ARB, transfers: 0, previous: 0, changePct: null, volumeByToken: {} },
    ]);
    expect(changePct(3, 7)).toBe(-57.1);
    s.close();
  });
  it('overview: 24h and all-time sources, distinct senders, fills and lower-median latency', () => {
    const s = new Store(':memory:'); const now = 1_000_000;
    add(s, ...bridge({ ref: 'o1', sender: addr(1), chainId: SEPOLIA, gross: usdc(5, 9001), at: now - 100, fillDelay: 2 }),
      ...bridge({ ref: 'o2', sender: addr(1), chainId: SEPOLIA, gross: usdc(5, 9001), at: now - 90_000, fillDelay: 4 }),
      ...bridge({ ref: 'o3', sender: addr(2), chainId: MONAD, gross: usdc(5, 9002), at: now - 50, outcome: 'refund' }),
      ...bridge({ ref: 'o4', sender: addr(3), chainId: MONAD, gross: usdc(5, 9002), at: now - 40, outcome: 'pending' }),
      ev('Payout', MONAD, now, { srcRef: 'orphan', maker: MAKER, recipient: addr(9), token: usdcOf(MONAD), amount: '1', kind: 2 }));
    expect(overview(s.transfers(), now)).toEqual({ transfers24h: 3, transfersAll: 4, users: 3, filled: 2, medianLatencyMs: 2000,
      volumeByToken: { [`${SEPOLIA}:${usdcOf(SEPOLIA).toLowerCase()}`]: (2n * usdc(5, 9001)).toString(), [`${MONAD}:${usdcOf(MONAD).toLowerCase()}`]: (2n * usdc(5, 9002)).toString() } });
    expect(overview([], now)).toEqual({ transfers24h: 0, transfersAll: 0, users: 0, filled: 0, medianLatencyMs: null, volumeByToken: {} });
    s.close();
  });
});
