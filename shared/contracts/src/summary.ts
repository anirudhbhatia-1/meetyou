import { z } from 'zod';

/**
 * The JSON the summarization LLM must return (PRD §14.3, ARCHITECTURE §10).
 * snake_case because it is the model-facing contract. The LLM cites segment IDs that we supplied;
 * timestamps are never produced by the model.
 */

const segmentIds = z.array(z.string().regex(/^seg_[0-9A-HJKMNP-TV-Z]{26}$/)).min(1);

const CitedText = z.object({
  text: z.string().min(1),
  segment_ids: segmentIds,
});

export const SummaryOutput = z.object({
  title: z.string().min(1).max(200),
  overview: z.string().min(1),
  anchored_sections: z.array(
    z.object({
      note_id: z.string().min(1),
      details: z.array(CitedText),
    }),
  ),
  decisions: z.array(CitedText),
  action_items: z.array(
    z.object({
      task: z.string().min(1),
      owner_participant_id: z.string().min(1),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      due_phrase: z.string().nullable(),
      segment_ids: segmentIds,
    }),
  ),
  open_questions: z.array(CitedText),
  topics: z.array(z.string().min(1)),
});
export type SummaryOutput = z.infer<typeof SummaryOutput>;

/** JSON Schema handed to the LLM's structured-output mode. */
export const summaryOutputJsonSchema = z.toJSONSchema(SummaryOutput);

export const UNASSIGNED_OWNER = 'unassigned';
