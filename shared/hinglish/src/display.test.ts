import { describe, expect, it } from 'vitest';

import { CANONICAL_LIST } from './canonical.ts';
import { asProvidedPolicy, romanRulesPolicy, SpellingNormalizer } from './display.ts';

describe('display text (ARCHITECTURE §8.1 steps 2–3)', () => {
  it('ships the canonical list v1', () => {
    expect(CANONICAL_LIST.entries.length).toBeGreaterThanOrEqual(92);
  });

  it('unifies Hinglish spellings but keeps case, punctuation and English words', () => {
    const n = new SpellingNormalizer();
    expect(n.normalize('Nahin, deck abhi ready nhi hai.')).toBe('Nahi, deck abhi ready nahi hai.');
    expect(n.normalize('NAHIN')).toBe('NAHI');
    expect(n.normalize('The release is on Friday.')).toBe('The release is on Friday.');
  });

  it('never rewrites ambiguous forms that are also other words', () => {
    // "he" is in the list as an ambiguous spelling of "hai" but is also English.
    expect(new SpellingNormalizer().normalize('he said kyaa')).toBe('he said kya');
  });

  it('as provided: Devanagari stays Devanagari', () => {
    expect(asProvidedPolicy().toDisplay('कल deployment करते हैं')).toBe('कल deployment करते हैं');
  });

  it('roman rules: transliterates Devanagari, leaves Roman text alone', () => {
    const policy = romanRulesPolicy();
    expect(policy.toDisplay('कल deployment करते हैं')).toBe('kal deployment karte hain');
    expect(policy.toDisplay('Kal tak bhej dena.')).toBe('Kal tak bhej dena.');
  });
});
