export interface Task {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  created_at: Date;
  status: string;
  description?: string;
  assignee?: string;
  deadline?: Date;
}

export interface SearchOptions {
  query?: string;
  sortBy?: 'priority' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  tasks: Task[];
  total: number;
  query: string;
}

const PRIORITY_ORDER: Record<Task['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class TaskSearchEngine {
  private tasks: Task[] = [];

  constructor(tasks: Task[] = []) {
    this.tasks = [...tasks];
  }

  addTask(task: Task): void {
    this.tasks.push(task);
  }

  addTasks(tasks: Task[]): void {
    this.tasks.push(...tasks);
  }

  removeTask(taskId: string): boolean {
    const index = this.tasks.findIndex(task => task.id === taskId);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      return true;
    }
    return false;
  }

  updateTask(taskId: string, updates: Partial<Task>): boolean {
    const index = this.tasks.findIndex(task => task.id === taskId);
    if (index !== -1) {
      this.tasks[index] = { ...this.tasks[index], ...updates };
      return true;
    }
    return false;
  }

  search(options: SearchOptions = {}): SearchResult {
    const { query = '', sortBy = 'priority', sortOrder = 'asc' } = options;
    
    let filteredTasks = this.tasks;

    // Filter by title substring (case-insensitive)
    if (query.trim()) {
      const searchQuery = query.toLowerCase().trim();
      filteredTasks = this.tasks.filter(task =>
        task.title.toLowerCase().includes(searchQuery)
      );
    }

    // Sort results
    const sortedTasks = this.sortTasks(filteredTasks, sortBy, sortOrder);

    return {
      tasks: sortedTasks,
      total: sortedTasks.length,
      query: query.trim(),
    };
  }

  private sortTasks(tasks: Task[], sortBy: string, sortOrder: string): Task[] {
    return [...tasks].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'priority') {
        // Critical first, then by priority order
        comparison = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        
        // If priorities are equal, sort by created_at as secondary
        if (comparison === 0) {
          comparison = a.created_at.getTime() - b.created_at.getTime();
        }
      } else if (sortBy === 'created_at') {
        comparison = a.created_at.getTime() - b.created_at.getTime();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  getAllTasks(): Task[] {
    return [...this.tasks];
  }

  getTaskById(taskId: string): Task | undefined {
    return this.tasks.find(task => task.id === taskId);
  }

  clear(): void {
    this.tasks = [];
  }
}

export function searchTasks(tasks: Task[], query: string = ''): SearchResult {
  const engine = new TaskSearchEngine(tasks);
  return engine.search({ query });
}

export function filterTasksByTitle(tasks: Task[], titleSubstring: string): Task[] {
  if (!titleSubstring.trim()) {
    return [...tasks];
  }

  const searchQuery = titleSubstring.toLowerCase().trim();
  return tasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery)
  );
}

export function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const priorityComparison = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    
    if (priorityComparison === 0) {
      return a.created_at.getTime() - b.created_at.getTime();
    }
    
    return priorityComparison;
  });
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c5a64a4b957874299fc6c649df80efbce9816db7de3a14d681c952f1345c8802',
  name: 'Search and Filtering',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;