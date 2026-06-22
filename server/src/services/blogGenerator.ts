// ============================================================================
// Blog Generator Service — generates complete blogs via AI.
// ============================================================================

import { getAIProvider } from './aiProvider.js';
import { buildBlogGenerationPrompt } from '../prompts/blogGeneration.js';
import { logPrompt } from './promptLogger.js';
import { config } from '../config.js';
import type { GenerateBlogRequest, GeneratedBlogData, BlogSection } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeLayoutText, sanitizeSectionShape, stripHtmlAndCode } from '../utils/plainText.js';
import { randomUUID } from 'crypto';

function imageUrlForPrompt(prompt: string, idx: number): string {
  const seed = encodeURIComponent(`${prompt}-${idx}`);
  return `https://picsum.photos/seed/${seed}/1280/720`;
}

const BLOCKED_IMAGE_HOSTS = new Set([
  'example.com',
  'www.example.com',
  'images.example.com',
]);

function singleLine(input: unknown): string {
  return stripHtmlAndCode(input).replace(/\s+/g, ' ').trim();
}

function slugify(input: string): string {
  return singleLine(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeGeneratedImageUrl(raw: unknown, fallbackSeed: string, idx: number): string {
  const candidate = singleLine(raw);
  if (!candidate) return imageUrlForPrompt(fallbackSeed, idx);

  let normalized = candidate;
  const markdownMatch = normalized.match(/^!\[[^\]]*]\(([^)]+)\)$/);
  if (markdownMatch?.[1]) {
    normalized = markdownMatch[1].trim();
  }
  normalized = normalized.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '').trim();
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  if (!normalized) return imageUrlForPrompt(fallbackSeed, idx);

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      if (BLOCKED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
        return imageUrlForPrompt(fallbackSeed, idx);
      }
      return normalized;
    } catch {
      return imageUrlForPrompt(fallbackSeed, idx);
    }
  }

  if (/^(data:image\/|\/|\.\/|\.\.\/)/i.test(normalized)) {
    return normalized;
  }

  return imageUrlForPrompt(fallbackSeed, idx);
}

function normalizeKeywords(rawKeywords: unknown): string[] {
  const values = Array.isArray(rawKeywords)
    ? rawKeywords
    : typeof rawKeywords === 'string'
      ? rawKeywords.split(',')
      : [];

  const dedup = new Set<string>();
  for (const value of values) {
    const normalized = singleLine(value);
    if (!normalized) continue;
    dedup.add(normalized);
  }
  return [...dedup];
}

function computeWordCount(sections: BlogSection[]): number {
  return sections.reduce((total, sec) => {
    const text =
      sec.type === 'image'
        ? normalizeLayoutText(sec.caption || sec.text || '')
        : normalizeLayoutText(sec.text || '');
    if (!text) return total;
    return total + text.split(/\s+/).filter(Boolean).length;
  }, 0);
}

const PRIMARY_HEADING_PATTERN =
  /^(introduction|overview|framework|implementation roadmap|roadmap|common pitfalls|best practices|conclusion|final thoughts|summary|frequently asked questions|faq|key takeaways)\b/i;
const TERTIARY_HEADING_PATTERN =
  /^(step\s+\d+|phase\s+\d+|example\s+\d+|checklist|quick wins|advanced tips)\b/i;
const TABLE_OF_CONTENTS_PATTERN = /^(table of contents|contents)\b/i;
const EXEC_SUMMARY_HEADING_PATTERN =
  /^(executive summary|at a glance|quick summary|summary snapshot)\b/i;
const SUMMARY_HEADING_PATTERN =
  /^(summary|conclusion|final thoughts|closing thoughts|wrap-up|wrap up|key takeaways)\b/i;
const IMAGE_INTENT_PATTERN =
  /\b(image|images|photo|photos|visual|visuals|illustration|illustrations|infographic|infographics|diagram|diagrams|chart|charts|screenshot|screenshots|gallery)\b/i;

function normalizeHeadingHierarchy(sections: BlogSection[]): BlogSection[] {
  return sections.map((section) => {
    if (section.type !== 'heading') return section;

    const cleanText = normalizeLayoutText(section.text || '');
    const parsedLevel = Number(section.level);
    let normalizedLevel =
      Number.isFinite(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 3
        ? Math.round(parsedLevel)
        : undefined;

    if (PRIMARY_HEADING_PATTERN.test(cleanText)) {
      normalizedLevel = 2;
    }

    if (TERTIARY_HEADING_PATTERN.test(cleanText)) {
      normalizedLevel = 3;
    }

    if (!normalizedLevel) {
      normalizedLevel = 2;
    }

    // Keep major sections under level 2 so the page title always remains visually dominant.
    if (normalizedLevel === 1) {
      normalizedLevel = 2;
    }

    return { ...section, level: normalizedLevel };
  });
}

function ensureCalloutSection(sections: BlogSection[]): BlogSection[] {
  if (sections.some((s) => s.type === 'callout' && normalizeLayoutText(s.text || '').length >= 20)) {
    return sections;
  }

  const anchorIdx = sections.findIndex(
    (s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 120
  );
  if (anchorIdx < 0) return sections;

  const source = normalizeLayoutText(sections[anchorIdx].text || '');
  const firstSentence = source
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s.length >= 50 && s.length <= 220);
  if (!firstSentence) return sections;

  const next = [...sections];
  next.splice(anchorIdx + 1, 0, {
    id: randomUUID(),
    type: 'callout',
    text: `Key Insight:\n"${firstSentence}"`,
    level: undefined,
    caption: '',
    url: '',
  });
  return next;
}

function userRequestedVisuals(request: GenerateBlogRequest): boolean {
  const prompt = normalizeLayoutText(request.prompt || '');
  const keywords = normalizeLayoutText(request.seoKeywords || '');
  const prefText = (request.preferences || []).join(' ').toLowerCase();
  return (
    IMAGE_INTENT_PATTERN.test(prompt) ||
    IMAGE_INTENT_PATTERN.test(keywords) ||
    IMAGE_INTENT_PATTERN.test(prefText)
  );
}

function targetImageCountForLength(length: string, explicitVisualRequest: boolean): number {
  if (!explicitVisualRequest) return 1;
  if (length === 'Long (~2000 words)') return 4;
  if (length === 'Medium (~1200 words)') return 3;
  return 2;
}

function ensureImageCoverage(
  sections: BlogSection[],
  request: GenerateBlogRequest,
  fallbackSeed: string
): BlogSection[] {
  const explicitVisualRequest = userRequestedVisuals(request);
  const next = sections.map((section, idx) => {
    if (section.type !== 'image') return section;
    const promptText = normalizeLayoutText(section.text || section.caption || '') || `Blog visual ${idx + 1}`;
    return {
      ...section,
      text: promptText,
      url: normalizeGeneratedImageUrl(section.url || '', promptText || fallbackSeed, idx + 1),
      caption: normalizeLayoutText(section.caption || '') || `Illustration: ${promptText.slice(0, 90)}`,
    };
  });

  const target = targetImageCountForLength(request.length, explicitVisualRequest);
  const imageIndexes = next
    .map((section, idx) => (section.type === 'image' ? idx : -1))
    .filter((idx) => idx >= 0);
  if (imageIndexes.length > target) {
    const removable = imageIndexes.slice(target).reverse();
    for (const idx of removable) {
      next.splice(idx, 1);
    }
  }

  let imageCount = next.filter((s) => s.type === 'image').length;

  if (imageCount >= target) return next;

  const missing = target - imageCount;
  for (let i = 0; i < missing; i += 1) {
    const ratio = (i + 1) / (missing + 1);
    const insertAt = Math.min(next.length, Math.max(1, Math.floor(next.length * ratio)));
    const anchor = next[insertAt] || next[Math.max(0, insertAt - 1)];
    const anchorText = normalizeLayoutText(
      anchor?.type === 'image' ? anchor.caption || anchor.text || '' : anchor?.text || ''
    );
    const promptText =
      anchorText || `Supporting visual for ${singleLine(fallbackSeed).slice(0, 90) || 'this article'}`;

    next.splice(insertAt, 0, {
      id: randomUUID(),
      type: 'image',
      text: promptText,
      url: imageUrlForPrompt(promptText || fallbackSeed, imageCount + i + 1),
      caption: `Illustration: ${promptText.slice(0, 90)}`,
      level: undefined,
    });
  }

  imageCount = next.filter((s) => s.type === 'image').length;
  if (imageCount === 0) {
    next.splice(1, 0, {
      id: randomUUID(),
      type: 'image',
      text: 'Cover visual',
      url: imageUrlForPrompt(fallbackSeed, 1),
      caption: 'Illustration: Cover visual',
      level: undefined,
    });
  }

  return next;
}

function extractHeadingTitles(sections: BlogSection[]): string[] {
  return sections
    .filter((s) => s.type === 'heading')
    .map((s) => normalizeLayoutText(s.text || ''))
    .filter(
      (text) =>
        text.length >= 4 &&
        !TABLE_OF_CONTENTS_PATTERN.test(text) &&
        !SUMMARY_HEADING_PATTERN.test(text)
    );
}

function buildTableOfContentsText(sections: BlogSection[]): string {
  const headings = extractHeadingTitles(sections).slice(0, 10);
  if (headings.length === 0) return '';
  return headings.map((heading, idx) => `${idx + 1}. ${heading}`).join('\n');
}

function firstLongSentence(text: string): string {
  return normalizeLayoutText(text)
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .find((line) => line.length >= 32 && line.length <= 260) || '';
}

function ensureExecutiveSummarySection(sections: BlogSection[]): BlogSection[] {
  const summarySeed = buildSummaryText(sections);
  if (!summarySeed) return sections;

  const next = [...sections];
  const summaryHeadingIdx = next.findIndex(
    (s) => s.type === 'heading' && EXEC_SUMMARY_HEADING_PATTERN.test(normalizeLayoutText(s.text || ''))
  );

  if (summaryHeadingIdx >= 0) {
    next[summaryHeadingIdx] = {
      ...next[summaryHeadingIdx],
      text: 'Executive Summary',
      level: 2,
    };

    const follower = next[summaryHeadingIdx + 1];
    if (follower && follower.type === 'paragraph') {
      if (normalizeLayoutText(follower.text || '').length < 32) {
        next[summaryHeadingIdx + 1] = {
          ...follower,
          text: summarySeed,
        };
      }
    } else {
      next.splice(summaryHeadingIdx + 1, 0, {
        id: randomUUID(),
        type: 'paragraph',
        text: summarySeed,
        level: undefined,
        caption: '',
        url: '',
      });
    }
    return next;
  }

  const introIdx = next.findIndex(
    (s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 80
  );
  const insertAt = introIdx >= 0 ? introIdx + 1 : Math.min(1, next.length);

  next.splice(insertAt, 0,
    {
      id: randomUUID(),
      type: 'heading',
      text: 'Executive Summary',
      level: 2,
      caption: '',
      url: '',
    },
    {
      id: randomUUID(),
      type: 'paragraph',
      text: summarySeed,
      level: undefined,
      caption: '',
      url: '',
    }
  );

  return next;
}

function ensureTableOfContentsSection(sections: BlogSection[]): BlogSection[] {
  const tocText = buildTableOfContentsText(sections);
  if (!tocText) return sections;

  const next = [...sections];
  const tocHeadingIdx = next.findIndex(
    (s) => s.type === 'heading' && TABLE_OF_CONTENTS_PATTERN.test(normalizeLayoutText(s.text || ''))
  );

  const tocHeading: BlogSection = {
    id: randomUUID(),
    type: 'heading',
    text: 'Table of Contents',
    level: 2,
    caption: '',
    url: '',
  };
  const tocParagraph: BlogSection = {
    id: randomUUID(),
    type: 'paragraph',
    text: tocText,
    level: undefined,
    caption: '',
    url: '',
  };

  if (tocHeadingIdx >= 0) {
    next[tocHeadingIdx] = {
      ...next[tocHeadingIdx],
      text: 'Table of Contents',
      level: 2,
    };

    const following = next[tocHeadingIdx + 1];
    if (following && (following.type === 'paragraph' || following.type === 'callout')) {
      next[tocHeadingIdx + 1] = {
        ...following,
        type: 'paragraph',
        text: tocText,
      };
    } else {
      next.splice(tocHeadingIdx + 1, 0, tocParagraph);
    }
    return next;
  }

  const introIdx = next.findIndex(
    (s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 80
  );
  const insertAt = introIdx >= 0 ? introIdx + 1 : Math.min(2, next.length);
  next.splice(insertAt, 0, tocHeading, tocParagraph);
  return next;
}

function buildSummaryText(sections: BlogSection[]): string {
  const proseSentences = sections
    .filter((s) => s.type === 'paragraph' || s.type === 'callout')
    .map((s) => normalizeLayoutText(s.text || ''))
    .filter((text) => text.length >= 50 && !/^\d+[.)]\s+/.test(text))
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);

  if (proseSentences.length >= 2) {
    const summary = `${proseSentences[0]} ${proseSentences[1]}`;
    return normalizeLayoutText(summary).slice(0, 520).trim();
  }
  if (proseSentences.length === 1) {
    return normalizeLayoutText(proseSentences[0]).slice(0, 420).trim();
  }
  return '';
}

function ensureSummarySection(sections: BlogSection[]): BlogSection[] {
  const hasSummaryHeading = sections.some(
    (s) => s.type === 'heading' && SUMMARY_HEADING_PATTERN.test(normalizeLayoutText(s.text || ''))
  );
  if (hasSummaryHeading) return sections;

  const summaryText = buildSummaryText(sections);
  if (!summaryText) return sections;

  return [
    ...sections,
    {
      id: randomUUID(),
      type: 'heading',
      text: 'Summary',
      level: 2,
      caption: '',
      url: '',
    },
    {
      id: randomUUID(),
      type: 'paragraph',
      text: summaryText,
      level: undefined,
      caption: '',
      url: '',
    },
  ];
}

function ensureHeadingBodyRhythm(sections: BlogSection[]): BlogSection[] {
  const next = [...sections];

  for (let idx = 0; idx < next.length; idx += 1) {
    const sec = next[idx];
    if (sec.type !== 'heading') continue;

    const following = next[idx + 1];
    const needsBodyParagraph =
      !following ||
      following.type === 'heading' ||
      following.type === 'image' ||
      (following.type === 'callout' && normalizeLayoutText(following.text || '').length >= 8);

    if (!needsBodyParagraph) continue;

    const headingText = normalizeLayoutText(sec.text || '').replace(/^\d+[.)]\s+/, '');
    const previousParagraph = [...next]
      .slice(Math.max(0, idx - 4), idx)
      .reverse()
      .find((item) => item.type === 'paragraph' && normalizeLayoutText(item.text || '').length >= 40);
    const contextSentence = firstLongSentence(previousParagraph?.text || '');

    const bridge = normalizeLayoutText(
      contextSentence
        ? `${contextSentence} ${headingText} should translate into clear actions, measurable outcomes, and practical next moves.`
        : `${headingText} should translate into clear actions, measurable outcomes, and practical next moves.`
    );
    if (!bridge) continue;

    next.splice(idx + 1, 0, {
      id: randomUUID(),
      type: 'paragraph',
      text: bridge,
      level: undefined,
      caption: '',
      url: '',
    });
    idx += 1;
  }

  return next;
}

function buildProfessionalSubtitle(
  rawSubtitle: unknown,
  title: string,
  sections: BlogSection[],
  request: GenerateBlogRequest
): string {
  const normalized = singleLine(rawSubtitle);
  if (normalized.length >= 22) {
    return normalized.slice(0, 170);
  }

  const firstParagraph = sections.find((s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 36);
  const paragraphText = normalizeLayoutText(firstParagraph?.text || '');
  if (paragraphText) {
    const sentence = paragraphText
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .find((line) => line.length >= 34);
    if (sentence) {
      return singleLine(sentence).replace(/[.?!]\s*$/, '').slice(0, 170);
    }
  }

  const topic = singleLine(request.prompt || title).slice(0, 120);
  return singleLine(`A practical, structured guide to ${topic}`).slice(0, 170);
}

function polishNarrativeSections(sections: BlogSection[]): BlogSection[] {
  return sections.map((section) => {
    if (section.type === 'heading') {
      return {
        ...section,
        text: singleLine(section.text || ''),
      };
    }

    if (section.type === 'callout') {
      const text = normalizeLayoutText(section.text || '');
      if (!text) return section;
      const strippedLabel = text
        .replace(/^key insight[:\s-]*/i, '')
        .replace(/^key takeaways[:\s-]*/i, '')
        .trim();
      const unwrapped = strippedLabel.replace(/^["'“”]+|["'“”]+$/g, '').trim();
      if (!unwrapped) return section;
      return {
        ...section,
        text: `Key Insight:\n"${unwrapped}"`,
      };
    }

    if (section.type === 'paragraph') {
      return {
        ...section,
        text: normalizeLayoutText(section.text || ''),
      };
    }

    return section;
  });
}

function enforceEditorialLayout(
  sections: BlogSection[],
  request: GenerateBlogRequest,
  fallbackSeed: string
): BlogSection[] {
  const polished = polishNarrativeSections(sections);
  const withHierarchy = normalizeHeadingHierarchy(polished);
  const withExecutiveSummary = ensureExecutiveSummarySection(withHierarchy);
  const withToc = ensureTableOfContentsSection(withExecutiveSummary);
  const withCallout = ensureCalloutSection(withToc);
  const withRhythm = ensureHeadingBodyRhythm(withCallout);
  const withSummary = ensureSummarySection(withRhythm);
  return ensureImageCoverage(withSummary, request, fallbackSeed);
}

function buildGeneratedBlogFromParsed(parsed: any, request: GenerateBlogRequest): GeneratedBlogData {
  const title = singleLine(parsed?.title);
  const subtitleRaw = singleLine(parsed?.subtitle);
  const metaDescription = singleLine(parsed?.metaDescription || parsed?.meta_description);
  const fallbackSeed = title || request.prompt || 'Blog';

  const rawSections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const sections: BlogSection[] = rawSections
    .map((raw: any, idx: number) =>
      sanitizeSectionShape(
        {
          ...raw,
          text:
            raw?.text ??
            raw?.content ??
            raw?.body ??
            raw?.paragraph ??
            raw?.description ??
            raw?.title ??
            raw?.heading,
          caption: raw?.caption ?? raw?.alt ?? raw?.imageCaption,
          url: raw?.url ?? raw?.imageUrl ?? raw?.src,
        },
        randomUUID()
      )
    )
    .map((section: BlogSection, idx: number) => {
      if (section.type !== 'image') {
        return {
          ...section,
          text: normalizeLayoutText(section.text || ''),
          caption: normalizeLayoutText(section.caption || ''),
        };
      }
      const promptText = section.text || section.caption || title || request.prompt || 'blog visual';
      return {
        ...section,
        text: normalizeLayoutText(promptText),
        url: normalizeGeneratedImageUrl(section.url, promptText, idx + 1),
        caption:
          normalizeLayoutText(section.caption || '') ||
          `Illustration: ${normalizeLayoutText(promptText).slice(0, 80)}`,
      };
    })
    .filter((section: BlogSection) => {
      if (section.type === 'image') {
        return Boolean(section.url || section.text || section.caption);
      }
      return Boolean(normalizeLayoutText(section.text || '').length >= 3);
    });

  const improvedSections = enforceEditorialLayout(
    splitLongSections(sections),
    request,
    request.prompt || title || fallbackSeed
  ).map((section) => ({
    ...section,
    id: singleLine(section.id) || randomUUID(),
    text: normalizeLayoutText(section.text || ''),
    caption: normalizeLayoutText(section.caption || ''),
  }));

  const slug = singleLine(parsed?.slug) || slugify(title || fallbackSeed);
  const subtitle = buildProfessionalSubtitle(subtitleRaw, title || fallbackSeed, improvedSections, request);

  return {
    title,
    subtitle,
    slug,
    metaDescription,
    sections: improvedSections,
    keywords: normalizeKeywords(parsed?.keywords),
    faq: Array.isArray(parsed?.faq)
      ? parsed.faq
          .map((item: any) => ({
            question: singleLine(item?.question),
            answer: normalizeLayoutText(item?.answer),
          }))
          .filter((item: any) => item.question && item.answer)
      : null,
    cta: singleLine(parsed?.cta) || undefined,
  };
}

function validateGeneratedBlog(
  generated: GeneratedBlogData,
  request: GenerateBlogRequest
): { ok: boolean; reason?: string } {
  if (!generated.title) return { ok: false, reason: 'missing title' };
  if (!Array.isArray(generated.sections) || generated.sections.length === 0) {
    return { ok: false, reason: 'missing sections' };
  }

  const minSectionsByLength: Record<string, number> = {
    'Short (~600 words)': 6,
    'Medium (~1200 words)': 8,
    'Long (~2000 words)': 10,
  };
  const minWordsByLength: Record<string, number> = {
    'Short (~600 words)': 220,
    'Medium (~1200 words)': 450,
    'Long (~2000 words)': 800,
  };

  const textSections = generated.sections.filter(
    (s) => s.type !== 'image' && normalizeLayoutText(s.text || '').length >= 20
  );
  const paragraphSections = generated.sections.filter(
    (s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 20
  );
  const headingSections = generated.sections.filter(
    (s) => s.type === 'heading' && normalizeLayoutText(s.text || '').length >= 4
  );

  if (generated.sections.length < (minSectionsByLength[request.length] || 6)) {
    return { ok: false, reason: 'too few sections' };
  }
  if (textSections.length < 4) return { ok: false, reason: 'too few textual sections' };
  if (paragraphSections.length < 2) return { ok: false, reason: 'too few paragraphs' };
  if (headingSections.length < 2) return { ok: false, reason: 'too few headings' };

  const words = computeWordCount(generated.sections);
  if (words < (minWordsByLength[request.length] || 220)) {
    return { ok: false, reason: `insufficient words (${words})` };
  }
  return { ok: true };
}

function splitLongSections(sections: BlogSection[]): BlogSection[] {
  const next: BlogSection[] = [];
  for (const sec of sections) {
    if ((sec.type === 'paragraph' || sec.type === 'callout') && (sec.text || '').length > 700) {
      const sentences = normalizeLayoutText(sec.text || '')
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length >= 6) {
        const mid = Math.ceil(sentences.length / 2);
        const first = sentences.slice(0, mid).join(' ');
        const second = sentences.slice(mid).join(' ');
        next.push({ ...sec, text: first });
        next.push({
          ...sec,
          id: randomUUID(),
          text: second,
        });
        continue;
      }
    }
    next.push(sec);
  }
  return next;
}

export async function generateBlog(
  request: GenerateBlogRequest,
  userId?: string
): Promise<GeneratedBlogData> {
  const ai = getAIProvider();
  const { system, user } = buildBlogGenerationPrompt(request);
  const model = config.ai.modelGeneration;
  const attemptUserMessages = [
    user,
    `${user}\n\nIMPORTANT: Your previous output was invalid or incomplete. Return FULL JSON with a non-empty title and 6+ non-empty sections with professional content.`,
  ];

  let lastIssue = 'unknown generation error';

  for (let attempt = 0; attempt < attemptUserMessages.length; attempt += 1) {
    const userPrompt = attemptUserMessages[attempt];
    const startTime = Date.now();
    let result;

    try {
      result = await ai.complete(
        [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        {
          model,
          temperature: 0.25,
          maxTokens: 8192,
          responseFormat: 'json',
        }
      );
    } catch (err: any) {
      await logPrompt({
        userId,
        endpoint: 'blog_generation',
        userPrompt,
        systemPrompt: system,
        model,
        tokensUsed: 0,
        latencyMs: Date.now() - startTime,
        status: 'error',
        response: err.message,
      });
      lastIssue = err.message;
      continue;
    }

    const latencyMs = Date.now() - startTime;

    await logPrompt({
      userId,
      endpoint: 'blog_generation',
      userPrompt,
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
      lastIssue = 'invalid JSON response';
      continue;
    }

    try {
      const generated = buildGeneratedBlogFromParsed(parsed, request);
      const validation = validateGeneratedBlog(generated, request);
      if (validation.ok) {
        return generated;
      }
      lastIssue = validation.reason || 'generated content did not pass integrity checks';
    } catch (err: any) {
      lastIssue = err?.message || 'failed to normalize generated content';
    }
  }

  throw new AppError(
    502,
    `AI returned incomplete blog content (${lastIssue}). Please try again.`
  );
}
