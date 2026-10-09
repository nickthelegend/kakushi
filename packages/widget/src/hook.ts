import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicClient } from "viem";
import type { StealthMetaAddress } from "@kakushi/sdk";
import {
  type KakushiDeployment,
  KakushiPayError,
  type KakushiPayStatus,
  type KakushiPayStep,
  type KakushiPaymentOptions,
  type KakushiPaymentResult,
  type WalletClientSource,
  createKakushiPayment,
  resolveRecipient,
  toKakushiError,
} from "./core.ts";

export interface UseKakushiPayOptions extends Omit<KakushiPaymentOptions, "walletClient" | "publicClient" | "onStatus"> {
  /** may be undefined until the user connects a wallet; pay() then fails with NO_ACCOUNT */
  walletClient?: WalletClientSource | null;
  publicClient?: PublicClient | null;
  /** look the recipient up as soon as `to` changes, so an unregistered recipient shows up before
   *  the click; default true */
  preflight?: boolean;
  onPaid?: (result: KakushiPaymentResult) => void;
  onError?: (error: KakushiPayError) => void;
  onStatus?: KakushiPaymentOptions["onStatus"];
}

export type RecipientState =
  | { state: "unknown" }
  | { state: "checking" }
  | { state: "ready"; metaAddress: StealthMetaAddress }
  | { state: "error"; error: KakushiPayError };

export interface UseKakushiPay {
  status: KakushiPayStatus;
  /** which transaction "confirming"/"sending" refers to */
  step: KakushiPayStep | undefined;
  /** hash of the transaction being mined while "sending" */
  pendingTxHash: `0x${string}` | undefined;
  error: KakushiPayError | null;
  result: KakushiPaymentResult | null;
  recipient: RecipientState;
  busy: boolean;
  /** false while busy, after "paid", without a wallet/public client, or when the recipient lookup failed */
  canPay: boolean;
  /** run the payment; resolves with the result, or null when it failed (the error is in `error`) */
  pay: (overrides?: Partial<KakushiPaymentOptions>) => Promise<KakushiPaymentResult | null>;
  /** back to idle (keeps the recipient lookup) */
  reset: () => void;
}

const BUSY: ReadonlySet<KakushiPayStatus> = new Set(["resolving", "confirming", "sending"]);

/** The KakushiPay logic for custom UIs. */
export function useKakushiPay(opts: UseKakushiPayOptions): UseKakushiPay {
  const [status, setStatus] = useState<KakushiPayStatus>("idle");
  const [step, setStep] = useState<KakushiPayStep | undefined>();
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<KakushiPayError | null>(null);
  const [result, setResult] = useState<KakushiPaymentResult | null>(null);
  const [recipient, setRecipient] = useState<RecipientState>({ state: "unknown" });

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const run = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Keyed on primitives, not the client object: apps often build a new client every render.
  const { to, deployment } = opts;
  const registry = deployment?.stealthRegistry;
  const preflight = opts.preflight ?? true;
  const hasClient = Boolean(opts.publicClient);
  const clientChain = opts.publicClient?.chain?.id;
  useEffect(() => {
    const publicClient = optsRef.current.publicClient;
    if (!preflight || !to || !publicClient) {
      setRecipient({ state: "unknown" });
      return;
    }
    let live = true;
    setRecipient({ state: "checking" });
    const dep: Pick<KakushiDeployment, "stealthRegistry"> = registry ? { stealthRegistry: registry } : {};
    resolveRecipient(to, publicClient, dep).then(
      (metaAddress) => live && setRecipient({ state: "ready", metaAddress }),
      (e: unknown) => live && setRecipient({ state: "error", error: toKakushiError(e) }),
    );
    return () => {
      live = false;
    };
  }, [to, hasClient, clientChain, registry, preflight]);

  const pay = useCallback(async (overrides: Partial<KakushiPaymentOptions> = {}) => {
    const o = optsRef.current;
    const id = ++run.current;
    const current = () => mounted.current && id === run.current;
    setError(null);
    setResult(null);
    setPendingTxHash(undefined);
    setStep(undefined);
    try {
      const walletClient = overrides.walletClient ?? o.walletClient;
      const publicClient = overrides.publicClient ?? o.publicClient;
      if (!walletClient || !publicClient) throw new KakushiPayError("NO_ACCOUNT", "Connect a wallet to pay.");
      const { preflight: _p, onPaid: _a, onError: _b, ...base } = o;
      const r = await createKakushiPayment({
        ...base,
        ...overrides,
        walletClient,
        publicClient,
        onStatus: (e) => {
          if (current()) {
            setStatus(e.status);
            setStep(e.step);
            setPendingTxHash(e.status === "sending" ? e.txHash : undefined);
          }
          o.onStatus?.(e);
          overrides.onStatus?.(e);
        },
      });
      if (current()) setResult(r);
      o.onPaid?.(r);
      return r;
    } catch (e) {
      const err = toKakushiError(e);
      if (current()) {
        setStatus("error");
        setError(err);
      }
      o.onError?.(err);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    run.current++;
    setStatus("idle");
    setStep(undefined);
    setPendingTxHash(undefined);
    setError(null);
    setResult(null);
  }, []);

  const busy = BUSY.has(status);
  const canPay = !busy && status !== "paid" && Boolean(opts.walletClient && opts.publicClient) && recipient.state !== "error" && recipient.state !== "checking";
  return { status, step, pendingTxHash, error, result, recipient, busy, canPay, pay, reset };
}
