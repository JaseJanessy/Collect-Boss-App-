import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { mergeDrafts, validateDraft, type MobileDraft } from '@/lib/workflow-core';

const indexKey = 'collectboss.mobile.draft-index.v1';
const draftKey = (id: string) => `collectboss.mobile.draft.${id}`;
const memoryDrafts = new Map<string, MobileDraft>();
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function secureAvailable() {
  return Platform.OS !== 'web' && await SecureStore.isAvailableAsync();
}

async function readIds(): Promise<string[]> {
  if (!(await secureAvailable())) return [...memoryDrafts.keys()];
  const value = await SecureStore.getItemAsync(indexKey, secureOptions);
  if (!value) return [];
  try {
    const ids = JSON.parse(value) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function writeIds(ids: string[]) {
  if (!(await secureAvailable())) return;
  await SecureStore.setItemAsync(indexKey, JSON.stringify(ids.slice(0, 20)), secureOptions);
}

export async function loadDrafts(userId?: string): Promise<MobileDraft[]> {
  if (!(await secureAvailable())) return [...memoryDrafts.values()].filter((draft) => !userId || draft.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = await readIds();
  const values = await Promise.all(ids.map((id) => SecureStore.getItemAsync(draftKey(id), secureOptions)));
  return values.flatMap((value) => {
    if (!value) return [];
    try { return [JSON.parse(value) as MobileDraft]; } catch { return []; }
  }).filter((draft) => !userId || draft.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveDraft(draft: MobileDraft): Promise<MobileDraft[]> {
  const invalid = validateDraft(draft);
  if (invalid) throw new Error(invalid);
  const next = mergeDrafts(await loadDrafts(), draft);
  if (!(await secureAvailable())) {
    memoryDrafts.set(draft.id, draft);
    for (const id of [...memoryDrafts.keys()]) if (!next.some((item) => item.id === id)) memoryDrafts.delete(id);
    return next;
  }
  const serialized = JSON.stringify(draft);
  if (new TextEncoder().encode(serialized).length > 2_000) {
    throw new Error('This draft is too large for protected on-device storage. Shorten the note and try again.');
  }
  await SecureStore.setItemAsync(draftKey(draft.id), serialized, secureOptions);
  await writeIds(next.map((item) => item.id));
  return next;
}

export async function removeDraft(id: string): Promise<MobileDraft[]> {
  memoryDrafts.delete(id);
  if (await secureAvailable()) await SecureStore.deleteItemAsync(draftKey(id), secureOptions);
  const remaining = (await loadDrafts()).filter((draft) => draft.id !== id);
  await writeIds(remaining.map((draft) => draft.id));
  return remaining;
}

export async function clearDrafts() {
  const ids = await readIds();
  memoryDrafts.clear();
  if (await secureAvailable()) {
    await Promise.all(ids.map((id) => SecureStore.deleteItemAsync(draftKey(id), secureOptions)));
    await SecureStore.deleteItemAsync(indexKey, secureOptions);
  }
}
