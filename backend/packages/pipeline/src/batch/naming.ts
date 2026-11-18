import type { WorkspaceTx } from '@meetyou/db';

import { nameClusters, soleOtherParticipant } from './align.ts';

/**
 * FR-SPK-03: names `them` clusters of this meeting from Meet's active-speaker signal, given which
 * cluster (by provider label) spoke when, and in a two-person call names the rest after the other
 * person. Only unnamed clusters change: a name the user chose stays (FR-SPK-05). Returns how many
 * clusters were named.
 */
export async function applySpeakerNames(
  tx: WorkspaceTx,
  meetingId: string,
  speech: readonly { cluster: string; startMs: number; endMs: number }[],
): Promise<number> {
  if (speech.length === 0) return 0;
  const signals = (
    await tx
      .selectFrom('speakerSignals')
      .select(['externalId', 'atMs'])
      .where('meetingId', '=', meetingId)
      .execute()
  ).map((s) => ({ externalId: s.externalId, atMs: Number(s.atMs) }));
  const participants = await tx
    .selectFrom('participants')
    .select(['id', 'externalId', 'displayName', 'isSelf'])
    .where('meetingId', '=', meetingId)
    .execute();
  const byExternal = new Map(
    participants.filter((p) => p.externalId !== null).map((p) => [p.externalId ?? '', p.id]),
  );
  const clusters = await tx
    .selectFrom('speakerClusters')
    .select(['id', 'providerLabel'])
    .where('meetingId', '=', meetingId)
    .where('lane', '=', 'them')
    .execute();
  const idOf = new Map(clusters.map((c) => [c.providerLabel, c.id]));
  let count = 0;
  const setName = async (clusterId: string, participantId: string): Promise<void> => {
    const result = await tx
      .updateTable('speakerClusters')
      .set({ participantId })
      .where('id', '=', clusterId)
      .where('participantId', 'is', null)
      .executeTakeFirst();
    count += Number(result.numUpdatedRows);
  };
  if (signals.length > 0) {
    for (const [label, externalId] of nameClusters(speech, signals)) {
      const participantId = byExternal.get(externalId);
      const clusterId = idOf.get(label);
      if (participantId === undefined || clusterId === undefined) continue;
      await setName(clusterId, participantId);
    }
  }
  // A two-person call: every `them` cluster still unnamed is the other person, even when Meet's
  // talking marks were missing or too sparse (diarization often splits one voice in two).
  const other = soleOtherParticipant(participants);
  if (other !== undefined) {
    for (const cluster of clusters) await setName(cluster.id, other);
  }
  return count;
}

/** Names the live (streaming) clusters, before the first notes are written (S3-03 → S3-04). */
export async function nameLiveClusters(tx: WorkspaceTx, meetingId: string): Promise<number> {
  const speech = await tx
    .selectFrom('transcriptSegments as s')
    .innerJoin('speakerClusters as c', 'c.id', 's.speakerClusterId')
    .select(['c.providerLabel', 's.startMs', 's.endMs'])
    .where('s.meetingId', '=', meetingId)
    .where('s.lane', '=', 'them')
    .execute();
  return applySpeakerNames(
    tx,
    meetingId,
    speech.map((s) => ({
      cluster: s.providerLabel,
      startMs: Number(s.startMs),
      endMs: Number(s.endMs),
    })),
  );
}
