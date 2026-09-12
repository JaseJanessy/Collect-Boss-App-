import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const chunkSize = 1_800;
const maxChunks = 16;
const memory = new Map<string, string>();
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const manifestKey = (key: string) => `${key}.manifest`;
const chunkKey = (key: string, index: number) => `${key}.part.${index}`;

async function available() {
  return Platform.OS !== 'web' && await SecureStore.isAvailableAsync();
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!(await available())) return memory.get(key) ?? null;
    const rawManifest = await SecureStore.getItemAsync(manifestKey(key), options);
    if (!rawManifest) return null;
    const count = Number(rawManifest);
    if (!Number.isInteger(count) || count < 1 || count > maxChunks) return null;
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index), options)));
    return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!(await available())) { memory.set(key, value); return; }
    const chunks = Array.from({ length: Math.ceil(value.length / chunkSize) }, (_, index) => value.slice(index * chunkSize, (index + 1) * chunkSize));
    if (!chunks.length || chunks.length > maxChunks) throw new Error('The secure session is unexpectedly large. Sign in again or contact support.');
    const previous = Number(await SecureStore.getItemAsync(manifestKey(key), options) ?? 0);
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk, options)));
    await SecureStore.setItemAsync(manifestKey(key), String(chunks.length), options);
    if (previous > chunks.length) await Promise.all(Array.from({ length: previous - chunks.length }, (_, offset) => SecureStore.deleteItemAsync(chunkKey(key, chunks.length + offset), options)));
  },
  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    if (!(await available())) return;
    const count = Number(await SecureStore.getItemAsync(manifestKey(key), options) ?? 0);
    await Promise.all(Array.from({ length: Math.min(Math.max(count, 0), maxChunks) }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index), options)));
    await SecureStore.deleteItemAsync(manifestKey(key), options);
  },
};
