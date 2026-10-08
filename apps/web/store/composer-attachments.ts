import type { UploadReference } from '@zimage/domain';

const DATABASE = 'zimage-composer-attachments-v1';
const TAB_KEY = 'zimage:attachment-tab:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
type SavedAttachments = { key: string; savedAt: number; references: { file: File; id?: string }[] };
let pending = Promise.resolve();

// Keep File bytes, never persist blob URLs or signed download URLs. The tab
// namespace and server-authorized session selection match text draft ownership.
function tabKey() {
  let key = sessionStorage.getItem(TAB_KEY);
  if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(TAB_KEY, key); }
  return key;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Attachment storage unavailable'));
  });
}

function enqueue<T>(work: (store: IDBObjectStore, tab: string) => Promise<T> | T): Promise<T | undefined> {
  const next = pending.then(async () => {
    const tab = tabKey();
    const db = await database();
    try {
      const transaction = db.transaction('drafts', 'readwrite');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
      const [result] = await Promise.all([work(transaction.objectStore('drafts'), tab), done]);
      return result;
    } finally { db.close(); }
  }).catch(() => undefined); // Storage restrictions must not break the composer.
  pending = next.then(() => undefined);
  return next;
}

export function saveAttachments(sessionId: string, references: UploadReference[], limit = 4) {
  const files = references.filter((ref) => ref.file instanceof File).slice(0, Math.min(26, Math.max(1, limit)))
    .map((ref) => ({ file: ref.file!, id: ref.id }));
  return enqueue((store, tab) => {
    const key = `${tab}:${sessionId}`;
    if (files.length) store.put({ key, savedAt: Date.now(), references: files } satisfies SavedAttachments);
    else store.delete(key);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (Date.now() - entry.value.savedAt > MAX_AGE) entry.delete();
      entry.continue();
    };
  });
}

export function loadAttachments(sessionId: string, limit = 4): Promise<UploadReference[] | undefined> {
  return enqueue((store, tab) => new Promise<UploadReference[]>((resolve, reject) => {
    const request = store.get(`${tab}:${sessionId}`);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const value = request.result as SavedAttachments | undefined;
      if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > MAX_AGE
        || !Array.isArray(value.references)) {
        if (value) store.delete(value.key);
        resolve([]); return;
      }
      resolve(value.references.slice(0, Math.min(26, Math.max(1, limit))).flatMap((reference) => {
        const file = reference?.file;
        if (!(file instanceof File) || file.size > 10 * 1024 * 1024
          || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return [];
        return [{ file, id: typeof reference.id === 'string' ? reference.id : undefined, name: file.name, mimeType: file.type, size: file.size,
          previewUrl: URL.createObjectURL(file), status: 'ready' as const }];
      }));
    };
  }));
}

export function clearAttachments(sessionId?: string) {
  return enqueue((store, tab) => {
    if (sessionId) { store.delete(`${tab}:${sessionId}`); return; }
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (String(entry.key).startsWith(`${tab}:`)) entry.delete();
      entry.continue();
    };
  });
}
