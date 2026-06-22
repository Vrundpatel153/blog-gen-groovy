// ============================================================================
// Prompt Templates - Blog Generation
// ============================================================================

import type { GenerateBlogRequest } from '../types/index.js';

type BlogMode = 'thought-leadership' | 'practical-how-to' | 'seo-pillar' | 'case-study';

function detectBlogMode(req: GenerateBlogRequest): BlogMode {
  const signal = `${req.blogType || ''} ${req.prompt || ''} ${req.seoKeywords || ''}`.toLowerCase();

  if (
    /\b(case study|case-study|client success|implementation result|growth story|customer story|postmortem|lessons learned)\b/.test(
      signal
    )
  ) {
    return 'case-study';
  }

  if (
    /\b(how to|how-to|tutorial|step by step|step-by-step|workflow|implementation guide|playbook|checklist)\b/.test(
      signal
    )
  ) {
    return 'practical-how-to';
  }

  if (
    /\b(seo|pillar|complete guide|ultimate guide|comprehensive guide|beginner to advanced|everything you need to know)\b/.test(
      signal
    )
  ) {
    return 'seo-pillar';
  }

  return 'thought-leadership';
}

export function buildBlogGenerationPrompt(req: GenerateBlogRequest): {
  system: string;
  user: string;
} {
  const lengthGuide: Record<string, string> = {
    'Short (~600 words)': '500-700 words total across all sections',
    'Medium (~1200 words)': '1000-1400 words total across all sections',
    'Long (~2000 words)': '1800-2200 words total across all sections',
  };

  const wordTarget = lengthGuide[req.length] || '1000-1400 words total';
  const sectionGuide: Record<string, string> = {
    'Short (~600 words)': '8 to 12 sections total',
    'Medium (~1200 words)': '12 to 18 sections total',
    'Long (~2000 words)': '18 to 26 sections total',
  };
  const sectionTarget = sectionGuide[req.length] || '12 to 18 sections total';
  const blogMode = detectBlogMode(req);

  const prefs = req.preferences || [];
  const preferenceInstructions: string[] = [];
  if (prefs.includes('faq')) {
    preferenceInstructions.push('Include a Frequently Asked Questions section with 3-5 relevant Q&A pairs.');
  }
  if (prefs.includes('takeaways')) {
    preferenceInstructions.push('Include a Key Takeaways callout summarizing the most important points.');
  }
  if (prefs.includes('statistics')) {
    preferenceInstructions.push('Include relevant industry statistics and data points throughout the blog.');
  }
  if (prefs.includes('cta')) {
    preferenceInstructions.push('End with a compelling call-to-action that motivates the reader.');
  }

  const system = `You are an expert editorial writer creating publication-ready blog posts.
Write in a ${req.tone.toLowerCase()} tone for a ${req.audience.toLowerCase()} audience.

You MUST respond with valid JSON matching this exact schema:
{
  "title": "string",
  "subtitle": "string",
  "slug": "string - lowercase url slug",
  "metaDescription": "string - 150 to 160 characters",
  "sections": [
    {
      "type": "heading" | "paragraph" | "callout" | "image",
      "text": "string",
      "level": "number or null",
      "caption": "string optional - required for image sections",
      "url": "string optional - image URL if available"
    }
  ],
  "keywords": ["string"],
  "faq": [{"question": "string", "answer": "string"}] | null,
  "cta": "string" | null
}

Rules:
- Plain text only in all fields.
- Do NOT output HTML tags, markdown syntax, code fences, or code snippets.
- Make the title concise and strong (ideally 45-68 characters), with subtitle adding context.
- Keep subtitle between 70 and 150 characters and make it read like an editorial deck line.
- Use clear heading hierarchy:
  - level 2 for major sections (document title is already outside sections),
  - level 3 only for tightly scoped nested subpoints.
- Use "paragraph" for body text and "callout" for highlighted insights.
- Image policy:
  - By default, include at most 1 "image" section unless the user explicitly asks for multiple visuals.
  - If user explicitly asks for visuals/images/infographics/charts, include 2 to 4 image sections with meaningful captions.
  - For image sections, keep "text" as a short image prompt/description.
  - Use real publicly accessible image URLs only. Never use placeholder domains like example.com.
- Use production-grade formatting:
  - Keep paragraphs concise (2-4 sentences each) with clear spacing intent.
  - For lists, output one bullet/numbered point per line in "text".
  - Do not merge all bullets into one long line.
- Ensure heading/body rhythm:
  - Most headings should be followed by one or more paragraph sections before the next heading.
  - Avoid long runs of back-to-back headings.
- Position image sections near related content (not all grouped at end).
- Never cluster many images back-to-back unless user explicitly requests an image-heavy post.
- Professional composition baseline (mandatory):
  - Hero: title + strong subtitle (deck-like line); optional cover image section near the beginning.
  - Opening: 1 to 3 intro paragraphs with a strong hook and clear problem framing.
  - Main body: mix section styles, not only heading+paragraph repetition.
  - Ending: conclusion + what-to-do-next + CTA style close.
- In the main body, include at least these structural elements:
  - one framework or step section with numbered lines,
  - one practical checklist with bullet lines,
  - one concrete example or mini case snippet,
  - one comparison/pros-vs-cons style subsection where relevant.
- Structure blueprint requirements:
  - Include an early "Table of Contents" heading with numbered lines of upcoming sections.
  - Include an "Executive Summary" or equivalent early summary section.
  - Include one quote-style key insight using a "callout" section.
  - End with a "Summary" or "Conclusion" section with concrete next steps.
- Quality and depth requirements:
  - Build a concrete narrative arc: hook -> problem context -> framework/process -> examples -> pitfalls -> conclusion.
  - Use specific, domain-relevant details instead of generic filler.
  - Include practical guidance the user can execute immediately.
  - Include at least one numbered framework/list and one concise bullet checklist where relevant.
- Keep each heading meaningful and non-generic.
- Include at least one "callout" section that reads like a quotable key insight.
- Blog mode selection is required. Use the selected mode and follow its blueprint:
  - Mode: thought-leadership
    - strong opinionated hook
    - 4 to 5 argument sections
    - practical examples
    - final takeaway with strategic implications
  - Mode: practical-how-to
    - problem framing
    - step-by-step implementation framework
    - realistic examples
    - execution checklist
    - FAQ optional
  - Mode: seo-pillar
    - broad, comprehensive guide structure
    - early table of contents
    - many H2 sections covering subtopics fully
    - FAQ and CTA when useful
  - Mode: case-study
    - problem
    - context
    - what was tried
    - measurable result
    - lessons learned
- Target ${wordTarget}.
- Target ${sectionTarget}.
- Include at least 3 useful main sections and a clear conclusion.
- Keep content specific, actionable, and precise.
- Follow user intent exactly. Avoid generic filler, vague claims, and random statements.
- Ensure each section has clean spacing and natural paragraph flow.
- Selected blog mode for this request: ${blogMode}.

Language: ${req.language}
Blog type: ${req.blogType}`;

  let userMsg = `Write a complete ${req.blogType.toLowerCase()} blog post about: ${req.prompt}`;

  if (req.seoKeywords) {
    userMsg += `\n\nTarget SEO keywords: ${req.seoKeywords}`;
  }

  if (preferenceInstructions.length > 0) {
    userMsg += `\n\nAdditional requirements:\n${preferenceInstructions.map((p) => `- ${p}`).join('\n')}`;
  }

  return { system, user: userMsg };
}
