// Mock Storage: source uploads and output files are scoped by unguessable IDs.
// Ownership is checked by the gateway before every read; no object URLs are persisted.
const DATABASE = "zimage-mock-apparel-assets-v1";
const fallback = new Map<string, { blob: Blob; expiresAt: number }>();
async function store() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function putApparelBlob(
  id: string,
  blob: Blob,
  expiresAt: number,
) {
  if (typeof indexedDB === "undefined") {
    fallback.set(id, { blob, expiresAt });
    return;
  }
  const db = await store();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite"),
        files = tx.objectStore("files");
      files.put({ blob, expiresAt }, id);
      const cursor = files.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (entry.value.expiresAt <= Date.now()) entry.delete();
        entry.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function getApparelBlob(id: string) {
  if (typeof indexedDB === "undefined") {
    const item = fallback.get(id);
    return item && item.expiresAt > Date.now() ? item.blob : undefined;
  }
  const db = await store();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction("files", "readonly"),
        request = tx.objectStore("files").get(id);
      request.onsuccess = () => {
        const item = request.result as
          { blob: Blob; expiresAt: number } | undefined;
        resolve(item && item.expiresAt > Date.now() ? item.blob : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
