// A tiny promise wrapper around one IndexedDB object store, used as a cache for big data
// (parsed playlists and guides) so the app opens instantly instead of re-downloading everything.
const DB = 'orbit-cache';
const STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const cache = {
  get: <T>(key: string) => run<T | undefined>('readonly', s => s.get(key)).catch(() => undefined),
  set: (key: string, value: unknown) => run<void>('readwrite', s => s.put(value, key)).catch(() => undefined),
  remove: (key: string) => run<void>('readwrite', s => s.delete(key)).catch(() => undefined),
};
