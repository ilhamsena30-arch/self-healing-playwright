import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Append-only NDJSON self-healing report (D1, D7).
 *
 * One JSON line per event via `fs.appendFile`, which is parallel-safe by
 * construction — the old read-modify-write JSON-array approach is what lost
 * entries when workers ran concurrently. Every attempt is recorded: applied,
 * rejected, and unverified.
 */

export interface SuggestedPatch {
  file: string | null;
  before: string;
  after: string;
}

export interface HealReportEntry {
  timestamp: string;
  test: string;
  originalSelector: string;
  repairedSelector: string;
  confidence: number;
  /** false when the gate had no expectations to check (D4/D12). */
  verified: boolean;
  reasoning: string;
  applied: boolean;
  reason?: string;
  url: string;
  model: string;
  suggestedPatch?: SuggestedPatch;
}

const log: Logger = createLogger('healing:report');

const reportPath = path.join(process.cwd(), SELF_HEALING.reportFile);

/** Serialises concurrent appends; each write waits for the previous one. */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Appends a single event line. `flushHealReport` is called from teardown so
 * buffered lines are never lost (D16).
 */
export function logHealEvent(entry: Omit<HealReportEntry, 'timestamp'>): void {
  const fullEntry: HealReportEntry = { ...entry, timestamp: new Date().toISOString() };

  writeQueue = writeQueue.then(async () => {
    await fs.appendFile(reportPath, `${JSON.stringify(fullEntry)}\n`, 'utf8');
    log.info(
      `heal logged (applied=${fullEntry.applied}, verified=${fullEntry.verified}): "${fullEntry.originalSelector}" -> "${fullEntry.repairedSelector}"`,
    );
  });

  writeQueue = writeQueue.catch((error) => {
    log.warn(`failed to write self-healing report: ${String(error)}`);
  });
}

/** Resolves once all queued writes have settled (used by teardown, D16). */
export async function flushHealReport(): Promise<void> {
  await writeQueue;
}
