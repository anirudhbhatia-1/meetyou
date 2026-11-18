import { companyFromEmail, nameFromEmail } from '../calendar/google-calendar.ts';

/**
 * Vocabulary for STT (live stream and batch pass): the workspace glossary plus the names of people Meet showed in
 * the call, so they are spelled right (idea from the open-source Yogurt recorder, MIT,
 * FrigadeHQ/yogurt, vocab.ts, which gives Whisper the participants' names). The provider adapter
 * trims the list to its limits, so the glossary goes first and names fill what is left.
 */

/** A first name shorter than this is too easy to boost into ordinary words ("Al", "Om"). */
const MIN_FIRST_NAME = 3;
/** Titles that come first in a name but are not one ("Dr. Ramesh Kumar", "Sri Lakshmi N"). */
const HONORIFICS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'miss',
  'sri',
  'shri',
  'smt',
  'prof',
  'er',
  'ca',
  'adv',
]);

/** Terms for one display name: the full name, and the first name when there is more than one word. */
export function nameKeyterms(displayName: string): string[] {
  const name = displayName
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return [];
  const words = name.split(' ');
  const isTitle = (w: string) => HONORIFICS.has(w.toLowerCase().replace(/\.$/, ''));
  const given = words.filter((w) => !isTitle(w));
  const first = given[0] ?? '';
  return given.length > 1 && first.length >= MIN_FIRST_NAME ? [name, first] : [name];
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

/**
 * A big invite must not fill the provider's list (50 terms): names Meet shows during the call are
 * appended after these and need room too.
 */
const MAX_INVITE_NAMES = 12;
const MAX_INVITE_COMPANIES = 4;

/**
 * ADR-0013: the glossary plus the calendar invite's people (their names, or the name part of the
 * email) and their companies (from work email domains), so names are right before anyone speaks.
 */
export function calendarKeyterms(
  glossary: readonly string[],
  attendees: readonly { name: string | null; email: string | null }[],
): string[] {
  const names = attendees
    .map((a) => a.name ?? (a.email !== null ? nameFromEmail(a.email) : ''))
    .filter((n) => n.trim() !== '')
    .slice(0, MAX_INVITE_NAMES);
  const companies = [
    ...new Set(
      attendees
        .map((a) => (a.email !== null ? companyFromEmail(a.email) : null))
        .filter((c): c is string => c !== null),
    ),
  ].slice(0, MAX_INVITE_COMPANIES);
  return sessionKeyterms([...glossary], [...names, ...companies]);
}
