import type {
  AskUsage,
  ConsentLogEntry,
  ExportView,
  PatchSettingsRequest,
  ProductEvent,
  UserSettings,
  Meeting,
  MeetingProgress,
  MeetingQuestion,
  Note,
  Segment,
  SummaryItem,
  VideoPlaybackResponse,
} from '@meetyou/contracts';

export type {
  AskUsage,
  ConsentLogEntry,
  ExportView,
  PatchSettingsRequest,
  UserSettings,
  Meeting,
  MeetingProgress,
  MeetingQuestion,
  Note,
  Segment,
  SummaryItem,
  VideoPlaybackResponse,
};

/** "Ask this meeting" (DESIGN §12.7): an answer, or why there is none (shown as fixed text). */
export type AskResult =
  | { ok: true; question: MeetingQuestion; usage: AskUsage }
  | { ok: false; error: 'rate_limited' | 'unavailable' | 'no_transcript' | 'failed' };

export interface LaneAudio {
  /** An object URL of the Ogg file (revoke when done). */
  url: string;
  spans: { fileMs: number; sessionMs: number; durationMs: number }[];
}

export interface Participant {
  id: string;
  displayName: string;
  isSelf: boolean;
}

/**
 * Notes tab payload (DESIGN §12.4). Chip numbers are per-summary display indices, each mapping to
 * segment IDs (ARCHITECTURE §10).
 * TODO(S3-08): replace with the `GET /v1/meetings/{id}/summary` DTO from shared/contracts.
 */
export interface MeetingSummary {
  /** The stored version shown (server summaries, S3-08); absent in mock fixtures. */
  summaryId?: string;
  version?: number;
  template?: Meeting['template'];
  /** A regenerated version waiting for Keep / Go back (DESIGN §12.2, FR-SUM-07). */
  candidate?: { version: number; template: Meeting['template'] } | null;
  overview: string;
  /** One per user note, in note order; `note` null = topic section added from the conversation. */
  sections: { note: Note | null; items: SummaryItem[] }[];
  decisions: SummaryItem[];
  questions: SummaryItem[];
  actionItems: SummaryItem[];
  /** Subjects covered, in order: the agenda of Minutes of meeting notes. */
  topics?: string[];
}

export interface ActionItemRow {
  item: SummaryItem;
  meetingId: string;
  meetingTitle: string;
  ownerName: string;
  ownedBySelf: boolean;
}

export interface MeetingFilter {
  query: string;
  template: Meeting['template'] | 'all';
}

/** What the library screens need from the API (ARCHITECTURE §12.1, DESIGN §17). */
export interface LibraryApi {
  me(): Promise<{ firstName: string; name: string; email: string }>;
  /** DESIGN §15 (S4-12): every change saves at once; returns what the server stored. */
  getSettings(): Promise<UserSettings>;
  patchSettings(patch: PatchSettingsRequest): Promise<UserSettings>;
  /** DESIGN §11.3: newest first, `count` at a time (50); `more` when older meetings exist. */
  listMeetings(
    filter: MeetingFilter,
    count?: number,
  ): Promise<{ meetings: Meeting[]; more: boolean }>;
  /** DESIGN §12.3 rename. */
  renameMeeting(id: string, title: string): Promise<void>;
  /** DESIGN §12.4 item 7 inline edit, §12.6 owner and due pickers. */
  editSummaryItem(
    id: string,
    patch: { text?: string; ownerParticipantId?: string | null; dueDate?: string | null },
  ): Promise<SummaryItem>;
  /** DESIGN §12.4 item 8, per action item. */
  sendItemFeedback(itemId: string, useful: boolean): Promise<void>;
  /** S4-15 product analytics (typed, no content); the API drops them for an opted-out user. */
  sendEvents(events: ProductEvent[]): Promise<void>;
  /** DESIGN §12.5 speaker rename, whole meeting. */
  renameSpeaker(
    meetingId: string,
    clusterId: string,
    to: { participantId: string } | { name: string },
  ): Promise<{ participantId: string; displayName: string }>;
  /** One lane's audio (meetings without video) and where it sits on the meeting clock; null when deleted. */
  getAudio(meetingId: string, lane: 'me' | 'them'): Promise<LaneAudio | null>;
  /** DESIGN §13.4. */
  getConsentLog(meetingId: string): Promise<ConsentLogEntry[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  getSummary(id: string): Promise<MeetingSummary | null>;
  getSegments(id: string): Promise<Segment[]>;
  getParticipants(id: string): Promise<Participant[]>;
  listActionItems(status: 'open' | 'done' | 'all'): Promise<ActionItemRow[]>;
  setActionItemStatus(id: string, status: 'open' | 'done'): Promise<void>;
  /** Signed playback URL of the finalized video (DESIGN §6.19); null until it is ready. */
  getVideo(
    meetingId: string,
    options?: { download?: boolean },
  ): Promise<VideoPlaybackResponse | null>;
  /** Questions about one recording, oldest first, with the caller's limits (DESIGN §12.7). */
  listQuestions(meetingId: string): Promise<{ items: MeetingQuestion[]; usage: AskUsage } | null>;
  askQuestion(meetingId: string, question: string): Promise<AskResult>;
  /** DESIGN §12.2: rewrite the notes with another template; the result arrives as a candidate. */
  regenerateSummary(meetingId: string, template: Meeting['template']): Promise<void>;
  keepSummary(meetingId: string, version: number): Promise<void>;
  discardSummary(meetingId: string, version: number): Promise<void>;
  /** DESIGN §12.4 item 8 "Were these notes useful?". */
  sendFeedback(summaryId: string, useful: boolean, comment?: string): Promise<void>;
  /** Processing progress until the notes are ready (S3-03); returns an unsubscribe function. */
  watchProgress(meetingId: string, onProgress: (progress: MeetingProgress) => void): () => void;
  /** DESIGN §15.5 vocabulary: words the transcription should listen for (S3-10). */
  getGlossary(): Promise<{ terms: string[]; maxTerms: number }>;
  saveGlossary(
    terms: string[],
  ): Promise<
    { ok: true; terms: string[] } | { ok: false; error: 'too_long' | 'invalid' | 'failed' }
  >;
  /** DESIGN §13.2 "Download all my data" (S3-11): starts or returns the export in progress. */
  startExport(): Promise<ExportView>;
  /** The latest export (for the Settings row), or one by ID with a fresh download link. */
  latestExport(): Promise<ExportView | null>;
  getExport(id: string): Promise<ExportView | null>;
  /** Ends the web session (clears the refresh cookie). */
  signOut(): Promise<void>;
  /** FR-SET-02: soft-deletes a meeting; the server removes it after a short grace period. */
  deleteMeeting(id: string): Promise<void>;
  /** Undo within the grace period (`POST /v1/meetings/{id}:restore`). */
  restoreMeeting(id: string): Promise<void>;
  /** FR-SET-03: deletes the account and every meeting (asynchronously, on the server). */
  deleteAccount(): Promise<void>;
}
