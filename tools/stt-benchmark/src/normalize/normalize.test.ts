import { describe, expect, it } from 'vitest';
import { transliterate, transliterateWord } from './devanagari.ts';
import { Normalizer, loadCanonicalList } from './index.ts';

describe('devanagari → roman', () => {
  const cases: [string, string][] = [
    ['कल', 'kal'],
    ['मेरा', 'mera'],
    ['है', 'hai'],
    ['हैं', 'hain'],
    ['क्या', 'kya'],
    ['करना', 'karna'],
    ['समझना', 'samajhna'],
    ['बहुत', 'bahut'],
    ['ठीक', 'theek'],
    ['पता', 'pata'],
    ['लगता', 'lagta'],
    ['अभी', 'abhi'],
    ['भी', 'bhi'],
    ['दिन', 'din'],
    ['रात', 'raat'],
    ['आज', 'aaj'],
    ['हिंदी', 'hindi'],
    ['ज़्यादा', 'zyaada'],
    ['अच्छा', 'achchha'],
    ['नहीं', 'nahin'],
  ];
  it.each(cases)('%s → %s', (dev, roman) => {
    expect(transliterateWord(dev)).toBe(roman);
  });

  it('keeps Latin words and converts Devanagari digits', () => {
    expect(transliterate('कल deployment करते हैं')).toBe('kal deployment karte hain');
    expect(transliterate('१५ नवंबर')).toBe('15 navanbar');
  });
});

describe('normalizer', () => {
  const norm = new Normalizer({ list: loadCanonicalList() });

  it('maps Hinglish variants to canonical spellings', () => {
    expect(norm.tokens('Nahin yaar, bohot zyaada kaam hai!')).toEqual([
      'nahi',
      'yaar',
      'bahut',
      'zyada',
      'kaam',
      'hai',
    ]);
  });

  it('scores Devanagari and Roman output the same after normalization', () => {
    expect(norm.tokens('अच्छा, नहीं पता')).toEqual(norm.tokens('accha nahi pata'));
  });

  it('does not rewrite ambiguous English words', () => {
    expect(norm.tokens('tell me to do it')).toEqual(['tell', 'me', 'to', 'do', 'it']);
  });

  it('normalizes numbers, currency, fillers and splits', () => {
    expect(norm.tokens('Um, ₹40,000 aur ek crores… kardo')).toEqual([
      '40000',
      'aur',
      '1',
      'crore',
      'kar',
      'do',
    ]);
    expect(norm.tokens('version 2.5 launch')).toEqual(['version', '2.5', 'launch']);
  });

  it('can produce raw scores without canonicalization', () => {
    const raw = new Normalizer({ list: loadCanonicalList(), canonicalize: false });
    expect(raw.tokens('nahin bohot')).toEqual(['nahin', 'bohot']);
  });
});
