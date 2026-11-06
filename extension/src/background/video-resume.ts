/**
 * Video left by a closed browser (ADR-0011 §3.3) uploads at startup instead of at the next
 * recording. The offscreen document's uploader resumes on load and reports `capture.upload_idle`
 * when done, so opening the document is all it takes. Checked in order, cheapest first: a build
 * with somewhere to upload, nothing recording, signed in (cloud), fragments actually waiting.
 */
export interface ResumeDeps {
  hasUploadTarget: boolean;
  idle(): Promise<boolean>;
  signedIn(): Promise<boolean>;
  pendingFragments(): Promise<number>;
  openOffscreen(): Promise<void>;
}

export async function resumeVideoUploads(deps: ResumeDeps): Promise<boolean> {
  if (!deps.hasUploadTarget) return false;
  if (!(await deps.idle())) return false;
  if (!(await deps.signedIn())) return false;
  if ((await deps.pendingFragments()) === 0) return false;
  await deps.openOffscreen();
  return true;
}
