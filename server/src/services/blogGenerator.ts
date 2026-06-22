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
const CTA_HEADING_PATTERN = /^(what to do next|next steps?|action plan|where to start)\b/i;

type BlogMode = 'thought-leadership' | 'practical-how-to' | 'seo-pillar' | 'case-study';

function detectBlogMode(request: GenerateBlogRequest): BlogMode {
  const signal = `${request.blogType || ''} ${request.prompt || ''} ${request.seoKeywords || ''}`.toLowerCase();

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

function topicSeed(request: GenerateBlogRequest): string {
  return singleLine(request.prompt || request.blogType || 'this topic').slice(0, 140) || 'this topic';
}

function countListLines(text: string, type: 'numbered' | 'bullet'): number {
  const lines = normalizeLayoutText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (type === 'numbered') {
    return lines.filter((line) => /^\d+[.)]\s+/.test(line)).length;
  }
  return lines.filter((line) => /^[-*]\s+/.test(line)).length;
}

function hasNumberedFramework(sections: BlogSection[]): boolean {
  return sections.some((section) => section.type === 'paragraph' && countListLines(section.text || '', 'numbered') >= 3);
}

function hasChecklist(sections: BlogSection[]): boolean {
  return sections.some((section) => section.type === 'paragraph' && countListLines(section.text || '', 'bullet') >= 3);
}

function findInsertBeforeSummary(sections: BlogSection[]): number {
  const summaryIdx = sections.findIndex(
    (section) => section.type === 'heading' && SUMMARY_HEADING_PATTERN.test(normalizeLayoutText(section.text || ''))
  );
  return summaryIdx >= 0 ? summaryIdx : sections.length;
}

function ensureOpeningNarrative(
  sections: BlogSection[],
  request: GenerateBlogRequest
): BlogSection[] {
  const next = [...sections];
  const earlyParagraphCount = next
    .slice(0, 5)
    .filter((section) => section.type === 'paragraph' && normalizeLayoutText(section.text || '').length >= 70).length;

  if (earlyParagraphCount >= 1) return next;

  const seed = topicSeed(request);
  next.unshift({
    id: randomUUID(),
    type: 'paragraph',
    text: normalizeLayoutText(
      `${seed} is now a strategic priority, but most teams still operate without a clear execution model. This guide frames the core problem, clarifies the decisions that matter, and maps a practical path from idea to measurable outcomes.`
    ),
    level: undefined,
    caption: '',
    url: '',
  });

  return next;
}

function ensureModeSignatureSections(
  sections: BlogSection[],
  mode: BlogMode,
  request: GenerateBlogRequest
): BlogSection[] {
  const next = [...sections];
  const headingTitles = new Set(
    next
      .filter((section) => section.type === 'heading')
      .map((section) => normalizeLayoutText(section.text || '').toLowerCase())
  );
  const insertAt = Math.max(2, Math.min(findInsertBeforeSummary(next), next.length));
  const seed = topicSeed(request);

  const addHeadingAndParagraph = (heading: string, paragraph: string) => {
    next.splice(insertAt, 0,
      {
        id: randomUUID(),
        type: 'heading',
        text: heading,
        level: 2,
        caption: '',
        url: '',
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        text: normalizeLayoutText(paragraph),
        level: undefined,
        caption: '',
        url: '',
      });
  };

  if (mode === 'practical-how-to') {
    if (![...headingTitles].some((title) => title.includes('step-by-step framework'))) {
      addHeadingAndParagraph(
        'Step-by-Step Framework',
        `Use a repeatable execution loop for ${seed}: diagnose the current state, prioritize the highest-leverage actions, implement in short cycles, and track outcomes against clear quality metrics.`
      );
    }
    return next;
  }

  if (mode === 'seo-pillar') {
    if (![...headingTitles].some((title) => title.includes('complete guide framework'))) {
      addHeadingAndParagraph(
        'Complete Guide Framework',
        `Treat ${seed} as an ecosystem topic: cover fundamentals, implementation patterns, common mistakes, and advanced optimization strategies so readers can move from awareness to execution in one resource.`
      );
    }
    return next;
  }

  if (mode === 'case-study') {
    if (![...headingTitles].some((title) => title.includes('what was tried'))) {
      addHeadingAndParagraph(
        'What Was Tried',
        `The team prioritized one constrained pilot first, instrumented the workflow, and iterated in short cycles. This reduced adoption friction and made it easier to validate impact before scaling.`
      );
    }
    if (![...headingTitles].some((title) => title.includes('lessons learned'))) {
      addHeadingAndParagraph(
        'Lessons Learned',
        `The biggest lesson for ${seed} was that execution quality depended less on tools and more on operating discipline: clear ownership, explicit guardrails, and fast feedback loops.`
      );
    }
    return next;
  }

  if (![...headingTitles].some((title) => title.includes('final takeaway'))) {
    addHeadingAndParagraph(
      'Final Takeaway',
      `The long-term advantage in ${seed} comes from consistency: teams that translate strategy into repeatable workflows compound results faster than teams that rely on one-off wins.`
    );
  }
  return next;
}

function ensureFrameworkAndChecklist(
  sections: BlogSection[],
  mode: BlogMode,
  request: GenerateBlogRequest
): BlogSection[] {
  const next = [...sections];
  const insertAt = findInsertBeforeSummary(next);
  const seed = topicSeed(request);

  if (!hasNumberedFramework(next)) {
    const frameworkText =
      mode === 'case-study'
        ? `1. Define baseline metrics and constraints for ${seed}.\n2. Run one controlled pilot and capture operational evidence.\n3. Scale only what proves durable impact.`
        : mode === 'seo-pillar'
          ? `1. Map user intent and subtopics for ${seed}.\n2. Build section-level depth with clear internal structure.\n3. Refresh the guide using performance and query data.`
          : `1. Clarify the target outcome for ${seed}.\n2. Deploy the workflow in a small measurable scope.\n3. Iterate based on quality, speed, and business impact.`;

    next.splice(insertAt, 0,
      {
        id: randomUUID(),
        type: 'heading',
        text: mode === 'practical-how-to' ? 'Execution Steps' : 'Action Framework',
        level: 2,
        caption: '',
        url: '',
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        text: frameworkText,
        level: undefined,
        caption: '',
        url: '',
      });
  }

  if (!hasChecklist(next)) {
    const checklistText =
      mode === 'thought-leadership'
        ? '- Align leaders on one clear point of view.\n- Back arguments with concrete evidence.\n- Convert strategy into team-level operating actions.'
        : '- Define ownership and timeline before rollout.\n- Validate quality with a measurable acceptance bar.\n- Capture results and feed them into the next iteration.';

    const checklistInsertAt = findInsertBeforeSummary(next);
    next.splice(checklistInsertAt, 0,
      {
        id: randomUUID(),
        type: 'heading',
        text: 'Execution Checklist',
        level: 2,
        caption: '',
        url: '',
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        text: checklistText,
        level: undefined,
        caption: '',
        url: '',
      });
  }

  return next;
}

function ensureExampleAndComparison(
  sections: BlogSection[],
  mode: BlogMode
): BlogSection[] {
  const next = [...sections];
  const headings = new Set(
    next
      .filter((section) => section.type === 'heading')
      .map((section) => normalizeLayoutText(section.text || '').toLowerCase())
  );

  if (![...headings].some((title) => /\b(example|case)\b/.test(title))) {
    const insertAt = findInsertBeforeSummary(next);
    next.splice(insertAt, 0,
      {
        id: randomUUID(),
        type: 'heading',
        text: mode === 'case-study' ? 'Case Snapshot' : 'Practical Example',
        level: 2,
        caption: '',
        url: '',
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        text: normalizeLayoutText(
          'Example: one cross-functional team started with a narrow pilot, documented decisions in a shared runbook, and improved quality each cycle by reviewing what changed and why.'
        ),
        level: undefined,
        caption: '',
        url: '',
      });
  }

  if (mode !== 'case-study' && ![...headings].some((title) => /\b(comparison|pros|cons)\b/.test(title))) {
    const insertAt = findInsertBeforeSummary(next);
    next.splice(insertAt, 0,
      {
        id: randomUUID(),
        type: 'heading',
        text: 'Comparison: Common Approaches',
        level: 2,
        caption: '',
        url: '',
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        text:
          '- Fast but unmanaged approach: quick output, high inconsistency risk.\n- Structured approach: slower setup, stronger repeatability and safer scale.\n- Best fit: combine speed with clear quality guardrails.',
        level: undefined,
        caption: '',
        url: '',
      });
  }

  return next;
}

function ensureClosingCta(
  sections: BlogSection[],
  request: GenerateBlogRequest
): BlogSection[] {
  const next = [...sections];
  const hasCtaHeading = next.some(
    (section) => section.type === 'heading' && CTA_HEADING_PATTERN.test(normalizeLayoutText(section.text || ''))
  );
  if (hasCtaHeading) return next;

  const seed = topicSeed(request);
  next.push(
    {
      id: randomUUID(),
      type: 'heading',
      text: 'What to Do Next',
      level: 2,
      caption: '',
      url: '',
    },
    {
      id: randomUUID(),
      type: 'callout',
      text: normalizeLayoutText(
        `Next Step: choose one high-impact workflow for ${seed}, run a focused implementation sprint this week, and publish the first measurable outcome to build momentum.`
      ),
      level: undefined,
      caption: '',
      url: '',
    }
  );
  return next;
}

function positionHeroImageNearTop(sections: BlogSection[]): BlogSection[] {
  const next = [...sections];
  const firstImageIdx = next.findIndex((section) => section.type === 'image');
  if (firstImageIdx < 0 || firstImageIdx <= 4) return next;

  const [hero] = next.splice(firstImageIdx, 1);
  const insertAt = Math.min(3, next.length);
  next.splice(insertAt, 0, hero);
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
  const mode = detectBlogMode(request);
  const polished = polishNarrativeSections(sections);
  const withHierarchy = normalizeHeadingHierarchy(polished);
  const withOpening = ensureOpeningNarrative(withHierarchy, request);
  const withExecutiveSummary = ensureExecutiveSummarySection(withOpening);
  const withToc = ensureTableOfContentsSection(withExecutiveSummary);
  const withModeSignature = ensureModeSignatureSections(withToc, mode, request);
  const withFrameworkChecklist = ensureFrameworkAndChecklist(withModeSignature, mode, request);
  const withExampleComparison = ensureExampleAndComparison(withFrameworkChecklist, mode);
  const withCallout = ensureCalloutSection(withExampleComparison);
  const withRhythm = ensureHeadingBodyRhythm(withCallout);
  const withSummary = ensureSummarySection(withRhythm);
  const withCta = ensureClosingCta(withSummary, request);
  const withImages = ensureImageCoverage(withCta, request, fallbackSeed);
  return positionHeroImageNearTop(withImages);
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
  const hasOpeningParagraph = generated.sections
    .slice(0, 5)
    .some((s) => s.type === 'paragraph' && normalizeLayoutText(s.text || '').length >= 70);
  const hasFramework = hasNumberedFramework(generated.sections);
  const hasChecklistBlock = hasChecklist(generated.sections);
  const hasClosingCta = generated.sections.some(
    (s) =>
      (s.type === 'heading' && CTA_HEADING_PATTERN.test(normalizeLayoutText(s.text || ''))) ||
      (s.type === 'callout' && /next step|action/i.test(normalizeLayoutText(s.text || '')))
  );

  if (generated.sections.length < (minSectionsByLength[request.length] || 6)) {
    return { ok: false, reason: 'too few sections' };
  }
  if (textSections.length < 4) return { ok: false, reason: 'too few textual sections' };
  if (paragraphSections.length < 2) return { ok: false, reason: 'too few paragraphs' };
  if (headingSections.length < 2) return { ok: false, reason: 'too few headings' };
  if (!hasOpeningParagraph) return { ok: false, reason: 'missing strong opening narrative' };
  if (!hasFramework) return { ok: false, reason: 'missing numbered framework section' };
  if (!hasChecklistBlock) return { ok: false, reason: 'missing checklist section' };
  if (!hasClosingCta) return { ok: false, reason: 'missing closing next-step CTA' };

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
