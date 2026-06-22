// ============================================================================
// AI Blog Studio — Express Server Entry Point
// ============================================================================

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

// Route imports
import healthRoutes from './routes/health.js';
import blogRoutes from './routes/blogs.js';
import sectionRoutes from './routes/sections.js';
import chatRoutes from './routes/chat.js';

const app = express();

// ---------------------------------------------------------------------------
// Global Middleware
// ---------------------------------------------------------------------------
app.use(cors({
  origin: config.isDev ? '*' : undefined,
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Auth — extracts userId (optional JWT or demo user)
app.use('/api', authMiddleware);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/health', healthRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/chat', chatRoutes);

// ---------------------------------------------------------------------------
import { ensureDemoUserExists } from './services/dbInit.js';

// Error Handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(config.port, async () => {
  console.log(`\n🚀 AI Blog Studio Server running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   AI Provider: ${config.ai.provider}`);
  console.log(`   Models: gen=${config.ai.modelGeneration}, edit=${config.ai.modelEdit}, chat=${config.ai.modelChat}\n`);

  // Auto-initialize db schema defaults
  await ensureDemoUserExists();
});
