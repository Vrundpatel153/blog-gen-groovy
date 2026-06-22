// ============================================================================
// Global Error Handler Middleware
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // Unknown errors
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({
    success: false,
    error: config.isDev ? err.message : 'Internal server error',
  });
}
