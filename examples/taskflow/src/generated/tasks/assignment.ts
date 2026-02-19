export interface AssignmentRecord {
  taskId: string;
  assigneeId: string | null;
  assignedAt: Date;
  assignedBy: string;
}

export interface AssignmentAuditEntry {
  taskId: string;
  previousAssigneeId: string | null;
  newAssigneeId: string | null;
  changedAt: Date;
  changedBy: string;
  action: 'assigned' | 'reassigned' | 'unassigned';
}

export interface Task {
  id: string;
  assigneeId: string | null;
  [key: string]: any;
}

export class AssignmentManager {
  private assignments = new Map<string, AssignmentRecord>();
  private auditTrail: AssignmentAuditEntry[] = [];

  assignTask(taskId: string, assigneeId: string, assignedBy: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!assigneeId.trim()) {
      throw new Error('User ID cannot be empty');
    }
    if (!assignedBy.trim()) {
      throw new Error('Assigned by user ID cannot be empty');
    }

    const existingAssignment = this.assignments.get(taskId);
    const previousAssigneeId = existingAssignment?.assigneeId || null;

    const assignment: AssignmentRecord = {
      taskId,
      assigneeId,
      assignedAt: new Date(),
      assignedBy
    };

    this.assignments.set(taskId, assignment);

    const auditEntry: AssignmentAuditEntry = {
      taskId,
      previousAssigneeId,
      newAssigneeId: assigneeId,
      changedAt: new Date(),
      changedBy: assignedBy,
      action: previousAssigneeId ? 'reassigned' : 'assigned'
    };

    this.auditTrail.push(auditEntry);
  }

  unassignTask(taskId: string, unassignedBy: string): void {
    if (!taskId.trim()) {
      throw new Error('Task ID cannot be empty');
    }
    if (!unassignedBy.trim()) {
      throw new Error('Unassigned by user ID cannot be empty');
    }

    const existingAssignment = this.assignments.get(taskId);
    if (!existingAssignment) {
      throw new Error(`Task ${taskId} is not assigned`);
    }

    const previousAssigneeId = existingAssignment.assigneeId;
    this.assignments.delete(taskId);

    const auditEntry: AssignmentAuditEntry = {
      taskId,
      previousAssigneeId,
      newAssigneeId: null,
      changedAt: new Date(),
      changedBy: unassignedBy,
      action: 'unassigned'
    };

    this.auditTrail.push(auditEntry);
  }

  getAssignment(taskId: string): AssignmentRecord | null {
    return this.assignments.get(taskId) || null;
  }

  getAssignedTasks(assigneeId: string): AssignmentRecord[] {
    if (!assigneeId.trim()) {
      throw new Error('User ID cannot be empty');
    }

    return Array.from(this.assignments.values()).filter(
      assignment => assignment.assigneeId === assigneeId
    );
  }

  getUnassignedTasks(allTasks: Task[]): Task[] {
    return allTasks.filter(task => !this.assignments.has(task.id));
  }

  getAuditTrail(taskId?: string): AssignmentAuditEntry[] {
    if (taskId) {
      return this.auditTrail.filter(entry => entry.taskId === taskId);
    }
    return [...this.auditTrail];
  }

  isTaskAssigned(taskId: string): boolean {
    return this.assignments.has(taskId);
  }

  getTaskAssignee(taskId: string): string | null {
    const assignment = this.assignments.get(taskId);
    return assignment?.assigneeId || null;
  }
}

export function validateUserId(userId: string): void {
  if (!userId || !userId.trim()) {
    throw new Error('User ID cannot be empty');
  }
}

export function createAssignmentManager(): AssignmentManager {
  return new AssignmentManager();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c59272a317e39a8c65f755776338d447a62410fdfab6bef99784dfb7985e6788',
  name: 'Assignment',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;