import { IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';

export interface Member {
  id: string;
  name: string;
  email: string;
}

export interface Group {
  id: string;
  name: string;
  currency: string;
  creator: Member;
  members: Member[];
  expenses: Expense[];
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  splitAmong: string[];
  date: Date;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface CreateGroupRequest {
  name: string;
  currency: string;
  creator: Member;
}

class GroupStore {
  private groups = new Map<string, Group>();
  private nextId = 1;

  createGroup(request: CreateGroupRequest): Group {
    const id = (this.nextId++).toString();
    const group: Group = {
      id,
      name: request.name,
      currency: request.currency,
      creator: request.creator,
      members: [request.creator],
      expenses: []
    };
    this.groups.set(id, group);
    return group;
  }

  getGroup(id: string): Group | undefined {
    return this.groups.get(id);
  }

  removeMember(groupId: string, memberId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    
    const memberIndex = group.members.findIndex(m => m.id === memberId);
    if (memberIndex === -1) return false;
    
    group.members.splice(memberIndex, 1);
    return true;
  }

  deleteExpense(groupId: string, expenseId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    
    const expenseIndex = group.expenses.findIndex(e => e.id === expenseId);
    if (expenseIndex === -1) return false;
    
    group.expenses.splice(expenseIndex, 1);
    return true;
  }

  computeSettlements(groupId: string): Settlement[] {
    const group = this.groups.get(groupId);
    if (!group) return [];

    const balances = new Map<string, number>();
    
    // Initialize balances
    group.members.forEach(member => {
      balances.set(member.id, 0);
    });

    // Calculate net balances from expenses
    group.expenses.forEach(expense => {
      const paidAmount = expense.amount;
      const shareAmount = paidAmount / expense.splitAmong.length;
      
      // Person who paid gets credited
      const currentBalance = balances.get(expense.paidBy) || 0;
      balances.set(expense.paidBy, currentBalance + paidAmount);
      
      // People who owe get debited
      expense.splitAmong.forEach(memberId => {
        const memberBalance = balances.get(memberId) || 0;
        balances.set(memberId, memberBalance - shareAmount);
      });
    });

    // Convert to settlements using greedy algorithm
    const settlements: Settlement[] = [];
    const creditors: Array<{id: string, amount: number}> = [];
    const debtors: Array<{id: string, amount: number}> = [];

    balances.forEach((balance, memberId) => {
      if (balance > 0.01) {
        creditors.push({id: memberId, amount: balance});
      } else if (balance < -0.01) {
        debtors.push({id: memberId, amount: -balance});
      }
    });

    // Sort for consistent results
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    let i = 0, j = 0;
    while (i < creditors.length && j < debtors.length) {
      const creditor = creditors[i];
      const debtor = debtors[j];
      
      const settleAmount = Math.min(creditor.amount, debtor.amount);
      
      if (settleAmount > 0.01) {
        settlements.push({
          from: debtor.id,
          to: creditor.id,
          amount: Math.round(settleAmount * 100) / 100
        });
      }
      
      creditor.amount -= settleAmount;
      debtor.amount -= settleAmount;
      
      if (creditor.amount < 0.01) i++;
      if (debtor.amount < 0.01) j++;
    }

    return settlements;
  }
}

const store = new GroupStore();

export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = parse(req.url || '', true);
  const pathname = url.pathname || '';
  const method = req.method || 'GET';

  try {
    if (method === 'POST' && pathname === '/groups') {
      handleCreateGroup(req, res);
    } else if (method === 'DELETE' && pathname.match(/^\/groups\/[^\/]+\/members\/[^\/]+$/)) {
      handleRemoveMember(req, res, pathname);
    } else if (method === 'DELETE' && pathname.match(/^\/groups\/[^\/]+\/expenses\/[^\/]+$/)) {
      handleDeleteExpense(req, res, pathname);
    } else if (method === 'GET' && pathname.match(/^\/groups\/[^\/]+\/settlements$/)) {
      handleGetSettlements(req, res, pathname);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

function handleCreateGroup(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    try {
      const data = JSON.parse(body) as CreateGroupRequest;
      
      if (!data.name || !data.currency || !data.creator) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: name, currency, creator' }));
        return;
      }
      
      const group = store.createGroup(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(group));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

function handleRemoveMember(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const parts = pathname.split('/');
  const groupId = parts[2];
  const memberId = parts[4];
  
  const success = store.removeMember(groupId, memberId);
  
  if (success) {
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Group or member not found' }));
  }
}

function handleDeleteExpense(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const parts = pathname.split('/');
  const groupId = parts[2];
  const expenseId = parts[4];
  
  const success = store.deleteExpense(groupId, expenseId);
  
  if (success) {
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Group or expense not found' }));
  }
}

function handleGetSettlements(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const parts = pathname.split('/');
  const groupId = parts[2];
  
  const group = store.getGroup(groupId);
  if (!group) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Group not found' }));
    return;
  }
  
  const settlements = store.computeSettlements(groupId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ settlements }));
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '85e17ce4d231ac2072e788df85a14c112d87bf7358ac68b778f77687c52f0ca6',
  name: 'Endpoints',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;