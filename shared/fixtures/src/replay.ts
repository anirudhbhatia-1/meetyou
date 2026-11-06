import { ServerMessage } from '@meetyou/contracts';
import { z } from 'zod';

/**
 * A gateway WebSocket session as the client saw it (S2-13): every server message with its
 * session time. Recorded from the real gateway with a scripted STT provider
 * (`backend/apps/gateway/src/record-fixture.ts`), so the shapes are the production ones.
 */
export const RecordedSession = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  /** Always true: fixtures are synthetic (AGENTS §8). */
  synthetic: z.literal(true),
  sessionId: z.string().min(1),
  durationMs: z.number().int().positive(),
  messages: z.array(z.object({ atMs: z.number().int().nonnegative(), message: ServerMessage })),
});
export type RecordedSession = z.infer<typeof RecordedSession>;

export interface ReplayTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Plays a recorded session to `onMessage` at `speed` × real time (UI mocks: S4-01). Returns a
 * function that stops it. Messages keep their recorded order.
 */
export function replaySession(
  session: RecordedSession,
  onMessage: (message: ServerMessage, atMs: number) => void,
  options: { speed?: number; timers?: ReplayTimers; onDone?: () => void } = {},
): () => void {
  const speed = options.speed ?? 1;
  const timers: ReplayTimers = options.timers ?? {
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let index = 0;
  let handle: unknown = null;
  let stopped = false;
  const step = (): void => {
    if (stopped) return;
    const current = session.messages[index];
    if (current === undefined) {
      options.onDone?.();
      return;
    }
    onMessage(current.message, current.atMs);
    index += 1;
    const next = session.messages[index];
    const wait = next === undefined ? 0 : Math.max(0, (next.atMs - current.atMs) / speed);
    handle = timers.setTimeout(step, wait);
  };
  const first = session.messages[0];
  handle = timers.setTimeout(step, first === undefined ? 0 : first.atMs / speed);
  return () => {
    stopped = true;
    if (handle !== null) timers.clearTimeout(handle);
  };
}

/** Messages up to a session time, e.g. to render a mid-meeting state in a test or mock. */
export function messagesUntil(session: RecordedSession, atMs: number): ServerMessage[] {
  return session.messages.filter((m) => m.atMs <= atMs).map((m) => m.message);
}
