import { describe, expect, it } from 'vitest';

import { parseParticipants, speakerLabel } from './speaker-label.ts';

const self = { displayName: 'Anirudh Bhatia', isSelf: true };
const asha = { displayName: 'Asha Rao', isSelf: false };
const ravi = { displayName: 'Ravi Kumar', isSelf: false };

describe('speakerLabel', () => {
  it('names the me lane after the Meet "(You)" participant', () => {
    expect(speakerLabel('me', null, [self, asha])).toBe('Anirudh Bhatia');
    expect(speakerLabel('me', null, [])).toBe('Me');
  });

  it('names the other person on a 1:1 call', () => {
    expect(speakerLabel('them', 'spk_1', [self, asha])).toBe('Asha Rao');
  });

  it('falls back to Speaker N on group calls and Them without a cluster', () => {
    expect(speakerLabel('them', 'spk_2', [self, asha, ravi])).toBe('Speaker 2');
    expect(speakerLabel('them', null, [self, asha, ravi])).toBe('Them');
    expect(speakerLabel('them', 'odd', [])).toBe('Them');
  });
});

describe('parseParticipants', () => {
  it('reads names from the adapter message and drops malformed entries', () => {
    const message = {
      type: 'meet.state-changed',
      metadata: {
        participants: [self, { displayName: '  ', isSelf: false }, { displayName: 5 }, asha],
      },
    };
    expect(parseParticipants(message)).toEqual([self, asha]);
    expect(parseParticipants({ metadata: {} })).toBeNull();
    expect(parseParticipants(null)).toBeNull();
  });
});
