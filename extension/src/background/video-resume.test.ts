import { describe, expect, it, vi } from 'vitest';

import { uploadableSession } from '../offscreen/video-uploader.ts';
import { resumeVideoUploads, type ResumeDeps } from './video-resume.ts';

function deps(overrides: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    hasUploadTarget: true,
    idle: () => Promise.resolve(true),
    signedIn: () => Promise.resolve(true),
    pendingFragments: () => Promise.resolve(3),
    openOffscreen: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('video upload resume at startup (ADR-0011 §3.3)', () => {
  it('opens the offscreen document when fragments wait and nothing records', async () => {
    const d = deps();
    expect(await resumeVideoUploads(d)).toBe(true);
    expect(d.openOffscreen).toHaveBeenCalledOnce();
  });

  it.each([
    ['no upload target', { hasUploadTarget: false }],
    ['a recording is running', { idle: () => Promise.resolve(false) }],
    ['signed out', { signedIn: () => Promise.resolve(false) }],
    ['nothing pending', { pendingFragments: () => Promise.resolve(0) }],
  ] as const)('does nothing when %s', async (_, overrides) => {
    const d = deps(overrides);
    expect(await resumeVideoUploads(d)).toBe(false);
    expect(d.openOffscreen).not.toHaveBeenCalled();
  });

  it('does not refresh the token while recording (cheap checks first)', async () => {
    const signedIn = vi.fn(() => Promise.resolve(true));
    await resumeVideoUploads(deps({ idle: () => Promise.resolve(false), signedIn }));
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('uploads only fragments of server sessions', () => {
    expect(uploadableSession('ses_01ABC')).toBe(true);
    expect(uploadableSession('local-1730000000')).toBe(false);
  });
});
