// IndexedDB persistence with a localStorage fallback (e.g. private browsing).
const DB = 'pto-save';
const STORE = 'slots';

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function saveSlot(slot: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(json, slot);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    try { localStorage.setItem(`${DB}:${slot}`, json); } catch { /* storage unavailable */ }
  }
}

export async function loadSlot<T>(slot: string): Promise<T | null> {
  try {
    const db = await openDB();
    const json = await new Promise<string | undefined>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(slot);
      r.onsuccess = () => res(r.result as string | undefined);
      r.onerror = () => rej(r.error);
    });
    if (json) return JSON.parse(json) as T;
  } catch { /* fall back */ }
  try {
    const j = localStorage.getItem(`${DB}:${slot}`);
    return j ? (JSON.parse(j) as T) : null;
  } catch { return null; }
}

export async function deleteSlot(slot: string) {
  try {
    const db = await openDB();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot);
  } catch { /* ignore */ }
  try { localStorage.removeItem(`${DB}:${slot}`); } catch { /* ignore */ }
}

export const settingsStore = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('pto:' + k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem('pto:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
