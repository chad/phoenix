export interface SideChannelDependencies {
  databases?: string[];
  queues?: string[];
  caches?: string[];
  config?: string[];
  external_apis?: string[];
  files?: string[];
}

export interface CodeDependencies {
  allowed_ius?: string[];
  allowed_packages?: string[];
  forbidden_ius?: string[];
  forbidden_packages?: string[];
  forbidden_paths?: string[];
}

export interface BoundaryPolicy {
  iu_id: string;
  name: string;
  side_channels: SideChannelDependencies;
  code_dependencies: CodeDependencies;
}

export interface InvalidationEdge {
  from_iu: string;
  to_iu: string;
  dependency_type: keyof SideChannelDependencies;
  resource_name: string;
}

export interface BoundaryPolicyConfig {
  policies: BoundaryPolicy[];
  global_allowed_packages?: string[];
  global_forbidden_packages?: string[];
  global_forbidden_paths?: string[];
}

export class BoundaryPolicyValidator {
  private policies: Map<string, BoundaryPolicy> = new Map();
  private globalConfig: Omit<BoundaryPolicyConfig, 'policies'>;

  constructor(config: BoundaryPolicyConfig) {
    this.globalConfig = {
      global_allowed_packages: config.global_allowed_packages || [],
      global_forbidden_packages: config.global_forbidden_packages || [],
      global_forbidden_paths: config.global_forbidden_paths || []
    };

    for (const policy of config.policies) {
      this.policies.set(policy.iu_id, policy);
    }
  }

  validatePolicy(policy: BoundaryPolicy): string[] {
    const errors: string[] = [];

    if (!policy.iu_id || typeof policy.iu_id !== 'string') {
      errors.push('Policy must have a valid iu_id');
    }

    if (!policy.name || typeof policy.name !== 'string') {
      errors.push('Policy must have a valid name');
    }

    if (policy.side_channels) {
      this.validateSideChannels(policy.side_channels, errors);
    }

    if (policy.code_dependencies) {
      this.validateCodeDependencies(policy.code_dependencies, errors);
    }

    return errors;
  }

  private validateSideChannels(sideChannels: SideChannelDependencies, errors: string[]): void {
    const validKeys: (keyof SideChannelDependencies)[] = [
      'databases', 'queues', 'caches', 'config', 'external_apis', 'files'
    ];

    for (const [key, value] of Object.entries(sideChannels)) {
      if (!validKeys.includes(key as keyof SideChannelDependencies)) {
        errors.push(`Invalid side channel dependency type: ${key}`);
        continue;
      }

      if (value && !Array.isArray(value)) {
        errors.push(`Side channel dependency '${key}' must be an array`);
        continue;
      }

      if (value) {
        for (const item of value) {
          if (typeof item !== 'string' || item.trim() === '') {
            errors.push(`Side channel dependency '${key}' contains invalid resource name`);
          }
        }
      }
    }
  }

  private validateCodeDependencies(codeDeps: CodeDependencies, errors: string[]): void {
    const validKeys: (keyof CodeDependencies)[] = [
      'allowed_ius', 'allowed_packages', 'forbidden_ius', 'forbidden_packages', 'forbidden_paths'
    ];

    for (const [key, value] of Object.entries(codeDeps)) {
      if (!validKeys.includes(key as keyof CodeDependencies)) {
        errors.push(`Invalid code dependency type: ${key}`);
        continue;
      }

      if (value && !Array.isArray(value)) {
        errors.push(`Code dependency '${key}' must be an array`);
        continue;
      }

      if (value) {
        for (const item of value) {
          if (typeof item !== 'string' || item.trim() === '') {
            errors.push(`Code dependency '${key}' contains invalid item`);
          }
        }
      }
    }

    if (codeDeps.allowed_ius && codeDeps.forbidden_ius) {
      const allowed = new Set(codeDeps.allowed_ius);
      const forbidden = new Set(codeDeps.forbidden_ius);
      const conflicts = [...allowed].filter(iu => forbidden.has(iu));
      if (conflicts.length > 0) {
        errors.push(`IUs cannot be both allowed and forbidden: ${conflicts.join(', ')}`);
      }
    }

    if (codeDeps.allowed_packages && codeDeps.forbidden_packages) {
      const allowed = new Set(codeDeps.allowed_packages);
      const forbidden = new Set(codeDeps.forbidden_packages);
      const conflicts = [...allowed].filter(pkg => forbidden.has(pkg));
      if (conflicts.length > 0) {
        errors.push(`Packages cannot be both allowed and forbidden: ${conflicts.join(', ')}`);
      }
    }
  }

  generateInvalidationGraph(): InvalidationEdge[] {
    const edges: InvalidationEdge[] = [];
    const resourceToIUs = new Map<string, Set<string>>();

    for (const policy of this.policies.values()) {
      if (!policy.side_channels) continue;

      for (const [depType, resources] of Object.entries(policy.side_channels)) {
        if (!resources) continue;

        for (const resource of resources) {
          const key = `${depType}:${resource}`;
          if (!resourceToIUs.has(key)) {
            resourceToIUs.set(key, new Set());
          }
          resourceToIUs.get(key)!.add(policy.iu_id);
        }
      }
    }

    for (const [resourceKey, ius] of resourceToIUs.entries()) {
      const [depType, resourceName] = resourceKey.split(':', 2);
      const iuList = Array.from(ius);

      for (let i = 0; i < iuList.length; i++) {
        for (let j = i + 1; j < iuList.length; j++) {
          edges.push({
            from_iu: iuList[i],
            to_iu: iuList[j],
            dependency_type: depType as keyof SideChannelDependencies,
            resource_name: resourceName
          });
          edges.push({
            from_iu: iuList[j],
            to_iu: iuList[i],
            dependency_type: depType as keyof SideChannelDependencies,
            resource_name: resourceName
          });
        }
      }
    }

    return edges;
  }

  checkCodeDependencyViolation(fromIU: string, toIU: string, packageName?: string, filePath?: string): string[] {
    const policy = this.policies.get(fromIU);
    if (!policy) {
      return [`No boundary policy found for IU: ${fromIU}`];
    }

    const violations: string[] = [];
    const codeDeps = policy.code_dependencies;

    if (!codeDeps) {
      return violations;
    }

    if (toIU && codeDeps.forbidden_ius?.includes(toIU)) {
      violations.push(`IU ${fromIU} is forbidden from depending on IU ${toIU}`);
    }

    if (toIU && codeDeps.allowed_ius && !codeDeps.allowed_ius.includes(toIU)) {
      violations.push(`IU ${fromIU} is not allowed to depend on IU ${toIU}`);
    }

    if (packageName) {
      if (codeDeps.forbidden_packages?.includes(packageName) || 
          this.globalConfig.global_forbidden_packages?.includes(packageName)) {
        violations.push(`IU ${fromIU} is forbidden from using package ${packageName}`);
      }

      const allowedPackages = [
        ...(codeDeps.allowed_packages || []),
        ...(this.globalConfig.global_allowed_packages || [])
      ];

      if (allowedPackages.length > 0 && !allowedPackages.includes(packageName)) {
        violations.push(`IU ${fromIU} is not allowed to use package ${packageName}`);
      }
    }

    if (filePath) {
      const forbiddenPaths = [
        ...(codeDeps.forbidden_paths || []),
        ...(this.globalConfig.global_forbidden_paths || [])
      ];

      for (const forbiddenPath of forbiddenPaths) {
        if (filePath.includes(forbiddenPath)) {
          violations.push(`IU ${fromIU} is forbidden from accessing path ${filePath}`);
        }
      }
    }

    return violations;
  }

  getPolicy(iuId: string): BoundaryPolicy | undefined {
    return this.policies.get(iuId);
  }

  getAllPolicies(): BoundaryPolicy[] {
    return Array.from(this.policies.values());
  }

  updatePolicy(policy: BoundaryPolicy): string[] {
    const errors = this.validatePolicy(policy);
    if (errors.length === 0) {
      this.policies.set(policy.iu_id, policy);
    }
    return errors;
  }

  removePolicy(iuId: string): boolean {
    return this.policies.delete(iuId);
  }
}

export function createBoundaryPolicyValidator(config: BoundaryPolicyConfig): BoundaryPolicyValidator {
  return new BoundaryPolicyValidator(config);
}

export function validateBoundaryPolicyConfig(config: BoundaryPolicyConfig): string[] {
  const errors: string[] = [];

  if (!config.policies || !Array.isArray(config.policies)) {
    errors.push('Config must have a policies array');
    return errors;
  }

  const validator = new BoundaryPolicyValidator(config);
  const seenIds = new Set<string>();

  for (const policy of config.policies) {
    if (seenIds.has(policy.iu_id)) {
      errors.push(`Duplicate IU ID found: ${policy.iu_id}`);
    }
    seenIds.add(policy.iu_id);

    const policyErrors = validator.validatePolicy(policy);
    errors.push(...policyErrors);
  }

  return errors;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '0cefa9e3bdf727c5ddbc7222f2f1522bed6bd08158e7425c2deb730162d07cda',
  name: 'Boundary Policy Schema',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;