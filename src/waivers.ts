/**
 * Waiver Store — the labeling workflow for manual edits (PRD §9).
 *
 * Drift detection flags every unlabeled edit to generated code. The three labels
 * are how a human tells Phoenix what the edit *means*:
 *
 *   - promote_to_requirement — the edit encodes a real requirement that must be
 *     harvested into the spec (scar tissue → canonical graph). Recorded as a
 *     pending promotion; the waiver clears when the file is regenerated.
 *   - waiver — a signed, deliberate acceptance of the divergence.
 *   - temporary_patch — a hotfix with an expiry; drift returns when it expires.
 *
 * Waivers are keyed by project-relative file path, or by
 * `<file>#<iu_id>|<role>|<key>` for a single region of a shared aggregate file
 * (matching drift.ts's region-waiver keying).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { DriftWaiver } from './models/manifest.js';

export interface StoredWaiver extends DriftWaiver {
  /** Waiver key: file path, or `<file>#<iu>|<role>|<key>` for a shared-file region. */
  key: string;
  created_at: string;
  /** Hash of the working-tree content at label time (the labeled state). */
  labeled_hash?: string;
}

/**
 * A pending promotion: a manual edit the user declared to be a real requirement.
 * It stays open until the requirement lands in the spec and the file regenerates
 * cleanly — status surfaces open promotions so harvested knowledge is never lost.
 */
export interface PromotionRecord {
  file_path: string;
  iu_id?: string;
  reason: string;
  created_at: string;
  /** Hash of the edited content the promotion captured. */
  labeled_hash?: string;
  /** Set when the promotion is resolved (spec updated + file regenerated). */
  resolved_at?: string;
}

interface WaiverIndex {
  waivers: Record<string, StoredWaiver>;
}

interface PromotionIndex {
  promotions: PromotionRecord[];
}

export class WaiverStore {
  private waiverPath: string;
  private promotionPath: string;

  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.waiverPath = join(phoenixRoot, 'waivers.json');
    this.promotionPath = join(phoenixRoot, 'promotions.json');
  }

  private loadIndex(): WaiverIndex {
    if (!existsSync(this.waiverPath)) return { waivers: {} };
    try {
      return JSON.parse(readFileSync(this.waiverPath, 'utf8'));
    } catch {
      return { waivers: {} };
    }
  }

  private saveIndex(index: WaiverIndex): void {
    writeFileSync(this.waiverPath, JSON.stringify(index, null, 2), 'utf8');
  }

  private loadPromotions(): PromotionIndex {
    if (!existsSync(this.promotionPath)) return { promotions: [] };
    try {
      return JSON.parse(readFileSync(this.promotionPath, 'utf8'));
    } catch {
      return { promotions: [] };
    }
  }

  private savePromotions(index: PromotionIndex): void {
    writeFileSync(this.promotionPath, JSON.stringify(index, null, 2), 'utf8');
  }

  add(waiver: StoredWaiver): void {
    const index = this.loadIndex();
    index.waivers[waiver.key] = waiver;
    this.saveIndex(index);
  }

  remove(key: string): boolean {
    const index = this.loadIndex();
    if (!(key in index.waivers)) return false;
    delete index.waivers[key];
    this.saveIndex(index);
    return true;
  }

  get(key: string): StoredWaiver | undefined {
    return this.loadIndex().waivers[key];
  }

  getAll(): StoredWaiver[] {
    return Object.values(this.loadIndex().waivers);
  }

  /** The map shape detectDrift consumes: key → DriftWaiver. */
  asMap(): Map<string, DriftWaiver> {
    const map = new Map<string, DriftWaiver>();
    for (const [key, w] of Object.entries(this.loadIndex().waivers)) {
      map.set(key, { kind: w.kind, reason: w.reason, signed_by: w.signed_by, expires: w.expires });
    }
    return map;
  }

  addPromotion(record: PromotionRecord): void {
    const index = this.loadPromotions();
    index.promotions.push(record);
    this.savePromotions(index);
  }

  openPromotions(): PromotionRecord[] {
    return this.loadPromotions().promotions.filter(p => !p.resolved_at);
  }

  /**
   * Resolve promotions for a file (called when the file is regenerated — the
   * harvested edit either made it into the spec or was consciously dropped;
   * either way the working tree matches the manifest again).
   */
  resolvePromotions(filePath: string): number {
    const index = this.loadPromotions();
    let resolved = 0;
    for (const p of index.promotions) {
      if (p.file_path === filePath && !p.resolved_at) {
        p.resolved_at = new Date().toISOString();
        resolved++;
      }
    }
    if (resolved > 0) this.savePromotions(index);
    return resolved;
  }

  /**
   * Drop waivers whose labeled content no longer exists (file regenerated):
   * a waiver labels ONE divergence, not the file forever. Returns removed keys.
   */
  clearForFile(filePath: string): string[] {
    const index = this.loadIndex();
    const removed: string[] = [];
    for (const key of Object.keys(index.waivers)) {
      if (key === filePath || key.startsWith(`${filePath}#`)) {
        delete index.waivers[key];
        removed.push(key);
      }
    }
    if (removed.length > 0) this.saveIndex(index);
    return removed;
  }
}

/** Best-effort signer identity: git user, then $USER. Never throws. */
export function defaultSigner(cwd?: string): string | undefined {
  try {
    const name = execSync('git config user.name', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (name) return name;
  } catch { /* not a git repo / no config */ }
  return process.env.USER || process.env.USERNAME || undefined;
}

/**
 * Parse an --expires value: an ISO date, or a duration like `14d`, `12h`, `30m`.
 * Returns an ISO timestamp, or undefined for unparseable input.
 */
export function parseExpiry(value: string, now: Date = new Date()): string | undefined {
  const dur = value.match(/^(\d+)([dhm])$/);
  if (dur) {
    const n = parseInt(dur[1], 10);
    const unitMs = dur[2] === 'd' ? 86_400_000 : dur[2] === 'h' ? 3_600_000 : 60_000;
    return new Date(now.getTime() + n * unitMs).toISOString();
  }
  const t = new Date(value);
  if (!isNaN(t.getTime())) return t.toISOString();
  return undefined;
}
