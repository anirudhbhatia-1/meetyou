import { Storage, type Bucket } from '@google-cloud/storage';

/**
 * The few object operations recordings need. Cloud Storage in staging and production (strongly
 * consistent: a completed write is durable and visible to every reader), memory in tests.
 */
export interface ObjectBucket {
  save(key: string, data: Uint8Array, contentType: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  /** Keys under a prefix, in lexicographic order. */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  /** Deleting a missing key is not an error (retries, races with the lifecycle rule). */
  delete(key: string): Promise<void>;
  uploadFile(key: string, sourcePath: string, contentType: string): Promise<void>;
}

export class GcsBucket implements ObjectBucket {
  readonly name: string;
  readonly #bucket: Bucket;

  /** Credentials come from the runtime service account (Application Default Credentials). */
  constructor(name: string, storage: Storage = new Storage()) {
    this.name = name;
    this.#bucket = storage.bucket(name);
  }

  /** For signing (signing.ts). */
  file(key: string) {
    return this.#bucket.file(key);
  }

  async save(key: string, data: Uint8Array, contentType: string): Promise<void> {
    // Chunks are small (≤ ~1 MB): one request, no resumable session.
    await this.#bucket.file(key).save(Buffer.from(data), { resumable: false, contentType });
  }

  async read(key: string): Promise<Uint8Array> {
    const [bytes] = await this.#bucket.file(key).download();
    return new Uint8Array(bytes);
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const [files] = await this.#bucket.getFiles({ prefix, autoPaginate: true });
    return files
      .map((f) => ({ key: f.name, size: Number(f.metadata.size ?? 0) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(key: string): Promise<void> {
    await this.#bucket.file(key).delete({ ignoreNotFound: true });
  }

  async uploadFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    await this.#bucket.upload(sourcePath, { destination: key, contentType });
  }
}

/** In-memory bucket for tests. */
export class MemoryBucket implements ObjectBucket {
  readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();

  save(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { data: new Uint8Array(data), contentType });
    return Promise.resolve();
  }

  read(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    return object === undefined
      ? Promise.reject(Object.assign(new Error('No such object'), { code: 404 }))
      : Promise.resolve(object.data);
  }

  list(prefix: string): Promise<{ key: string; size: number }[]> {
    return Promise.resolve(
      [...this.objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, o]) => ({ key, size: o.data.byteLength }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    );
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  async uploadFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    await this.save(key, new Uint8Array(await readFile(sourcePath)), contentType);
  }
}
