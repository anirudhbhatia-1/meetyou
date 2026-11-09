import type {
  AskUsage,
  ExportView,
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
  ExportView,
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
  me(): Promise<{ firstName: string; email: string }>;
  listMeetings(filter: MeetingFilter): Promise<Meeting[]>;
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
  ): Promise<{ ok: true; terms: string[] } | { ok: false; error: 'too_long' | 'invalid' }>;
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
