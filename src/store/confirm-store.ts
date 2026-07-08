/**
 * Confirm Store — pending mutating bot commands awaiting confirmation (PRD §14.1).
 *
 * A bot mutating command echoes its parsed intent and a confirm_id; the user
 * replies `phx confirm <id>` to execute. This persists the pending command so
 * confirmation survives across separate CLI invocations (each `phoenix bot …`
 * call is its own process).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BotCommand } from '../models/bot.js';

export interface PendingCommand {
  confirm_id: string;
  command: BotCommand;
  intent: string;
  created_at: string;
}

interface ConfirmIndex {
  pending: Record<string, PendingCommand>;
}

export class ConfirmStore {
  private path: string;
  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.path = join(phoenixRoot, 'pending-confirms.json');
  }
  private load(): ConfirmIndex {
    if (!existsSync(this.path)) return { pending: {} };
    try { return JSON.parse(readFileSync(this.path, 'utf8')); } catch { return { pending: {} }; }
  }
  private save(index: ConfirmIndex): void {
    writeFileSync(this.path, JSON.stringify(index, null, 2), 'utf8');
  }
  add(p: PendingCommand): void {
    const index = this.load();
    index.pending[p.confirm_id] = p;
    this.save(index);
  }
  take(confirmId: string): PendingCommand | null {
    const index = this.load();
    const p = index.pending[confirmId];
    if (!p) return null;
    delete index.pending[confirmId];
    this.save(index);
    return p;
  }
  /** The most recently created pending command (for a bare `ok` reply). */
  latest(): PendingCommand | null {
    const all = Object.values(this.load().pending);
    if (all.length === 0) return null;
    return all.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  }
}
