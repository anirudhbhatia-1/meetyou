/**
 * Notes as Markdown or plain text (DESIGN §13.1, FR-EXP-01..03): the share sheet, the meeting's
 * "Download as .md" and the account export (FR-SET-04) all print this, so one copy reads the same
 * everywhere. Callers map their data to `NotesDoc`; unverified items are left out unless the user
 * edited them.
 */
export interface NotesDocItem {
  text: string;
  /** Session time of the first cited line; printed only with `includeTimes`. */
  atMs: number | null;
  flagged: boolean;
  userEdited: boolean;
}

export interface NotesDocAction extends NotesDocItem {
  done: boolean;
  owner: string | null;
  due: string | null;
}

export interface NotesDoc {
  title: string;
  /** Already formatted for the reader, e.g. "Mon 9 Nov 2026, 10:30" and "42 min". */
  when: string;
  length: string;
  overview: string;
  /** One per user note (heading = the note), or a topic added from the conversation (null). */
  sections: { heading: string | null; items: NotesDocItem[] }[];
  decisions: NotesDocItem[];
  actionItems: NotesDocAction[];
  questions: NotesDocItem[];
}

export interface NotesTextOptions {
  format: 'markdown' | 'text';
  includeTimes: boolean;
}

/** "4:07", "1:02:30" — the session clock used across the app. */
export function clockTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const shown = <T extends NotesDocItem>(items: T[]): T[] =>
  items.filter((i) => !i.flagged || i.userEdited);

export function notesText(doc: NotesDoc, options: NotesTextOptions): string {
  const md = options.format === 'markdown';
  const time = (item: NotesDocItem) =>
    options.includeTimes && item.atMs !== null ? ` [${clockTime(item.atMs)}]` : '';
  const title = doc.title.trim() === '' ? 'Untitled meeting' : doc.title.trim();
  const out: string[] = [md ? `# ${title}` : title.toUpperCase(), `${doc.when} · ${doc.length}`];
  const section = (heading: string, lines: string[]) => {
    if (lines.length === 0) return;
    out.push('', md ? `## ${heading}` : heading, ...lines);
  };

  if (doc.overview.trim() !== '') section('Summary', [doc.overview.trim()]);
  for (const s of doc.sections) {
    const items = shown(s.items);
    if (items.length === 0) continue;
    section(
      s.heading ?? 'From the conversation',
      items.map((i) => `- ${i.text}${time(i)}`),
    );
  }
  section(
    'Decisions',
    shown(doc.decisions).map((i) => `- ${i.text}${time(i)}`),
  );
  section(
    'Action items',
    shown(doc.actionItems).map((a) => {
      const box = md ? (a.done ? '- [x] ' : '- [ ] ') : '- ';
      const who = [a.owner ?? 'Unassigned', ...(a.due !== null ? [a.due] : [])].join(', ');
      return `${box}${a.text} — ${who}${time(a)}`;
    }),
  );
  section(
    'Open questions',
    shown(doc.questions).map((i) => `- ${i.text}${time(i)}`),
  );
  return `${out.join('\n')}\n`;
}

/** File name from the title: "weekly-sync-2026-11-09.md" (ASCII, no path characters). */
export function notesFileName(title: string, startedAt: string, ext: 'md' | 'txt'): string {
  const slug =
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'meeting';
  return `${slug}-${startedAt.slice(0, 10)}.${ext}`;
}
