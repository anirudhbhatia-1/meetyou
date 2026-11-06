import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoFragmentRow } from './video-recorder.ts';
import {
  baseContentType,
  UploadRejected,
  VideoUploader,
  FragmentRejected,
  type FragmentFilter,
  type FragmentQueue,
  type SignedFragment,
  type VideoUploaderOptions,
} from './video-uploader.ts';

function row(sessionId: string, partId: string, index: number): VideoFragmentRow {
  return {
    sessionId,
    partId,
    index,
    startMs: 0,
    mimeType: 'video/mp4;codecs=avc1,opus',
    createdAt: index,
    blob: new Blob([new Uint8Array([index])]),
  };
}

const key = (r: VideoFragmentRow) =>
  `${r.sessionId}/${r.partId}/${String(r.index).padStart(6, '0')}`;

/** IndexedDB key order: session, part, index. */
class MemoryQueue implements FragmentQueue {
  rows: VideoFragmentRow[];

  constructor(rows: VideoFragmentRow[]) {
    this.rows = rows;
  }

  #sorted(): VideoFragmentRow[] {
    return [...this.rows].sort((a, b) => key(a).localeCompare(key(b)));
  }

  next(include: FragmentFilter): Promise<VideoFragmentRow | null> {
    return Promise.resolve(
      this.#sorted().find((r) => include(r.sessionId, r.partId, r.index)) ?? null,
    );
  }

  indices(sessionId: string, partId: string, limit: number): Promise<number[]> {
    return Promise.resolve(
      this.#sorted()
        .filter((r) => r.sessionId === sessionId && r.partId === partId)
        .map((r) => r.index)
        .slice(0, limit),
    );
  }

  count(include: FragmentFilter): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => include(r.sessionId, r.partId, r.index)).length);
  }

  remove(target: VideoFragmentRow): Promise<void> {
    this.rows = this.rows.filter((r) => key(r) !== key(target));
    return Promise.resolve();
  }
}

interface Harness {
  queue: MemoryQueue;
  uploader: VideoUploader;
  puts: string[];
  signs: { sessionId: string; indices: number[]; contentType: string }[];
  progress: { pending: number; uploaded: number }[];
  idle: number;
  errors: string[];
}

function harness(rows: VideoFragmentRow[], overrides: Partial<VideoUploaderOptions> = {}): Harness {
  const queue = new MemoryQueue(rows);
  const h: Harness = {
    queue,
    uploader: undefined as unknown as VideoUploader,
    puts: [],
    signs: [],
    progress: [],
    idle: 0,
    errors: [],
  };
  h.uploader = new VideoUploader({
    queue,
    sign(sessionId, partId, indices, contentType) {
      h.signs.push({ sessionId, indices, contentType });
      const signed: SignedFragment[] = indices.map((index) => ({
        index,
        url: `https://upload/${sessionId}/${partId}/${index}`,
        expiresAt: Date.now() + 15 * 60_000,
      }));
      return Promise.resolve(signed);
    },
    put(url) {
      h.puts.push(url);
      return Promise.resolve();
    },
    canUpload: () => true,
    isUploadable: (sessionId) => sessionId.startsWith('ses_'),
    onProgress: (p) => h.progress.push(p),
    onIdle: () => (h.idle += 1),
    onError: (context) => h.errors.push(context),
    ...overrides,
  });
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VideoUploader (ADR-0011 §3.3)', () => {
  it('uploads oldest first, one at a time, and deletes each fragment only after its PUT', async () => {
    const h = harness([row('ses_B', 'vp_1', 0), row('ses_A', 'vp_2', 1), row('ses_A', 'vp_2', 0)]);
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.puts).toEqual([
      'https://upload/ses_A/vp_2/0',
      'https://upload/ses_A/vp_2/1',
      'https://upload/ses_B/vp_1/0',
    ]);
    expect(h.queue.rows).toEqual([]);
    expect(h.progress.map((p) => p.pending)).toEqual([2, 1, 0, 0]);
    expect(h.uploader.uploaded).toBe(3);
    expect(h.idle).toBe(1);
    h.uploader.stop();
  });

  it('sends the signed headers with each PUT (Cloud Storage size range, S2-14)', async () => {
    const sent: Record<string, string>[] = [];
    const h = harness([row('ses_A', 'vp_1', 0)], {
      sign: (_s, _p, indices) =>
        Promise.resolve(
          indices.map((index) => ({
            index,
            url: `https://storage.googleapis.com/b/${index}`,
            expiresAt: Date.now() + 15 * 60_000,
            headers: { 'x-goog-content-length-range': '0,8388608' },
          })),
        ),
      put: (_url, _blob, _type, headers) => {
        sent.push(headers ?? {});
        return Promise.resolve();
      },
    });
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ 'x-goog-content-length-range': '0,8388608' }]);
    h.uploader.stop();
  });

  it('signs a part in one batch and reuses the URLs', async () => {
    const h = harness([0, 1, 2].map((i) => row('ses_A', 'vp_1', i)));
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.signs).toEqual([{ sessionId: 'ses_A', indices: [0, 1, 2], contentType: 'video/mp4' }]);
    expect(h.puts).toHaveLength(3);
    h.uploader.stop();
  });

  it('waits while audio needs the link and resumes when it is clear', async () => {
    let audioClear = false;
    const h = harness([row('ses_A', 'vp_1', 0)], { canUpload: () => audioClear });
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.puts).toEqual([]);

    audioClear = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.puts).toEqual(['https://upload/ses_A/vp_1/0']);
    h.uploader.stop();
  });

  it('keeps a fragment after a failed PUT and retries it with a fresh URL after a backoff', async () => {
    let failures = 1;
    const h = harness([row('ses_A', 'vp_1', 0)], {
      put(url) {
        h.puts.push(url);
        if (failures-- > 0) return Promise.reject(new Error('HTTP 503'));
        return Promise.resolve();
      },
    });
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.queue.rows).toHaveLength(1);
    expect(h.errors).toEqual(['video upload failed']);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.queue.rows).toEqual([]);
    expect(h.puts).toHaveLength(2);
    expect(h.signs).toHaveLength(2);
    h.uploader.stop();
  });

  it('skips a session the server rejects but keeps its fragments, and uploads the rest', async () => {
    const h = harness([row('ses_A', 'vp_1', 0), row('ses_B', 'vp_2', 0)], {
      sign(sessionId, partId, indices) {
        if (sessionId === 'ses_A') return Promise.reject(new UploadRejected());
        return Promise.resolve(
          indices.map((index) => ({
            index,
            url: `https://upload/${partId}/${index}`,
            expiresAt: Date.now() + 900_000,
          })),
        );
      },
    });
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toEqual(['https://upload/vp_2/0']);
    expect(h.queue.rows.map((r) => r.sessionId)).toEqual(['ses_A']);
    expect(await h.uploader.pending()).toBe(0);
    h.uploader.stop();
  });

  it('moves past a fragment the server refuses for good, keeping it locally', async () => {
    const h = harness([row('ses_A', 'vp_1', 0), row('ses_A', 'vp_1', 1)], {
      put(url) {
        h.puts.push(url);
        if (url.endsWith('/0')) return Promise.reject(new FragmentRejected(413));
        return Promise.resolve();
      },
    });
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toEqual(['https://upload/ses_A/vp_1/0', 'https://upload/ses_A/vp_1/1']);
    expect(h.queue.rows.map((r) => r.index)).toEqual([0]);
    expect(await h.uploader.pending()).toBe(0);
    expect(h.idle).toBe(1);
    h.uploader.stop();
  });

  it('never uploads or counts recordings made without the gateway', async () => {
    const h = harness([row('local_X', 'vp_1', 0)]);
    expect(await h.uploader.pending()).toBe(0);
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toEqual([]);
    expect(h.idle).toBe(1);
    h.uploader.stop();
  });

  it('wakes from idle when a new fragment is written', async () => {
    const h = harness([]);
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    h.queue.rows.push(row('ses_A', 'vp_1', 0));
    h.uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toEqual(['https://upload/ses_A/vp_1/0']);
    h.uploader.stop();
  });
});

describe('baseContentType', () => {
  it('drops codec parameters', () => {
    expect(baseContentType('video/mp4;codecs=avc1,opus')).toBe('video/mp4');
    expect(baseContentType('video/webm')).toBe('video/webm');
  });
});
