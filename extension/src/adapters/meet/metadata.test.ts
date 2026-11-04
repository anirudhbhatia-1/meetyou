/**
 * Unit tests for Google Meet Metadata Extractor Module
 *
 * Verifies:
 * - FR-DET-04: Read meeting title and participant display names.
 * - PRD §13: No emails scraped.
 * - Untrusted text sanitization (HTML, control chars, max length).
 * - Filtering of Meet UI icons and internal action labels.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanParticipantName,
  extractMeetingMetadata,
  extractMeetingTitle,
  extractParticipants,
  sanitizeUntrustedText,
} from './metadata.ts';

interface MockElement {
  textContent?: string;
  getAttribute?(attr: string): string | null;
}

function createMockContainer(
  elements: Record<string, MockElement | MockElement[]> = {},
): ParentNode {
  return {
    querySelector: (selector: string) => {
      for (const [key, val] of Object.entries(elements)) {
        if (selector.includes(key) || key.includes(selector)) {
          const item = Array.isArray(val) ? (val[0] ?? null) : val;
          if (item === null) return null;
          return {
            textContent: item.textContent ?? '',
            getAttribute: (attr: string) => item.getAttribute?.(attr) ?? null,
          } as unknown as Element;
        }
      }
      return null;
    },
    querySelectorAll: (selector: string) => {
      for (const [key, val] of Object.entries(elements)) {
        if (selector.includes(key) || key.includes(selector)) {
          const list = Array.isArray(val) ? val : [val];
          return list.map(
            (item) =>
              ({
                textContent: item.textContent ?? '',
                getAttribute: (attr: string) => item.getAttribute?.(attr) ?? null,
              }) as unknown as Element,
          );
        }
      }
      return [];
    },
  } as unknown as ParentNode;
}

describe('sanitizeUntrustedText', () => {
  it('handles null and undefined gracefully', () => {
    expect(sanitizeUntrustedText(null)).toBe('');
    expect(sanitizeUntrustedText(undefined)).toBe('');
  });

  it('strips HTML tags and script elements', () => {
    const raw = '<b>Team Standup</b> <script>alert("xss")</script>';
    expect(sanitizeUntrustedText(raw)).toBe('Team Standup alert("xss")');
  });

  it('collapses multiple whitespace characters and trims', () => {
    const raw = '   Engineering    Sync \n  Call   ';
    expect(sanitizeUntrustedText(raw)).toBe('Engineering Sync Call');
  });

  it('truncates to maxLength boundary', () => {
    const raw = 'A'.repeat(300);
    expect(sanitizeUntrustedText(raw, 50)).toHaveLength(50);
  });
});

describe('cleanParticipantName', () => {
  it('cleans regular names and detects not-self', () => {
    const res = cleanParticipantName('Alice Smith');
    expect(res).toEqual({ name: 'Alice Smith', isSelf: false });
  });

  it('detects and strips "(You)" suffix and sets isSelf to true', () => {
    const res = cleanParticipantName('Gaurav Sankhla (You)');
    expect(res).toEqual({ name: 'Gaurav Sankhla', isSelf: true });
  });

  it('strips "(Presenting)" suffix and keeps isSelf false', () => {
    const res = cleanParticipantName('Bob (Presenting)');
    expect(res).toEqual({ name: 'Bob', isSelf: false });
  });

  it('extracts name from Meet tile 3-dot menu label "More options for <Name>"', () => {
    const res = cleanParticipantName('More options for Gaurav Sankhla');
    expect(res).toEqual({ name: 'Gaurav Sankhla', isSelf: false });
  });

  it('extracts name from "more_vertMore options for <Name>" icon text', () => {
    const res = cleanParticipantName('more_vertMore options for Gaurav Sankhla');
    expect(res).toEqual({ name: 'Gaurav Sankhla', isSelf: false });
  });

  it('filters out Meet UI icons and internal action labels', () => {
    expect(cleanParticipantName('Open sound settings')).toBeNull();
    expect(cleanParticipantName('frame_personReframe')).toBeNull();
    expect(cleanParticipantName('visual_effectsBackgrounds and effects')).toBeNull();
    expect(cleanParticipantName('more_vert')).toBeNull();
    expect(cleanParticipantName('Others might still see your full video.')).toBeNull();
  });

  it('rejects email addresses per PRD §13', () => {
    expect(cleanParticipantName('user@example.com')).toBeNull();
    expect(cleanParticipantName('sankhlagaurav66@gmail.com')).toBeNull();
  });

  it('rejects empty or single character strings', () => {
    expect(cleanParticipantName('')).toBeNull();
    expect(cleanParticipantName(' ')).toBeNull();
    expect(cleanParticipantName('A')).toBeNull();
  });
});

describe('extractMeetingTitle', () => {
  it('extracts title when a valid title element exists in DOM', () => {
    const dom = createMockContainer({
      'div[data-meeting-title]': { textContent: 'Q4 Product Review' },
    });
    expect(extractMeetingTitle(dom, 'abc-defg-hij')).toBe('Q4 Product Review');
  });

  it('falls back to secondary title selector when primary is absent', () => {
    const dom = createMockContainer({
      'div[jsname="r4nke"]': { textContent: 'Sprint Planning' },
    });
    expect(extractMeetingTitle(dom, 'abc-defg-hij')).toBe('Sprint Planning');
  });

  it('falls back to meeting code when DOM title is missing', () => {
    const dom = createMockContainer({});
    expect(extractMeetingTitle(dom, 'ted-rhqc-ygc')).toBe('ted-rhqc-ygc');
  });

  it('falls back to "Untitled Meeting" when neither DOM title nor code exists', () => {
    const dom = createMockContainer({});
    expect(extractMeetingTitle(dom, null)).toBe('Untitled Meeting');
    expect(extractMeetingTitle(dom, '')).toBe('Untitled Meeting');
  });
});

describe('extractParticipants', () => {
  it('extracts participant from data-self-name and marks isSelf: true', () => {
    const dom = createMockContainer({
      'div[data-self-name]': {
        textContent: '',
        getAttribute: (attr: string) => (attr === 'data-self-name' ? 'Gaurav Sankhla' : null),
      },
    });
    const participants = extractParticipants(dom);
    expect(participants).toEqual([{ displayName: 'Gaurav Sankhla', isSelf: true }]);
  });

  it('extracts participant names from tile "More options for " buttons', () => {
    const dom = createMockContainer({
      'button[aria-label*="More options for " i]': [
        {
          textContent: 'more_vert',
          getAttribute: (attr: string) =>
            attr === 'aria-label' ? 'More options for Alice Wonderland' : null,
        },
        {
          textContent: 'more_vert',
          getAttribute: (attr: string) =>
            attr === 'aria-label' ? 'More options for Bob Builder (You)' : null,
        },
      ],
    });
    const participants = extractParticipants(dom);
    expect(participants).toHaveLength(2);
    expect(participants).toContainEqual({ displayName: 'Alice Wonderland', isSelf: false });
    expect(participants).toContainEqual({ displayName: 'Bob Builder', isSelf: true });
  });

  it('deduplicates participant names and preserves isSelf if any occurrence was self', () => {
    const dom = createMockContainer({
      'div[data-self-name]': {
        textContent: '',
        getAttribute: (attr: string) => (attr === 'data-self-name' ? 'Alice' : null),
      },
      'button[aria-label*="More options for " i]': [
        {
          textContent: '',
          getAttribute: (attr: string) => (attr === 'aria-label' ? 'More options for Alice' : null),
        },
      ],
    });
    const participants = extractParticipants(dom);
    expect(participants).toHaveLength(1);
    expect(participants[0]).toEqual({ displayName: 'Alice', isSelf: true });
  });

  it('ignores UI junk and email elements in participant tiles', () => {
    const dom = createMockContainer({
      'button[aria-label*="More options for " i]': [
        {
          textContent: 'Open sound settings',
          getAttribute: () => null,
        },
        {
          textContent: 'sankhla@gmail.com',
          getAttribute: () => null,
        },
        {
          textContent: '',
          getAttribute: (attr: string) =>
            attr === 'aria-label' ? 'More options for Gaurav Sankhla' : null,
        },
      ],
    });
    const participants = extractParticipants(dom);
    expect(participants).toEqual([{ displayName: 'Gaurav Sankhla', isSelf: false }]);
  });
});

describe('extractMeetingMetadata', () => {
  it('aggregates title, meetingCode, participants, and timestamp', () => {
    const dom = createMockContainer({
      'div[data-meeting-title]': { textContent: 'Project Kickoff' },
      'div[data-self-name]': {
        textContent: '',
        getAttribute: (attr: string) => (attr === 'data-self-name' ? 'Gaurav Sankhla' : null),
      },
    });
    const metadata = extractMeetingMetadata(dom, 'https://meet.google.com/rkb-zpxk-xhz');

    expect(metadata.title).toBe('Project Kickoff');
    expect(metadata.meetingCode).toBe('rkb-zpxk-xhz');
    expect(metadata.participants).toEqual([{ displayName: 'Gaurav Sankhla', isSelf: true }]);
    expect(metadata.extractedAt).toBeGreaterThan(0);
  });
});
