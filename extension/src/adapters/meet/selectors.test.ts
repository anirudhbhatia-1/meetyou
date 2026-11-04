import { describe, expect, it } from 'vitest';

import {
  CALL_ENDED_SELECTORS,
  IN_CALL_SELECTORS,
  LOBBY_SELECTORS,
  MEET_SELECTORS_VERSION,
  METADATA_SELECTORS,
  PARTICIPANT_SELECTORS,
  matchesAny,
  queryWithFallbacks,
  type SelectorDescriptor,
} from './selectors.ts';

describe('selectors module', () => {
  it('has a valid version tag', () => {
    expect(MEET_SELECTORS_VERSION).toBe('2026-11-03');
  });

  it('defines valid selector descriptors across all categories', () => {
    const allDescriptors: SelectorDescriptor[] = [
      ...Object.values(LOBBY_SELECTORS),
      ...Object.values(IN_CALL_SELECTORS),
      ...Object.values(CALL_ENDED_SELECTORS),
      ...Object.values(METADATA_SELECTORS),
      ...Object.values(PARTICIPANT_SELECTORS),
    ];

    for (const descriptor of allDescriptors) {
      expect(descriptor.id).toBeTruthy();
      expect(descriptor.description).toBeTruthy();
      expect(descriptor.selectors.length).toBeGreaterThan(0);
      for (const selector of descriptor.selectors) {
        expect(selector.trim()).toBe(selector);
        expect(selector.length).toBeGreaterThan(0);
      }
    }
  });

  describe('queryWithFallbacks', () => {
    const testDescriptor: SelectorDescriptor = {
      id: 'test.element',
      description: 'Test descriptor with fallbacks',
      selectors: ['#primary-id', '.fallback-class', '[data-test="third"]'],
    };

    it('returns primary match when first selector matches', () => {
      const mockElement = { id: 'primary-id' } as unknown as Element;
      const container = {
        querySelector: (selector: string) => (selector === '#primary-id' ? mockElement : null),
      } as unknown as ParentNode;

      const result = queryWithFallbacks(container, testDescriptor);
      expect(result.element).toBe(mockElement);
      expect(result.isPrimary).toBe(true);
      expect(result.matchedSelector).toBe('#primary-id');
      expect(result.selectorIndex).toBe(0);
    });

    it('returns fallback match when primary fails and fallback matches', () => {
      const mockElement = { className: 'fallback-class' } as unknown as Element;
      const container = {
        querySelector: (selector: string) => (selector === '.fallback-class' ? mockElement : null),
      } as unknown as ParentNode;

      const result = queryWithFallbacks(container, testDescriptor);
      expect(result.element).toBe(mockElement);
      expect(result.isPrimary).toBe(false);
      expect(result.matchedSelector).toBe('.fallback-class');
      expect(result.selectorIndex).toBe(1);
    });

    it('returns null result when no selectors match', () => {
      const container = {
        querySelector: () => null,
      } as unknown as ParentNode;

      const result = queryWithFallbacks(container, testDescriptor);
      expect(result.element).toBeNull();
      expect(result.isPrimary).toBe(false);
      expect(result.matchedSelector).toBeNull();
      expect(result.selectorIndex).toBe(-1);
    });

    it('ignores querySelector errors and continues to next fallback', () => {
      const mockElement = { id: 'fallback' } as unknown as Element;
      const errorDescriptor: SelectorDescriptor = {
        id: 'test.error',
        description: 'Descriptor with broken selector first',
        selectors: [':::broken:::', '#working-fallback'],
      };

      const container = {
        querySelector: (selector: string) => {
          if (selector === ':::broken:::') {
            throw new Error('SyntaxError: invalid selector');
          }
          return selector === '#working-fallback' ? mockElement : null;
        },
      } as unknown as ParentNode;

      const result = queryWithFallbacks(container, errorDescriptor);
      expect(result.element).toBe(mockElement);
      expect(result.matchedSelector).toBe('#working-fallback');
      expect(result.isPrimary).toBe(false);
      expect(result.selectorIndex).toBe(1);
    });
  });

  describe('matchesAny', () => {
    const testDescriptor: SelectorDescriptor = {
      id: 'test.element',
      description: 'Test descriptor',
      selectors: ['#one', '#two'],
    };

    it('returns true when a selector matches', () => {
      const container = {
        querySelector: (s: string) => (s === '#two' ? ({} as Element) : null),
      } as unknown as ParentNode;

      expect(matchesAny(container, testDescriptor)).toBe(true);
    });

    it('returns false when no selector matches', () => {
      const container = {
        querySelector: () => null,
      } as unknown as ParentNode;

      expect(matchesAny(container, testDescriptor)).toBe(false);
    });
  });
});
