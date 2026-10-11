// Expo web: Mera's built-in browser WebAuthn client; the relying party is this page's host.
import type { PasskeyEnv } from "../lib/wallet";

export const passkeyEnv: PasskeyEnv = {
  rpId: typeof location !== "undefined" ? location.hostname : "localhost",
  rpName: "Kakushi Confidential",
};

export function passkeySupport(): { ok: boolean; why?: string } {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return { ok: false, why: "This browser has no WebAuthn." };
  return { ok: true, why: "Browser passkeys need a PRF-capable authenticator (iCloud Keychain, Google Password Manager, 1Password)." };
}
