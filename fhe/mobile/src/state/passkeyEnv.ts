// Native passkeys: Mera over react-native-passkey (iOS 18+ / Android 9+ with a PRF-capable provider).
// Expo Go does not contain the native passkey module; a development build (`npx expo run:ios`) does.
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import type { PasskeyEnv } from "../lib/wallet";

const extra = (Constants.expoConfig?.extra ?? {}) as { rpId?: string; rpName?: string };

export const passkeyEnv: PasskeyEnv = {
  rpId: extra.rpId ?? "pay.kakushi.example",
  rpName: extra.rpName ?? "Kakushi Pay",
  webAuthnClient: reactNativeWebAuthnClient,
};

export function passkeySupport(): { ok: boolean; why?: string } {
  if (!NativeModules.Passkey) return { ok: false, why: "This build has no native passkey module (Expo Go). Use the development build: npx expo run:ios." };
  if (Platform.OS === "ios" && parseInt(String(Platform.Version), 10) < 18) return { ok: false, why: "Passkey PRF needs iOS 18 or newer." };
  if (Platform.OS === "android" && Number(Platform.Version) < 28) return { ok: false, why: "Passkeys need Android 9 or newer." };
  if (passkeyEnv.rpId.endsWith(".example")) return { ok: true, why: `Passkey domain is the placeholder ${passkeyEnv.rpId}; set KAKUSHI_FHE_PASSKEY_DOMAIN (see README).` };
  return { ok: true };
}
