/**
 * Vocabulary for STT (live stream and batch pass): the workspace glossary plus the names of people Meet showed in
 * the call, so they are spelled right (idea from the open-source Yogurt recorder, MIT,
 * FrigadeHQ/yogurt, vocab.ts, which gives Whisper the participants' names). The provider adapter
 * trims the list to its limits, so the glossary goes first and names fill what is left.
 */

/** A first name shorter than this is too easy to boost into ordinary words ("Al", "Om"). */
const MIN_FIRST_NAME = 3;

/** Terms for one display name: the full name, and the first name when there is more than one word. */
export function nameKeyterms(displayName: string): string[] {
  const name = displayName
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return [];
  const words = name.split(' ');
  const first = words[0] ?? '';
  return words.length > 1 && first.length >= MIN_FIRST_NAME ? [name, first] : [name];
}

/** Glossary first, then each name's terms in the order people were seen, without repeats. */
export function sessionKeyterms(glossary: readonly string[], names: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (term: string): void => {
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(term);
  };
  for (const term of glossary) add(term);
  for (const name of names) for (const term of nameKeyterms(name)) add(term);
  return out;
}
