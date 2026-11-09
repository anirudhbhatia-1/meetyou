import { describe, expect, it } from 'vitest';

import {
  ActionItemList,
  ListActionItemsQuery,
  ListMeetingsQuery,
  MeResponse,
  PatchMeetingRequest,
  PatchSettingsRequest,
  PatchSummaryItemRequest,
  PutGlossaryRequest,
  PutNotesRequest,
  RecoverSessionResponse,
} from './api.ts';

const ULID = '01J00000000000000000000000';

describe('Phase 1 endpoint shapes (ARCHITECTURE §12.1)', () => {
  it('coerces list queries from the query string and bounds the limit', () => {
    expect(ListMeetingsQuery.parse({})).toEqual({ limit: 20 });
    expect(ListMeetingsQuery.parse({ limit: '50', template: 'standup' })).toEqual({
      limit: 50,
      template: 'standup',
    });
    expect(ListMeetingsQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(ListActionItemsQuery.parse({})).toMatchObject({ status: 'open', owner: 'any' });
  });

  it('refuses empty PATCH bodies and server-owned fields', () => {
    expect(PatchMeetingRequest.safeParse({}).success).toBe(false);
    expect(PatchMeetingRequest.safeParse({ title: '  Weekly sync ' }).data).toEqual({
      title: 'Weekly sync',
    });
    expect(PatchSettingsRequest.safeParse({ retentionPolicy: '30d' }).success).toBe(true);
    expect(PatchSettingsRequest.safeParse({ consentAcknowledged: true }).success).toBe(true);
    // The acknowledgement time is set by the server only.
    expect(
      PatchSettingsRequest.parse({
        recordVideo: false,
        consentAcknowledgedAt: '2026-11-06T10:00:00Z',
      } as unknown),
    ).toEqual({ recordVideo: false });
    expect(PatchSummaryItemRequest.safeParse({ status: 'done' }).success).toBe(true);
    expect(PatchSummaryItemRequest.safeParse({ dueDate: '15 Nov' }).success).toBe(false);
  });

  it('validates sessions, notes and glossary limits', () => {
    expect(RecoverSessionResponse.parse({ state: 'ended', meetingId: `mtg_${ULID}` }).state).toBe(
      'ended',
    );
    const note = { id: 'note_1', sessionMs: 0, marker: null, text: 'x' };
    expect(PutNotesRequest.safeParse({ notes: Array(501).fill(note) }).success).toBe(false);
    expect(PutGlossaryRequest.safeParse({ terms: ['Minutes', 'staging, db'] }).success).toBe(false);
    expect(PutGlossaryRequest.safeParse({ terms: Array(51).fill('x') }).success).toBe(false);
  });

  it('parses responses the clients read', () => {
    expect(
      MeResponse.safeParse({
        userId: 'usr_1',
        workspaceId: 'ws_1',
        email: 'a@example.com',
        displayName: 'A',
      }).success,
    ).toBe(true);
    expect(ActionItemList.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
