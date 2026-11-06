import type { Lane, Segment } from '@meetyou/contracts';

import type { WorkspaceTx } from './db.ts';

/**
 * Realtime-path writes (S2-04, S2-05, S2-07, S2-14). Every function takes a transaction from
 * `Db.inWorkspace`, so row-level security scopes it; callers pass the IDs (prefixed ULIDs).
 * Writes are idempotent where a retry can repeat them (segments, usage, video assets).
 */

export interface NewMeeting {
  id: string;
  workspaceId: string;
  sessionId: string;
  externalMeetingCode: string | null;
  title?: string;
  startedAt: Date;
}

/** The meeting a capture session records into (the API's `POST /sessions`, S2-09, calls this). */
export async function createMeetingForSession(tx: WorkspaceTx, meeting: NewMeeting): Promise<void> {
  await tx
    .insertInto('meetings')
    .values({
      id: meeting.id,
      workspaceId: meeting.workspaceId,
      sessionId: meeting.sessionId,
      platform: 'google_meet',
      externalMeetingCode: meeting.externalMeetingCode,
      ...(meeting.title !== undefined ? { title: meeting.title.slice(0, 200) } : {}),
      startedAt: meeting.startedAt,
    })
    .execute();
}

export async function meetingForSession(
  tx: WorkspaceTx,
  sessionId: string,
): Promise<{ id: string; endedAt: Date | null } | undefined> {
  return tx
    .selectFrom('meetings')
    .select(['id', 'endedAt'])
    .where('sessionId', '=', sessionId)
    .executeTakeFirst();
}

/**
 * Stores final segments (ARCHITECTURE §8.1 step 5). A segment's `speakerClusterId` is the
 * provider's label within the meeting ("spk_2"); it becomes a `speaker_clusters` row, created on
 * first use. A segment stored before (a retry) is left as it is.
 */
export async function storeSegments(
  tx: WorkspaceTx,
  segments: readonly Segment[],
  newClusterId: () => string,
): Promise<void> {
  const clusters = new Map<string, string>();
  for (const segment of segments) {
    const label = segment.speakerClusterId;
    if (label === undefined) continue;
    const key = `${segment.meetingId}|${segment.lane}|${label}`;
    if (clusters.has(key)) continue;
    clusters.set(
      key,
      await clusterRowId(
        tx,
        segment.workspaceId,
        segment.meetingId,
        segment.lane,
        label,
        newClusterId,
      ),
    );
  }
  if (segments.length === 0) return;
  await tx
    .insertInto('transcriptSegments')
    .values(
      segments.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        meetingId: s.meetingId,
        lane: s.lane,
        speakerClusterId:
          s.speakerClusterId === undefined
            ? null
            : (clusters.get(`${s.meetingId}|${s.lane}|${s.speakerClusterId}`) ?? null),
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        rawText: s.rawText,
        language: s.language,
        source: s.source,
        words: s.words === undefined ? null : JSON.stringify(s.words),
        flags: s.flags,
      })),
    )
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

async function clusterRowId(
  tx: WorkspaceTx,
  workspaceId: string,
  meetingId: string,
  lane: Lane,
  providerLabel: string,
  newClusterId: () => string,
): Promise<string> {
  const row = await tx
    .insertInto('speakerClusters')
    .values({
      id: newClusterId(),
      workspaceId,
      meetingId,
      lane,
      providerLabel,
      participantId: null,
    })
    // Touching the row makes RETURNING give the existing ID on a conflict.
    .onConflict((oc) =>
      oc.columns(['meetingId', 'lane', 'providerLabel']).doUpdateSet({ updatedAt: new Date() }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Recording ended: the meeting moves to processing (the pipeline takes it from there, S3-03). */
export async function endMeeting(tx: WorkspaceTx, meetingId: string, endedAt: Date): Promise<void> {
  await tx
    .updateTable('meetings')
    .set({ endedAt, status: 'processing', processingStep: 'finalizing' })
    .where('id', '=', meetingId)
    .where('endedAt', 'is', null)
    .execute();
}

export interface UsageRecord {
  workspaceId: string;
  meetingId: string;
  sttProvider: string | null;
  sttSecondsMe: number;
  sttSecondsThem: number;
  storageBytes: number;
  estimatedCostUsd: number;
}

/** One row per meeting for the realtime path (S2-07), overwritten as counts grow. */
export function realtimeUsageId(meetingId: string): string {
  return `use_rt_${meetingId}`;
}

export async function upsertRealtimeUsage(tx: WorkspaceTx, usage: UsageRecord): Promise<void> {
  const values = {
    sttProvider: usage.sttProvider,
    sttSecondsMe: usage.sttSecondsMe.toFixed(3),
    sttSecondsThem: usage.sttSecondsThem.toFixed(3),
    storageBytes: usage.storageBytes,
    estimatedCostUsd: usage.estimatedCostUsd.toFixed(6),
  };
  await tx
    .insertInto('usageRecords')
    .values({
      id: realtimeUsageId(usage.meetingId),
      workspaceId: usage.workspaceId,
      meetingId: usage.meetingId,
      llmModel: null,
      ...values,
    })
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updatedAt: new Date() }))
    .execute();
}

export interface VideoAssetRow {
  id: string;
  workspaceId: string;
  meetingId: string;
  /** Null for the finalized playback file of the meeting. */
  partId: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'expired';
  mimeType: 'video/mp4' | 'video/webm';
  startMs: number;
  durationMs: number | null;
  fragments: number | null;
  storageKey: string | null;
  bytes: number | null;
  deleteAfter: Date | null;
}

/** One row per part, and one for the finalized file (S2-14); a re-run updates it. */
export async function upsertVideoAsset(tx: WorkspaceTx, row: VideoAssetRow): Promise<void> {
  const { id, workspaceId, meetingId, partId, ...rest } = row;
  await tx
    .insertInto('videoAssets')
    .values({ id, workspaceId, meetingId, partId, ...rest })
    .onConflict((oc) =>
      oc.columns(['meetingId', 'partId']).doUpdateSet({ ...rest, updatedAt: new Date() }),
    )
    .execute();
}

/** Workspace glossary for STT key terms (S2-04, ARCHITECTURE §6.1). */
export async function glossaryTerms(tx: WorkspaceTx): Promise<string[]> {
  const rows = await tx.selectFrom('glossaryTerms').select('term').orderBy('term').execute();
  return rows.map((r) => r.term);
}
