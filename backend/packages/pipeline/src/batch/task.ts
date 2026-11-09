import { newUlid, type Lane, type Segment } from '@meetyou/contracts';
import { storeSegments, type Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import type { BatchSegment, SttBatchProvider } from '@meetyou/providers';
import { defineTask, enqueue, jobKey } from '@meetyou/queue';
import type { ObjectBucket } from '@meetyou/storage';
import { z } from 'zod';

import { summarizeJob, summarizeJobKey } from '../task.ts';
import { MATERIAL_CHANGE, mapSegmentIds, transcriptChange } from './align.ts';
import { joinLaneAudio, type TimeMap } from './lane-audio.ts';
import { applySpeakerNames, nameLiveClusters } from './naming.ts';

export const MEETING_RETRANSCRIBE = 'meeting.retranscribe';

/** IDs only (ADR-0005 §3.1). */
export const RetranscribePayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
});
export type RetranscribePayload = z.infer<typeof RetranscribePayload>;

export const retranscribeJob = {
  name: MEETING_RETRANSCRIBE,
  schema: RetranscribePayload,
  maxAttempts: 5,
} as const;

export function retranscribeJobKey(meetingId: string): string {
  return jobKey(MEETING_RETRANSCRIBE, meetingId, 1);
}

/** Short meetings gain little from a second pass (ARCHITECTURE §22 cost levers). */
export const MIN_BATCH_MS = 2 * 60 * 1000;

const LANES: readonly Lane[] = ['me', 'them'];
const log = createLogger('batch');

/** Provider HTTP errors that will not succeed on retry (bad request, auth, too large). */
function permanent(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

interface NewSegment extends Segment {
  /** Batch diarization label on the `them` lane, before it becomes a cluster row. */
  cluster?: string;
}

function toSegments(
  workspaceId: string,
  meetingId: string,
  lane: Lane,
  batch: readonly BatchSegment[],
  time: TimeMap,
): NewSegment[] {
  return batch.map((b) => {
    const cluster =
      lane === 'them' && b.speaker !== undefined ? `batch_spk_${b.speaker + 1}` : undefined;
    const startMs = time.toSession(b.startMs);
    return {
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane,
      ...(cluster !== undefined ? { speakerClusterId: cluster, cluster } : {}),
      startMs,
      endMs: Math.max(startMs, time.toSession(b.endMs)),
      text: b.text,
      rawText: b.text,
      language: b.language ?? 'und',
      source: 'batch',
      flags: [],
      words: b.words.map((w) => ({
        text: w.text,
        startMs: time.toSession(w.startMs),
        endMs: time.toSession(w.endMs),
      })),
    };
  });
}

/**
 * The batch pass (S3-04, ARCHITECTURE §9.2 steps 6–8, FR-PROC-02): re-transcribe the stored audio
 * of each lane with the batch model, name `them` clusters from Meet's active-speaker signal, and —
 * when the words changed materially — replace the live segments, re-point citations and answers to
 * the new segments, and rewrite the notes (reason `batch`, status `updated`). Otherwise only the
 * speaker names are applied. Runs after the first notes, never instead of them.
 */
export function retranscribeTask(deps: {
  db: Db;
  bucket: ObjectBucket;
  stt: SttBatchProvider | null;
}) {
  return defineTask(
    MEETING_RETRANSCRIBE,
    RetranscribePayload,
    async ({ workspaceId, meetingId }) => {
      if (deps.stt === null) return;
      const meeting = await deps.db.inWorkspace(workspaceId, (tx) =>
        tx
          .selectFrom('meetings')
          .select(['status', 'startedAt', 'endedAt', 'deletedAt'])
          .where('id', '=', meetingId)
          .executeTakeFirst(),
      );
      if (meeting === undefined || meeting.deletedAt !== null) return;
      if (meeting.status !== 'ready' && meeting.status !== 'updated') return;

      const fresh: NewSegment[] = [];
      const seconds: Record<Lane, number> = { me: 0, them: 0 };
      for (const lane of LANES) {
        const audio = await joinLaneAudio(deps.bucket, workspaceId, meetingId, lane);
        if (audio === null) continue;
        let result;
        try {
          result = await deps.stt.transcribe(
            { kind: 'bytes', bytes: audio.ogg, contentType: 'audio/ogg' },
            { diarize: lane === 'them' },
          );
        } catch (error) {
          if (!permanent(error)) throw error; // outage: the queue retries with backoff
          log.error('batch.failed', { meetingId, lane, code: errorCode(error) });
          return;
        }
        seconds[lane] = audio.timeMap.durationMs / 1000;
        fresh.push(...toSegments(workspaceId, meetingId, lane, result.segments, audio.timeMap));
      }
      if (fresh.length === 0) {
        log.log('batch.skipped', { meetingId, reason: 'no_audio' });
        return;
      }

      const outcome = await deps.db.inWorkspace(workspaceId, async (tx) => {
        const live = await tx
          .selectFrom('transcriptSegments')
          .select(['id', 'lane', 'startMs', 'endMs', 'text', 'flags', 'speakerClusterId'])
          .where('meetingId', '=', meetingId)
          .orderBy('startMs')
          .execute();
        const liveTimed = live.map((s) => ({
          id: s.id,
          lane: s.lane,
          startMs: Number(s.startMs),
          endMs: Number(s.endMs),
        }));
        // Echo (the other lane heard through the mic) stays echo: a new `me` segment mostly
        // inside live echo is flagged too, so it never becomes a citation.
        const echo = liveTimed.filter((_, i) => (live[i]?.flags ?? []).includes('echo'));
        for (const s of fresh) {
          if (s.lane !== 'me') continue;
          const covered = echo.reduce(
            (n, e) => n + Math.max(0, Math.min(e.endMs, s.endMs) - Math.max(e.startMs, s.startMs)),
            0,
          );
          if (covered * 2 > s.endMs - s.startMs) s.flags = ['echo'];
        }
        const spoken = (texts: { text: string; echo: boolean }[]) =>
          texts.filter((t) => !t.echo).map((t) => t.text);
        const change = transcriptChange(
          spoken(live.map((s) => ({ text: s.text, echo: (s.flags ?? []).includes('echo') }))),
          spoken(fresh.map((s) => ({ text: s.text, echo: s.flags.includes('echo') }))),
        );

        await tx
          .insertInto('usageRecords')
          .values({
            id: `use_batch_${meetingId}`,
            workspaceId,
            meetingId,
            sttProvider: `${deps.stt?.name ?? 'unknown'}:batch`,
            sttSecondsMe: seconds.me.toFixed(3),
            sttSecondsThem: seconds.them.toFixed(3),
            estimatedCostUsd: (
              ((seconds.me + seconds.them) / 60) *
              (deps.stt?.usdPerMinute ?? 0)
            ).toFixed(6),
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();

        if (change < MATERIAL_CHANGE) {
          // Same words: keep the live segments (and their IDs); only name the live clusters.
          return { replaced: false, change, named: await nameLiveClusters(tx, meetingId) };
        }

        await storeSegments(tx, fresh, () => `spc_${newUlid()}`);
        const ids = mapSegmentIds(liveTimed, fresh);
        // Citations first (NO ACTION foreign key): each old ID points to its new segment.
        const cites = await tx
          .selectFrom('citations')
          .select(['id', 'summaryItemId', 'segmentId'])
          .where('meetingId', '=', meetingId)
          .execute();
        const kept = new Set<string>();
        for (const c of cites) {
          const target = ids.get(c.segmentId);
          const key = `${c.summaryItemId}|${target}`;
          if (target === undefined || kept.has(key)) {
            await tx.deleteFrom('citations').where('id', '=', c.id).execute();
            continue;
          }
          kept.add(key);
          await tx
            .updateTable('citations')
            .set({ segmentId: target })
            .where('id', '=', c.id)
            .execute();
        }
        const questions = await tx
          .selectFrom('meetingQuestions')
          .select(['id', 'segmentIds'])
          .where('meetingId', '=', meetingId)
          .execute();
        for (const q of questions) {
          const mapped = [
            ...new Set(q.segmentIds.map((id) => ids.get(id)).filter((id) => id !== undefined)),
          ];
          await tx
            .updateTable('meetingQuestions')
            .set({ segmentIds: mapped })
            .where('id', '=', q.id)
            .execute();
        }
        if (liveTimed.length > 0) {
          await tx
            .deleteFrom('transcriptSegments')
            .where('meetingId', '=', meetingId)
            .where(
              'id',
              'in',
              liveTimed.map((s) => s.id),
            )
            .execute();
        }

        // Live clusters are replaced by the batch ones; a person already named on a live cluster
        // (by the user or an earlier pass) moves to the batch cluster most of its speech went to.
        const oldClusters = await tx
          .selectFrom('speakerClusters')
          .select(['id', 'providerLabel', 'participantId'])
          .where('meetingId', '=', meetingId)
          .execute();
        const personOf = new Map(oldClusters.map((c) => [c.id, c.participantId]));
        const labelOfNew = new Map(fresh.map((s) => [s.id, s.cluster]));
        const votes = new Map<string, Map<string, number>>();
        for (const s of live) {
          const person = personOf.get(s.speakerClusterId ?? '');
          const label = labelOfNew.get(ids.get(s.id) ?? '');
          if (person == null || label === undefined) continue;
          const v = votes.get(label) ?? new Map<string, number>();
          v.set(person, (v.get(person) ?? 0) + Number(s.endMs) - Number(s.startMs));
          votes.set(label, v);
        }
        await tx
          .deleteFrom('speakerClusters')
          .where('meetingId', '=', meetingId)
          .where('providerLabel', 'not like', 'batch_%')
          .execute();
        const clusters = await tx
          .selectFrom('speakerClusters')
          .select(['id', 'providerLabel'])
          .where('meetingId', '=', meetingId)
          .execute();
        for (const c of clusters) {
          const top = [...(votes.get(c.providerLabel) ?? new Map<string, number>()).entries()].sort(
            (a, b) => b[1] - a[1],
          )[0];
          if (top === undefined) continue;
          await tx
            .updateTable('speakerClusters')
            .set({ participantId: top[0] })
            .where('id', '=', c.id)
            .execute();
        }
        const count = await applySpeakerNames(
          tx,
          meetingId,
          fresh
            .filter((s) => s.cluster !== undefined)
            .map((s) => ({ cluster: s.cluster ?? '', startMs: s.startMs, endMs: s.endMs })),
        );
        await enqueue(
          tx,
          summarizeJob,
          { workspaceId, meetingId, reason: 'batch' },
          { jobKey: summarizeJobKey(meetingId, 'batch') },
        );
        return { replaced: true, change, named: count };
      });
      log.log('batch.done', {
        meetingId,
        replaced: outcome.replaced,
        changePct: Math.round(outcome.change * 1000) / 10,
        segmentCount: fresh.length,
        namedCount: outcome.named,
      });
    },
    { maxAttempts: retranscribeJob.maxAttempts },
  );
}
