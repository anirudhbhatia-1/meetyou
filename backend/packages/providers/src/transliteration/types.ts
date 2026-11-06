/**
 * Devanagari → Roman for display (D-01); the original stays as `rawText`.
 * TODO(S2-05): implementation with the canonical Hinglish spelling list (S0-03).
 */
export interface Transliterator {
  toRoman(text: string, sourceLanguage: string): { text: string; confidence: number };
}
