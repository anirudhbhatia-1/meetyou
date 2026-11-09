/**
 * IndexedDB for the offscreen document (ARCHITECTURE §4.5). Shared with extension pages, which
 * run on the same origin (the side panel reads `video_buffer` for the developer download).
 */
export const DB_NAME = 'minutes';
export const AUDIO_STORE = 'audio_buffer';
export const VIDEO_STORE = 'video_buffer';

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function openMinutesDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore(AUDIO_STORE, { keyPath: ['sessionId', 'lane', 'seq'] });
    db.createObjectStore(VIDEO_STORE, { keyPath: ['sessionId', 'partId', 'index'] });
  };
  return idbRequest(request);
}

/**
 * Removes everything this computer still holds for one recording (DESIGN §9 "Stop and delete",
 * FR-CON-04): buffered audio frames and video fragments. Keys start with the session ID.
 */
export async function deleteSessionData(db: IDBDatabase, sessionId: string): Promise<void> {
  // Arrays sort after strings, so [sessionId, []] is past every [sessionId, lane|part, …] key.
  const range = IDBKeyRange.bound([sessionId], [sessionId, []]);
  const tx = db.transaction([AUDIO_STORE, VIDEO_STORE], 'readwrite');
  tx.objectStore(AUDIO_STORE).delete(range);
  tx.objectStore(VIDEO_STORE).delete(range);
  await idbDone(tx);
}
