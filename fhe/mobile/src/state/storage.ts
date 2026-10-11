// Device storage for NON-secret metadata only: the account address + passkey credential id (so a
// locked app can show balances without a prompt) and the chosen network. The key itself is never
// stored: it is re-derived from the passkey each session.
import * as SecureStore from "expo-secure-store";

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function load(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTS);
  } catch {
    return null;
  }
}
export async function save(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTS);
}
export async function remove(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTS);
}
