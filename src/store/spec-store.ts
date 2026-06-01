/**
 * Spec Store — manages the Spec Graph
 *
 * Handles ingestion, retrieval, and diffing of spec documents.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Clause, IngestResult, ClauseDiff } from '../models/clause.js';
import { ContentStore } from './content-store.js';
import { parseSpec } from '../spec-parser.js';
import { diffClauses } from '../diff.js';

interface SpecGraphIndex {
  documents: Record<string, {
    clause_ids: string[];
    last_ingested: string;
  }>;
}

export class SpecStore {
  private contentStore: ContentStore;
  private graphPath: string;
  private phoenixRoot: string;

  constructor(phoenixRoot: string) {
    this.phoenixRoot = phoenixRoot;
    this.contentStore = new ContentStore(phoenixRoot);
    const graphDir = join(phoenixRoot, 'graphs');
    mkdirSync(graphDir, { recursive: true });
    this.graphPath = join(graphDir, 'spec.json');
  }

  private loadIndex(): SpecGraphIndex {
    if (!existsSync(this.graphPath)) {
      return { documents: {} };
    }
    try {
      return JSON.parse(readFileSync(this.graphPath, 'utf8'));
    } catch {
      return { documents: {} }; // empty/partial file must not brick the store
    }
  }

  private saveIndex(index: SpecGraphIndex): void {
    writeFileSync(this.graphPath, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * Ingest a spec document. Parses it into clauses, stores them,
   * and updates the spec graph index.
   */
  ingestDocument(docPath: string, projectRoot?: string): IngestResult {
    const content = readFileSync(docPath, 'utf8');
    const docId = projectRoot ? relative(projectRoot, docPath) : docPath;
    const clauses = parseSpec(content, docId);

    // Store each clause
    for (const clause of clauses) {
      this.contentStore.put(clause.clause_id, clause);
    }

    // Update index
    const index = this.loadIndex();
    const timestamp = new Date().toISOString();
    index.documents[docId] = {
      clause_ids: clauses.map(c => c.clause_id),
      last_ingested: timestamp,
    };
    this.saveIndex(index);

    return { doc_id: docId, clauses, timestamp };
  }

  /**
   * Ingest from raw content string (useful for testing).
   */
  ingestContent(content: string, docId: string): IngestResult {
    const clauses = parseSpec(content, docId);

    for (const clause of clauses) {
      this.contentStore.put(clause.clause_id, clause);
    }

    const index = this.loadIndex();
    const timestamp = new Date().toISOString();
    index.documents[docId] = {
      clause_ids: clauses.map(c => c.clause_id),
      last_ingested: timestamp,
    };
    this.saveIndex(index);

    return { doc_id: docId, clauses, timestamp };
  }

  /**
   * Get all clauses for a document.
   */
  getClauses(docId: string): Clause[] {
    const index = this.loadIndex();
    const doc = index.documents[docId];
    if (!doc) return [];
    return doc.clause_ids
      .map(id => this.contentStore.get<Clause>(id))
      .filter((c): c is Clause => c !== null);
  }

  /**
   * Get a single clause by ID.
   */
  getClause(clauseId: string): Clause | null {
    return this.contentStore.get<Clause>(clauseId);
  }

  /**
   * Diff a document: compare stored clauses vs current file content.
   */
  diffDocument(docPath: string, projectRoot?: string): ClauseDiff[] {
    const content = readFileSync(docPath, 'utf8');
    const docId = projectRoot ? relative(projectRoot, docPath) : docPath;
    const before = this.getClauses(docId);
    const after = parseSpec(content, docId);
    return diffClauses(before, after);
  }

  /**
   * Diff from content strings (useful for testing).
   */
  diffContent(beforeContent: string, afterContent: string, docId: string): ClauseDiff[] {
    const before = parseSpec(beforeContent, docId);
    const after = parseSpec(afterContent, docId);
    return diffClauses(before, after);
  }
}
