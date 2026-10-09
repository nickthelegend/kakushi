// Shared fixtures for the engagement tests: decoded events shaped exactly like the scanner
// persists them (SDK SourcePayment fields, PayoutRouter/DisputeModule/EBC event args).
import { CHAINS } from '@kakushi/config';
import { Store, type ObservedEvent } from '../src/store.ts';

export const MONAD = CHAINS.monadTestnet.chainId;
export const SEPOLIA = CHAINS.sepolia.chainId;
export const BASE = CHAINS.baseSepolia.chainId;
export const ARB = CHAINS.arbitrumSepolia.chainId;
export const NATIVE = '0x0000000000000000000000000000000000000000';
export const usdcOf = (chainId: number): string => Object.values(CHAINS).find(c => c.chainId === chainId)!.usdc.address;
export const addr = (n: number): string => `0x${n.toString(16).padStart(40, '0')}`;
export const MAKER = '0x00000000000000000000000000000000000000Aa';

let seq = 0;
/** One event in its own block, so `Store.commit` accepts it alone. */
export function ev(name: string, chainId: number, timestamp: number, args: Record<string, unknown>): ObservedEvent {
  seq++;
  return { chainId, blockNumber: seq, blockHash: `0xblock${seq}`, timestamp, txHash: `0xtx${seq}`, logIndex: 0, name, args };
}

export interface BridgeSpec { ref: string; sender: string; chainId: number; gross: bigint; token?: string; recipient?: string; at: number; outcome?: 'fill' | 'refund' | 'pending'; maker?: string; fillDelay?: number }

/** A source payment plus its payout (fill kind 2 / refund kind 3), as observed on two chains. */
export function bridge(s: BridgeSpec): ObservedEvent[] {
  const maker = s.maker ?? MAKER;
  const token = s.token ?? usdcOf(s.chainId);
  const source = ev('SourcePayment', s.chainId, s.at, { srcChainId: s.chainId, txHash: `0xsrc${s.ref}`, logIndex: 0, sender: s.sender, maker, token, gross: s.gross.toString(), recipient: s.recipient ?? s.sender, blockNumber: '1', timestamp: String(s.at), via: 'raw-erc20', srcRef: s.ref });
  if ((s.outcome ?? 'fill') === 'pending') return [source];
  const payout = ev('Payout', MONAD, s.at + (s.fillDelay ?? 2), { srcRef: s.ref, maker, recipient: s.recipient ?? s.sender, token: usdcOf(MONAD), amount: (s.gross / 2n).toString(), kind: s.outcome === 'refund' ? 3 : 2 });
  return [source, payout];
}

export function add(store: Store, ...events: ObservedEvent[]): void {
  for (const e of events) store.commit(e.chainId, e.blockNumber, e.blockHash, [e]);
}

export const usdc = (whole: number, code: number): bigint => BigInt(whole) * 1_000_000n + BigInt(code);
export const eth = (milli: number, code: number): bigint => BigInt(milli) * 10n ** 15n + BigInt(code);
