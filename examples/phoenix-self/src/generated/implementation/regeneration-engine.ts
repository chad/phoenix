import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface ImplementationUnit {
  id: string;
  path: string;
  content: string;
  dependencies: string[];
  lastModified: number;
}

export interface RegenerationRecord {
  model_id: string;
  promptpack_hash: string;
  toolchain_version: string;
  normalization_steps: string[];
  timestamp: number;
  iu_id: string;
}

export interface GeneratedArtifact {
  path: string;
  content: string;
  source_iu_id: string;
}

export interface FileHash {
  path: string;
  hash: string;
}

export interface IuHash {
  iu_id: string;
  hash: string;
  artifacts: FileHash[];
}

export interface GeneratedManifest {
  version: string;
  timestamp: number;
  file_hashes: FileHash[];
  iu_hashes: IuHash[];
  regeneration_records: RegenerationRecord[];
}

export interface RegenerationInput {
  model_id: string;
  promptpack_hash: string;
  toolchain_version: string;
  normalization_steps: string[];
  ius: ImplementationUnit[];
  generator: (iu: ImplementationUnit) => Promise<GeneratedArtifact[]>;
}

export class RegenerationEngine {
  private manifestPath: string;
  private manifest: GeneratedManifest;

  constructor(projectRoot: string) {
    this.manifestPath = join(projectRoot, '.phoenix', 'generated_manifest');
    this.manifest = {
      version: '1.0.0',
      timestamp: 0,
      file_hashes: [],
      iu_hashes: [],
      regeneration_records: []
    };
  }

  async loadManifest(): Promise<void> {
    try {
      const content = await readFile(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(content);
    } catch (error) {
      // Manifest doesn't exist or is invalid, use default
      this.manifest = {
        version: '1.0.0',
        timestamp: 0,
        file_hashes: [],
        iu_hashes: [],
        regeneration_records: []
      };
    }
  }

  async saveManifest(): Promise<void> {
    await mkdir(dirname(this.manifestPath), { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private computeIuInputHash(iu: ImplementationUnit, input: RegenerationInput): string {
    const inputData = {
      iu_id: iu.id,
      content: iu.content,
      dependencies: iu.dependencies.sort(),
      model_id: input.model_id,
      promptpack_hash: input.promptpack_hash,
      toolchain_version: input.toolchain_version,
      normalization_steps: input.normalization_steps
    };
    return this.computeHash(JSON.stringify(inputData));
  }

  private isIuInvalidated(iu: ImplementationUnit, input: RegenerationInput): boolean {
    const currentInputHash = this.computeIuInputHash(iu, input);
    const existingIuHash = this.manifest.iu_hashes.find(h => h.iu_id === iu.id);
    
    if (!existingIuHash) {
      return true; // New IU, needs generation
    }

    return existingIuHash.hash !== currentInputHash;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async areArtifactsValid(iu: ImplementationUnit): Promise<boolean> {
    const existingIuHash = this.manifest.iu_hashes.find(h => h.iu_id === iu.id);
    if (!existingIuHash) {
      return false;
    }

    for (const artifact of existingIuHash.artifacts) {
      if (!(await this.fileExists(artifact.path))) {
        return false;
      }

      try {
        const content = await readFile(artifact.path, 'utf-8');
        const currentHash = this.computeHash(content);
        if (currentHash !== artifact.hash) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  async regenerate(input: RegenerationInput): Promise<GeneratedArtifact[]> {
    await this.loadManifest();

    const invalidatedIus: ImplementationUnit[] = [];
    const allArtifacts: GeneratedArtifact[] = [];

    // Identify invalidated IUs
    for (const iu of input.ius) {
      const isInvalidated = this.isIuInvalidated(iu, input);
      const artifactsValid = await this.areArtifactsValid(iu);
      
      if (isInvalidated || !artifactsValid) {
        invalidatedIus.push(iu);
      }
    }

    // Regenerate invalidated IUs
    for (const iu of invalidatedIus) {
      const artifacts = await input.generator(iu);
      allArtifacts.push(...artifacts);

      // Write artifacts to disk
      for (const artifact of artifacts) {
        await mkdir(dirname(artifact.path), { recursive: true });
        await writeFile(artifact.path, artifact.content);
      }

      // Update manifest
      const inputHash = this.computeIuInputHash(iu, input);
      const artifactHashes: FileHash[] = artifacts.map(artifact => ({
        path: artifact.path,
        hash: this.computeHash(artifact.content)
      }));

      // Remove existing IU hash entry
      this.manifest.iu_hashes = this.manifest.iu_hashes.filter(h => h.iu_id !== iu.id);
      
      // Add new IU hash entry
      this.manifest.iu_hashes.push({
        iu_id: iu.id,
        hash: inputHash,
        artifacts: artifactHashes
      });

      // Update file hashes
      for (const artifactHash of artifactHashes) {
        this.manifest.file_hashes = this.manifest.file_hashes.filter(h => h.path !== artifactHash.path);
        this.manifest.file_hashes.push(artifactHash);
      }

      // Record regeneration
      const record: RegenerationRecord = {
        model_id: input.model_id,
        promptpack_hash: input.promptpack_hash,
        toolchain_version: input.toolchain_version,
        normalization_steps: [...input.normalization_steps],
        timestamp: Date.now(),
        iu_id: iu.id
      };

      this.manifest.regeneration_records.push(record);
    }

    // Update manifest timestamp
    this.manifest.timestamp = Date.now();

    // Save manifest
    await this.saveManifest();

    return allArtifacts;
  }

  getManifest(): GeneratedManifest {
    return { ...this.manifest };
  }

  getRegenerationHistory(iu_id?: string): RegenerationRecord[] {
    if (iu_id) {
      return this.manifest.regeneration_records.filter(r => r.iu_id === iu_id);
    }
    return [...this.manifest.regeneration_records];
  }

  async validateArtifacts(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    for (const iu_hash of this.manifest.iu_hashes) {
      for (const artifact of iu_hash.artifacts) {
        try {
          if (!(await this.fileExists(artifact.path))) {
            issues.push(`Missing artifact: ${artifact.path} for IU ${iu_hash.iu_id}`);
            continue;
          }

          const content = await readFile(artifact.path, 'utf-8');
          const currentHash = this.computeHash(content);
          
          if (currentHash !== artifact.hash) {
            issues.push(`Hash mismatch for ${artifact.path}: expected ${artifact.hash}, got ${currentHash}`);
          }
        } catch (error) {
          issues.push(`Error validating ${artifact.path}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}

export function createRegenerationEngine(projectRoot: string): RegenerationEngine {
  return new RegenerationEngine(projectRoot);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '3715ff580b28c15b2682a86308238ea96a4bc26aa3f265097ee21e13cd01bb18',
  name: 'Regeneration Engine',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;