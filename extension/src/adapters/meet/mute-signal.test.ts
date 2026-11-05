import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectMuteState, observeMuteState } from './mute-signal.ts';

interface MockElement {
  getAttribute?(attr: string): string | null;
  textContent?: string;
}

function createMockDoc(micEl: MockElement | null): Document {
  return {
    querySelector: (selector: string) => {
      if (
        micEl !== null &&
        (selector.includes('B1qRre') ||
          selector.includes('microphone') ||
          selector.includes('data-is-muted'))
      ) {
        return {
          getAttribute: (attr: string) => micEl.getAttribute?.(attr) ?? null,
          textContent: micEl.textContent ?? '',
        } as unknown as Element;
      }
      return null;
    },
    body: {} as HTMLElement,
  } as unknown as Document;
}

class MockMutationObserver {
  static instances: MockMutationObserver[] = [];
  callback: (records: unknown[]) => void;

  constructor(callback: (records: unknown[]) => void) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    MockMutationObserver.instances = MockMutationObserver.instances.filter((i) => i !== this);
  }
  trigger() {
    this.callback([]);
  }
}

describe('Meet Mute Signal Adapter (S1-08)', () => {
  beforeEach(() => {
    MockMutationObserver.instances = [];
    vi.stubGlobal('MutationObserver', MockMutationObserver);
  });

  describe('detectMuteState', () => {
    it('returns null when mic button is absent', () => {
      const doc = createMockDoc(null);
      const result = detectMuteState(doc);
      expect(result.isMuted).toBeNull();
      expect(result.matchedBy).toBeNull();
    });

    it('detects muted state via primary data-is-muted="true"', () => {
      const doc = createMockDoc({
        getAttribute: (attr: string) => {
          if (attr === 'data-is-muted') return 'true';
          if (attr === 'aria-label') return 'Turn on microphone (Ctrl + D)';
          return null;
        },
      });
      const result = detectMuteState(doc);
      expect(result.isMuted).toBe(true);
      expect(result.matchedBy).toBe('data-is-muted=true');
    });

    it('detects unmuted state via primary data-is-muted="false"', () => {
      const doc = createMockDoc({
        getAttribute: (attr: string) => {
          if (attr === 'data-is-muted') return 'false';
          if (attr === 'aria-label') return 'Turn off microphone (Ctrl + D)';
          return null;
        },
      });
      const result = detectMuteState(doc);
      expect(result.isMuted).toBe(false);
      expect(result.matchedBy).toBe('data-is-muted=false');
    });

    it('detects muted state via fallback aria-label ("Turn on microphone")', () => {
      const doc = createMockDoc({
        getAttribute: (attr: string) => {
          if (attr === 'aria-label') return 'Turn on microphone';
          return null;
        },
      });
      const result = detectMuteState(doc);
      expect(result.isMuted).toBe(true);
      expect(result.matchedBy).toBe('aria-label(unmute)');
    });

    it('detects unmuted state via fallback aria-label ("Turn off microphone")', () => {
      const doc = createMockDoc({
        getAttribute: (attr: string) => {
          if (attr === 'aria-label') return 'Turn off microphone';
          return null;
        },
      });
      const result = detectMuteState(doc);
      expect(result.isMuted).toBe(false);
      expect(result.matchedBy).toBe('aria-label(mute)');
    });

    it('detects state via aria-pressed fallback', () => {
      const doc = createMockDoc({
        getAttribute: (attr: string) => {
          if (attr === 'aria-pressed') return 'true';
          return null;
        },
      });
      const result = detectMuteState(doc);
      expect(result.isMuted).toBe(true);
      expect(result.matchedBy).toBe('aria-pressed=true');
    });
  });

  describe('observeMuteState', () => {
    it('notifies initial state and transitions on attribute changes', () => {
      let isMutedValue = 'true';
      const doc: Document = {
        querySelector: (selector: string) => {
          if (selector.includes('B1qRre') || selector.includes('data-is-muted')) {
            return {
              getAttribute: (attr: string) => (attr === 'data-is-muted' ? isMutedValue : null),
              textContent: '',
            } as unknown as Element;
          }
          return null;
        },
        body: {} as HTMLElement,
      } as unknown as Document;

      const onChange = vi.fn();
      const unsubscribe = observeMuteState(doc, onChange);

      // Initial evaluation triggered
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          muted: true,
          at: expect.any(Number),
        }),
      );

      // Transition to unmuted
      isMutedValue = 'false';
      expect(MockMutationObserver.instances).toHaveLength(1);
      MockMutationObserver.instances[0]?.trigger();

      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          muted: false,
          at: expect.any(Number),
        }),
      );

      // Trigger mutation without changing state; should NOT fire
      MockMutationObserver.instances[0]?.trigger();
      expect(onChange).toHaveBeenCalledTimes(2);

      // Teardown
      unsubscribe();
      expect(MockMutationObserver.instances).toHaveLength(0);
    });
  });
});
