/**
 * Google Meet Selector Health Reporting Module
 *
 * Evaluates the health of configured DOM selectors against Google Meet's live DOM.
 * Tracks whether primary selectors or fallback selectors are matching, providing
 * early warnings ('degraded') when Google updates Meet's DOM before critical failures occur.
 *
 * Requirements:
 * - ARCHITECTURE §4.6: Monitor selector health, report degraded selectors before breaking.
 * - IMPLEMENTATION_PLAN §S1-07: Selector health report with version tags.
 */

import { type MeetCallState } from './detector.ts';
import {
  CALL_ENDED_SELECTORS,
  IN_CALL_SELECTORS,
  LOBBY_SELECTORS,
  MEET_SELECTORS_VERSION,
  METADATA_SELECTORS,
  PARTICIPANT_SELECTORS,
  queryWithFallbacks,
  type SelectorDescriptor,
} from './selectors.ts';

export type SelectorHealthStatus = 'healthy' | 'degraded' | 'broken';
export type HealthContext = MeetCallState | 'unknown';

export interface SelectorHealthEntry {
  descriptorId: string;
  description: string;
  matched: boolean;
  isPrimary: boolean;
  matchedSelector: string | null;
  selectorIndex: number; // 0 = primary, >0 = fallback, -1 = none
  totalFallbacks: number;
  required: boolean;
}

export interface SelectorHealthReport {
  version: string;
  timestamp: number;
  overallStatus: SelectorHealthStatus;
  primaryMatchCount: number;
  fallbackMatchCount: number;
  unmatchedCount: number;
  activeContext: HealthContext;
  entries: SelectorHealthEntry[];
}

/**
 * Evaluates a single selector descriptor against a DOM container.
 */
export function probeSelector(
  container: ParentNode,
  descriptor: SelectorDescriptor,
): SelectorHealthEntry {
  const result = queryWithFallbacks(container, descriptor);

  return {
    descriptorId: descriptor.id,
    description: descriptor.description,
    matched: result.element !== null,
    isPrimary: result.isPrimary,
    matchedSelector: result.matchedSelector,
    selectorIndex: result.selectorIndex,
    totalFallbacks: descriptor.selectors.length - 1,
    required: descriptor.required ?? true,
  };
}

/**
 * Probes a dictionary of selector descriptors against a DOM container.
 */
export function probeDescriptors(
  container: ParentNode,
  descriptors: Record<string, SelectorDescriptor>,
): SelectorHealthEntry[] {
  return Object.values(descriptors).map((descriptor) => probeSelector(container, descriptor));
}

/**
 * Determines overall health status based on matched entries.
 * - 'healthy': All required descriptors match on their primary selector.
 * - 'degraded': At least one descriptor matched on a fallback selector.
 * - 'broken': At least one required descriptor failed to match at all.
 */
export function computeHealthStatus(entries: readonly SelectorHealthEntry[]): SelectorHealthStatus {
  if (entries.length === 0) {
    return 'healthy';
  }

  // Only required descriptors trigger 'broken' if missing
  const hasUnmatchedRequired = entries.some((e) => e.required && !e.matched);
  if (hasUnmatchedRequired) {
    return 'broken';
  }

  // Any matched descriptor that used a fallback triggers 'degraded' (early warning)
  const hasFallbackMatch = entries.some((e) => e.matched && !e.isPrimary);
  if (hasFallbackMatch) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Selects descriptors relevant to the current call context.
 */
function getDescriptorsForContext(context: HealthContext): Record<string, SelectorDescriptor> {
  switch (context) {
    case 'in_call':
      return {
        ...IN_CALL_SELECTORS,
        ...METADATA_SELECTORS,
        ...PARTICIPANT_SELECTORS,
      };
    case 'lobby':
      return {
        ...LOBBY_SELECTORS,
      };
    case 'ended':
      return {
        ...CALL_ENDED_SELECTORS,
      };
    default: {
      // Home or unknown page: probe everything for telemetry, but nothing is required here, so the
      // report is not "broken" just because in-call controls are absent.
      const all = { ...IN_CALL_SELECTORS, ...LOBBY_SELECTORS, ...CALL_ENDED_SELECTORS };
      return Object.fromEntries(
        Object.entries(all).map(([key, descriptor]) => [key, { ...descriptor, required: false }]),
      );
    }
  }
}

/**
 * Generates a full selector health report for telemetry and debugging.
 */
export function generateSelectorHealthReport(
  container: ParentNode,
  context: HealthContext = 'unknown',
): SelectorHealthReport {
  const descriptors = getDescriptorsForContext(context);
  const entries = probeDescriptors(container, descriptors);

  let primaryMatchCount = 0;
  let fallbackMatchCount = 0;
  let unmatchedCount = 0;

  for (const entry of entries) {
    if (!entry.matched) {
      if (entry.required) {
        unmatchedCount++;
      }
    } else if (entry.isPrimary) {
      primaryMatchCount++;
    } else {
      fallbackMatchCount++;
    }
  }

  const overallStatus = computeHealthStatus(entries);

  return {
    version: MEET_SELECTORS_VERSION,
    timestamp: Date.now(),
    overallStatus,
    primaryMatchCount,
    fallbackMatchCount,
    unmatchedCount,
    activeContext: context,
    entries,
  };
}
