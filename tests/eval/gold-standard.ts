/**
 * Gold-standard annotated specs for measuring canonicalization quality.
 * Each spec has expected node types, edge types, and coverage.
 */

export interface GoldNode {
  statement: string;       // substring match (case-insensitive)
  type: string;            // expected CanonicalType
  tags?: string[];         // expected tags (subset)
}

export interface GoldEdge {
  from: string;            // statement substring of source
  to: string;              // statement substring of target
  type: string;            // expected EdgeType
}

export interface GoldSpec {
  name: string;
  path: string;
  docId: string;
  expectedNodes: GoldNode[];
  expectedEdges: GoldEdge[];
  expectedMinCoverage: number;  // minimum average coverage %
  expectedMinNodes: number;
  expectedMaxNodes: number;
}

export const GOLD_SPECS: GoldSpec[] = [
  {
    name: 'Auth v1',
    path: 'tests/fixtures/spec-auth-v1.md',
    docId: 'spec-auth.md',
    expectedMinCoverage: 80,
    expectedMinNodes: 8,
    expectedMaxNodes: 22,
    expectedNodes: [
      { statement: 'authenticate with email', type: 'REQUIREMENT' },
      { statement: 'rate-limited', type: 'CONSTRAINT' },
      { statement: 'hashed with bcrypt', type: 'REQUIREMENT' },
      { statement: 'https', type: 'CONSTRAINT' },
      { statement: 'signed with rs256', type: 'CONSTRAINT' },
      { statement: 'session management', type: 'CONTEXT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Auth v2',
    path: 'tests/fixtures/spec-auth-v2.md',
    docId: 'spec-auth.md',
    expectedMinCoverage: 80,
    expectedMinNodes: 8,
    expectedMaxNodes: 26,
    expectedNodes: [
      { statement: 'authenticate', type: 'REQUIREMENT' },
      { statement: 'oauth', type: 'CONTEXT' },
      { statement: 'rate-limited', type: 'CONSTRAINT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Notifications',
    path: 'tests/fixtures/spec-notifications.md',
    docId: 'spec/notifications.md',
    expectedMinCoverage: 90,
    expectedMinNodes: 12,
    expectedMaxNodes: 20,
    expectedNodes: [
      { statement: 'email delivery via smtp', type: 'REQUIREMENT' },
      { statement: 'never include raw user passwords', type: 'INVARIANT' },
      { statement: 'retried up to 3 times', type: 'CONSTRAINT' },
      { statement: 'push notification', type: 'REQUIREMENT' },
      { statement: 'template', type: 'CONTEXT' },
      { statement: 'sanitized against xss', type: 'CONSTRAINT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Gateway',
    path: 'tests/fixtures/spec-gateway.md',
    docId: 'spec/gateway.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 15,
    expectedMaxNodes: 32,
    expectedNodes: [
      { statement: 'route requests to backend', type: 'REQUIREMENT' },
      { statement: 'rate-limited to 100', type: 'CONSTRAINT' },
      { statement: 'validate jwt', type: 'REQUIREMENT' },
      { statement: 'https', type: 'CONSTRAINT' },
      { statement: 'structured json', type: 'REQUIREMENT' },
      { statement: 'sql injection', type: 'CONSTRAINT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'TaskFlow: tasks',
    path: 'examples/taskflow/spec/tasks.md',
    docId: 'spec/tasks.md',
    expectedMinCoverage: 95,
    expectedMinNodes: 15,
    expectedMaxNodes: 25,
    expectedNodes: [
      { statement: 'status transitions', type: 'REQUIREMENT' },
      { statement: 'invalid', type: 'REQUIREMENT' },
      { statement: 'task management', type: 'CONTEXT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'TaskFlow: analytics',
    path: 'examples/taskflow/spec/analytics.md',
    docId: 'spec/analytics.md',
    expectedMinCoverage: 90,
    expectedMinNodes: 8,
    expectedMaxNodes: 20,
    expectedNodes: [
      { statement: 'completion rate', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Pixel Wars: game',
    path: 'examples/pixel-wars/spec/game.md',
    docId: 'spec/game.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 10,
    expectedMaxNodes: 25,
    expectedNodes: [
      { statement: '20 columns', type: 'CONTEXT' },
      { statement: 'cooldown', type: 'CONSTRAINT' },
      { statement: 'rejected', type: 'REQUIREMENT' },
      { statement: 'broadcast', type: 'REQUIREMENT' },
      { statement: '120 seconds', type: 'CONTEXT' },
      { statement: 'round-robin', type: 'CONTEXT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Pixel Wars: server',
    path: 'examples/pixel-wars/spec/server.md',
    docId: 'spec/server.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 8,
    expectedMaxNodes: 20,
    expectedNodes: [
      { statement: 'websocket', type: 'CONTEXT' },
      { statement: 'maximum 20', type: 'CONSTRAINT' },
      { statement: 'disconnected', type: 'REQUIREMENT' },
      { statement: 'room_full', type: 'CONSTRAINT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Settle Up: expenses',
    path: 'examples/settle-up/spec/expenses.md',
    docId: 'spec/expenses.md',
    expectedMinCoverage: 90,
    expectedMinNodes: 12,
    expectedMaxNodes: 30,
    expectedNodes: [
      { statement: 'unique expense id', type: 'REQUIREMENT' },
      { statement: 'positive', type: 'CONSTRAINT' },
      { statement: 'equal', type: 'CONTEXT' },
      { statement: 'remainder', type: 'CONSTRAINT' },
      { statement: 'sum of all individual shares must always equal', type: 'INVARIANT' },
      { statement: 'reverse chronological', type: 'REQUIREMENT' },
      { statement: 'member who created', type: 'CONTEXT' },
      { statement: 'deterministic', type: 'INVARIANT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Settle Up: settlements',
    path: 'examples/settle-up/spec/settlements.md',
    docId: 'spec/settlements.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 8,
    expectedMaxNodes: 22,
    expectedNodes: [
      { statement: 'minimum number of payments', type: 'CONSTRAINT' },
      { statement: 'same net effect', type: 'REQUIREMENT' },
      { statement: 'cycles', type: 'REQUIREMENT' },
      { statement: 'empty settlement plan', type: 'REQUIREMENT' },
      { statement: 'exceeds', type: 'REQUIREMENT' },
      { statement: 'settled up', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'User Service',
    path: 'examples/microservices/spec/user-service.md',
    docId: 'spec/user-service.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 18,
    expectedMaxNodes: 40,
    expectedNodes: [
      { statement: 'system of record', type: 'CONTEXT' },
      { statement: 'email addresses must be unique', type: 'REQUIREMENT' },
      { statement: 'never store or return plaintext passwords', type: 'INVARIANT' },
      { statement: 'soft delete', type: 'REQUIREMENT' },
      { statement: '100 characters', type: 'CONSTRAINT' },
      { statement: 'locked for 1 hour', type: 'REQUIREMENT' },
      { statement: 'parameterized statements', type: 'CONSTRAINT' },
      { statement: 'event payloads must never contain passwords', type: 'INVARIANT' },
      { statement: '50 results per page', type: 'CONSTRAINT' },
      { statement: 'usercreated', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'TicTacToe: game engine',
    path: 'examples/tictactoe/spec/game-engine.md',
    docId: 'spec/game-engine.md',
    expectedMinCoverage: 90,
    expectedMinNodes: 10,
    expectedMaxNodes: 25,
    expectedNodes: [
      { statement: '3x3 grid', type: 'REQUIREMENT' },
      { statement: 'already occupied', type: 'REQUIREMENT' },
      { statement: 'x always moves first', type: 'INVARIANT' },
      { statement: 'draw', type: 'REQUIREMENT' },
      { statement: 'win detection', type: 'CONTEXT' },
      { statement: 'unique game id', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  // ─── Phoenix Self (Dog-food) ────────────────────────────────────────────
  {
    name: 'Phoenix: ingestion',
    path: 'examples/phoenix-self/spec/ingestion.md',
    docId: 'spec/ingestion.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 15,
    expectedMaxNodes: 40,
    expectedNodes: [
      { statement: 'clause_id', type: 'REQUIREMENT' },
      { statement: 'sha-256', type: 'REQUIREMENT' },
      { statement: 'four classes', type: 'REQUIREMENT' },
      { statement: 'd-rate', type: 'CONTEXT' },
      { statement: 'at most 5%', type: 'CONSTRAINT' },
      { statement: 'above 15%', type: 'REQUIREMENT' },
      { statement: 'normalized edit distance', type: 'REQUIREMENT' },
      { statement: 'incidental invalidation', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Phoenix: canonicalization',
    path: 'examples/phoenix-self/spec/canonicalization.md',
    docId: 'spec/canonicalization.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 12,
    expectedMaxNodes: 35,
    expectedNodes: [
      { statement: 'pipeline', type: 'CONTEXT' },
      { statement: 'pipelineupgrade', type: 'REQUIREMENT' },
      { statement: 'confidence score', type: 'REQUIREMENT' },
      { statement: 'shadow mode', type: 'REQUIREMENT' },
      { statement: 'shadow mode', type: 'REQUIREMENT' },
      { statement: 'at most 3%', type: 'CONSTRAINT' },
      { statement: 'reject', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Phoenix: implementation',
    path: 'examples/phoenix-self/spec/implementation.md',
    docId: 'spec/implementation.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 15,
    expectedMaxNodes: 40,
    expectedNodes: [
      { statement: 'risk tier', type: 'REQUIREMENT' },
      { statement: 'boundary policy', type: 'CONTEXT' },
      { statement: 'forbidden', type: 'CONSTRAINT' },
      { statement: 'architectural linter', type: 'REQUIREMENT' },
      { statement: 'generated_manifest', type: 'REQUIREMENT' },
      { statement: 'reproducible', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Phoenix: integrity',
    path: 'examples/phoenix-self/spec/integrity.md',
    docId: 'spec/integrity.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 12,
    expectedMaxNodes: 35,
    expectedNodes: [
      { statement: 'generated_manifest', type: 'REQUIREMENT' },
      { statement: 'waiver', type: 'REQUIREMENT' },
      { statement: 'low-tier', type: 'REQUIREMENT' },
      { statement: 'critical-tier', type: 'REQUIREMENT' },
      { statement: 'cascade', type: 'REQUIREMENT' },
      { statement: 'cascade depth must be bounded', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Phoenix: operations',
    path: 'examples/phoenix-self/spec/operations.md',
    docId: 'spec/operations.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 12,
    expectedMaxNodes: 35,
    expectedNodes: [
      { statement: 'hot graph', type: 'REQUIREMENT' },
      { statement: 'compaction must never delete', type: 'INVARIANT' },
      { statement: 'compactionevent', type: 'REQUIREMENT' },
      { statement: 'severity', type: 'CONTEXT' },
      { statement: 'bootstrap', type: 'DEFINITION' },
      { statement: 'steady_state', type: 'REQUIREMENT' },
    ],
    expectedEdges: [],
  },
  {
    name: 'Phoenix: platform',
    path: 'examples/phoenix-self/spec/platform.md',
    docId: 'spec/platform.md',
    expectedMinCoverage: 85,
    expectedMinNodes: 12,
    expectedMaxNodes: 35,
    expectedNodes: [
      { statement: 'five interconnected graphs', type: 'REQUIREMENT' },
      { statement: 'content-addressed', type: 'REQUIREMENT' },
      { statement: 'provenance edges', type: 'REQUIREMENT' },
      { statement: 'selective invalidation', type: 'REQUIREMENT' },
      { statement: 'confirmation model', type: 'REQUIREMENT' },
      { statement: 'brownfield', type: 'DEFINITION' },
    ],
    expectedEdges: [],
  },
];
