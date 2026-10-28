/**
 * Devanagari → Hinglish-style Roman transliteration, used identically for every provider so that
 * Devanagari output can be scored against Roman references (STT_BENCHMARK_PLAN §5 step 3).
 *
 * Conventions follow common Hinglish typing: "kal", "mera", "nahin", "samajhna", "theek".
 * Schwa deletion uses Ohala's rule (V C a C V → delete the a), applied right to left, plus
 * word-final schwa deletion. It is a heuristic; CER is reported alongside WER to absorb residual
 * spelling differences.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  क़: 'q',
  ख़: 'kh',
  ग़: 'gh',
  ज़: 'z',
  ड़: 'd',
  ढ़: 'rh',
  फ़: 'f',
  य़: 'y',
};

/** Consonant + nukta (U+093C) written as two code points. */
const NUKTA_FORMS: Record<string, string> = {
  क: 'q',
  ख: 'kh',
  ग: 'gh',
  ज: 'z',
  ड: 'd',
  ढ: 'rh',
  फ: 'f',
  य: 'y',
};

const INDEPENDENT_VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ee',
  उ: 'u',
  ऊ: 'oo',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  ऑ: 'o',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
};

const VIRAMA = '्';
const NUKTA = '़';
const NASALS: Record<string, string> = { 'ं': 'n', 'ँ': 'n', 'ः': 'h' };
const DIGITS = '०१२३४५६७८९';

type Unit =
  | { kind: 'cons'; c: string; v: string; inherent: boolean; nasal: string }
  | { kind: 'vowel'; v: string; nasal: string };

export const DEVANAGARI_RE = /[ऀ-ॿ]/;

function parseWord(word: string): Unit[] {
  const chars = Array.from(word.normalize('NFC'));
  const units: Unit[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';
    const last = units[units.length - 1];
    if (ch === NUKTA) {
      continue; // handled when reading the consonant
    }
    if (CONSONANTS[ch] !== undefined) {
      let c = CONSONANTS[ch] ?? '';
      if (chars[i + 1] === NUKTA && NUKTA_FORMS[ch]) {
        c = NUKTA_FORMS[ch] ?? c;
        i++;
      }
      units.push({ kind: 'cons', c, v: 'a', inherent: true, nasal: '' });
    } else if (MATRAS[ch] !== undefined && last?.kind === 'cons') {
      last.v = MATRAS[ch] ?? '';
      last.inherent = false;
    } else if (ch === VIRAMA && last?.kind === 'cons') {
      last.v = '';
      last.inherent = false;
    } else if (NASALS[ch] !== undefined && last) {
      last.nasal += NASALS[ch] ?? '';
    } else if (INDEPENDENT_VOWELS[ch] !== undefined) {
      units.push({ kind: 'vowel', v: INDEPENDENT_VOWELS[ch] ?? '', nasal: '' });
    } else {
      const d = DIGITS.indexOf(ch);
      units.push({ kind: 'vowel', v: d >= 0 ? String(d) : ch, nasal: '' });
    }
  }
  return units;
}

function hasVowel(u: Unit | undefined): boolean {
  if (!u) return false;
  return u.kind === 'vowel' ? /[a-z]/.test(u.v) : u.v !== '';
}

function deleteSchwas(units: Unit[]): void {
  const last = units[units.length - 1];
  if (units.length > 1 && last?.kind === 'cons' && last.inherent && !last.nasal) {
    last.v = '';
    last.inherent = false;
  }
  for (let i = units.length - 2; i >= 1; i--) {
    const u = units[i];
    const next = units[i + 1];
    if (
      u?.kind === 'cons' &&
      u.inherent &&
      !u.nasal &&
      hasVowel(units[i - 1]) &&
      next?.kind === 'cons' &&
      hasVowel(next)
    ) {
      u.v = '';
      u.inherent = false;
    }
  }
}

/** Long vowels are written short at the end of a word in Hinglish ("mera", "abhi", "tu"). */
function finalShortening(v: string): string {
  if (v === 'aa') return 'a';
  if (v === 'ee') return 'i';
  if (v === 'oo') return 'u';
  return v;
}

export function transliterateWord(word: string): string {
  if (!DEVANAGARI_RE.test(word)) return word;
  const units = parseWord(word);
  deleteSchwas(units);
  return units
    .map((u, i) => {
      const isLast = i === units.length - 1;
      const v = isLast ? finalShortening(u.v) : u.v;
      return (u.kind === 'cons' ? u.c : '') + v + u.nasal;
    })
    .join('');
}

/** Runs of Devanagari letters, marks, and digits — excluding the danda punctuation (U+0964/5). */
const DEVANAGARI_RUN = /[ऀ-ॣ०-ॿ]+/g;

/** Transliterates every Devanagari word in a string; Latin text and punctuation pass through. */
export function transliterate(text: string): string {
  return text.normalize('NFC').replace(DEVANAGARI_RUN, transliterateWord);
}
