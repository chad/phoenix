import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

const router = new Hono();

// Global error handler middleware
router.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Middleware to handle invalid JSON
router.use('*', async (c, next) => {
  if (c.req.method === 'POST' || c.req.method === 'PATCH' || c.req.method === 'PUT') {
    const contentType = c.req.header('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        // Pre-parse JSON to catch syntax errors
        const body = await c.req.text();
        if (body.trim()) {
          JSON.parse(body);
        }
      } catch (error) {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }
  }
  await next();
});

// Test endpoint to demonstrate error handling
router.get('/test-errors', (c) => {
  const type = c.req.query('type');
  
  switch (type) {
    case 'validation':
      return c.json({ error: 'Validation failed: title is required' }, 400);
    case 'not-found':
      return c.json({ error: 'Resource not found' }, 404);
    case 'invalid-json':
      return c.json({ error: 'Invalid JSON body' }, 400);
    case 'server-error':
      throw new Error('Simulated server error');
    default:
      return c.json({ 
        message: 'Error handling test endpoint',
        available_types: ['validation', 'not-found', 'invalid-json', 'server-error']
      });
  }
});

// Test endpoint for JSON validation
router.post('/test-json', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ message: 'Valid JSON received', data: body });
  } catch (error) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
});

// Test endpoint for Zod validation
const TestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  age: z.number().int().min(0, 'Age must be non-negative'),
});

router.post('/test-validation', async (c) => {
  try {
    const body = await c.req.json();
    const result = TestSchema.safeParse(body);
    
    if (!result.success) {
      const firstError = result.error.issues[0];
      return c.json({ error: firstError.message }, 400);
    }
    
    return c.json({ message: 'Validation passed', data: result.data });
  } catch (error) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '1ada78d27b09eccf1ebece746bdd645cf9dccc6e35efdbdeb0d23fa194400152',
  name: 'Error Handling',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;