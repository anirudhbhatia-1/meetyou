import { z } from 'zod';

import { IsoDateTime } from './common.ts';

/**
 * "Download all my data" (S3-11, FR-SET-04, DESIGN §13.2): an export job builds a zip of JSON and
 * Markdown; the file is kept 24 hours. The download URL is signed per request and short-lived.
 */
export const EXPORT_KEEP_MS = 24 * 60 * 60 * 1000;

export const ExportStatus = z.enum(['preparing', 'ready', 'failed', 'expired']);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ExportView = z.object({
  id: z.string().min(1),
  status: ExportStatus,
  createdAt: IsoDateTime,
  readyAt: IsoDateTime.nullable(),
  /** When the file is deleted (ready exports only). */
  expiresAt: IsoDateTime.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  meetingCount: z.number().int().nonnegative().nullable(),
  /** Signed, short-lived link; present only when `ready`. */
  downloadUrl: z.string().url().nullable(),
});
export type ExportView = z.infer<typeof ExportView>;

// POST /v1/exports → 202 (an export already preparing is returned instead of a second one)
// GET /v1/exports/{id}
export const ExportResponse = z.object({ export: ExportView });
export type ExportResponse = z.infer<typeof ExportResponse>;

// GET /v1/exports: the caller's latest export, if any, for the Settings row.
export const ExportListResponse = z.object({ latest: ExportView.nullable() });
export type ExportListResponse = z.infer<typeof ExportListResponse>;
