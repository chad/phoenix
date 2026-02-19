export interface AssignmentRecord {
  taskId: string;
  userId: string | null;
  assignedAt: Date;
  assignedBy: string;
}

export interface AssignmentAuditEntry {
  taskId: string;
  previousUserId: string | null;
  newUserId: string | null;
  changedAt: Date;
  changedBy: string;
  reason?: string;
}

export interface TaskAssignment {
  taskId: string;
  currentUserId: string | null;
  assignedAt: Date | null;
  assignedBy: string | null;
  auditTrail: AssignmentAuditEntry[];
}

export class AssignmentManager {
  private assignments = new Map<string, TaskAssignment>();

  assignTask(taskId: string, userId: string, assignedBy: string, reason?: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!userId.trim()) {
      throw new Error('User ID cannot be empty');
    }
    if (!assignedBy.trim()) {
      throw new Error('Assigned by user ID cannot be empty');
    }

    const now = new Date();
    const existing = this.assignments.get(taskId);
    const previousUserId = existing?.currentUserId || null;

    const auditEntry: AssignmentAuditEntry = {
      taskId,
      previousUserId,
      newUserId: userId,
      changedAt: now,
      changedBy: assignedBy,
      reason,
    };

    const assignment: TaskAssignment = {
      taskId,
      currentUserId: userId,
      assignedAt: now,
      assignedBy,
      auditTrail: existing ? [...existing.auditTrail, auditEntry] : [auditEntry],
    };

    this.assignments.set(taskId, assignment);
  }

  unassignTask(taskId: string, unassignedBy: string, reason?: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!unassignedBy.trim()) {
      throw new Error('Unassigned by user ID cannot be empty');
    }

    const existing = this.assignments.get(taskId);
    if (!existing || !existing.currentUserId) {
      throw new Error('Task is not currently assigned');
    }

    const now = new Date();
    const auditEntry: AssignmentAuditEntry = {
      taskId,
      previousUserId: existing.currentUserId,
      newUserId: null,
      changedAt: now,
      changedBy: unassignedBy,
      reason,
    };

    const assignment: TaskAssignment = {
      taskId,
      currentUserId: null,
      assignedAt: null,
      assignedBy: null,
      auditTrail: [...existing.auditTrail, auditEntry],
    };

    this.assignments.set(taskId, assignment);
  }

  getAssignment(taskId: string): TaskAssignment | null {
    return this.assignments.get(taskId) || null;
  }

  getUnassignedTasks(): string[] {
    const unassigned: string[] = [];
    for (const [taskId, assignment] of this.assignments) {
      if (!assignment.currentUserId) {
        unassigned.push(taskId);
      }
    }
    return unassigned;
  }

  getTasksAssignedTo(userId: string): string[] {
    if (!userId.trim()) {
      return [];
    }

    const assigned: string[] = [];
    for (const [taskId, assignment] of this.assignments) {
      if (assignment.currentUserId === userId) {
        assigned.push(taskId);
      }
    }
    return assigned;
  }

  getAssignmentHistory(taskId: string): AssignmentAuditEntry[] {
    const assignment = this.assignments.get(taskId);
    return assignment ? [...assignment.auditTrail] : [];
  }

  getAllAssignments(): TaskAssignment[] {
    return Array.from(this.assignments.values()).map(assignment => ({
      ...assignment,
      auditTrail: [...assignment.auditTrail],
    }));
  }

  isTaskAssigned(taskId: string): boolean {
    const assignment = this.assignments.get(taskId);
    return assignment ? assignment.currentUserId !== null : false;
  }

  reassignTask(taskId: string, newUserId: string, reassignedBy: string, reason?: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!newUserId.trim()) {
      throw new Error('New user ID cannot be empty');
    }
    if (!reassignedBy.trim()) {
      throw new Error('Reassigned by user ID cannot be empty');
    }

    const existing = this.assignments.get(taskId);
    if (!existing) {
      throw new Error('Task has no assignment record');
    }

    this.assignTask(taskId, newUserId, reassignedBy, reason);
  }
}

export function createAssignmentManager(): AssignmentManager {
  return new AssignmentManager();
}

export function validateUserId(userId: string): void {
  if (!userId || !userId.trim()) {
    throw new Error('User ID cannot be empty');
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c59272a317e39a8c65f755776338d447a62410fdfab6bef99784dfb7985e6788',
  name: 'Assignment',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;