// ============================================================================
// Request Validation Middleware — uses Zod schemas
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Creates middleware that validates req.body against a Zod schema.
 * Returns 400 with validation errors if invalid.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
      return;
    }
    // Replace body with parsed (and potentially transformed) data
    req.body = result.data;
    next();
  };
}
