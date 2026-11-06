import type { Lane } from '@meetyou/contracts';

/**
 * A synthetic meeting script (written for tests; no real meeting or person). Times are on the
 * session clock. `them` utterances carry a diarization speaker index; `interims` are the partial
 * texts the scripted STT sends before the final, as a live provider would.
 */
export interface Utterance {
  lane: Lane;
  /** Provider speaker index on the `them` lane (spk_1 = 0). */
  speaker?: number;
  startMs: number;
  endMs: number;
  text: string;
  interims: string[];
  language: string;
  /** Spoken by the synthetic TTS voice for audio fixtures (macOS `say`). */
  voice: 'Rishi' | 'Lekha' | 'Aman';
}

export const STANDUP_HINGLISH: readonly Utterance[] = [
  {
    lane: 'them',
    speaker: 0,
    startMs: 1_000,
    endMs: 4_000,
    text: 'Good morning, chaliye standup shuru karte hain.',
    interims: ['Good morning', 'Good morning, chaliye standup'],
    language: 'hi',
    voice: 'Rishi',
  },
  {
    lane: 'me',
    startMs: 4_500,
    endMs: 8_500,
    text: 'Kal maine search pagination merge kar diya, aaj review comments dekhunga.',
    interims: ['Kal maine search', 'Kal maine search pagination merge kar diya'],
    language: 'hi',
    voice: 'Aman',
  },
  {
    lane: 'them',
    speaker: 1,
    startMs: 9_000,
    endMs: 13_000,
    text: 'Main staging database pe blocked hoon, migration abhi tak apply nahi hui.',
    interims: ['Main staging database pe', 'Main staging database pe blocked hoon'],
    language: 'hi',
    voice: 'Lekha',
  },
  {
    lane: 'them',
    speaker: 0,
    startMs: 13_500,
    endMs: 16_500,
    text: 'Okay, decision: release Friday tak move karte hain.',
    interims: ['Okay, decision'],
    language: 'en',
    voice: 'Rishi',
  },
  {
    lane: 'me',
    startMs: 17_000,
    endMs: 20_000,
    text: 'Theek hai, main onboarding screens aaj review kar lunga.',
    interims: ['Theek hai', 'Theek hai, main onboarding screens'],
    language: 'hi',
    voice: 'Aman',
  },
];

export const STANDUP_DURATION_MS = 21_000;
