# Notification Service

The notification service handles sending messages to users across multiple channels.

## Delivery Channels

- The service must support email delivery via SMTP
- The service must support push notifications
- The service must support in-app notification storage
- Channel preference must be configurable per user

## Templates

- Notifications must be rendered from named templates
- Templates must support variable interpolation
- Missing template variables must produce a clear error, not silent blanks
- Template rendering must be locale-aware

## Retry Logic

- Failed deliveries must be retried up to 3 times with exponential backoff
- Permanently failed deliveries must be marked and archived
- Retry status must be queryable per notification

## Security Constraints

- Email content must never include raw user passwords
- Push notification payloads must be limited to 4KB
- All notification content must be sanitized against XSS
