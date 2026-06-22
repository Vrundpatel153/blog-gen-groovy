// ============================================================================
// Section Editor Service — AI-powered section rewriting with version tracking.
// ============================================================================

import { getAIProvider } from './aiProvider.js';
import { buildSectionEditPrompt } from '../prompts/sectionEdit.js';
import { logPrompt } from './promptLogger.js';
import { createVersion } from './versionService.js';
import { config } from '../config.js';
import type { EditSectionRequest, EditSectionResponse } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { stripHtmlAndCode } from '../utils/plainText.js';

export async function editSection(
  sectionId: string,
  blogId: string,
  request: EditSectionRequest,
  userId?: string
): Promise<EditSectionResponse> {
  const ai = getAIProvider();
  const { system, user } = buildSectionEditPrompt(request);
  const model = config.ai.modelEdit;

  const startTime = Date.now();
  let result;

  try {
    result = await ai.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model,
        temperature: 0.6,
        maxTokens: 2048,
        responseFormat: 'json',
      }
    );
  } catch (err: any) {
    await logPrompt({
      userId,
      blogId,
      endpoint: 'section_edit',
      userPrompt: user,
      systemPrompt: system,
      model,
      tokensUsed: 0,
      latencyMs: Date.now() - startTime,
      status: 'error',
      response: err.message,
    });
    throw new AppError(502, `AI editing failed: ${err.message}`);
  }

  const latencyMs = Date.now() - startTime;

  await logPrompt({
    userId,
    blogId,
    endpoint: 'section_edit',
    userPrompt: user,
    systemPrompt: system,
    response: result.content.slice(0, 2000),
    model: result.model,
    tokensUsed: result.tokensUsed,
    latencyMs,
    status: 'success',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new AppError(502, 'AI returned invalid JSON for section edit.');
  }

  const editedText = stripHtmlAndCode(parsed.editedText || parsed.edited_text);
  const explanation = stripHtmlAndCode(parsed.explanation) || 'Content improved.';
  const diffSummary = stripHtmlAndCode(parsed.diffSummary || parsed.diff_summary) || undefined;

  if (!editedText) {
    throw new AppError(502, 'AI returned an empty editedText field.');
  }

  // Save version
  const version = await createVersion({
    sectionId,
    blogId,
    originalText: stripHtmlAndCode(request.currentText),
    editedText,
    explanation,
    diffSummary,
    promptUsed: request.instruction,
    modelUsed: result.model,
  });

  return {
    originalText: request.currentText,
    editedText,
    explanation,
    diffSummary,
    versionId: version.id,
  };
}
