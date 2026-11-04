/**
 * Unit tests for Google Meet Selector Health Reporting Module
 *
 * Verifies:
 * - Detection of primary selector matches (healthy).
 * - Detection of fallback selector matches (degraded - early warning).
 * - Detection of unmatched required selectors (broken).
 * - Preservation of healthy status when optional/situational selectors are unmatched.
 * - Report generation with version tags and telemetry counts.
 */

import { describe, expect, it } from 'vitest';
import {
  computeHealthStatus,
  generateSelectorHealthReport,
  probeDescriptors,
  probeSelector,
  type SelectorHealthEntry,
} from './health.ts';
import { IN_CALL_SELECTORS, MEET_SELECTORS_VERSION, type SelectorDescriptor } from './selectors.ts';

function createMockContainer(matchedPatterns: string[] = []): ParentNode {
  return {
    querySelector: (selector: string) => {
      const match = matchedPatterns.some((pattern) => selector.includes(pattern));
      return match ? ({} as Element) : null;
    },
    querySelectorAll: (selector: string) => {
      const match = matchedPatterns.some((pattern) => selector.includes(pattern));
      return match ? [{} as Element] : [];
    },
  } as unknown as ParentNode;
}

describe('probeSelector', () => {
  const mockDescriptor: SelectorDescriptor = {
    id: 'test.button',
    description: 'Test button',
    selectors: ['button[primary]', 'button[fallback-1]', 'button[fallback-2]'],
    required: true,
  };

  it('reports healthy primary match when first selector matches', () => {
    const dom = createMockContainer(['button[primary]']);
    const entry = probeSelector(dom, mockDescriptor);

    expect(entry.matched).toBe(true);
    expect(entry.isPrimary).toBe(true);
    expect(entry.selectorIndex).toBe(0);
    expect(entry.matchedSelector).toBe('button[primary]');
    expect(entry.totalFallbacks).toBe(2);
    expect(entry.required).toBe(true);
  });

  it('reports fallback match when primary fails but fallback matches', () => {
    const dom = createMockContainer(['button[fallback-1]']);
    const entry = probeSelector(dom, mockDescriptor);

    expect(entry.matched).toBe(true);
    expect(entry.isPrimary).toBe(false);
    expect(entry.selectorIndex).toBe(1);
    expect(entry.matchedSelector).toBe('button[fallback-1]');
  });

  it('reports unmatched when none of the selectors match', () => {
    const dom = createMockContainer([]);
    const entry = probeSelector(dom, mockDescriptor);

    expect(entry.matched).toBe(false);
    expect(entry.isPrimary).toBe(false);
    expect(entry.selectorIndex).toBe(-1);
    expect(entry.matchedSelector).toBeNull();
  });
});

describe('computeHealthStatus', () => {
  it('returns healthy when all entries matched primary', () => {
    const entries: SelectorHealthEntry[] = [
      {
        descriptorId: 'a',
        description: 'A',
        matched: true,
        isPrimary: true,
        matchedSelector: 'a',
        selectorIndex: 0,
        totalFallbacks: 1,
        required: true,
      },
      {
        descriptorId: 'b',
        description: 'B',
        matched: true,
        isPrimary: true,
        matchedSelector: 'b',
        selectorIndex: 0,
        totalFallbacks: 2,
        required: true,
      },
    ];

    expect(computeHealthStatus(entries)).toBe('healthy');
  });

  it('returns degraded when at least one entry matched on fallback', () => {
    const entries: SelectorHealthEntry[] = [
      {
        descriptorId: 'a',
        description: 'A',
        matched: true,
        isPrimary: true,
        matchedSelector: 'a',
        selectorIndex: 0,
        totalFallbacks: 1,
        required: true,
      },
      {
        descriptorId: 'b',
        description: 'B',
        matched: true,
        isPrimary: false,
        matchedSelector: 'b-fallback',
        selectorIndex: 1,
        totalFallbacks: 2,
        required: true,
      },
    ];

    expect(computeHealthStatus(entries)).toBe('degraded');
  });

  it('returns broken when a required entry failed to match', () => {
    const entries: SelectorHealthEntry[] = [
      {
        descriptorId: 'a',
        description: 'A',
        matched: true,
        isPrimary: true,
        matchedSelector: 'a',
        selectorIndex: 0,
        totalFallbacks: 1,
        required: true,
      },
      {
        descriptorId: 'b',
        description: 'B',
        matched: false,
        isPrimary: false,
        matchedSelector: null,
        selectorIndex: -1,
        totalFallbacks: 2,
        required: true,
      },
    ];

    expect(computeHealthStatus(entries)).toBe('broken');
  });

  it('returns healthy when an optional (required: false) selector is unmatched', () => {
    const entries: SelectorHealthEntry[] = [
      {
        descriptorId: 'core-button',
        description: 'Leave call',
        matched: true,
        isPrimary: true,
        matchedSelector: 'button.leave',
        selectorIndex: 0,
        totalFallbacks: 1,
        required: true,
      },
      {
        descriptorId: 'optional-title',
        description: 'Calendar meeting title',
        matched: false,
        isPrimary: false,
        matchedSelector: null,
        selectorIndex: -1,
        totalFallbacks: 2,
        required: false, // Optional on instant calls
      },
    ];

    expect(computeHealthStatus(entries)).toBe('healthy');
  });

  it('returns healthy for empty entries list', () => {
    expect(computeHealthStatus([])).toBe('healthy');
  });
});

describe('probeDescriptors', () => {
  it('evaluates all descriptors in a dictionary', () => {
    const dom = createMockContainer(['Leave call', 'Call controls']);
    const entries = probeDescriptors(dom, IN_CALL_SELECTORS);

    expect(entries).toHaveLength(Object.keys(IN_CALL_SELECTORS).length);
    expect(entries.some((e) => e.descriptorId === 'in-call.leave-button')).toBe(true);
  });
});

describe('generateSelectorHealthReport', () => {
  it('generates report with correct version, counts, and context', () => {
    const dom = createMockContainer([
      'Leave call',
      'Call controls',
      'Turn off microphone',
      'More options for ',
    ]);
    const report = generateSelectorHealthReport(dom, 'in_call');

    expect(report.version).toBe(MEET_SELECTORS_VERSION);
    expect(report.activeContext).toBe('in_call');
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.overallStatus).toBe('healthy');
  });

  it('scopes descriptors correctly for lobby context', () => {
    const dom = createMockContainer(['Join now']);
    const report = generateSelectorHealthReport(dom, 'lobby');

    expect(report.activeContext).toBe('lobby');
    const descriptorIds = report.entries.map((e) => e.descriptorId);
    expect(descriptorIds).toContain('lobby.join-button');
    expect(descriptorIds).not.toContain('in-call.leave-button');
  });
});
