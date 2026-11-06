import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Storage } from '@google-cloud/storage';
import { describe, expect, it } from 'vitest';

import { GcsBucket, MemoryBucket } from './bucket.ts';
import { audioChunkBase, videoFileKey, videoFragmentKey } from './layout.ts';
import { LENGTH_RANGE_HEADER, signFragmentUploads, signReadUrl } from './signing.ts';
import { ObjectVideoStore } from './video-store.ts';

const PART = 'vp_01J00000000000000000000PRT';

describe('object layout (ARCHITECTURE §11.4)', () => {
  it('names objects per meeting, sortable by time, and refuses path tricks', () => {
    expect(audioChunkBase('ws_1', 'mtg_1', 'me', 1234)).toBe(
      'ws/ws_1/meetings/mtg_1/audio/me/0000001234',
    );
    expect(videoFragmentKey('ws_1', 'mtg_1', PART, 3)).toBe(
      `ws/ws_1/meetings/mtg_1/video/${PART}/3.frag`,
    );
    expect(videoFileKey('ws_1', 'mtg_1', 'playback.mp4')).toBe(
      'ws/ws_1/meetings/mtg_1/video/playback.mp4',
    );
    expect(() => videoFragmentKey('ws_1', '../x', PART, 0)).toThrow();
    expect(() => videoFragmentKey('ws_1', 'mtg_1', PART, -1)).toThrow();
  });
});

describe('ObjectVideoStore (S2-14)', () => {
  it('lists fragments per part, merges part timing, and deletes only the temporary objects', async () => {
    const bucket = new MemoryBucket();
    const store = new ObjectVideoStore(bucket);
    for (const i of [2, 0, 1]) {
      await store.putVideoFragment('ws_1', 'mtg_1', PART, i, new Uint8Array([i]), 'video/mp4');
    }
    expect(await store.listVideo('ws_1', 'mtg_1')).toEqual([{ partId: PART, indices: [0, 1, 2] }]);
    await store.putVideoPartInfo('ws_1', 'mtg_1', {
      partId: PART,
      mimeType: 'video/mp4',
      startMs: 500,
    });
    await store.putVideoPartInfo('ws_1', 'mtg_1', { partId: PART, fragments: 3 });
    expect(await store.listVideoPartInfo('ws_1', 'mtg_1')).toEqual([
      { partId: PART, mimeType: 'video/mp4', startMs: 500, fragments: 3 },
    ]);
    expect(await store.readVideoFragment('ws_1', 'mtg_1', PART, 1)).toEqual(new Uint8Array([1]));

    const dir = await mkdtemp(join(tmpdir(), 'storage-test-'));
    try {
      const file = join(dir, 'playback.mp4');
      await writeFile(file, new Uint8Array(10));
      expect(await store.putVideoFile('ws_1', 'mtg_1', 'playback.mp4', file)).toEqual({
        storageKey: 'ws/ws_1/meetings/mtg_1/video/playback.mp4',
        bytes: 10,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await store.deleteVideoFragments('ws_1', 'mtg_1');
    expect([...bucket.objects.keys()]).toEqual(['ws/ws_1/meetings/mtg_1/video/playback.mp4']);
    expect(await store.videoFileSize('ws_1', 'mtg_1', 'playback.mp4')).toBe(10);
  });
});

describe('V4 signed URLs (signed locally with a throwaway key; no network)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const storage = new Storage({
    projectId: 'test-project',
    credentials: {
      client_email: 'signer@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
  });
  const bucket = new GcsBucket('test-bucket', storage);
  const now = Date.now();

  it('binds fragment uploads to the object, content type, size range and 15 minutes', async () => {
    const signed = await signFragmentUploads(
      bucket,
      {
        workspaceId: 'ws_1',
        meetingId: 'mtg_1',
        partId: PART,
        indices: [0, 1],
        contentType: 'video/mp4',
      },
      now,
    );
    expect(signed.headers).toEqual({ [LENGTH_RANGE_HEADER]: '0,8388608' });
    expect(signed.fragments.map((f) => f.index)).toEqual([0, 1]);
    const url = new URL(signed.fragments[1]?.url ?? '');
    expect(url.hostname).toBe('storage.googleapis.com');
    expect(url.pathname).toBe(`/test-bucket/ws/ws_1/meetings/mtg_1/video/${PART}/1.frag`);
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(Number(url.searchParams.get('X-Goog-Expires'))).toBeLessThanOrEqual(900);
    const signedHeaders = url.searchParams.get('X-Goog-SignedHeaders') ?? '';
    expect(signedHeaders).toContain('content-type');
    expect(signedHeaders).toContain(LENGTH_RANGE_HEADER);
    expect(new Date(signed.fragments[0]?.expiresAt ?? '').getTime()).toBe(now + 15 * 60 * 1000);
  });

  it('signs short-lived reads, optionally as a download', async () => {
    const { url } = await signReadUrl(bucket, 'ws/ws_1/meetings/mtg_1/video/playback.mp4', {
      now,
      downloadName: 'minutes-mtg_1.mp4',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('response-content-disposition')).toContain('attachment');
    expect(Number(parsed.searchParams.get('X-Goog-Expires'))).toBeLessThanOrEqual(900);
  });
});
