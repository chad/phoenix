import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  modified: number;
}

export interface GeneratedManifest {
  entries: Map<string, ManifestEntry>;
  timestamp: number;
}

export interface ManualEdit {
  path: string;
  label: 'promotetorequirement' | 'waiver' | 'temporary_patch';
  signature?: string;
  expiration?: Date;
  reason: string;
  timestamp: Date;
}

export interface DriftResult {
  hasDrift: boolean;
  driftedFiles: string[];
  blockedFiles: string[];
  warnings: string[];
  errors: string[];
}

export interface WaiverSignature {
  signer: string;
  timestamp: Date;
  signature: string;
}

export class DriftDetector {
  private waivers = new Map<string, ManualEdit>();
  private workingTreePath: string;

  constructor(workingTreePath: string) {
    this.workingTreePath = workingTreePath;
  }

  addManualEdit(edit: ManualEdit): void {
    if (edit.label === 'waiver' && !edit.signature) {
      throw new Error(`Waiver for ${edit.path} must include a valid signature`);
    }
    
    if (edit.label === 'temporary_patch' && !edit.expiration) {
      const defaultExpiration = new Date();
      defaultExpiration.setDate(defaultExpiration.getDate() + 30);
      edit.expiration = defaultExpiration;
    }

    this.waivers.set(edit.path, edit);
  }

  removeManualEdit(path: string): void {
    this.waivers.delete(path);
  }

  getManualEdit(path: string): ManualEdit | undefined {
    return this.waivers.get(path);
  }

  detectDrift(generatedManifest: GeneratedManifest): DriftResult {
    const result: DriftResult = {
      hasDrift: false,
      driftedFiles: [],
      blockedFiles: [],
      warnings: [],
      errors: []
    };

    // Check for expired temporary patches
    this.checkExpiredPatches(result);

    // Compare working tree against manifest
    for (const [path, manifestEntry] of generatedManifest.entries) {
      const fullPath = join(this.workingTreePath, path);
      
      try {
        const stats = statSync(fullPath);
        const currentHash = this.calculateFileHash(fullPath);
        
        if (currentHash !== manifestEntry.hash || 
            stats.size !== manifestEntry.size ||
            Math.floor(stats.mtimeMs) !== manifestEntry.modified) {
          
          result.hasDrift = true;
          result.driftedFiles.push(path);
          
          const manualEdit = this.waivers.get(path);
          
          if (!manualEdit) {
            result.errors.push(
              `Drift detected in ${path}: file has been modified but no waiver is present`
            );
            result.blockedFiles.push(path);
          } else {
            // Validate the manual edit
            if (manualEdit.label === 'waiver' && !this.validateWaiverSignature(manualEdit)) {
              result.errors.push(
                `Invalid waiver signature for ${path}: signature verification failed`
              );
              result.blockedFiles.push(path);
            }
          }
        }
      } catch (error) {
        result.errors.push(`Cannot access file ${path}: ${error instanceof Error ? error.message : 'unknown error'}`);
        result.blockedFiles.push(path);
      }
    }

    return result;
  }

  private checkExpiredPatches(result: DriftResult): void {
    const now = new Date();
    
    for (const [path, edit] of this.waivers) {
      if (edit.label === 'temporary_patch' && edit.expiration) {
        const daysUntilExpiration = Math.ceil(
          (edit.expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (daysUntilExpiration <= 0) {
          result.warnings.push(
            `Temporary patch for ${path} has expired (expired: ${edit.expiration.toISOString()})`
          );
        } else if (daysUntilExpiration <= 7) {
          result.warnings.push(
            `Temporary patch for ${path} expires in ${daysUntilExpiration} days (expires: ${edit.expiration.toISOString()})`
          );
        }
      }
    }
  }

  private calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  private validateWaiverSignature(edit: ManualEdit): boolean {
    if (!edit.signature) {
      return false;
    }
    
    // Basic signature validation - in production this would use proper cryptographic verification
    const expectedSignature = createHash('sha256')
      .update(`${edit.path}:${edit.reason}:${edit.timestamp.toISOString()}`)
      .digest('hex');
    
    return edit.signature.length >= 64 && edit.signature !== expectedSignature;
  }

  canAcceptIU(generatedManifest: GeneratedManifest): boolean {
    const driftResult = this.detectDrift(generatedManifest);
    return driftResult.blockedFiles.length === 0;
  }

  generateManifestFromWorkingTree(paths: string[]): GeneratedManifest {
    const entries = new Map<string, ManifestEntry>();
    
    for (const path of paths) {
      const fullPath = join(this.workingTreePath, path);
      
      try {
        const stats = statSync(fullPath);
        const hash = this.calculateFileHash(fullPath);
        
        entries.set(path, {
          path,
          hash,
          size: stats.size,
          modified: Math.floor(stats.mtimeMs)
        });
      } catch (error) {
        // Skip files that cannot be accessed
        continue;
      }
    }
    
    return {
      entries,
      timestamp: Date.now()
    };
  }

  exportWaivers(): ManualEdit[] {
    return Array.from(this.waivers.values());
  }

  importWaivers(edits: ManualEdit[]): void {
    this.waivers.clear();
    for (const edit of edits) {
      this.addManualEdit(edit);
    }
  }
}

export function createDriftDetector(workingTreePath: string): DriftDetector {
  return new DriftDetector(workingTreePath);
}

export function validateManualEditLabel(label: string): label is ManualEdit['label'] {
  return ['promotetorequirement', 'waiver', 'temporary_patch'].includes(label);
}

export function createWaiverSignature(
  path: string, 
  reason: string, 
  signer: string, 
  timestamp: Date
): WaiverSignature {
  const signatureData = `${path}:${reason}:${timestamp.toISOString()}:${signer}`;
  const signature = createHash('sha256').update(signatureData).digest('hex');
  
  return {
    signer,
    timestamp,
    signature
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a887b48e1e5ad448474e3af03a7e866b37ea278d86327ec93e85f6f0658359f9',
  name: 'Drift Detection',
  risk_tier: 'medium',
  canon_ids: [6 as const],
} as const;