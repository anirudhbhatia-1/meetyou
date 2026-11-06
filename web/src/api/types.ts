import type { Meeting, Note, Segment, SummaryItem } from '@meetyou/contracts';

export type { Meeting, Note, Segment, SummaryItem };

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
}
