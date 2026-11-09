import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectActiveSpeakers, observeActiveSpeakers } from './speaker-signal.ts';

interface MockDomNode {
  attributes?: Record<string, string>;
  parent?: MockDomNode | null;
  children?: MockDomNode[];
  textContent?: string;
}

function makeMockElement(data: MockDomNode): Element {
  const node = {
    getAttribute: (attr: string) => data.attributes?.[attr] ?? null,
    closest: (selector: string): Element | null => {
      let cur: MockDomNode | null = data;
      while (cur !== null && cur !== undefined) {
        if (matches(cur, selector)) {
          return makeMockElement(cur);
        }
        cur = cur.parent ?? null;
      }
      return null;
    },
    querySelector: (selector: string): Element | null => {
      const results = queryAll(data, selector);
      const first = results[0];
      return first !== undefined ? makeMockElement(first) : null;
    },
    querySelectorAll: (selector: string): Element[] => {
      return queryAll(data, selector).map((d) => makeMockElement(d));
    },
    textContent: data.textContent ?? '',
  };
  return node as unknown as Element;
}

function matches(data: MockDomNode, selector: string): boolean {
  if (selector.includes('data-participant-id') && data.attributes?.['data-participant-id'])
    return true;
  if (
    selector.includes('data-requested-participant-id') &&
    data.attributes?.['data-requested-participant-id']
  )
    return true;
  if (selector.includes('jscontroller="e6S21b"') && data.attributes?.['jscontroller'] === 'e6S21b')
    return true;
  if (
    selector.includes('data-is-speaking="true"') &&
    data.attributes?.['data-is-speaking'] === 'true'
  )
    return true;
  if (
    selector.includes('data-is-speaking="false"') &&
    data.attributes?.['data-is-speaking'] === 'false'
  )
    return true;
  if (
    selector.includes('data-active-speaker="true"') &&
    data.attributes?.['data-active-speaker'] === 'true'
  )
    return true;
  if (selector.includes('x3Eknd') && data.attributes?.['jsname'] === 'x3Eknd') return true;
  if (
    selector.includes('aria-label*="speaking"') &&
    data.attributes?.['aria-label']?.toLowerCase().includes('speaking')
  )
    return true;
  if (
    selector.includes('data-self-name') &&
    (data.attributes?.['data-self-name'] !== undefined ||
      data.attributes?.['data-self-name'] === '')
  )
    return true;
  if (
    selector.includes('More options for') &&
    data.attributes?.['aria-label']?.includes('More options for')
  )
    return true;
  return false;
}

function queryAll(root: MockDomNode, selector: string): MockDomNode[] {
  const list: MockDomNode[] = [];
  function walk(n: MockDomNode) {
    if (n !== root && matches(n, selector)) {
      list.push(n);
    }
    for (const c of n.children ?? []) {
      c.parent = n;
      walk(c);
    }
  }
  walk(root);
  return list;
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

describe('Meet Active-Speaker Signal Adapter (S1-08)', () => {
  beforeEach(() => {
    MockMutationObserver.instances = [];
    vi.stubGlobal('MutationObserver', MockMutationObserver);
    vi.useRealTimers();
  });

  describe('detectActiveSpeakers', () => {
    it('returns empty array when no speaking indicators exist', () => {
      const rootNode: MockDomNode = {
        children: [
          {
            attributes: { 'data-participant-id': 'p1' },
            children: [{ attributes: { 'aria-label': 'More options for Alice' } }],
          },
        ],
      };
      const doc = {
        querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
      } as unknown as ParentNode;

      expect(detectActiveSpeakers(doc)).toEqual([]);
    });

    it('detects speaker from data-is-speaking inside participant tile', () => {
      const waveNode: MockDomNode = {
        attributes: { 'data-is-speaking': 'true', jsname: 'x3Eknd' },
      };
      const labelNode: MockDomNode = {
        attributes: { 'aria-label': 'More options for Priya Sharma' },
      };
      const tileNode: MockDomNode = {
        attributes: { 'data-participant-id': 'spaces/abc/participants/123' },
        children: [waveNode, labelNode],
      };
      const rootNode: MockDomNode = { children: [tileNode] };
      waveNode.parent = tileNode;
      labelNode.parent = tileNode;
      tileNode.parent = rootNode;

      const doc = {
        querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
      } as unknown as ParentNode;

      const speakers = detectActiveSpeakers(doc);
      expect(speakers).toHaveLength(1);
      expect(speakers[0]).toEqual({
        participantId: 'spaces/abc/participants/123',
        displayName: 'Priya Sharma',
        isSelf: false,
      });
    });

    it('detects self speaker correctly', () => {
      const waveNode: MockDomNode = {
        attributes: { 'data-active-speaker': 'true' },
      };
      const labelNode: MockDomNode = {
        attributes: { 'data-self-name': 'Gaurav' },
        textContent: 'Gaurav (You)',
      };
      const tileNode: MockDomNode = {
        attributes: { 'data-participant-id': 'self-tile', 'data-self-name': 'Gaurav' },
        children: [waveNode, labelNode],
      };
      const rootNode: MockDomNode = { children: [tileNode] };
      waveNode.parent = tileNode;
      labelNode.parent = tileNode;
      tileNode.parent = rootNode;

      const doc = {
        querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
      } as unknown as ParentNode;

      const speakers = detectActiveSpeakers(doc);
      expect(speakers).toHaveLength(1);
      expect(speakers[0]).toEqual({
        participantId: 'self-tile',
        displayName: 'Gaurav',
        isSelf: true,
      });
    });

    it('synthesizes deterministic ID when data-participant-id is missing', () => {
      const waveNode: MockDomNode = {
        attributes: { 'data-is-speaking': 'true' },
      };
      const labelNode: MockDomNode = {
        attributes: { 'aria-label': 'More options for Anirudh Bhatia' },
      };
      const tileNode: MockDomNode = {
        attributes: { jscontroller: 'e6S21b' },
        children: [waveNode, labelNode],
      };
      const rootNode: MockDomNode = { children: [tileNode] };
      waveNode.parent = tileNode;
      labelNode.parent = tileNode;
      tileNode.parent = rootNode;

      const doc = {
        querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
      } as unknown as ParentNode;

      const speakers = detectActiveSpeakers(doc);
      expect(speakers).toHaveLength(1);
      const id = speakers[0]?.participantId ?? '';
      expect(id).toMatch(/^p_[0-9a-f]{8}$/);
      expect(id).not.toContain('anirudh');
      expect(speakers[0]?.displayName).toBe('Anirudh Bhatia');
    });

    it('prefers a name-based ID over the video slot ID, which moves between people', () => {
      const tile = (name: string | null): ParentNode => {
        const waveNode: MockDomNode = { attributes: { 'data-is-speaking': 'true' } };
        const labelNode: MockDomNode = { attributes: { 'aria-label': `More options for ${name}` } };
        const tileNode: MockDomNode = {
          attributes: { jscontroller: 'e6S21b', 'data-allocation-id': 'slot-3' },
          children: name === null ? [waveNode] : [waveNode, labelNode],
        };
        const rootNode: MockDomNode = { children: [tileNode] };
        waveNode.parent = tileNode;
        labelNode.parent = tileNode;
        tileNode.parent = rootNode;
        return {
          querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
        } as unknown as ParentNode;
      };
      expect(detectActiveSpeakers(tile('Neha Kapoor'))[0]?.participantId).toMatch(
        /^p_[0-9a-f]{8}$/,
      );
      expect(detectActiveSpeakers(tile(null))[0]?.participantId).toBe('slot-3');
    });

    it('ignores elements with data-is-speaking="false"', () => {
      const waveNode: MockDomNode = {
        attributes: { 'data-is-speaking': 'false' },
      };
      const tileNode: MockDomNode = {
        attributes: { 'data-participant-id': 'p2' },
        children: [waveNode],
      };
      const rootNode: MockDomNode = { children: [tileNode] };
      waveNode.parent = tileNode;
      tileNode.parent = rootNode;

      const doc = {
        querySelectorAll: (sel: string) => queryAll(rootNode, sel).map((d) => makeMockElement(d)),
      } as unknown as ParentNode;

      expect(detectActiveSpeakers(doc)).toEqual([]);
    });
  });

  describe('observeActiveSpeakers', () => {
    it('notifies on active speaker changes with throttling and deduplication', () => {
      vi.useFakeTimers();

      let activeSpeakerId: string | null = null;

      const wave1: MockDomNode = { attributes: { 'data-is-speaking': 'true' } };
      const tile1: MockDomNode = {
        attributes: { 'data-participant-id': 'p1' },
        children: [{ attributes: { 'aria-label': 'More options for P1' } }],
      };
      const wave2: MockDomNode = { attributes: { 'data-is-speaking': 'true' } };
      const tile2: MockDomNode = {
        attributes: { 'data-participant-id': 'p2' },
        children: [{ attributes: { 'aria-label': 'More options for P2' } }],
      };

      const rootNode: MockDomNode = { children: [tile1, tile2] };
      tile1.parent = rootNode;
      tile2.parent = rootNode;

      const doc = {
        body: {} as HTMLElement,
        querySelectorAll: (sel: string) => {
          // Dynamically attach speaking wave depending on activeSpeakerId
          tile1.children = [{ attributes: { 'aria-label': 'More options for P1' } }];
          tile2.children = [{ attributes: { 'aria-label': 'More options for P2' } }];
          if (activeSpeakerId === 'p1') {
            tile1.children.push(wave1);
            wave1.parent = tile1;
          } else if (activeSpeakerId === 'p2') {
            tile2.children.push(wave2);
            wave2.parent = tile2;
          }
          return queryAll(rootNode, sel).map((d) => makeMockElement(d));
        },
      } as unknown as Document;

      const onSpeakerActive = vi.fn();
      const unsubscribe = observeActiveSpeakers(doc, onSpeakerActive, {
        throttleMs: 50,
        silenceResetMs: 500,
      });

      // Initially no speaker
      expect(onSpeakerActive).not.toHaveBeenCalled();

      // P1 starts talking
      activeSpeakerId = 'p1';
      expect(MockMutationObserver.instances).toHaveLength(1);
      MockMutationObserver.instances[0]?.trigger();

      vi.advanceTimersByTime(50);

      expect(onSpeakerActive).toHaveBeenCalledTimes(1);
      expect(onSpeakerActive).toHaveBeenLastCalledWith(
        expect.objectContaining({
          speaker: expect.objectContaining({ participantId: 'p1' }),
          at: expect.any(Number),
        }),
      );

      // Same speaker continues talking; should deduplicate
      MockMutationObserver.instances[0]?.trigger();
      vi.advanceTimersByTime(50);
      expect(onSpeakerActive).toHaveBeenCalledTimes(1);

      // P2 speaks
      activeSpeakerId = 'p2';
      MockMutationObserver.instances[0]?.trigger();
      vi.advanceTimersByTime(50);

      expect(onSpeakerActive).toHaveBeenCalledTimes(2);
      expect(onSpeakerActive).toHaveBeenLastCalledWith(
        expect.objectContaining({
          speaker: expect.objectContaining({ participantId: 'p2' }),
          at: expect.any(Number),
        }),
      );

      unsubscribe();
      expect(MockMutationObserver.instances).toHaveLength(0);
    });
  });
});
