# API Gateway Service

The API Gateway handles all incoming HTTP requests, routing, authentication, and rate limiting.

## Authentication

- The gateway must validate JWT tokens on all protected endpoints
- Invalid or expired tokens must be rejected with 401 status
- Token validation must check the RS256 signature
- The gateway must support token refresh without full re-authentication

## Rate Limiting

- All endpoints must be rate-limited to 100 requests per minute per client
- Rate limiting must use a sliding window algorithm
- Exceeded rate limits must return 429 status with Retry-After header
- Rate limit configuration must be adjustable per route

## Request Routing

- The gateway must route requests to backend services based on path prefix
- Route configuration must be loaded from a declarative config file
- Unknown routes must return 404 with available route listing
- The gateway must support path parameter extraction

## Logging

- All requests must be logged with timestamp, method, path, status, and duration
- Failed requests must include error details in the log
- Log format must be structured JSON
- The gateway must support configurable log levels

## Security Constraints

- All traffic must use HTTPS (TLS 1.2+)
- CORS headers must be configurable per route
- Request body size must be limited to 10MB
- SQL injection patterns in query parameters must be rejected
