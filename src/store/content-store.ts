/**
 * Content-Addressed Object Store
 *
 * Stores JSON objects by their content hash.
 * Operates on the filesystem under .phoenix/store/objects/
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export class ContentStore {
  private objectsDir: string;

  constructor(phoenixRoot: string) {
    this.objectsDir = join(phoenixRoot, 'store', 'objects');
    mkdirSync(this.objectsDir, { recursive: true });
  }

  /**
   * Store an object by its ID. ID is expected to be a hex hash.
   */
  put(id: string, data: unknown): void {
    // Reject empty/short ids — an empty id would resolve to the objects directory (EISDIR).
    if (!id || id.length < 2) throw new Error(`ContentStore.put: invalid id ${JSON.stringify(id)}`);
    // Use first 2 chars as subdirectory for fan-out
    const subDir = join(this.objectsDir, id.slice(0, 2));
    mkdirSync(subDir, { recursive: true });
    const filePath = join(subDir, id);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Retrieve an object by ID. Returns null if not found.
   */
  get<T = unknown>(id: string): T | null {
    const filePath = join(this.objectsDir, id.slice(0, 2), id);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  }

  /**
   * Check if an object exists.
   */
  has(id: string): boolean {
    const filePath = join(this.objectsDir, id.slice(0, 2), id);
    return existsSync(filePath);
  }

  /**
   * Delete an object by id. No-op if absent. Used to reclaim objects that are
   * definitively orphaned (e.g. a canonical node dropped by re-canonicalization),
   * so the content store doesn't accumulate dead blobs forever.
   */
  remove(id: string): boolean {
    if (!id || id.length < 2) return false;
    const filePath = join(this.objectsDir, id.slice(0, 2), id);
    if (!existsSync(filePath)) return false;
    rmSync(filePath);
    return true;
  }
}
