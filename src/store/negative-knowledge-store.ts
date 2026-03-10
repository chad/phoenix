/**
 * Negative Knowledge Store — persists what was tried and failed.
 * Preserved across compaction. The system's immune memory.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NegativeKnowledge } from '../models/negative-knowledge.js';

interface NKIndex {
  records: NegativeKnowledge[];
}

export class NegativeKnowledgeStore {
  private indexPath: string;

  constructor(phoenixRoot: string) {
    const dir = join(phoenixRoot, 'provenance');
    mkdirSync(dir, { recursive: true });
    this.indexPath = join(dir, 'negative-knowledge.json');
  }

  private load(): NKIndex {
    if (!existsSync(this.indexPath)) return { records: [] };
    return JSON.parse(readFileSync(this.indexPath, 'utf8'));
  }

  private save(index: NKIndex): void {
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  add(record: NegativeKnowledge): void {
    const index = this.load();
    const existing = index.records.findIndex(r => r.nk_id === record.nk_id);
    if (existing >= 0) {
      index.records[existing] = record;
    } else {
      index.records.push(record);
    }
    this.save(index);
  }

  getBySubject(subjectId: string): NegativeKnowledge[] {
    return this.load().records.filter(r => r.subject_id === subjectId && r.active);
  }

  getAll(): NegativeKnowledge[] {
    return this.load().records;
  }

  getActive(): NegativeKnowledge[] {
    return this.load().records.filter(r => r.active);
  }

  markStale(nkId: string): boolean {
    const index = this.load();
    const record = index.records.find(r => r.nk_id === nkId);
    if (record) {
      record.active = false;
      this.save(index);
      return true;
    }
    return false;
  }
}
