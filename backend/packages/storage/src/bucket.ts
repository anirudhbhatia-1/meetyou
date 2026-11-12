import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  type ContainerClient,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { Storage, type Bucket } from '@google-cloud/storage';

/**
 * The few object operations recordings need. Azure Blob Storage in staging since 2026-11-12
 * (ADR-0012), Google Cloud Storage before; both strongly consistent (a completed write is durable
 * and visible to every reader). Memory in tests.
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

/**
 * A bucket that can hand out short-lived links (ADR-0011 §3.3, ARCHITECTURE §14): the browser
 * uploads video fragments and plays recordings without our servers in the data path.
 */
export interface SignableBucket extends ObjectBucket {
  /** A URL one object may be PUT to until `expiresAt`, and the headers every PUT must send. */
  signUpload(
    key: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A GET URL; `downloadName` makes the browser save the file instead of playing it. */
  signRead(key: string, options: { expiresAt: Date; downloadName?: string }): Promise<string>;
}

/** A missing object, from any bucket (Google 404, Azure BlobNotFound, the test bucket). */
export function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; statusCode?: unknown };
  return e.code === 404 || e.statusCode === 404 || e.code === 'BlobNotFound';
}

/**
 * The size bound travels as a signed extension header: the uploader must send exactly this
 * header, and Cloud Storage refuses a body outside the range.
 */
const GCS_LENGTH_RANGE_HEADER = 'x-goog-content-length-range';

export class GcsBucket implements SignableBucket {
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

  /** V4 signed PUT bound to the content type and the size range (the IAM signBlob API signs). */
  async signUpload(
    key: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date },
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const headers = { [GCS_LENGTH_RANGE_HEADER]: `0,${options.maxBytes}` };
    const [url] = await this.#bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: options.expiresAt,
      contentType: options.contentType,
      extensionHeaders: headers,
    });
    return { url, headers };
  }

  async signRead(
    key: string,
    options: { expiresAt: Date; downloadName?: string },
  ): Promise<string> {
    const [url] = await this.#bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: options.expiresAt,
      ...(options.downloadName !== undefined ? { promptSaveAs: options.downloadName } : {}),
    });
    return url;
  }
}

/** A user delegation key is reused until this close to its expiry (Azure allows up to 7 days). */
const DELEGATION_KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DELEGATION_KEY_REFRESH_MS = 2 * 60 * 60 * 1000;
/** SAS validity starts a little in the past so a client clock running behind still works. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Azure Blob Storage (ADR-0012). Credentials come from the container app's managed identity
 * (DefaultAzureCredential); links are **user delegation SAS** signed with a key that identity
 * requests, so no account key exists anywhere. The identity needs *Storage Blob Data
 * Contributor* (data access and generateUserDelegationKey) on the account (infra/azure).
 *
 * Unlike a Cloud Storage V4 link, a SAS cannot bound the upload size: fragments are limited by the
 * 15-minute, single-object link and by finalize ignoring oversized fragments (AUDIT B2).
 */
export class AzureBlobBucket implements SignableBucket {
  readonly name: string;
  readonly #accountName: string;
  readonly #service: BlobServiceClient;
  readonly #container: ContainerClient;
  #delegationKey: { key: UserDelegationKey; expiresAt: number } | null = null;

  constructor(accountName: string, containerName: string, service?: BlobServiceClient) {
    this.name = containerName;
    this.#accountName = accountName;
    this.#service =
      service ??
      new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
    this.#container = this.#service.getContainerClient(containerName);
  }

  async save(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.#container
      .getBlockBlobClient(key)
      .uploadData(Buffer.from(data), { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async read(key: string): Promise<Uint8Array> {
    const bytes = await this.#container.getBlobClient(key).downloadToBuffer();
    return new Uint8Array(bytes);
  }

  async list(prefix: string): Promise<{ key: string; size: number }[]> {
    const found: { key: string; size: number }[] = [];
    for await (const blob of this.#container.listBlobsFlat({ prefix })) {
      found.push({ key: blob.name, size: blob.properties.contentLength ?? 0 });
    }
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(key: string): Promise<void> {
    await this.#container.getBlobClient(key).deleteIfExists();
  }

  async uploadFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    await this.#container
      .getBlockBlobClient(key)
      .uploadFile(sourcePath, { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async signUpload(
    key: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date },
  ): Promise<{ url: string; headers: Record<string, string> }> {
    // Create or write this one blob only; Put Blob needs the blob type header (REST Put Blob).
    const url = await this.#sign(key, 'cw', options.expiresAt);
    return { url, headers: { 'x-ms-blob-type': 'BlockBlob' } };
  }

  async signRead(
    key: string,
    options: { expiresAt: Date; downloadName?: string },
  ): Promise<string> {
    return this.#sign(key, 'r', options.expiresAt, options.downloadName);
  }

  async #sign(
    key: string,
    permissions: string,
    expiresAt: Date,
    downloadName?: string,
  ): Promise<string> {
    const now = Date.now();
    const delegation = await this.#userDelegationKey(now);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.name,
        blobName: key,
        permissions: BlobSASPermissions.parse(permissions),
        protocol: SASProtocol.Https,
        startsOn: new Date(now - CLOCK_SKEW_MS),
        expiresOn: expiresAt,
        ...(downloadName !== undefined
          ? { contentDisposition: `attachment; filename="${downloadName.replace(/"/g, '')}"` }
          : {}),
      },
      delegation,
      this.#accountName,
    ).toString();
    const blobUrl = this.#container.getBlobClient(key).url;
    return `${blobUrl}?${sas}`;
  }

  async #userDelegationKey(now: number): Promise<UserDelegationKey> {
    const cached = this.#delegationKey;
    if (cached !== null && cached.expiresAt - now > DELEGATION_KEY_REFRESH_MS) return cached.key;
    const expiresAt = now + DELEGATION_KEY_LIFETIME_MS;
    const key = await this.#service.getUserDelegationKey(
      new Date(now - CLOCK_SKEW_MS),
      new Date(expiresAt),
    );
    this.#delegationKey = { key, expiresAt };
    return key;
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

/**
 * The recordings bucket a service's environment names (ADR-0012): Azure when
 * `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_CONTAINER` are set, Google Cloud Storage when
 * `GCS_AUDIO_BUCKET` is, otherwise none (local development keeps files on disk).
 */
export function bucketFromEnv(env: Record<string, string | undefined>): SignableBucket | undefined {
  const account = env.AZURE_STORAGE_ACCOUNT;
  const container = env.AZURE_STORAGE_CONTAINER;
  if (account !== undefined && account !== '' && container !== undefined && container !== '') {
    return new AzureBlobBucket(account, container);
  }
  const gcs = env.GCS_AUDIO_BUCKET;
  return gcs !== undefined && gcs !== '' ? new GcsBucket(gcs) : undefined;
}
