# REST API

## Endpoints

- POST /groups — create a new group (body: name, currency, creator member)
- GET /groups/:id — get group details including member list and summary
- POST /groups/:id/members — add a member to a group
- DELETE /groups/:id/members/:memberId — remove a member from a group

- POST /groups/:id/expenses — add an expense (body: description, amount, payer, participants, split strategy)
- GET /groups/:id/expenses — list expenses with optional filters (payer, participant, date range)
- DELETE /groups/:id/expenses/:expenseId — delete an expense

- GET /groups/:id/balances — get all member balances for a group
- GET /groups/:id/settlements — compute the minimum settlement plan
- POST /groups/:id/settlements — record a settlement payment

## Error Handling

- All endpoints must return structured JSON errors with a code and human-readable message
- Invalid group ID must return 404
- Invalid member (not in group) must return 403
- Invalid expense data (negative amount, missing participants) must return 400
- Attempting to remove a member with non-zero balance must return 409 (Conflict)

## Response Format

- All responses must use JSON with consistent envelope: { ok: boolean, data?: T, error?: { code: string, message: string } }
- List endpoints must support pagination with `limit` and `offset` query parameters
- Monetary amounts in responses must be represented as integer cents to avoid floating-point errors
