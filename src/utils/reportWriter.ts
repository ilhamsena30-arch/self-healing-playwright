import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Appends self-healing repair events to a local JSON run log.
 *
 * `self-healing-report.json` sits at the repo root and accumulates one entry per
 * successful Tier-3 repair. Writes are serialised through an in-process promise
 * chain so concurrent workers never interleave a half-written JSON array.
 */

export interface HealReportEntry {
  timestamp: string;
  test: string;
  originalSelector: string;
  repairedSelector: string;
  confidence: number;
  reasoning: string;
}

const log: Logger = createLogger('healing:report');

const reportPath = path.join(process.cwd(), SELF_HEALING.reportFile);

/** Serialises concurrent appends; each write waits for the previous one. */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Reads the existing report array, or returns [] when the file is absent/malformed.
 * A corrupt file is reset so a single bad write can never brick future reports.
 */
async function readEntries(): Promise<HealReportEntry[]> {
  try {
    const raw = await fs.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HealReportEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends a repair event and writes the whole array back atomically. */
export function logHealEvent(entry: Omit<HealReportEntry, 'timestamp'>): void {
  const fullEntry: HealReportEntry = { ...entry, timestamp: new Date().toISOString() };

  // Chain onto the previous write so parallel tests never corrupt the file.
  writeQueue = writeQueue.then(async () => {
    const entries = await readEntries();
    entries.push(fullEntry);
    const tmp = `${reportPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
    await fs.rename(tmp, reportPath);
    log.info(
      `heal logged: "${fullEntry.originalSelector}" -> "${fullEntry.repairedSelector}" (confidence ${fullEntry.confidence})`,
    );
  });

  // Keep the chain alive even when a write fails.
  writeQueue = writeQueue.catch((error) => {
    log.warn(`failed to write self-healing report: ${String(error)}`);
  });
}

/** Resolves once all queued writes have settled (used by teardown). */
export async function flushHealReport(): Promise<void> {
  await writeQueue;
}
