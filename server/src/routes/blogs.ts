// ============================================================================
// Blog Routes — CRUD + AI generation
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as blogPersistence from '../services/blogPersistence.js';
import * as blogGenerator from '../services/blogGenerator.js';
import type { GenerateBlogRequest } from '../types/index.js';
import { normalizeLayoutText, stripHtmlAndCode } from '../utils/plainText.js';
import { AppError } from '../middleware/errorHandler.js';
import { randomUUID } from 'crypto';

const router = Router();

function assertSectionsIntegrity(sections: Array<{ type: string; text?: string; caption?: string }>) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new AppError(502, 'Generated blog has no sections.');
  }

  const textual = sections.filter((sec) => {
    if (sec.type === 'image') {
      return Boolean(normalizeLayoutText(sec.caption || sec.text || '').length >= 4);
    }
    return Boolean(normalizeLayoutText(sec.text || '').length >= 20);
  });

  if (textual.length < 4) {
    throw new AppError(502, 'Generated blog is incomplete. Please regenerate.');
  }
}

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  prompt: z.string().min(5, 'Prompt must be at least 5 characters'),
  blogType: z.string().default('Informative Blog'),
  tone: z.string().default('Professional'),
  audience: z.string().default('General Audience'),
  language: z.string().default('English'),
  length: z.string().default('Medium (~1200 words)'),
  seoKeywords: z.string().default(''),
  preferences: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  status: z.enum(['Draft', 'Published', 'Archived']).optional(),
  tone: z.string().optional(),
  audience: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  sections: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(['paragraph', 'heading', 'callout', 'image']),
        text: z.string().optional(),
        level: z.number().optional(),
        url: z.string().optional(),
        caption: z.string().optional(),
      })
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// POST /api/blogs/generate — Generate a new blog from AI
// ---------------------------------------------------------------------------
router.post('/generate', validate(generateSchema), async (req, res, next) => {
  try {
    const body: GenerateBlogRequest = req.body;

    // 1. Generate content via AI
    const generated = await blogGenerator.generateBlog(body, req.userId);
    assertSectionsIntegrity(generated.sections);

    // 2. Build FAQ / CTA sections if AI provided them
    const extraSections = [];
    if (generated.faq && generated.faq.length > 0) {
      extraSections.push({
        id: randomUUID(),
        type: 'heading' as const,
        level: 2,
        text: 'Frequently Asked Questions',
      });
      for (const qa of generated.faq) {
        const question = stripHtmlAndCode(qa.question);
        const answer = normalizeLayoutText(qa.answer);
        if (!question || !answer) continue;
        extraSections.push({
          id: randomUUID(),
          type: 'paragraph' as const,
          text: `Q: ${question}\nA: ${answer}`,
        });
      }
    }
    if (generated.cta) {
      extraSections.push({
        id: randomUUID(),
        type: 'callout' as const,
        text: normalizeLayoutText(generated.cta),
      });
    }

    const allSections = [...generated.sections, ...extraSections];
    assertSectionsIntegrity(allSections);

    // 3. Persist to database
    const blog = await blogPersistence.createBlog({
      userId: req.userId,
      title: generated.title,
      subtitle: generated.subtitle,
      slug: generated.slug,
      metaDescription: generated.metaDescription,
      tone: body.tone,
      audience: body.audience,
      language: body.language,
      blogType: body.blogType,
      keywords: generated.keywords,
      promptUsed: body.prompt,
      sections: allSections,
    });

    res.status(201).json({ success: true, data: blog });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/blogs — List user's blogs
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const blogs = await blogPersistence.listBlogs(req.userId);
    res.json({ success: true, data: blogs });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/blogs/:id — Get a single blog
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const blog = await blogPersistence.getBlogById(req.params.id as string);
    res.json({ success: true, data: blog });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/blogs/:id — Update blog metadata/sections
// ---------------------------------------------------------------------------
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    if (Array.isArray(req.body.sections)) {
      const meaningfulCount = req.body.sections.filter((section: any) => {
        const text =
          section?.type === 'image'
            ? normalizeLayoutText(section?.caption || section?.text || '')
            : normalizeLayoutText(section?.text || '');
        return text.length > 0;
      }).length;

      if (req.body.sections.length > 0 && meaningfulCount === 0) {
        throw new AppError(400, 'Section update rejected because all provided sections are empty.');
      }
    }

    const blog = await blogPersistence.updateBlog(req.params.id as string, req.body);
    res.json({ success: true, data: blog });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/blogs/:id — Archive (soft delete) a blog
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res, next) => {
  try {
    await blogPersistence.archiveBlog(req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
