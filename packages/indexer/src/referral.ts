// Referral binding: an EIP-191 personal_sign by the referee over a fixed message. The first valid
// binding for a referee wins and is immutable; only addresses without a completed transfer in the
// indexed data can be referred.

import { verifyMessage, type Hex } from 'viem';
import { isCompleted } from './points.ts';
import type { Store } from './store.ts';

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

/** Exactly the message the referee signs (both addresses lowercase). */
export function referralMessage(referrer: string, referee: string): string {
  return `Kakushi referral\nReferrer: ${referrer.toLowerCase()}\nAccount: ${referee.toLowerCase()}`;
}

/** EOA signature check through viem (no RPC). Malformed signatures verify as false. */
export async function verifyReferralSignature(referee: string, referrer: string, signature: string): Promise<boolean> {
  if (!ADDRESS_RE.test(referee) || !ADDRESS_RE.test(referrer) || !SIGNATURE_RE.test(signature)) return false;
  try {
    return await verifyMessage({ address: referee.toLowerCase() as Hex, message: referralMessage(referrer, referee), signature: signature as Hex });
  } catch {
    return false;
  }
}

export type ReferralErrorCode = 'invalid-input' | 'self-referral' | 'bad-signature' | 'already-referred' | 'referral-cycle' | 'not-new-user';

export type BindResult = { status: 200; body: { ok: true } } | { status: 400 | 401 | 409; body: { error: string; code: ReferralErrorCode } };

const fail = (status: 400 | 401 | 409, code: ReferralErrorCode, error: string): BindResult => ({ status, body: { error, code } });

/**
 * Validates and stores a binding. Status codes:
 * 400 invalid-input / self-referral, 401 bad-signature,
 * 409 already-referred (a different referrer is bound) / referral-cycle (the referrer is bound to this referee) / not-new-user (the referee already completed a transfer).
 * Re-posting the binding that is already stored returns 200 (idempotent retry).
 */
export async function bindReferral(store: Store, body: unknown, now = Date.now()): Promise<BindResult> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { referee, referrer, signature } = b;
  if (typeof referee !== 'string' || !ADDRESS_RE.test(referee) || typeof referrer !== 'string' || !ADDRESS_RE.test(referrer) || typeof signature !== 'string' || !SIGNATURE_RE.test(signature))
    return fail(400, 'invalid-input', 'Expected { referee, referrer, signature } with 0x addresses and a 65-byte hex signature');
  const ee = referee.toLowerCase(), er = referrer.toLowerCase();
  if (ee === er) return fail(400, 'self-referral', 'An address cannot refer itself');
  if (!(await verifyReferralSignature(ee, er, signature))) return fail(401, 'bad-signature', 'Signature does not match the referee for the referral message');
  // Everything below is synchronous, so no other request can interleave between check and insert.
  const existing = store.referral(ee);
  if (existing) return existing.referrer === er ? { status: 200, body: { ok: true } } : fail(409, 'already-referred', 'This account already has a referrer');
  if (store.referral(er)?.referrer === ee) return fail(409, 'referral-cycle', 'The referrer was referred by this account');
  if (store.transfers().some(t => isCompleted(t) && String(t.source?.args.sender).toLowerCase() === ee)) return fail(409, 'not-new-user', 'Only accounts without a completed transfer can be referred');
  if (!store.bindReferral({ referee: ee, referrer: er, signature, boundAt: now })) return fail(409, 'already-referred', 'This account already has a referrer');
  return { status: 200, body: { ok: true } };
}
