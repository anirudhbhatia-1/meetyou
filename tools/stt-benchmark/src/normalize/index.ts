import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { transliterate } from './devanagari.ts';

const CanonicalList = z.object({
  version: z.string(),
  entries: z.array(
    z.object({
      canonical: z.string(),
      variants: z.array(z.string()),
      ambiguous: z.array(z.string()).optional(),
    }),
  ),
  splits: z.record(z.string(), z.string()),
  fillers: z.array(z.string()),
});
export type CanonicalList = z.infer<typeof CanonicalList>;

export function loadCanonicalList(
  path = fileURLToPath(new URL('../../data/hinglish-canonical.json', import.meta.url)),
): CanonicalList {
  return CanonicalList.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Number words that are safe to convert on both sides ("do" is excluded: verb and English word). */
const NUMBER_WORDS: Record<string, string> = {
  ek: '1',
  teen: '3',
  char: '4',
  chaar: '4',
  paanch: '5',
  panch: '5',
  chhe: '6',
  saat: '7',
  aath: '8',
  nau: '9',
  das: '10',
  bees: '20',
  tees: '30',
  chaalis: '40',
  pachaas: '50',
  sau: '100',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  hundred: '100',
};

export interface NormalizeOptions {
  list: CanonicalList;
  /** Apply the canonical spelling map (off = "raw" score in STT_BENCHMARK_PLAN §5). */
  canonicalize?: boolean;
  transliterate?: boolean;
  numbers?: boolean;
}

export class Normalizer {
  private readonly variants = new Map<string, string>();
  private readonly splits: Map<string, string[]>;
  private readonly fillers: Set<string>;
  private readonly opts: NormalizeOptions;

  constructor(opts: NormalizeOptions) {
    this.opts = opts;
    for (const e of opts.list.entries)
      for (const v of e.variants) this.variants.set(v, e.canonical);
    this.splits = new Map(Object.entries(opts.list.splits).map(([k, v]) => [k, v.split(' ')]));
    this.fillers = new Set(opts.list.fillers);
  }

  /** Normalizes one string into scoring tokens. */
  tokens(text: string): string[] {
    const { canonicalize = true, numbers = true } = this.opts;
    let s = text.normalize('NFC');
    if (this.opts.transliterate !== false) s = transliterate(s);
    s = s
      .toLowerCase()
      .replace(/₹\s?/g, ' ')
      .replace(/(\d),(?=\d)/g, '$1')
      .replace(/[^\p{L}\p{N}\s.']/gu, ' ')
      .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
      .replace(/'/g, '');
    const out: string[] = [];
    for (const raw of s.split(/\s+/)) {
      if (!raw) continue;
      const parts = canonicalize ? (this.splits.get(raw) ?? [raw]) : [raw];
      for (let tok of parts) {
        if (this.fillers.has(tok)) continue;
        if (canonicalize) tok = this.variants.get(tok) ?? tok;
        if (numbers) tok = NUMBER_WORDS[tok] ?? tok;
        out.push(tok);
      }
    }
    return out;
  }
}
