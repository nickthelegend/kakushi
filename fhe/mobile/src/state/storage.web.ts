// Expo web: localStorage (non-secret metadata only, see storage.ts).
export async function load(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export async function save(key: string, value: string): Promise<void> {
  globalThis.localStorage?.setItem(key, value);
}
export async function remove(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(key);
}
