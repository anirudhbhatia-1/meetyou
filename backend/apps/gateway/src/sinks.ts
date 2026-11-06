import { newUlid, type Segment } from '@meetyou/contracts';
import {
  endMeeting,
  storeSegments,
  upsertRealtimeUsage,
  upsertVideoAsset,
  type Db,
} from '@meetyou/db';

import { enqueue } from '@meetyou/queue';
import { videoFinalizeJob, videoFinalizeJobKey } from '@meetyou/video';

import type { ChunkStore, VideoPartInfo } from './chunk-store.ts';
import type { SessionUsage } from './usage.ts';

/** Which meeting a session writes into (the meeting ID is the session ID without a database). */
export interface SessionTarget {
  workspaceId: string;
  sessionId: string;
  meetingId: string;
}

/**
 * Where a session's results go (ARCHITECTURE §6.1 steps 4 and 7, §8.1 step 5). Calls for one
 * session arrive in order; implementations must be safe to retry (IDs are fixed upstream).
 */
export interface SessionSink {
  segments(target: SessionTarget, segments: readonly Segment[]): Promise<void>;
  usage(target: SessionTarget, usage: SessionUsage): Promise<void>;
  ended(target: SessionTarget, endedAt: Date): Promise<void>;
  /** Video part timing (ADR-0011 §3.4); `video.finalize` lines parts up on the session clock. */
  videoPart(
    target: SessionTarget,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void>;
}

/** Local dev without a database: next to the audio in the chunk store. */
export class FileSink implements SessionSink {
  readonly #store: ChunkStore;

  constructor(store: ChunkStore) {
    this.#store = store;
  }

  segments(target: SessionTarget, segments: readonly Segment[]): Promise<void> {
    return this.#store.appendSegments(target.workspaceId, target.meetingId, segments);
  }

  usage(target: SessionTarget, usage: SessionUsage): Promise<void> {
    return this.#store.putUsage(usage, target.meetingId);
  }

  ended(): Promise<void> {
    return Promise.resolve();
  }

  videoPart(
    target: SessionTarget,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void> {
    return this.#store.putVideoPartInfo(target.workspaceId, target.meetingId, info);
  }
}

/**
 * Postgres (S2-05, S2-07): segments in `transcript_segments`, usage in `usage_records`, and the
 * meeting moves to processing when the recording ends. The usage file is still written for
 * `check-session`. TODO(S3-03): enqueue the processing pipeline in the same transaction (outbox).
 */
export class DbSink implements SessionSink {
  readonly #db: Db;
  readonly #store: ChunkStore;
  readonly #enqueueVideoFinalize: boolean;

  /**
   * `enqueueVideoFinalize`: the meeting's end also creates the `video.finalize` job in the same
   * transaction (the queue is the outbox, ADR-0005); needs the worker's queue schema.
   */
  constructor(db: Db, store: ChunkStore, options: { enqueueVideoFinalize?: boolean } = {}) {
    this.#db = db;
    this.#store = store;
    this.#enqueueVideoFinalize = options.enqueueVideoFinalize ?? false;
  }

  segments(target: SessionTarget, segments: readonly Segment[]): Promise<void> {
    return this.#db.inWorkspace(target.workspaceId, (tx) =>
      storeSegments(tx, segments, () => `spc_${newUlid()}`),
    );
  }

  async usage(target: SessionTarget, usage: SessionUsage): Promise<void> {
    await this.#store.putUsage(usage, target.meetingId);
    await this.#db.inWorkspace(target.workspaceId, (tx) =>
      upsertRealtimeUsage(tx, {
        workspaceId: target.workspaceId,
        meetingId: target.meetingId,
        sttProvider: usage.stt.provider,
        sttSecondsMe: usage.stt.audioMs.me / 1000,
        sttSecondsThem: usage.stt.audioMs.them / 1000,
        storageBytes: usage.bytesStored,
        estimatedCostUsd: usage.estimatedCostUsd,
      }),
    );
  }

  ended(target: SessionTarget, endedAt: Date): Promise<void> {
    return this.#db.inWorkspace(target.workspaceId, async (tx) => {
      await endMeeting(tx, target.meetingId, endedAt);
      if (this.#enqueueVideoFinalize) {
        // The task waits for late uploads itself (re-checks, 24 h cap, ADR-0011 §3.4).
        await enqueue(
          tx,
          videoFinalizeJob,
          { workspaceId: target.workspaceId, meetingId: target.meetingId },
          { jobKey: videoFinalizeJobKey(target.meetingId) },
        );
      }
    });
  }

  /** Timing next to the fragments (finalize reads it there) and a `video_assets` row per part. */
  async videoPart(
    target: SessionTarget,
    info: Partial<VideoPartInfo> & { partId: string },
  ): Promise<void> {
    await this.#store.putVideoPartInfo(target.workspaceId, target.meetingId, info);
    const part = (await this.#store.listVideoPartInfo(target.workspaceId, target.meetingId)).find(
      (p) => p.partId === info.partId,
    );
    if (part === undefined) return;
    await this.#db.inWorkspace(target.workspaceId, (tx) =>
      upsertVideoAsset(tx, {
        id: `va_${part.partId}`,
        workspaceId: target.workspaceId,
        meetingId: target.meetingId,
        partId: part.partId,
        status: 'uploading',
        mimeType: part.mimeType,
        startMs: part.startMs,
        durationMs: null,
        fragments: part.fragments ?? null,
        storageKey: null,
        bytes: null,
        deleteAfter: null,
      }),
    );
  }
}
