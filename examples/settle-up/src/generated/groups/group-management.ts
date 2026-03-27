import { randomUUID } from 'node:crypto';

export interface Group {
  id: string;
  name: string;
  currencyCode: string;
  createdAt: Date;
  memberIds: Set<string>;
}

export interface Member {
  id: string;
  displayName: string;
  email: string;
}

export interface MemberBalance {
  memberId: string;
  balance: number;
}

export class GroupManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupManagementError';
  }
}

export class GroupManager {
  private groups = new Map<string, Group>();
  private members = new Map<string, Member>();
  private balances = new Map<string, Map<string, number>>();

  createGroup(name: string, currencyCode: string): string {
    if (!name.trim()) {
      throw new GroupManagementError('Group name cannot be empty');
    }
    if (!currencyCode.trim()) {
      throw new GroupManagementError('Currency code cannot be empty');
    }

    const groupId = randomUUID();
    const group: Group = {
      id: groupId,
      name: name.trim(),
      currencyCode: currencyCode.trim().toUpperCase(),
      createdAt: new Date(),
      memberIds: new Set(),
    };

    this.groups.set(groupId, group);
    this.balances.set(groupId, new Map());
    return groupId;
  }

  createMember(displayName: string, email: string): string {
    if (!displayName.trim()) {
      throw new GroupManagementError('Display name cannot be empty');
    }
    if (!email.trim()) {
      throw new GroupManagementError('Email cannot be empty');
    }
    if (!this.isValidEmail(email)) {
      throw new GroupManagementError('Invalid email format');
    }

    const memberId = randomUUID();
    const member: Member = {
      id: memberId,
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
    };

    this.members.set(memberId, member);
    return memberId;
  }

  addMemberToGroup(groupId: string, memberId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupManagementError('Group not found');
    }

    const member = this.members.get(memberId);
    if (!member) {
      throw new GroupManagementError('Member not found');
    }

    if (group.memberIds.has(memberId)) {
      throw new GroupManagementError('Member is already in the group');
    }

    group.memberIds.add(memberId);
    const groupBalances = this.balances.get(groupId)!;
    groupBalances.set(memberId, 0);
  }

  removeMemberFromGroup(groupId: string, memberId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupManagementError('Group not found');
    }

    if (!group.memberIds.has(memberId)) {
      throw new GroupManagementError('Member is not in the group');
    }

    if (group.memberIds.size <= 1) {
      throw new GroupManagementError('Cannot remove member: group must contain at least one member');
    }

    const groupBalances = this.balances.get(groupId)!;
    const balance = groupBalances.get(memberId) || 0;
    if (balance !== 0) {
      throw new GroupManagementError('Cannot remove member: member has outstanding balance');
    }

    group.memberIds.delete(memberId);
    groupBalances.delete(memberId);
  }

  getGroup(groupId: string): Group | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;

    return {
      ...group,
      memberIds: new Set(group.memberIds),
    };
  }

  getMember(memberId: string): Member | undefined {
    const member = this.members.get(memberId);
    if (!member) return undefined;

    return { ...member };
  }

  getGroupMembers(groupId: string): Member[] {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupManagementError('Group not found');
    }

    return Array.from(group.memberIds)
      .map(memberId => this.members.get(memberId))
      .filter((member): member is Member => member !== undefined);
  }

  getMemberBalance(groupId: string, memberId: string): number {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupManagementError('Group not found');
    }

    if (!group.memberIds.has(memberId)) {
      throw new GroupManagementError('Member is not in the group');
    }

    const groupBalances = this.balances.get(groupId)!;
    return groupBalances.get(memberId) || 0;
  }

  updateMemberBalance(groupId: string, memberId: string, balance: number): void {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupManagementError('Group not found');
    }

    if (!group.memberIds.has(memberId)) {
      throw new GroupManagementError('Member is not in the group');
    }

    const groupBalances = this.balances.get(groupId)!;
    groupBalances.set(memberId, balance);
  }

  getAllGroups(): Group[] {
    return Array.from(this.groups.values()).map(group => ({
      ...group,
      memberIds: new Set(group.memberIds),
    }));
  }

  getAllMembers(): Member[] {
    return Array.from(this.members.values()).map(member => ({ ...member }));
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c1399ea2d34fc28a41fc692aeea9630fc0666279585518e9af4f489a6cce981a',
  name: 'Group Management',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;