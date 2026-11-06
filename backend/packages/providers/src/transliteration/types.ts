/**
 * Devanagari → Roman for display (D-01); the original stays as `rawText`.
 * Rule-based display today is `@meetyou/hinglish` (`roman_rules`, canonical spelling list, S2-05).
 * TODO(D-01): a provider adapter here only if the benchmarked rule-based quality is not enough.
 */
export interface Transliterator {
  toRoman(text: string, sourceLanguage: string): { text: string; confidence: number };
}
