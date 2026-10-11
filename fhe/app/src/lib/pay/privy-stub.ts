// Bundled instead of @privy-io/react-auth when NEXT_PUBLIC_PRIVY_APP_ID is unset (next.config.ts
// turbopack.resolveAlias), so the local-fork build neither ships nor compiles Privy. Never called:
// the Privy bridge only renders when an app ID exists. Types still come from the real package.
const off = () => {
  throw new Error("Privy is not configured (NEXT_PUBLIC_PRIVY_APP_ID); see app/PRIVY.md");
};
export const PrivyProvider = off;
export const useLogin = off;
export const useLogout = off;
export const usePrivy = off;
export const useSendTransaction = off;
export const useSignTransaction = off;
export const useSignTypedData = off;
export const useWallets = off;
