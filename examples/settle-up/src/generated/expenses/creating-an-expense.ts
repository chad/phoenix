import { randomUUID } from 'node:crypto';

export interface Member {
  id: string;
  name: string;
}

export interface Group {
  id: string;
  name: string;
  members: Member[];
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: Date;
  payerId: string;
  participantIds: string[];
  groupId: string;
}

export interface CreateExpenseRequest {
  description: string;
  amount: number;
  date?: Date;
  payerId: string;
  participantIds: string[];
  groupId: string;
}

export class ExpenseCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseCreationError';
  }
}

export class ExpenseCreator {
  private groups: Map<string, Group> = new Map();

  addGroup(group: Group): void {
    this.groups.set(group.id, group);
  }

  removeGroup(groupId: string): void {
    this.groups.delete(groupId);
  }

  getGroup(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  createExpense(request: CreateExpenseRequest): Expense {
    this.validateExpenseRequest(request);

    const expense: Expense = {
      id: randomUUID(),
      description: request.description.trim(),
      amount: this.normalizeAmount(request.amount),
      date: request.date || new Date(),
      payerId: request.payerId,
      participantIds: [...new Set(request.participantIds)], // Remove duplicates
      groupId: request.groupId,
    };

    return expense;
  }

  private validateExpenseRequest(request: CreateExpenseRequest): void {
    if (!request.description || request.description.trim().length === 0) {
      throw new ExpenseCreationError('Expense description is required');
    }

    if (!this.isValidAmount(request.amount)) {
      throw new ExpenseCreationError('Expense amount must be a positive number with at most two decimal places');
    }

    if (!request.groupId) {
      throw new ExpenseCreationError('Group identifier is required');
    }

    const group = this.groups.get(request.groupId);
    if (!group) {
      throw new ExpenseCreationError('Specified group does not exist');
    }

    if (!request.payerId) {
      throw new ExpenseCreationError('Payer identifier is required');
    }

    if (!this.isMemberOfGroup(request.payerId, group)) {
      throw new ExpenseCreationError('Payer must be a member of the group');
    }

    if (!request.participantIds || request.participantIds.length === 0) {
      throw new ExpenseCreationError('At least one participant is required');
    }

    for (const participantId of request.participantIds) {
      if (!this.isMemberOfGroup(participantId, group)) {
        throw new ExpenseCreationError(`Participant ${participantId} is not a member of the group`);
      }
    }
  }

  private isValidAmount(amount: number): boolean {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      return false;
    }

    // Check for at most two decimal places
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    return decimalPlaces <= 2;
  }

  private normalizeAmount(amount: number): number {
    return Math.round(amount * 100) / 100;
  }

  private isMemberOfGroup(memberId: string, group: Group): boolean {
    return group.members.some(member => member.id === memberId);
  }
}

export function createExpenseCreator(): ExpenseCreator {
  return new ExpenseCreator();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '60c1351d6276e69e296bd2b41f38faf4722726598340b1f380f51af67af156cf',
  name: 'Creating an Expense',
  risk_tier: 'high',
  canon_ids: [7 as const],
} as const;