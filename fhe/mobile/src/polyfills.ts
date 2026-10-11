import { getRandomValues } from "expo-crypto";

// Hermes ships no CSPRNG; mera's passkey ceremonies, viem and @noble need crypto.getRandomValues.
// Imported first, before any application code.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
