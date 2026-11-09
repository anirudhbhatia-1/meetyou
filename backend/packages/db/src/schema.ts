import type { ColumnType, Generated } from 'kysely';

/**
 * Kysely table types for `migrations/0001_init.sql`, in camelCase (CamelCasePlugin maps them to
 * the snake_case columns). Keep in step with the migrations; values mirror `shared/contracts`.
 */

/** Read as Date; written as Date or ISO string; database default on insert. */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | string | undefined, Date | string>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
/** int8 is read as number (pg.ts TYPE_PARSERS); numeric stays a string. */
type BigIntColumn = ColumnType<number, number | bigint | string, number | bigint | string>;
type NullableBigInt = ColumnType<
  number | null,
  number | bigint | string | null,
  number | bigint | string | null
>;

type Lane = 'me' | 'them';
type Template = 'general' | 'standup' | 'client_call' | 'interview' | 'one_on_one';

interface Audit {
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

export interface WorkspacesTable extends Audit {
  id: string;
  name: string;
  plan: Generated<'free'>;
}

export interface UsersTable extends Audit {
  id: string;
  googleSub: string;
  email: string;
  displayName: string;
}

export interface MembershipsTable extends Audit {
  id: string;
  workspaceId: string;
  userId: string;
  role: Generated<'owner'>;
}

export interface UserSettingsTable extends Audit {
  id: string;
  workspaceId: string;
  userId: string;
  transcriptLanguageMode: Generated<'auto' | 'english' | 'hindi' | 'hinglish'>;
  summaryLanguage: Generated<'english' | 'hindi' | 'hinglish'>;
  hindiScript: Generated<'roman' | 'devanagari'>;
  retentionPolicy: Generated<'immediate' | '7d' | '30d'>;
  recordVideo: Generated<boolean>;
  videoQuality: Generated<'standard' | 'data_saver'>;
  consentMode: Generated<'one_click' | 'automatic' | 'off'>;
  consentMessage: string | null;
  consentAcknowledgedAt: NullableTimestamp;
  followMeetMute: Generated<boolean>;
  offerPrompt: Generated<boolean>;
  defaultTemplate: Generated<Template>;
  analyticsOptOut: Generated<boolean>;
}

export interface MeetingsTable extends Audit {
  id: string;
  workspaceId: string;
  sessionId: string;
  platform: 'google_meet';
  externalMeetingCode: string | null;
  title: Generated<string>;
  template: Generated<Template>;
  startedAt: Timestamp;
  endedAt: NullableTimestamp;
  status: Generated<'recording' | 'processing' | 'ready' | 'updated' | 'failed' | 'too_short'>;
  processingStep: 'finalizing' | 'summarizing' | 'validating' | 'done' | null;
  deletedAt: NullableTimestamp;
}

export interface ParticipantsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  displayName: string;
  isSelf: Generated<boolean>;
  source: 'dom' | 'user_edit';
}

export interface SpeakerClustersTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  lane: Lane;
  providerLabel: string;
  participantId: string | null;
}

export interface AudioAssetsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  lane: Lane | 'mixed';
  storageKey: string;
  codec: 'opus' | 'pcm16';
  bytes: BigIntColumn;
  durationMs: BigIntColumn;
  deleteAfter: NullableTimestamp;
}

export interface VideoAssetsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  partId: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'expired';
  mimeType: 'video/mp4' | 'video/webm';
  startMs: ColumnType<number, number | string | undefined, number | string>;
  durationMs: NullableBigInt;
  fragments: number | null;
  storageKey: string | null;
  bytes: NullableBigInt;
  deleteAfter: NullableTimestamp;
}

export interface TranscriptSegmentsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  lane: Lane;
  speakerClusterId: string | null;
  startMs: BigIntColumn;
  endMs: BigIntColumn;
  text: string;
  rawText: string;
  language: string;
  source: 'live' | 'batch';
  words: ColumnType<unknown, string | null, string | null> | null;
  flags: Generated<('echo' | 'low_confidence')[]>;
}

export interface NotesTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  text: string;
  sessionMs: BigIntColumn;
  marker: 'decision' | 'action' | 'question' | 'important' | null;
  order: Generated<number>;
}

export interface SummariesTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  version: number;
  template: Template;
  language: string;
  model: string;
  status: 'pending' | 'ready' | 'failed';
  overview: string | null;
  accepted: Generated<boolean>;
}

export interface SummaryItemsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  summaryId: string;
  kind: 'anchor_detail' | 'decision' | 'action_item' | 'question' | 'topic';
  text: string;
  anchorNoteId: string | null;
  ownerParticipantId: string | null;
  /** 'YYYY-MM-DD', as in the SummaryItem contract. */
  dueDate: string | null;
  duePhrase: string | null;
  status: 'open' | 'done' | null;
  completedAt: NullableTimestamp;
  userEdited: Generated<boolean>;
  flagged: Generated<boolean>;
  order: Generated<number>;
}

export interface CitationsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  summaryItemId: string;
  segmentId: string;
}

export interface GlossaryTermsTable extends Audit {
  id: string;
  workspaceId: string;
  term: string;
  createdBy: string | null;
}

export interface ConsentLogsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  mode: 'one_click' | 'automatic' | 'off';
  outcome: 'posted' | 'skipped' | 'failed';
  /** Generated from `outcome`. */
  noticeSent: ColumnType<boolean, never, never>;
  noticeText: string | null;
  sentAt: NullableTimestamp;
}

export interface FeedbackTable extends Audit {
  id: string;
  workspaceId: string;
  targetType: 'summary' | 'summary_item' | 'segment';
  targetId: string;
  rating: -1 | 0 | 1;
  comment: string | null;
}

export interface UsageRecordsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  sttProvider: string | null;
  sttSecondsMe: ColumnType<string, number | string | undefined, number | string>;
  sttSecondsThem: ColumnType<string, number | string | undefined, number | string>;
  llmModel: string | null;
  inputTokens: ColumnType<number, number | string | undefined, number | string>;
  outputTokens: ColumnType<number, number | string | undefined, number | string>;
  storageBytes: ColumnType<number, number | string | undefined, number | string>;
  estimatedCostUsd: ColumnType<string, number | string | undefined, number | string>;
}

export interface DeletionRequestsTable extends Audit {
  id: string;
  /** Null once the workspace itself is deleted (the audit row stays). */
  workspaceId: string | null;
  scope: 'meeting' | 'account';
  targetId: string;
  requestedAt: CreatedAt;
  executeAfter: Timestamp;
  cancelledAt: NullableTimestamp;
  completedAt: NullableTimestamp;
}

/** `0004_meeting_questions.sql`: "Ask this meeting" (FEATURES E4, Phase 1 since 2026-11-07). */
export interface MeetingQuestionsTable extends Audit {
  id: string;
  workspaceId: string;
  meetingId: string;
  userId: string;
  question: string;
  status: 'answered' | 'not_in_meeting' | 'off_topic';
  answer: string | null;
  segmentIds: Generated<string[]>;
  model: string;
  inputTokens: ColumnType<number, number | string | undefined, number | string>;
  outputTokens: ColumnType<number, number | string | undefined, number | string>;
  thinkingTokens: ColumnType<number, number | string | undefined, number | string>;
}

/** `0006_exports.sql`: "Download all my data" (S3-11, FR-SET-04). */
export interface ExportsTable extends Audit {
  id: string;
  workspaceId: string;
  userId: string;
  status: Generated<'preparing' | 'ready' | 'failed' | 'expired'>;
  storageKey: string | null;
  sizeBytes: NullableBigInt;
  meetingCount: number | null;
  readyAt: NullableTimestamp;
  expiresAt: NullableTimestamp;
}

export interface RefreshTokenFamiliesTable extends Audit {
  id: string;
  userId: string;
  workspaceId: string;
  revokedAt: NullableTimestamp;
  revokeReason: 'logout' | 'reuse' | 'account_deleted' | null;
}

export interface RefreshTokensTable extends Audit {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Timestamp;
  usedAt: NullableTimestamp;
}

export interface Database {
  workspaces: WorkspacesTable;
  users: UsersTable;
  memberships: MembershipsTable;
  userSettings: UserSettingsTable;
  meetings: MeetingsTable;
  participants: ParticipantsTable;
  speakerClusters: SpeakerClustersTable;
  audioAssets: AudioAssetsTable;
  videoAssets: VideoAssetsTable;
  transcriptSegments: TranscriptSegmentsTable;
  notes: NotesTable;
  summaries: SummariesTable;
  summaryItems: SummaryItemsTable;
  citations: CitationsTable;
  glossaryTerms: GlossaryTermsTable;
  consentLogs: ConsentLogsTable;
  feedback: FeedbackTable;
  usageRecords: UsageRecordsTable;
  deletionRequests: DeletionRequestsTable;
  meetingQuestions: MeetingQuestionsTable;
  exports: ExportsTable;
  refreshTokenFamilies: RefreshTokenFamiliesTable;
  refreshTokens: RefreshTokensTable;
}
