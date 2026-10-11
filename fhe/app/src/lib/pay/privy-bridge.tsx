"use client";
// Loaded only when NEXT_PUBLIC_PRIVY_APP_ID is set (React.lazy in wallet.tsx), so the local-fork build
// never ships or runs Privy. Privy features used here:
//   1. login with email or passkey, embedded wallet created on login (Monad testnet, 10143)
//   2. native gas sponsorship: useSendTransaction(..., { sponsor: true }) (EIP-7702 + paymaster)
//   3. EIP-712 signing with the embedded wallet (Kakushi user decryption, payroll batch authorizations)
//   4. on the local fork, useSignTransaction + our own eth_sendRawTransactionSync broadcast, because
//      Privy's paymaster cannot reach a fork
import { useEffect, useMemo, useRef } from "react";
import { PrivyProvider, useLogin, useLogout, usePrivy, useSendTransaction, useSignTransaction, useSignTypedData, useWallets } from "@privy-io/react-auth";
import { monadTestnet } from "viem/chains";
import { toHex, type Hex, type PublicClient } from "viem";
import { MONAD_TESTNET_ID, jsonSafe } from "./core";
import { broadcast, ensureForkGas, type PayWallet, type PrivyState, type SentTx } from "./wallet";

interface Props {
  appId: string;
  clientId?: string;
  client: PublicClient;
  network: "local" | "testnet";
  onState: (s: PrivyState) => void;
}

export default function PrivyBridge({ appId, clientId, client, network, onState }: Props) {
  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        appearance: { theme: "#021a20", accentColor: "#34e3ff", logo: `${location.origin}/kakushi-fin.png`, landingHeader: "Sign in to Kakushi Confidential" },
        loginMethods: ["email", "passkey"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
      }}
    >
      <Inner client={client} network={network} onState={onState} />
    </PrivyProvider>
  );
}

function Inner({ client, network, onState }: Omit<Props, "appId" | "clientId">) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { sendTransaction } = useSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { signTypedData } = useSignTypedData();

  // hooks return fresh closures each render; keep the latest in a ref so the wallet object is stable
  const fns = useRef({ sendTransaction, signTransaction, signTypedData });
  fns.current = { sendTransaction, signTransaction, signTypedData };

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = embedded?.address as Hex | undefined;
  const label = user?.email?.address ?? (user?.linkedAccounts.some((a) => a.type === "passkey") ? "Passkey account" : "Privy account");

  const wallet = useMemo<PayWallet | null>(() => {
    if (!authenticated || !address) return null;
    const sponsored = network === "testnet";
    return {
      kind: "privy",
      address,
      label,
      sponsored,
      async send(tx): Promise<SentTx> {
        const submittedAt = Date.now();
        if (sponsored) {
          // Privy native gas sponsorship: the embedded wallet is upgraded with EIP-7702 and a paymaster
          // pays. msg.sender is still the user's address, so Kakushi input proofs bound to it verify.
          const { hash } = await fns.current.sendTransaction(
            { to: tx.to, data: tx.data, chainId: MONAD_TESTNET_ID, gasLimit: toHex(tx.gas) },
            { sponsor: true, address, uiOptions: { showWalletUIs: false } },
          );
          const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
          const out: SentTx = { hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receipt, submittedAt, receiptMs: Date.now() - submittedAt, via: "privy-sponsored", sync: false };
          if (receipt.status !== "success") throw Object.assign(new Error(`transaction ${hash.slice(0, 10)}… reverted`), { sent: out });
          return out;
        }
        // local fork: sign with the embedded wallet, broadcast to the fork ourselves
        await ensureForkGas(client, address);
        const [nonce, fees] = await Promise.all([client.getTransactionCount({ address, blockTag: "pending" }), client.estimateFeesPerGas()]);
        const { signature } = await fns.current.signTransaction(
          { from: address, to: tx.to, data: tx.data, chainId: MONAD_TESTNET_ID, type: 2, nonce, gasLimit: toHex(tx.gas), maxFeePerGas: toHex(fees.maxFeePerGas), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas) },
          { address, uiOptions: { showWalletUIs: false } },
        );
        if (signature.length <= 132) throw new Error("Privy returned a signature, not a signed transaction; cannot broadcast to the fork");
        return broadcast(client, signature, submittedAt, "privy-signed");
      },
      async signTypedData(td) {
        const { signature } = await fns.current.signTypedData(jsonSafe(td) as never, { address, uiOptions: { showWalletUIs: false } });
        return signature as Hex;
      },
    };
  }, [authenticated, address, label, network, client]);

  useEffect(() => {
    onState({ ready: ready && walletsReady, authenticated, wallet, login: () => login(), logout });
  }, [ready, walletsReady, authenticated, wallet, login, logout, onState]);

  return null;
}
