import { CANONICAL_LIST, type CanonicalList } from './canonical.ts';
import { DEVANAGARI_RE, transliterate } from './devanagari.ts';

/**
 * Display-text helpers for the transcript assembler (ARCHITECTURE §8.1 steps 2–3). Unlike the
 * benchmark normalizer (which lowercases and strips punctuation for scoring), these keep case,
 * punctuation and spacing: the result is what people read.
 */

/** Matches one Latin-script word, including an inner apostrophe ("hai'n"). */
const LATIN_WORD = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

function sameCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Spelling variants → canonical form. Ambiguous forms are left alone (they are other words). */
export class SpellingNormalizer {
  readonly #variants = new Map<string, string>();

  constructor(list: CanonicalList = CANONICAL_LIST) {
    for (const entry of list.entries) {
      for (const variant of entry.variants) this.#variants.set(variant, entry.canonical);
    }
  }

  /** Rewrites known variants ("nahin" → "nahi"), keeping the word's capitalisation. */
  normalize(text: string): string {
    return text.replace(LATIN_WORD, (word) => {
      const canonical = this.#variants.get(word.toLowerCase());
      return canonical === undefined ? word : sameCase(word, canonical);
    });
  }
}

/** Turns provider text into display text; `rawText` always keeps the provider's original. */
export interface DisplayTextPolicy {
  readonly name: string;
  toDisplay(text: string): string;
}

/** Shows the provider's text as is (only spelling variants of Roman Hinglish are unified). */
export function asProvidedPolicy(normalizer = new SpellingNormalizer()): DisplayTextPolicy {
  return { name: 'as_provided', toDisplay: (text) => normalizer.normalize(text) };
}

/**
 * D-01 Roman display by rules: Devanagari words are transliterated (schwa deletion heuristic),
 * then spellings unified. Quality is heuristic; a provider-based transliterator can replace it
 * behind the same interface.
 */
export function romanRulesPolicy(normalizer = new SpellingNormalizer()): DisplayTextPolicy {
  return {
    name: 'roman_rules',
    toDisplay: (text) =>
      normalizer.normalize(DEVANAGARI_RE.test(text) ? transliterate(text) : text),
  };
}
