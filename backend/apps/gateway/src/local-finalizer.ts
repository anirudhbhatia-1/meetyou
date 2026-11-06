import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { finalizeVideo, uploadsComplete, type FfmpegTools } from '@meetyou/video';

import type { ChunkStore } from './chunk-store.ts';
import { errorCode, log } from './log.ts';

/**
 * Local dev without Postgres (so without the job queue): runs `video.finalize` in this process
 * once an ended session's fragments have all arrived (ADR-0011 §3.4). Staging runs the queue task
 * (`@meetyou/video` videoFinalizeTask) in the worker instead.
 */
export class LocalVideoFinalizer {
  readonly #store: ChunkStore;
  readonly #tools: FfmpegTools | undefined;
  /** Per meeting, requests run one after another, so each re-checks after the previous one. */
  readonly #chains = new Map<string, Promise<void>>();

  constructor(store: ChunkStore, tools?: FfmpegTools) {
    this.#store = store;
    this.#tools = tools;
  }

  /**
   * Finalizes when every fragment is present, or at once with `force` (dev route). A request that
   * arrives while another runs is not merged into it: the running check may have seen the meeting
   * before this request's fragment was stored, so it runs again afterwards.
   */
  request(workspaceId: string, meetingId: string, force = false): Promise<void> {
    const key = `${workspaceId}/${meetingId}`;
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.#run(workspaceId, meetingId, force))
      .catch((error: unknown) => {
        // Listing failed (storage unreachable); the next upload or the dev route asks again.
        log('video.finalize_failed', { meetingId, code: errorCode(error) });
      });
    this.#chains.set(key, next);
    void next.then(() => {
      if (this.#chains.get(key) === next) this.#chains.delete(key);
    });
    return next;
  }

  async #run(workspaceId: string, meetingId: string, force: boolean): Promise<void> {
    const stored = await this.#store.listVideo(workspaceId, meetingId);
    if (stored.length === 0) return;
    const timing = await this.#store.listVideoPartInfo(workspaceId, meetingId);
    if (!force && !uploadsComplete(stored, timing)) return;
    const workDir = await mkdtemp(join(tmpdir(), 'minutes-finalize-'));
    try {
      const result = await finalizeVideo({
        store: this.#store,
        workspaceId,
        meetingId,
        workDir,
        ...(this.#tools !== undefined ? { tools: this.#tools } : {}),
      });
      if (result === null) {
        log('video.finalize_nothing_playable', { meetingId });
        return;
      }
      await this.#store.deleteVideoFragments(workspaceId, meetingId);
      log('video.finalized', {
        meetingId,
        durationMs: result.durationMs,
        parts: result.parts.length,
        bytes: result.bytes,
      });
    } catch (error: unknown) {
      // Fragments stay; the next request (another upload, or the dev route) tries again.
      log('video.finalize_failed', { meetingId, code: errorCode(error) });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
