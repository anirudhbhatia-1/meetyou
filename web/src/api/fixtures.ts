import type { Meeting, Note, Segment, SummaryItem } from '@meetyou/contracts';

import type { MeetingSummary, Participant } from './types.ts';

/**
 * Synthetic demo data (DESIGN §1 rule 4: names and meetings are samples, never real people).
 * Dates are relative to page load so the library always looks recent.
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

export const WORKSPACE = 'ws_01JD0000000000000000000000';
export const ME = { firstName: 'Asha', name: 'Asha Rao', email: 'asha@example.com' };

let segCounter = 0;
const segId = () => `seg_01JD${String(++segCounter).padStart(22, '0')}`;

export const meetings: Meeting[] = [
  {
    id: 'mtg_q4_launch',
    platform: 'google_meet',
    title: 'Q4 launch sync',
    startedAt: at(-2 * HOUR),
    endedAt: at(-2 * HOUR + 42 * 60_000),
    status: 'ready',
    processingStep: 'done',
    template: 'general',
    participantNames: ['Rahul Mehta', 'Neha Kapoor', 'Sameer K.'],
    recordingExpiresAt: at(7 * DAY - 2 * HOUR),
    video: { status: 'ready', durationMs: 42 * 60_000 },
  },
  {
    id: 'mtg_design_review',
    platform: 'google_meet',
    title: 'Design review: onboarding',
    startedAt: at(-20 * 60_000),
    endedAt: at(-2 * 60_000),
    status: 'processing',
    processingStep: 'summarizing',
    template: 'general',
    participantNames: ['Neha Kapoor'],
    recordingExpiresAt: at(7 * DAY),
    video: { status: 'uploading', durationMs: null },
  },
  {
    id: 'mtg_standup',
    platform: 'google_meet',
    title: 'Daily standup',
    startedAt: at(-1 * DAY - 3 * HOUR),
    endedAt: at(-1 * DAY - 3 * HOUR + 14 * 60_000),
    status: 'ready',
    processingStep: 'done',
    template: 'standup',
    participantNames: ['Rahul Mehta', 'Sameer K.', 'Priya S.'],
    recordingExpiresAt: at(6 * DAY - 3 * HOUR),
    video: null,
  },
  {
    id: 'mtg_acme',
    platform: 'google_meet',
    title: 'Acme Retail onboarding call',
    startedAt: at(-3 * DAY - 5 * HOUR),
    endedAt: at(-3 * DAY - 5 * HOUR + 58 * 60_000),
    status: 'updated',
    processingStep: 'done',
    template: 'client_call',
    participantNames: ['Vikram (Acme)', 'Rahul Mehta'],
    recordingExpiresAt: at(4 * DAY - 5 * HOUR),
    video: { status: 'ready', durationMs: 58 * 60_000 },
  },
  {
    id: 'mtg_interview',
    platform: 'google_meet',
    title: 'Frontend interview — round 2',
    startedAt: at(-9 * DAY),
    endedAt: at(-9 * DAY + 3 * 60_000),
    status: 'too_short',
    processingStep: null,
    template: 'interview',
    participantNames: ['Karan D.'],
    recordingExpiresAt: at(-2 * DAY),
    video: null,
  },
];

export const participants: Record<string, Participant[]> = {
  mtg_q4_launch: [
    { id: 'p_self', displayName: 'Asha', isSelf: true },
    { id: 'p_rahul', displayName: 'Rahul Mehta', isSelf: false },
    { id: 'p_neha', displayName: 'Neha Kapoor', isSelf: false },
    { id: 'p_sameer', displayName: 'Sameer K.', isSelf: false },
  ],
  mtg_standup: [
    { id: 'p_self', displayName: 'Asha', isSelf: true },
    { id: 'p_rahul', displayName: 'Rahul Mehta', isSelf: false },
    { id: 'p_sameer', displayName: 'Sameer K.', isSelf: false },
    { id: 'p_priya', displayName: 'Priya S.', isSelf: false },
  ],
};

function seg(
  meetingId: string,
  lane: 'me' | 'them',
  speakerName: string,
  startS: number,
  text: string,
): Segment {
  return {
    id: segId(),
    workspaceId: WORKSPACE,
    meetingId,
    lane,
    speakerName,
    // One diarized cluster per remote speaker, so speaker rename can be tried (DESIGN §12.5).
    ...(lane === 'them'
      ? { speakerClusterId: `spc_${meetingId}_${speakerName.toLowerCase().replace(/\W+/g, '_')}` }
      : {}),
    startMs: startS * 1000,
    endMs: startS * 1000 + Math.max(2000, text.length * 60),
    text,
    rawText: text,
    language: 'hi',
    source: 'live',
    flags: [],
  };
}

const q4 = [
  seg(
    'mtg_q4_launch',
    'them',
    'Rahul Mehta',
    12,
    'Chalo shuru karte hain. Aaj ka main point hai Q4 launch ki date.',
  ),
  seg(
    'mtg_q4_launch',
    'me',
    'You',
    21,
    'Haan, mujhe lagta hai 14 November realistic hai agar QA time pe khatam ho.',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Neha Kapoor',
    34,
    'QA ka last round Monday tak ho jayega, bas payments flow mein do bugs bache hain.',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Sameer K.',
    52,
    'Payments wale bugs main is week fix kar dunga, Thursday tak.',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Rahul Mehta',
    75,
    'Theek hai, toh 14 November final. Marketing ko bhi bata dete hain.',
  ),
  seg(
    'mtg_q4_launch',
    'me',
    'You',
    91,
    'Pricing page ka copy abhi bhi pending hai, woh kaun dekhega?',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Neha Kapoor',
    103,
    'Main copy draft karke Friday tak share kar dungi.',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Rahul Mehta',
    124,
    'Ek open question hai — kya hum launch ke saath Hindi UI bhi denge?',
  ),
  seg(
    'mtg_q4_launch',
    'them',
    'Sameer K.',
    140,
    'Uske liye translation budget confirm karna padega, abhi clear nahi hai.',
  ),
];
const q4Id = (i: number) => q4[i]?.id ?? '';

const standup = [
  seg('mtg_standup', 'them', 'Rahul Mehta', 5, 'Kal maine search API ka pagination merge kiya.'),
  seg(
    'mtg_standup',
    'them',
    'Sameer K.',
    20,
    'Mera blocker hai staging ka database, Gaurav se baat karni hai.',
  ),
  seg('mtg_standup', 'me', 'You', 41, 'Main aaj onboarding screens ka review karungi.'),
];

export const segments: Record<string, Segment[]> = {
  mtg_q4_launch: q4,
  mtg_standup: standup,
};

const note = (
  id: string,
  sessionMs: number,
  text: string,
  marker: Note['marker'] = null,
): Note => ({
  id,
  sessionMs,
  marker,
  text,
});

function item(
  id: string,
  kind: SummaryItem['kind'],
  text: string,
  segmentIds: string[],
  extra: Partial<SummaryItem> = {},
): SummaryItem {
  return {
    id,
    kind,
    text,
    anchorNoteId: null,
    ownerParticipantId: null,
    dueDate: null,
    duePhrase: null,
    status: kind === 'action_item' ? 'open' : null,
    segmentIds,
    userEdited: false,
    flagged: false,
    ...extra,
  };
}

const launchNote = note('note_launch', 25_000, 'Launch date?');
const pricingNote = note('note_pricing', 95_000, 'Pricing page copy');

export const summaries: Record<string, MeetingSummary> = {
  mtg_q4_launch: {
    overview:
      'The team confirmed 14 November as the Q4 launch date, provided the last QA round finishes on Monday and two payment bugs are fixed this week. Pricing-page copy is the remaining content gap; Hindi UI at launch is still open.',
    sections: [
      {
        note: launchNote,
        items: [
          item(
            'itm_1',
            'anchor_detail',
            '14 November is the launch date, if QA finishes by Monday.',
            [q4Id(1), q4Id(4)],
            { anchorNoteId: launchNote.id },
          ),
          item(
            'itm_2',
            'anchor_detail',
            'Two bugs in the payments flow are the only blockers.',
            [q4Id(2)],
            { anchorNoteId: launchNote.id },
          ),
        ],
      },
      {
        note: pricingNote,
        items: [
          item(
            'itm_3',
            'anchor_detail',
            'Neha will draft the pricing-page copy and share it by Friday.',
            [q4Id(6)],
            { anchorNoteId: pricingNote.id },
          ),
        ],
      },
      {
        note: null,
        items: [item('itm_4', 'topic', 'Marketing will be told about the final date.', [q4Id(4)])],
      },
    ],
    decisions: [item('itm_5', 'decision', 'Launch on 14 November.', [q4Id(4)])],
    questions: [
      item(
        'itm_6',
        'question',
        'Will the Hindi UI ship with the launch? Translation budget is not confirmed.',
        [q4Id(7), q4Id(8)],
      ),
    ],
    actionItems: [
      item('itm_7', 'action_item', 'Fix the two payments-flow bugs', [q4Id(3)], {
        ownerParticipantId: 'p_sameer',
        dueDate: at(2 * DAY).slice(0, 10),
        duePhrase: 'Thursday tak',
      }),
      item('itm_8', 'action_item', 'Draft pricing-page copy', [q4Id(6)], {
        ownerParticipantId: 'p_neha',
        duePhrase: 'Friday tak',
      }),
      item('itm_9', 'action_item', 'Tell marketing the launch date', [q4Id(4)], {
        ownerParticipantId: 'p_self',
        duePhrase: 'this week',
      }),
    ],
  },
  mtg_standup: {
    overview:
      'Short standup: search pagination is merged; Sameer is blocked on the staging database.',
    sections: [
      {
        note: null,
        items: [
          item('itm_10', 'topic', 'Search API pagination was merged yesterday.', [
            standup[0]?.id ?? '',
          ]),
          item('itm_11', 'topic', 'Sameer is blocked on the staging database.', [
            standup[1]?.id ?? '',
          ]),
        ],
      },
    ],
    decisions: [],
    questions: [],
    actionItems: [
      item('itm_12', 'action_item', 'Review the onboarding screens', [standup[2]?.id ?? ''], {
        ownerParticipantId: 'p_self',
        duePhrase: 'today',
      }),
      item(
        'itm_13',
        'action_item',
        'Sort out staging database access with Gaurav',
        [standup[1]?.id ?? ''],
        { ownerParticipantId: 'p_sameer', status: 'done' },
      ),
    ],
  },
};
