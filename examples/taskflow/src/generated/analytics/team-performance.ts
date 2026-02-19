export interface Task {
  id: string;
  assignee?: string;
  status: 'pending' | 'in-progress' | 'done' | 'cancelled';
}

export interface AssigneePerformance {
  assignee: string;
  totalAssigned: number;
  completed: number;
  completionRate: number;
}

export interface TeamPerformanceMetrics {
  assigneePerformance: AssigneePerformance[];
  topPerformer: AssigneePerformance | null;
}

export class TeamPerformanceCalculator {
  calculateTeamPerformance(tasks: Task[]): TeamPerformanceMetrics {
    const assignedTasks = tasks.filter(task => task.assignee !== undefined);
    
    const assigneeStats = new Map<string, { total: number; completed: number }>();
    
    for (const task of assignedTasks) {
      const assignee = task.assignee!;
      const stats = assigneeStats.get(assignee) || { total: 0, completed: 0 };
      
      stats.total++;
      if (task.status === 'done') {
        stats.completed++;
      }
      
      assigneeStats.set(assignee, stats);
    }
    
    const assigneePerformance: AssigneePerformance[] = Array.from(assigneeStats.entries())
      .map(([assignee, stats]) => ({
        assignee,
        totalAssigned: stats.total,
        completed: stats.completed,
        completionRate: stats.total > 0 ? stats.completed / stats.total : 0
      }));
    
    const topPerformer = this.findTopPerformer(assigneePerformance);
    
    return {
      assigneePerformance,
      topPerformer
    };
  }
  
  private findTopPerformer(performances: AssigneePerformance[]): AssigneePerformance | null {
    const eligiblePerformers = performances.filter(p => p.totalAssigned >= 3);
    
    if (eligiblePerformers.length === 0) {
      return null;
    }
    
    return eligiblePerformers.reduce((top, current) => 
      current.completionRate > top.completionRate ? current : top
    );
  }
  
  getCompletionRate(assignee: string, tasks: Task[]): number {
    const assigneeTasks = tasks.filter(task => task.assignee === assignee);
    
    if (assigneeTasks.length === 0) {
      return 0;
    }
    
    const completedTasks = assigneeTasks.filter(task => task.status === 'done');
    return completedTasks.length / assigneeTasks.length;
  }
}

export function calculateTeamPerformance(tasks: Task[]): TeamPerformanceMetrics {
  const calculator = new TeamPerformanceCalculator();
  return calculator.calculateTeamPerformance(tasks);
}

export function getTopPerformer(tasks: Task[]): AssigneePerformance | null {
  const metrics = calculateTeamPerformance(tasks);
  return metrics.topPerformer;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '1a341b16d06c4b94fd080e8175eac6e46413420cc871dc0b1183196ced852b25',
  name: 'Team Performance',
  risk_tier: 'high',
  canon_ids: [3 as const],
} as const;