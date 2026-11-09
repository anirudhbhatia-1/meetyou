import type { ProductEvent, ProductEventName } from '@meetyou/contracts';
import { createContext, useContext } from 'react';

import type { LibraryApi } from '../api/types.ts';

/** Events wait this long so a few clicks travel in one request. */
const FLUSH_MS = 5_000;
const BATCH_MAX = 25;

type PropsOf<N extends ProductEventName> = Extract<ProductEvent, { name: N }>['props'];

/**
 * Product analytics for the web app (S4-15, PRD §19.6): typed events only (the contract rejects
 * content), batched, and dropped while the user has opted out. The API enforces the opt-out too,
 * so events queued before the setting is known are never stored for an opted-out user.
 */
export class Analytics {
  readonly #api: LibraryApi;
  #queue: ProductEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #optOut = false;

  constructor(api: LibraryApi) {
    this.#api = api;
  }

  setOptOut(optOut: boolean): void {
    this.#optOut = optOut;
    if (optOut) this.#queue = [];
  }

  track<N extends ProductEventName>(name: N, props: PropsOf<N>): void {
    if (this.#optOut) return;
    this.#queue.push({ name, at: new Date().toISOString(), props } as ProductEvent);
    if (this.#queue.length >= BATCH_MAX) this.flush();
    else this.#timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Sends what is queued; a failure drops the batch (analytics never retries or blocks the UI). */
  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, BATCH_MAX);
      this.#api.sendEvents(batch).catch(() => undefined);
    }
  }
}

export const AnalyticsContext = createContext<Analytics | null>(null);

const NO_ANALYTICS: Pick<Analytics, 'track' | 'setOptOut'> = {
  track: () => undefined,
  setOptOut: () => undefined,
};

/** The tracker, or a no-op outside the library (e.g. the sign-in screen). */
export function useAnalytics(): Pick<Analytics, 'track' | 'setOptOut'> {
  return useContext(AnalyticsContext) ?? NO_ANALYTICS;
}
