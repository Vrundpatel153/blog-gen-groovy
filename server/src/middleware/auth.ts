// ============================================================================
// Auth Middleware — extracts user ID from Supabase JWT or uses demo user.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// Extend Express Request to include userId
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Optional auth middleware. If a valid Bearer token is present, extracts the
 * user ID from it. Otherwise falls back to the demo user ID.
 * This allows the app to work without login screens during development.
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (user && !error) {
        req.userId = user.id;
        return next();
      }
    } catch {
      // Token invalid — fall through to demo user
    }
  }

  // No token or invalid token → use demo user
  req.userId = config.demoUserId;
  next();
}
