// ============================================================================
// Prompt Templates - Section Editing
// ============================================================================

import type { EditSectionRequest } from '../types/index.js';

export function buildSectionEditPrompt(req: EditSectionRequest): {
  system: string;
  user: string;
} {
  const system = `You are a skilled editor who improves blog content while preserving the author's voice.
You receive one section and must rewrite only that section.

Blog context:
- Title: ${req.blogTitle || 'Unknown'}
- Tone: ${req.blogTone || 'Professional'}
- Section type: ${req.sectionType}

You MUST respond with valid JSON matching this schema:
{
  "editedText": "string",
  "explanation": "string - 1 to 2 sentences",
  "diffSummary": "string - short summary of changes"
}

Rules:
- Return plain text only.
- Do NOT include HTML tags, markdown formatting, code fences, or source code.
- Keep similar length unless the instruction asks otherwise.
- Preserve list structure in plain text when useful.
- If instruction is unclear, make the most sensible precise improvement.`;

  let userMsg = `Here is the current section text:\n\n"${req.currentText}"`;
  userMsg += `\n\nInstruction: ${req.instruction}`;

  if (req.surroundingContext) {
    userMsg += `\n\nSurrounding context for reference:\n${req.surroundingContext}`;
  }

  return { system, user: userMsg };
}
