import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NETWORKS, MONAD_WS, SESSION_MINUTES, type Network, type NetworkId } from "../lib/config";
import { MonadHeads } from "../lib/monad";
import { makeContext, type PayContext } from "../lib/pay";
import { createPasskeyWallet, devWallet, passkeyWallet, type DevName, type Wallet } from "../lib/wallet";
import type { ParsedLink } from "../lib/links";
import type { Hex } from "../lib/bytes";
import { encryptor } from "../fhe/bridge";
import { passkeyEnv } from "./passkeyEnv";
import * as store from "./storage";

export type StoredAccount = { kind: "passkey"; address: Hex; credentialId: string } | { kind: "dev"; address: Hex; name: DevName };

interface AppValue {
  network: NetworkId;
  net: Network;
  setNetwork(n: NetworkId): void;
  ctx: PayContext | null;
  heads: MonadHeads;
  loaded: boolean;
  stored: StoredAccount | null;
  address: Hex | null;
  wallet: Wallet | null;
  expiresAt: number | null;
  sessionNote: string | null;
  createPasskey(label: string): Promise<void>;
  restorePasskey(): Promise<void>;
  useDevAccount(name: DevName): Promise<void>;
  unlock(): Promise<Wallet>;
  lock(note?: string): void;
  signOut(): Promise<void>;
  withSigner<T>(fn: (w: Wallet) => Promise<T>): Promise<T>;
  version: number;
  refresh(): void;
  pendingClaim: ParsedLink | null;
  setPendingClaim(l: ParsedLink | null): void;
}

const Ctx = createContext<AppValue | null>(null);
const K_ACCOUNT = "kakushi.fhe.account.v1";
const K_NETWORK = "kakushi.fhe.network.v1";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<NetworkId>("local");
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState<StoredAccount | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [pendingClaim, setPendingClaim] = useState<ParsedLink | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletRef = useRef<Wallet | null>(null);
  const heads = useMemo(() => new MonadHeads(MONAD_WS), []);
  const net = NETWORKS[network];

  // the DEV gas sponsor exists only on the local fork
  const sponsor = useMemo(() => (net.dev ? devWallet("carol") : null), [net.dev]);
  const ctx = useMemo(() => {
    try {
      return makeContext(net, encryptor, sponsor?.account ?? null);
    } catch {
      return null;
    }
  }, [net, sponsor]);

  useEffect(() => {
    (async () => {
      const n = await store.load(K_NETWORK);
      if (n === "local" || n === "testnet") setNetworkState(n);
      const a = await store.load(K_ACCOUNT);
      if (a) {
        try {
          setStored(JSON.parse(a));
        } catch {}
      }
      setLoaded(true);
    })();
  }, []);

  const lock = useCallback((note?: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    walletRef.current?.end(); // zero the key
    walletRef.current = null;
    setWallet(null);
    setExpiresAt(null);
    setSessionNote(note ?? null);
  }, []);

  const open = useCallback(
    (w: Wallet) => {
      walletRef.current?.end();
      walletRef.current = w;
      setWallet(w);
      setSessionNote(null);
      const exp = Date.now() + SESSION_MINUTES * 60_000;
      setExpiresAt(exp);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => lock(`Your signing session ended after ${SESSION_MINUTES} min; the key was wiped from memory.`), exp - Date.now());
    },
    [lock],
  );

  const persist = useCallback(async (a: StoredAccount | null) => {
    setStored(a);
    if (a) await store.save(K_ACCOUNT, JSON.stringify(a));
    else await store.remove(K_ACCOUNT);
  }, []);

  const createPasskey = useCallback(
    async (label: string) => {
      const w = await createPasskeyWallet(passkeyEnv, label);
      await persist({ kind: "passkey", address: w.address, credentialId: w.credentialId });
      open(w);
    },
    [open, persist],
  );

  const restorePasskey = useCallback(async () => {
    const w = await passkeyWallet(passkeyEnv);
    await persist({ kind: "passkey", address: w.address, credentialId: w.credentialId });
    open(w);
  }, [open, persist]);

  const useDevAccount = useCallback(
    async (name: DevName) => {
      if (!net.dev) throw new Error("DEV accounts exist only on the local fork");
      const w = devWallet(name);
      await persist({ kind: "dev", address: w.address, name });
      open(w);
    },
    [net.dev, open, persist],
  );

  const unlock = useCallback(async () => {
    if (!stored) throw new Error("No account on this device");
    let w: Wallet;
    if (stored.kind === "dev") w = devWallet(stored.name);
    else {
      w = await passkeyWallet(passkeyEnv, stored.credentialId);
      if (w.address.toLowerCase() !== stored.address.toLowerCase()) {
        w.end();
        throw new Error("That passkey belongs to a different account.");
      }
    }
    open(w);
    return w;
  }, [stored, open]);

  const signOut = useCallback(async () => {
    lock();
    await persist(null);
  }, [lock, persist]);

  const withSigner = useCallback(
    async <T,>(fn: (w: Wallet) => Promise<T>): Promise<T> => {
      const w = walletRef.current ?? (await unlock());
      return fn(w);
    },
    [unlock],
  );

  const setNetwork = useCallback(
    (n: NetworkId) => {
      setNetworkState(n);
      store.save(K_NETWORK, n).catch(() => {});
      if (!NETWORKS[n].dev && stored?.kind === "dev") {
        lock("DEV accounts exist only on the local fork.");
        persist(null).catch(() => {});
      }
    },
    [stored, lock, persist],
  );

  useEffect(() => () => walletRef.current?.end(), []);

  const value: AppValue = {
    network,
    net,
    setNetwork,
    ctx,
    heads,
    loaded,
    stored,
    address: (wallet?.address as Hex | undefined) ?? stored?.address ?? null,
    wallet,
    expiresAt,
    sessionNote,
    createPasskey,
    restorePasskey,
    useDevAccount,
    unlock,
    lock,
    signOut,
    withSigner,
    version,
    refresh: () => setVersion((v) => v + 1),
    pendingClaim,
    setPendingClaim,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
