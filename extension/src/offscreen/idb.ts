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
