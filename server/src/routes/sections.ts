// ============================================================================
// Section Routes — AI editing + version history
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as sectionEditor from '../services/sectionEditor.js';
import * as versionService from '../services/versionService.js';
import { config } from '../config.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const editSchema = z.object({
  instruction: z.string().min(3, 'Instruction must be at least 3 characters'),
  currentText: z.string().min(1, 'Current text is required'),
  sectionType: z.string().default('paragraph'),
  blogTitle: z.string().optional(),
  blogTone: z.string().optional(),
  surroundingContext: z.string().optional(),
});

const createChatVersionsSchema = z.object({
  blogId: z.string().uuid('blogId must be a valid UUID'),
  prompt: z.string().optional(),
  changes: z
    .array(
      z.object({
        sectionId: z.string(),
        originalText: z.string(),
        editedText: z.string(),
        explanation: z.string().optional(),
      })
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// POST /api/sections/:id/edit — AI-edit a section
// ---------------------------------------------------------------------------
router.post('/:id/edit', validate(editSchema), async (req, res, next) => {
  try {
    const blogId = req.query.blogId as string;
    if (!blogId) {
      res.status(400).json({ success: false, error: 'blogId query parameter is required' });
      return;
    }

    const result = await sectionEditor.editSection(
      req.params.id as string,
      blogId,
      req.body,
      req.userId
    );

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sections/versions/:blogId — Get version history for a blog
// ---------------------------------------------------------------------------
router.post('/versions/chat', validate(createChatVersionsSchema), async (req, res, next) => {
  try {
    const versions = await Promise.all(
      req.body.changes.map((change: any) =>
        versionService.createVersion({
          sectionId: change.sectionId,
          blogId: req.body.blogId,
          originalText: change.originalText,
          editedText: change.editedText,
          explanation: change.explanation,
          promptUsed: req.body.prompt,
          modelUsed: config.ai.modelChat,
        })
      )
    );
    res.json({ success: true, data: versions });
  } catch (err) {
    next(err);
  }
});

router.get('/versions/:blogId', async (req, res, next) => {
  try {
    const versions = await versionService.getVersionsForBlog(req.params.blogId as string);
    res.json({ success: true, data: versions });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sections/:id/rollback/:versionId — Rollback to a version
// ---------------------------------------------------------------------------
router.post('/:id/rollback/:versionId', async (req, res, next) => {
  try {
    await versionService.rollbackToVersion(req.params.versionId as string);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/sections/:id/apply/:versionId — Apply a version edit
// ---------------------------------------------------------------------------
router.post('/:id/apply/:versionId', async (req, res, next) => {
  try {
    await versionService.applyVersion(req.params.versionId as string, req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
