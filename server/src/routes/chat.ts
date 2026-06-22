// ============================================================================
// Chat Routes — threads and messages with AI responses
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as chatPersistence from '../services/chatPersistence.js';
import * as chatAssistant from '../services/chatAssistant.js';
import * as blogPersistence from '../services/blogPersistence.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const createThreadSchema = z.object({
  blogId: z.string().uuid('blogId must be a valid UUID'),
  title: z.string().default('New Conversation'),
});

const sendMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  blogContext: z
    .object({
      title: z.string(),
      subtitle: z.string().optional(),
      tone: z.string(),
      audience: z.string(),
      sections: z.array(z.any()),
      activeSectionId: z.string().optional(),
      selectedText: z.string().optional(),
      selectedField: z.enum(['title', 'section']).optional(),
    })
    .optional(),
});

const updateMessageSchema = z.object({
  actionData: z.record(z.any()).optional(),
  showDiffCard: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/chat/threads — Create a new chat thread
// ---------------------------------------------------------------------------
router.post('/threads', validate(createThreadSchema), async (req, res, next) => {
  try {
    const thread = await chatPersistence.createThread(
      req.body.blogId,
      req.userId,
      req.body.title
    );
    res.status(201).json({ success: true, data: thread });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/chat/threads/:blogId — Get threads for a blog
// ---------------------------------------------------------------------------
router.get('/threads/:blogId', async (req, res, next) => {
  try {
    const threads = await chatPersistence.getThreadsForBlog(req.params.blogId as string);
    res.json({ success: true, data: threads });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/chat/threads/:threadId/messages — Send message + get AI response
// ---------------------------------------------------------------------------
router.post(
  '/threads/:threadId/messages',
  validate(sendMessageSchema),
  async (req, res, next) => {
    try {
      const threadId = req.params.threadId as string;

      // 1. Get thread to find blogId
      const thread = await chatPersistence.getThreadById(threadId);
      const blogId = thread ? thread.blogId : undefined;

      // 2. Save the user message
      const userMsg = await chatPersistence.saveMessage(
        threadId,
        'user',
        req.body.message
      );

      // 3. Get thread's existing messages for context
      const history = await chatPersistence.getMessagesForThread(threadId);

      // 4. Build blog context
      const blogContext = req.body.blogContext;

      // 5. Call AI assistant
      const aiResponse = await chatAssistant.processChat(
        history,
        req.body.message,
        blogContext,
        req.userId,
        blogId
      );

      // 6. Save AI response message
      const assistantMsg = await chatPersistence.saveMessage(
        threadId,
        'assistant',
        aiResponse.message.text,
        aiResponse.message.showDiffCard,
        aiResponse.actionType !== 'none' ? aiResponse.actionType : undefined,
        aiResponse.actionData
      );

      res.json({
        success: true,
        data: {
          userMessage: userMsg,
          assistantMessage: assistantMsg,
          actionType: aiResponse.actionType,
          actionData: aiResponse.actionData,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/chat/threads/:threadId/messages — Get message history
// ---------------------------------------------------------------------------
router.get('/threads/:threadId/messages', async (req, res, next) => {
  try {
    const messages = await chatPersistence.getMessagesForThread(req.params.threadId as string);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/chat/messages/:messageId â€” Update message action metadata
// ---------------------------------------------------------------------------
router.patch(
  '/messages/:messageId',
  validate(updateMessageSchema),
  async (req, res, next) => {
    try {
      const message = await chatPersistence.updateMessageActionData(req.params.messageId as string, {
        actionData: req.body.actionData,
        showDiffCard: req.body.showDiffCard,
      });
      res.json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
