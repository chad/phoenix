/**
 * Change Store — persists classified clause changes and the D-rate window.
 *
 * This closes the classifier→D-rate loop that was previously dead: `phoenix
 * ingest` classifies each changed clause, appends the classifications here, and
 * the persisted rolling window is what `phoenix status` reads to report the
 * D-rate (PRD §4). The window survives across processes — the earlier
 * save/load asymmetry (window never persisted) meant the rate reset every run.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangeClassification, ChangeClass } from '../models/classification.js';

export interface ChangeLogEntry {
  timestamp: string;
  doc_id: string;
  change_class: ChangeClass;
  confidence: number;
  clause_id_before?: string;
  clause_id_after?: string;
  llm_resolved?: boolean;
}

interface ChangeIndex {
  /** Rolling window of change classes (most recent last), capped at window_size. */
  window: ChangeClass[];
  window_size: number;
  /** Full append-only log for provenance/audit (not windowed). */
  log: ChangeLogEntry[];
}

const DEFAULT_WINDOW_SIZE = 100;

export class ChangeStore {
  private path: string;

  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.path = join(phoenixRoot, 'changes.json');
  }

  private load(): ChangeIndex {
    if (!existsSync(this.path)) return { window: [], window_size: DEFAULT_WINDOW_SIZE, log: [] };
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<ChangeIndex>;
      return {
        window: data.window ?? [],
        window_size: data.window_size ?? DEFAULT_WINDOW_SIZE,
        log: data.log ?? [],
      };
    } catch {
      return { window: [], window_size: DEFAULT_WINDOW_SIZE, log: [] };
    }
  }

  private save(index: ChangeIndex): void {
    writeFileSync(this.path, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * Record a batch of classifications: push classes into the rolling window
   * (evicting oldest past window_size) and append full entries to the log.
   */
  record(classifications: ChangeClassification[], docId: string, now: () => string = () => new Date().toISOString()): void {
    if (classifications.length === 0) return;
    const index = this.load();
    const timestamp = now();
    for (const c of classifications) {
      index.window.push(c.change_class);
      index.log.push({
        timestamp,
        doc_id: docId,
        change_class: c.change_class,
        confidence: c.confidence,
        clause_id_before: c.clause_id_before,
        clause_id_after: c.clause_id_after,
        llm_resolved: c.llm_resolved,
      });
    }
    while (index.window.length > index.window_size) index.window.shift();
    this.save(index);
  }

  /** The rolling window of change classes (for the D-rate tracker). */
  getWindow(): ChangeClass[] {
    return this.load().window;
  }

  getWindowSize(): number {
    return this.load().window_size;
  }

  /** Full classification log (append-only). */
  getLog(): ChangeLogEntry[] {
    return this.load().log;
  }
}
