import type { MeetingSummary } from '../api/types.ts';

/** Chip numbers are per-summary display indices, in reading order (DESIGN §12.6). */
export function numberCitations(summary: MeetingSummary): Map<string, number> {
  const numbers = new Map<string, number>();
  const all = [
    ...summary.sections.flatMap((s) => s.items),
    ...summary.decisions,
    ...summary.questions,
    ...summary.actionItems,
  ];
  for (const item of all) {
    // Unverified items show their own chip instead of a number (DESIGN §6.14).
    if (item.segmentIds.length > 0 && !item.flagged && !numbers.has(item.id)) {
      numbers.set(item.id, numbers.size + 1);
    }
  }
  return numbers;
}
