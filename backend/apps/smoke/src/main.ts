import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { loadKeyRing, TokenService } from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import { createPgPool, Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';

import { checkUsage, waitForDeletion } from './records.ts';
import { runSmoke, SmokeError } from './smoke.ts';

/**
 * Staging smoke job (S2-12): `node backend/apps/smoke/src/main.ts` in the Cloud Run job
 * `meetyou-<env>-smoke` (VPC, secrets DATABASE_URL and AUTH_SIGNING_JWKS). It signs in a fixed
 * synthetic account (no Google: the account is created through the same bootstrap function),
 * mints a 15-minute access token with the API's signing key, and runs `runSmoke`. It also checks
 * the database: the meeting's usage row (S2-07) and that the worker deleted the meeting after the
 * grace period (S2-10). Exit code 1 fails the deploy. Audio is synthesized here (espeak-ng, AGENTS §8: synthetic only).
 * Cost: about 20 s of Deepgram per lane per run.
 */
const log = createLogger('smoke');

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`smoke: ${name} is required`);
  return value;
}

/** 16 kHz mono PCM16 of a short English sentence, from espeak-ng through ffmpeg. */
export function synthesize(text: string): Uint8Array {
  const wav = execFileSync('espeak-ng', ['-v', 'en-us', '-s', '150', '--stdout', text]);
  const pcm = execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { input: wav },
  );
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

const SENTENCE =
  'This is the Minutes smoke test. The new release is deployed, and audio is streaming to the gateway.';

async function main(): Promise<void> {
  const apiUrl = required('API_URL');
  const origin = required('SMOKE_ORIGIN');
  const pool = createPgPool(required('DATABASE_URL'));
  const db = new Db(pool);
  try {
    const account = await db.signInGoogleUser(
      { googleSub: 'smoke:ci', email: 'smoke-test@minutes.invalid', displayName: 'Smoke Test' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    const tokens = new TokenService(
      await loadKeyRing(JSON.parse(required('AUTH_SIGNING_JWKS')) as never),
    );
    const workspaceId = account.workspaceId ?? '';
    let usage: Awaited<ReturnType<typeof checkUsage>> | undefined;
    const { token } = await tokens.issueAccessToken({
      userId: account.userId,
      workspaceId,
      scope: 'user',
    });
    const result = await runSmoke({
      apiUrl,
      accessToken: token,
      origin,
      pcmThem: synthesize(SENTENCE),
      speed: 2,
      beforeDelete: async (meetingId) => {
        usage = await checkUsage(db, workspaceId, meetingId);
      },
    });
    if (!result.deleted) throw new SmokeError('meeting delete', 'api refused');
    const deleteMs = await waitForDeletion(db, workspaceId, result.meetingId);
    log.log('smoke.passed', { ...result, ...usage, deleteMs });
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    log.error('smoke.failed', {
      code: errorCode(error),
      step: error instanceof SmokeError ? error.step : 'setup',
    });
    process.exitCode = 1;
  });
}
