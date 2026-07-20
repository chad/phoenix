/**
 * Architecture: web-api
 *
 * An API-driven web application. Components communicate via REST endpoints.
 * Each resource owns its data mutations. Components are independently
 * testable via HTTP endpoint contracts.
 *
 * This architecture is language/runtime agnostic.
 */

import type { Architecture } from '../models/architecture.js';

export const webApi: Architecture = {
  name: 'web-api',
  description: 'API-driven web application — REST endpoints, resource-oriented, independently testable',

  communicationPattern: 'rest',
  dataOwnership: 'per-component',
  evaluationSurface: 'http-endpoints',

  // What this architecture can EXPRESS — the fit gate compares spec demands to this
  // list. No interactive client, no realtime presence, no audio: a game spec run
  // through web-api gets a loud OUT OF TARGET banner, never a silent narrowing.
  capabilities: ['http-api', 'domain-logic', 'persistence'],

  systemPrompt: `## Architecture: API-driven Web Application

This system is an API-driven web application with the following architectural constraints:

### Communication
- Components communicate via REST HTTP endpoints
- Each resource has its own set of endpoints (CRUD)
- Standard HTTP status codes: 200 (ok), 201 (created), 204 (no content), 400 (bad request), 404 (not found)
- All responses are JSON. Errors: { "error": "message" }

### Data Ownership
- Each resource module owns exclusive mutation authority over its database table(s)
- Cross-resource queries use JOINs for read-only access
- Foreign key relationships must be validated before mutation (check referenced row exists)
- Cascade protection: cannot delete a parent resource that has dependent children

### Component Grain
- One module per resource (e.g., tasks, projects, categories)
- Each module is independently deployable and testable
- A web UI module serves HTML and calls the resource modules via fetch()

### Evaluation Surface
- Every module is testable via HTTP endpoint contracts
- Create → verify response has ID and matches input
- Read → verify response shape matches schema
- Update → verify changes are persisted
- Delete → verify resource is gone
- Validation → verify 400 for invalid input
- Not found → verify 404 for missing resources

### Translating user requirements to implementation
- "Users can create X" → POST endpoint with validation
- "Users can view X" → GET endpoint with SELECT query (JOINs for related data)
- "Users can edit X" → PATCH endpoint with UPDATE query
- "Users can delete X" → DELETE endpoint with safety checks
- "Users can filter by Y" → query parameters on GET endpoints
- "Show X sorted by Y" → ORDER BY in query
- "X must be visually highlighted" → UI concern, not API
- "Expose a programmatic interface" → the REST API IS the programmatic interface
`,

  runtimeTargets: ['node-typescript', 'python-fastapi'],
};
