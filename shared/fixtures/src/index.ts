import standup from './sessions/standup-hinglish.json' with { type: 'json' };

import { RecordedSession } from './replay.ts';

export { STANDUP_DURATION_MS, STANDUP_HINGLISH, type Utterance } from './script.ts';
export { messagesUntil, RecordedSession, replaySession, type ReplayTimers } from './replay.ts';

/** The scripted standup as the extension receives it from the gateway (synthetic). */
export function standupSession(): RecordedSession {
  return RecordedSession.parse(standup);
}
