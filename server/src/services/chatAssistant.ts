// ============================================================================
// Chat Assistant Service - context-aware AI chat with action support.
// ============================================================================

import { getAIProvider } from './aiProvider.js';
import { buildChatAssistantPrompt } from '../prompts/chatAssistant.js';
import { logPrompt } from './promptLogger.js';
import { config } from '../config.js';
import type {
  BlogSection,
  ChatMessage,
  AIMessage,
  ChatAssistantResponse,
} from '../types/index.js';
import { normalizeLayoutText, sanitizeSectionShape, stripHtmlAndCode } from '../utils/plainText.js';

type ActionKind = 'edit_section' | 'replace_all' | 'editor_ops' | 'none';

type EditorOp = {
  op:
    | 'style_title'
    | 'rename_title'
    | 'style_section'
    | 'replace_section_text'
    | 'delete_section'
    | 'replace_image'
    | 'insert_image_after';
  sectionId?: string;
  afterSectionId?: string;
  text?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  url?: string;
  caption?: string;
  selectedText?: string;
};

interface SanitizedContext {
  title: string;
  subtitle?: string;
  tone: string;
  audience: string;
  sections: BlogSection[];
  activeSectionId?: string;
  selectedText?: string;
  selectedField?: 'title' | 'section';
}

interface PromptContextPlan {
  mode: 'full' | 'focused' | 'targeted';
  reason: string;
  totalSections: number;
  promptSections: number;
  promptContext?: SanitizedContext;
}

interface AmbiguityOption {
  sectionId: string;
  sectionType: BlogSection['type'];
  occurrence: number;
  previewText: string;
  matchedSnippet: string;
}

interface AmbiguityPromptGuard {
  snippet: string;
  options: AmbiguityOption[];
  prompt: string;
}

function sanitizeContext(blogContext?: {
  title: string;
  subtitle?: string;
  tone: string;
  audience: string;
  sections: BlogSection[];
  activeSectionId?: string;
  selectedText?: string;
  selectedField?: 'title' | 'section';
}): SanitizedContext | undefined {
  if (!blogContext) return undefined;

  const selectedField = blogContext.selectedField === 'title' || blogContext.selectedField === 'section'
    ? blogContext.selectedField
    : undefined;
  const sections = (blogContext.sections || []).map((s, idx) =>
    sanitizeSectionShape(s, s.id || `sec-${idx}`)
  );
  const selectedText = normalizeLayoutText(blogContext.selectedText);
  const activeSectionIdRaw = stripHtmlAndCode(blogContext.activeSectionId);
  const baseContext = {
    title: stripHtmlAndCode(blogContext.title),
    subtitle: stripHtmlAndCode(blogContext.subtitle),
    tone: stripHtmlAndCode(blogContext.tone),
    audience: stripHtmlAndCode(blogContext.audience),
    selectedText,
    selectedField,
    sections,
  };
  const resolvedActiveSectionId =
    selectedField === 'section'
      ? activeSectionIdRaw ||
        findSectionIdBySnippet(selectedText, {
          ...baseContext,
          activeSectionId: '',
        }, { preferImage: false }) ||
        findSectionIdBySnippet(selectedText, {
          ...baseContext,
          activeSectionId: '',
        }, { preferImage: true }) ||
        ''
      : activeSectionIdRaw;

  return {
    title: baseContext.title,
    subtitle: baseContext.subtitle,
    tone: baseContext.tone,
    audience: baseContext.audience,
    activeSectionId: resolvedActiveSectionId,
    selectedText,
    selectedField,
    sections,
  };
}

function sanitizeColor(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim().toLowerCase();

  const named: Record<string, string> = {
    red: '#dc2626',
    blue: '#2563eb',
    green: '#16a34a',
    yellow: '#ca8a04',
    orange: '#ea580c',
    purple: '#7c3aed',
    pink: '#db2777',
    black: '#111827',
    white: '#ffffff',
    gray: '#4b5563',
    grey: '#4b5563',
  };

  if (named[raw]) return named[raw];

  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) return raw;

  return undefined;
}

function matchText(input: string): string {
  return stripHtmlAndCode(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripListPrefix(line: string): string {
  return normalizeLayoutText(line)
    .replace(/^(\d+)[.)]\s+/, '')
    .replace(/^[-*\u2022\u00B7\u25AA]+\s+/, '')
    .trim();
}

function comparableMultiline(input: string): string {
  return normalizeLayoutText(input)
    .split('\n')
    .map((line) => stripListPrefix(line))
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
    .replace(/[^a-z0-9\n\s]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function sectionDisplayText(section?: { type?: string; text?: string; caption?: string; url?: string }): string {
  if (!section) return '';
  if (section.type === 'image') {
    return normalizeLayoutText(section.caption || section.text || section.url || '');
  }
  return normalizeLayoutText(section.text || '');
}

function normalizeReplaceSectionText(input: unknown): string {
  const normalized = normalizeLayoutText(input);
  if (!normalized) return '';

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return normalized;

  const firstListIdx = lines.findIndex((line) => /^(\d+[.]\s+|[-*]\s+)/.test(line));
  if (firstListIdx < 1) return normalized;

  const leadLines = lines.slice(0, firstListIdx);
  const listLines = lines.slice(firstListIdx);
  const directiveLikeLead = leadLines.every((line) => {
    const lower = line.toLowerCase();
    const hasListSignal = /(list|bullet|numbered|points|items)/.test(lower);
    const hasDirectiveSignal =
      /(replace|rewrite|make|use|convert|change|exactly|only|with|following|below)/.test(lower);
    return hasListSignal && hasDirectiveSignal;
  });

  if (directiveLikeLead && listLines.length > 0) {
    return listLines.join('\n');
  }

  return normalized;
}

function buildRewriteFallbackText(sourceText: string, instructionLower: string): string {
  let output = normalizeLayoutText(sourceText);
  if (!output) return '';

  const replacements: Array<[RegExp, string]> = [
    [/\butilize\b/gi, 'use'],
    [/\bleverage\b/gi, 'use'],
    [/\bin order to\b/gi, 'to'],
    [/\ba lot of\b/gi, 'many'],
    [/\bvery\b/gi, ''],
  ];

  for (const [pattern, value] of replacements) {
    output = output.replace(pattern, value);
  }
  output = normalizeLayoutText(output);

  if (/\b(concise|short|shorter|shorten|brief)\b/.test(instructionLower)) {
    const firstSentence = output
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (firstSentence) {
      output = firstSentence;
    }
    const words = output.split(/\s+/).filter(Boolean);
    if (words.length > 28) {
      output = `${words.slice(0, 28).join(' ')}.`;
    }
    output = normalizeLayoutText(output);
  }

  const explicitWordLimitMatch =
    instructionLower.match(/\b(?:under|within|max(?:imum)?|at most|no more than)\s+(\d{1,3})\s+words?\b/i) ||
    instructionLower.match(/\b(\d{1,3})\s+words?\s+(?:max|maximum|or less)\b/i);
  const explicitWordLimit = explicitWordLimitMatch?.[1] ? Number(explicitWordLimitMatch[1]) : undefined;
  if (Number.isFinite(explicitWordLimit) && explicitWordLimit && explicitWordLimit > 2) {
    const words = output.split(/\s+/).filter(Boolean);
    if (words.length > explicitWordLimit) {
      output = words.slice(0, explicitWordLimit).join(' ').trim();
      output = output.replace(/[.?!,:;]+$/g, '').trim();
      if (output) {
        output = `${output}.`;
      }
    }
    output = normalizeLayoutText(output);
  }

  if (/\bformal\b/.test(instructionLower)) {
    output = output
      .replace(/\bcan't\b/gi, 'cannot')
      .replace(/\bdon't\b/gi, 'do not')
      .replace(/\bit's\b/gi, 'it is')
      .replace(/\bwon't\b/gi, 'will not');
    output = normalizeLayoutText(output);
  }

  const base = normalizeLayoutText(sourceText);
  if (!output || output === base) {
    const trimmed = base.replace(/[.?!]\s*$/, '').trim();
    output = normalizeLayoutText(`${trimmed}. Focus on clear, actionable outcomes.`);
  }

  return output;
}

function isSubtitleOnlyRequest(message: string): boolean {
  const clean = stripHtmlAndCode(message).toLowerCase();
  if (!/\bsub[\s-]?title\b/.test(clean)) return false;

  const explicitOnlySubtitle =
    /\b(only|just)\b[\s\w]{0,28}\bsub[\s-]?title\b/.test(clean) ||
    /\bsub[\s-]?title\b[\s\w]{0,28}\b(only|just)\b/.test(clean);
  if (explicitOnlySubtitle) return true;

  const withoutSubtitle = clean.replace(/\bsub[\s-]?title\b/g, ' ');
  const otherTargetSignals = /\b(section|paragraph|body|content|article|list|image|heading|table|faq|conclusion)\b/.test(
    withoutSubtitle
  );
  return !otherTargetSignals;
}

function deriveSubtitleEditText(message: string, currentSubtitle: string): string {
  const cleanMessage = stripHtmlAndCode(message);
  const lower = cleanMessage.toLowerCase();
  const looksInstructional = (value: string): boolean =>
    /\b(keep|unchanged|under|within|max(?:imum)?|rewrite|reword|shorten|make|only|title|body|section|paragraph)\b/i.test(
      value
    );

  if (/(remove|delete|clear)\s+(?:the\s+)?(?:blog\s+)?sub[\s-]?title/.test(lower)) {
    return '';
  }

  const directMatch =
    cleanMessage.match(
      /(?:rewrite|change|update|replace|set)\s+(?:only\s+|just\s+)?(?:the\s+)?(?:blog\s+)?sub[\s-]?title\s+(?:to|as|with)\s+"([^"\n]+)"/i
    ) || cleanMessage.match(/(?:subtitle|sub[\s-]?title)\s*[:=-]\s*"?([^"\n]+)"?\s*$/i);

  if (directMatch?.[1]) {
    const direct = normalizeLayoutText(directMatch[1]);
    if (direct && !looksInstructional(direct)) return direct;
  }

  const quotedSnippets = extractQuotedSnippets(cleanMessage);
  if (quotedSnippets.length >= 2) {
    const candidate = normalizeLayoutText(quotedSnippets[quotedSnippets.length - 1]);
    if (candidate) return candidate;
  }
  if (quotedSnippets.length === 1 && /\b(to|as|with|set|rewrite|change|update|replace)\b/.test(lower)) {
    const candidate = normalizeLayoutText(quotedSnippets[0]);
    if (candidate) return candidate;
  }

  return buildRewriteFallbackText(currentSubtitle, lower);
}

function extractQuotedSnippets(message: string): string[] {
  const snippets: string[] = [];
  const text = stripHtmlAndCode(message);
  const quoteRegexes = [/"([^"\n]{4,220})"/g, /'([^'\n]{4,220})'/g];
  for (const regex of quoteRegexes) {
    let match: RegExpExecArray | null = regex.exec(text);
    while (match) {
      if (match[1]) snippets.push(match[1]);
      match = regex.exec(text);
    }
  }
  return snippets;
}

function findSectionIdBySnippet(
  rawSnippet: string | undefined,
  context?: SanitizedContext,
  options?: { preferImage?: boolean }
): string | undefined {
  if (!rawSnippet || !context) return undefined;
  const snippet = matchText(rawSnippet);
  if (!snippet || snippet.length < 4) return undefined;
  const sections = (context.sections || []).filter((s) =>
    options?.preferImage ? s.type === 'image' : s.type !== 'image'
  );
  if (sections.length === 0) return undefined;

  const exact = sections.find((s) => matchText(sectionDisplayText(s)) === snippet);
  if (exact) return exact.id;

  const contains = sections.find((s) => matchText(sectionDisplayText(s)).includes(snippet));
  if (contains) return contains.id;

  const strippedSnippet = comparableMultiline(rawSnippet);
  if (strippedSnippet) {
    const strippedContains = sections.find((s) =>
      comparableMultiline(sectionDisplayText(s)).includes(strippedSnippet)
    );
    if (strippedContains) return strippedContains.id;
  }

  const shortened = snippet.slice(0, 80);
  if (!shortened) {
    return undefined;
  }
  const partial = sections.find((s) => matchText(sectionDisplayText(s)).includes(shortened));
  if (partial?.id) return partial.id;

  const snippetLines = strippedSnippet
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (snippetLines.length > 0) {
    let bestMatch: { id: string; score: number } | null = null;
    for (const section of sections) {
      const sectionLines = comparableMultiline(sectionDisplayText(section))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (sectionLines.length === 0) continue;

      let matched = 0;
      for (const line of snippetLines) {
        if (sectionLines.some((candidate) => candidate === line || candidate.includes(line) || line.includes(candidate))) {
          matched += 1;
        }
      }
      const score = matched / snippetLines.length;
      if (score < 0.5) continue;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { id: section.id, score };
      }
    }
    if (bestMatch?.id) return bestMatch.id;
  }

  return partial?.id;
}

function parseOrdinalIndex(message: string): number | undefined {
  const lower = message.toLowerCase();
  const wordMap: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
  };
  for (const [word, value] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return value;
  }
  const numericMatch = lower.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (!numericMatch) return undefined;
  const parsed = Number(numericMatch[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function chooseTargetSectionId(
  message: string,
  context?: SanitizedContext,
  options?: { preferImage?: boolean }
): string | undefined {
  if (!context) return undefined;
  if (context.activeSectionId) return context.activeSectionId;

  const clean = stripHtmlAndCode(message).toLowerCase();
  const sections = context.sections || [];
  if (sections.length === 0) return undefined;

  const textSections = sections.filter((s) => s.type !== 'image');
  const imageSections = sections.filter((s) => s.type === 'image');
  const pool = options?.preferImage ? imageSections : textSections;

  for (const sec of sections) {
    const idLower = (sec.id || '').toLowerCase();
    if (idLower && clean.includes(idLower)) return sec.id;
  }

  const snippets = extractQuotedSnippets(message);
  for (const snippet of snippets) {
    const bySnippet = findSectionIdBySnippet(snippet, context, options);
    if (bySnippet) return bySnippet;
  }

  const containsMatch = clean.match(/(?:contains|containing|that says|starting with|starts with)\s+["']?([^"']{4,180})/i);
  if (containsMatch?.[1]) {
    const byPhrase = findSectionIdBySnippet(containsMatch[1], context, options);
    if (byPhrase) return byPhrase;
  }

  const ordinal = parseOrdinalIndex(clean);
  if (ordinal && pool[ordinal - 1]?.id) {
    return pool[ordinal - 1].id;
  }

  if (/\b(introduction|intro|opening|opening paragraph)\b/.test(clean)) {
    return textSections[0]?.id;
  }
  if (/\b(conclusion|closing|ending|final paragraph|last paragraph|last section)\b/.test(clean)) {
    return textSections[textSections.length - 1]?.id;
  }
  if (/\b(cover image|hero image|first image)\b/.test(clean)) {
    return imageSections[0]?.id;
  }
  if (/\b(second image)\b/.test(clean)) {
    return imageSections[1]?.id;
  }
  if (/\b(last image)\b/.test(clean)) {
    return imageSections[imageSections.length - 1]?.id;
  }

  if (options?.preferImage && imageSections.length > 0 && /\b(image|photo|visual)\b/.test(clean)) {
    return imageSections[0].id;
  }

  return undefined;
}

function extractAmbiguityCandidateSnippets(message: string): string[] {
  const clean = stripHtmlAndCode(message);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeLayoutText(value);
    if (!normalized || normalized.length < 3) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
  };

  extractQuotedSnippets(clean).forEach(pushCandidate);

  const containsMatch = clean.match(
    /(?:contains|containing|that says|starting with|starts with|text|phrase|word)\s+["']?([^"'\n]{3,180})["']?/i
  );
  if (containsMatch?.[1]) {
    pushCandidate(containsMatch[1]);
  }

  const replaceMatch = clean.match(
    /(?:replace|rewrite|change|edit|update|remove|delete|make)\s+(?:the\s+)?(?:text|word|phrase|paragraph|line|sentence)?\s*["']([^"'\n]{3,180})["']/i
  );
  if (replaceMatch?.[1]) {
    pushCandidate(replaceMatch[1]);
  }

  return candidates.slice(0, 5);
}

function findMatchingSectionsBySnippet(
  snippet: string,
  context?: SanitizedContext
): BlogSection[] {
  if (!context || !snippet) return [];
  const normalized = matchText(snippet);
  const normalizedMultiline = comparableMultiline(snippet);
  const matches = (context.sections || []).filter((section) => {
    const display = sectionDisplayText(section);
    const exact = matchText(display);
    if (!exact) return false;
    if (normalized && (exact === normalized || exact.includes(normalized) || normalized.includes(exact))) {
      return true;
    }
    if (normalizedMultiline) {
      const comparable = comparableMultiline(display);
      if (
        comparable &&
        (comparable === normalizedMultiline ||
          comparable.includes(normalizedMultiline) ||
          normalizedMultiline.includes(comparable))
      ) {
        return true;
      }
    }
    return false;
  });

  const dedupedIds = new Set<string>();
  const ordered: BlogSection[] = [];
  for (const section of matches) {
    const id = stripHtmlAndCode(section.id || '');
    if (!id || dedupedIds.has(id)) continue;
    dedupedIds.add(id);
    ordered.push(section);
  }
  return ordered;
}

function shouldRunAmbiguityGuard(message: string, context?: SanitizedContext): boolean {
  if (!context || hasStrictSelectionScope(context)) return false;
  const clean = stripHtmlAndCode(message).toLowerCase();
  if (!clean) return false;
  if (looksLikeGlobalRewriteIntent(clean)) return false;
  if (parseOrdinalIndex(clean)) return false;
  if (context.sections.some((section) => clean.includes(stripHtmlAndCode(section.id || '').toLowerCase()))) {
    return false;
  }
  return /\b(rewrite|replace|change|edit|update|remove|delete|make|bold|italic|color|highlight|format)\b/.test(clean);
}

function detectAmbiguousPromptTarget(
  message: string,
  context?: SanitizedContext
): AmbiguityPromptGuard | null {
  if (!shouldRunAmbiguityGuard(message, context) || !context) return null;

  const snippets = extractAmbiguityCandidateSnippets(message);
  if (snippets.length === 0) return null;

  for (const snippet of snippets) {
    const matchingSections = findMatchingSectionsBySnippet(snippet, context);
    if (matchingSections.length <= 1) continue;

    const options: AmbiguityOption[] = matchingSections.slice(0, 8).map((section, idx) => {
      const previewText = sectionDisplayText(section).slice(0, 220);
      return {
        sectionId: stripHtmlAndCode(section.id || ''),
        sectionType: section.type,
        occurrence: idx + 1,
        previewText,
        matchedSnippet: snippet,
      };
    });
    if (options.length >= 2) {
      return {
        snippet,
        options,
        prompt: stripHtmlAndCode(message),
      };
    }
  }
  return null;
}

function dedupeEditorOps(ops: EditorOp[]): EditorOp[] {
  const merged = new Map<string, EditorOp>();
  for (const op of ops) {
    const key =
      op.op === 'style_title'
        ? `style_title:${op.selectedText || ''}`
        : op.op === 'rename_title'
          ? `rename_title:${op.selectedText || ''}`
          : op.op === 'style_section'
            ? `style_section:${op.sectionId || ''}:${op.selectedText || ''}`
            : op.op === 'replace_section_text'
              ? `replace_section_text:${op.sectionId || ''}:${op.selectedText || ''}`
              : op.op === 'delete_section'
                ? `delete_section:${op.sectionId || ''}:${op.selectedText || ''}`
                : op.op === 'replace_image'
                  ? `replace_image:${op.sectionId || ''}`
                  : op.op === 'insert_image_after'
                    ? `insert_image_after:${op.afterSectionId || op.sectionId || ''}:${op.url || ''}:${op.caption || ''}:${op.text || ''}`
                    : JSON.stringify(op);

    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, op);
      continue;
    }

    if (op.op === 'style_title' || op.op === 'style_section') {
      merged.set(key, {
        ...prev,
        ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
        ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
        ...(op.color ? { color: op.color } : {}),
      });
      continue;
    }

    // For non-style operations, latest instruction wins.
    merged.set(key, {
      ...prev,
      ...op,
    });
  }
  return Array.from(merged.values());
}

function coerceEditorOps(rawOps: any[]): EditorOp[] {
  const ops: EditorOp[] = [];

  for (const raw of rawOps) {
    if (!raw || typeof raw !== 'object') continue;
    const op = stripHtmlAndCode(raw.op) as EditorOp['op'];
    if (
      ![
        'style_title',
        'rename_title',
        'style_section',
        'replace_section_text',
        'delete_section',
        'replace_image',
        'insert_image_after',
      ].includes(op)
    ) {
      continue;
    }

    const next: EditorOp = { op };
    const sectionId = stripHtmlAndCode(raw.sectionId);
    const afterSectionId = stripHtmlAndCode(raw.afterSectionId);
    const text =
      op === 'replace_section_text'
        ? normalizeReplaceSectionText(raw.text)
        : normalizeLayoutText(raw.text);
    const url = stripHtmlAndCode(raw.url);
    const caption = normalizeLayoutText(raw.caption);
    const color = sanitizeColor(raw.color);
    const selectedText = normalizeLayoutText(raw.selectedText);

    if (sectionId) next.sectionId = sectionId;
    if (afterSectionId) next.afterSectionId = afterSectionId;
    if (text) next.text = text;
    if (url) next.url = url;
    if (caption) next.caption = caption;
    if (typeof raw.bold === 'boolean') next.bold = raw.bold;
    if (typeof raw.italic === 'boolean') next.italic = raw.italic;
    if (color) next.color = color;
    if (selectedText) next.selectedText = selectedText;

    ops.push(next);
  }

  return ops;
}

function defaultImageUrl(prompt: string): string {
  const seed = encodeURIComponent(stripHtmlAndCode(prompt).slice(0, 120) || 'blog-image');
  return `https://picsum.photos/seed/${seed}/1280/720`;
}

function isLikelyComplexInstruction(message: string): boolean {
  const clean = stripHtmlAndCode(message).toLowerCase();
  if (clean.length > 240) return true;

  const sentenceCount = clean
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  if (sentenceCount >= 3) return true;

  const complexitySignals = [
    ' and ',
    ' also ',
    ' then ',
    ' plus ',
    ' additionally ',
    ' moreover ',
    ' while ',
    ' first ',
    ' second ',
    ' third ',
    ' 1.',
    ' 2.',
    ' 3.',
    ' overall blog',
    ' whole blog',
    ' complete blog',
    ' entire blog',
  ];

  let signalHits = 0;
  for (const signal of complexitySignals) {
    if (clean.includes(signal)) signalHits += 1;
  }
  return signalHits >= 2;
}

function looksLikeGlobalRewriteIntent(message: string): boolean {
  const clean = stripHtmlAndCode(message).toLowerCase();
  if (!clean) return false;
  return /\b(whole blog|entire blog|complete blog|full blog|across the blog|rewrite the blog|rewrite entire|rewrite all|global rewrite|replace all|full rewrite)\b/.test(
    clean
  );
}

function tokenizeForContextRanking(message: string): string[] {
  const stopWords = new Set([
    'about',
    'after',
    'also',
    'and',
    'area',
    'blog',
    'change',
    'changes',
    'content',
    'edit',
    'from',
    'have',
    'into',
    'just',
    'make',
    'more',
    'only',
    'please',
    'prompt',
    'section',
    'this',
    'that',
    'text',
    'the',
    'their',
    'there',
    'these',
    'those',
    'title',
    'with',
    'without',
    'your',
  ]);
  return stripHtmlAndCode(message)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function buildPromptContextPlan(
  context: SanitizedContext | undefined,
  userMessage: string,
  isComplexInstruction: boolean
): PromptContextPlan {
  if (!context) {
    return {
      mode: 'full',
      reason: 'no_blog_context',
      totalSections: 0,
      promptSections: 0,
      promptContext: undefined,
    };
  }

  const sections = context.sections || [];
  const totalSections = sections.length;
  if (totalSections <= 12) {
    return {
      mode: 'full',
      reason: 'small_document',
      totalSections,
      promptSections: totalSections,
      promptContext: context,
    };
  }

  if (looksLikeGlobalRewriteIntent(userMessage) || (isComplexInstruction && totalSections <= 16)) {
    return {
      mode: 'full',
      reason: 'global_or_complex_intent',
      totalSections,
      promptSections: totalSections,
      promptContext: context,
    };
  }

  const selectedIndices = new Set<number>();
  const addIndex = (idx: number) => {
    if (idx >= 0 && idx < totalSections) selectedIndices.add(idx);
  };
  const addIndexWithNeighbors = (idx: number, radius = 1) => {
    for (let offset = -radius; offset <= radius; offset += 1) {
      addIndex(idx + offset);
    }
  };

  const selectedScopeId =
    stripHtmlAndCode(context.activeSectionId || '') ||
    findSectionIdBySnippet(context.selectedText, context, { preferImage: false }) ||
    findSectionIdBySnippet(context.selectedText, context, { preferImage: true }) ||
    '';
  if (selectedScopeId) {
    const scopedIdx = sections.findIndex((section) => section.id === selectedScopeId);
    if (scopedIdx >= 0) {
      addIndexWithNeighbors(scopedIdx, 2);
      addIndex(0);
      addIndex(1);
      addIndex(totalSections - 1);

      const ordered = Array.from(selectedIndices).sort((a, b) => a - b);
      const promptSections = ordered.map((idx) => sections[idx]).filter(Boolean);
      return {
        mode: 'focused',
        reason: 'strict_selected_scope',
        totalSections,
        promptSections: promptSections.length,
        promptContext: {
          ...context,
          sections: promptSections,
          activeSectionId: selectedScopeId,
        },
      };
    }
  }

  const lower = stripHtmlAndCode(userMessage).toLowerCase();
  const targetSectionId = chooseTargetSectionId(userMessage, context, {
    preferImage: /\b(image|photo|visual|figure|caption)\b/.test(lower),
  });
  const targetIdx = targetSectionId ? sections.findIndex((section) => section.id === targetSectionId) : -1;
  if (targetIdx >= 0) {
    addIndexWithNeighbors(targetIdx, 2);
  }

  // Keep minimal global narrative anchors (opening + ending) for quality safety.
  addIndex(0);
  addIndex(1);
  addIndex(totalSections - 1);
  addIndex(totalSections - 2);

  const tokens = tokenizeForContextRanking(userMessage);
  if (tokens.length > 0) {
    const scored = sections
      .map((section, idx) => {
        const text = matchText(sectionDisplayText(section));
        if (!text) return { idx, score: 0 };
        let score = 0;
        for (const token of tokens) {
          if (text.includes(token)) score += token.length >= 7 ? 2 : 1;
        }
        if (section.id === targetSectionId) score += 6;
        if (section.type === 'heading' && score > 0) score += 1;
        return { idx, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const hit of scored) {
      addIndexWithNeighbors(hit.idx, 1);
    }
  }

  if (selectedIndices.size < 7) {
    for (let idx = 0; idx < totalSections && selectedIndices.size < 7; idx += 1) {
      addIndex(idx);
    }
  }

  const ordered = Array.from(selectedIndices).sort((a, b) => a - b);
  const maxPromptSections = 10;
  const limited = ordered.slice(0, maxPromptSections);
  if (limited.length === 0 || limited.length >= totalSections) {
    return {
      mode: 'full',
      reason: 'pack_fallback_to_full',
      totalSections,
      promptSections: totalSections,
      promptContext: context,
    };
  }

  const promptSections = limited.map((idx) => sections[idx]).filter(Boolean);
  const promptActiveId = promptSections.some((section) => section.id === context.activeSectionId)
    ? context.activeSectionId
    : undefined;

  return {
    mode: targetIdx >= 0 ? 'focused' : 'targeted',
    reason: targetIdx >= 0 ? 'target_and_neighbors' : 'keyword_ranked_pack',
    totalSections,
    promptSections: promptSections.length,
    promptContext: {
      ...context,
      sections: promptSections,
      activeSectionId: promptActiveId,
    },
  };
}

function buildThreadMemory(
  threadMessages: ChatMessage[],
  context?: SanitizedContext,
  options?: {
    maxChars?: number;
    recentPrompts?: number;
    recentActions?: number;
    recentAppliedChanges?: number;
  }
): string {
  const maxChars =
    Number.isFinite(options?.maxChars as number) && (options?.maxChars as number) > 0
      ? Math.floor(options?.maxChars as number)
      : 2400;
  const recentPromptsLimit =
    Number.isFinite(options?.recentPrompts as number) && (options?.recentPrompts as number) > 0
      ? Math.floor(options?.recentPrompts as number)
      : 6;
  const recentActionsLimit =
    Number.isFinite(options?.recentActions as number) && (options?.recentActions as number) > 0
      ? Math.floor(options?.recentActions as number)
      : 6;
  const recentAppliedLimit =
    Number.isFinite(options?.recentAppliedChanges as number) && (options?.recentAppliedChanges as number) > 0
      ? Math.floor(options?.recentAppliedChanges as number)
      : 4;

  const recentUserPrompts = threadMessages
    .filter((m) => m.sender === 'user')
    .slice(-recentPromptsLimit)
    .map((m, idx) => `${idx + 1}. ${stripHtmlAndCode(m.text).slice(0, 180)}`);

  const recentActions = threadMessages
    .filter((m) => m.sender === 'assistant' && !!m.actionType)
    .slice(-recentActionsLimit)
    .map((m, idx) => {
      const kind = stripHtmlAndCode(m.actionType || '');
      if (kind === 'editor_ops') {
        const ops = Array.isArray((m.actionData as any)?.operations) ? (m.actionData as any).operations : [];
        const names = ops
          .map((op: any) => stripHtmlAndCode(op?.op))
          .filter(Boolean)
          .slice(0, 5)
          .join(', ');
        return `${idx + 1}. editor_ops: ${names || 'operations'}`;
      }
      if (kind === 'edit_section') {
        return `${idx + 1}. edit_section on ${stripHtmlAndCode((m.actionData as any)?.sectionId)}`;
      }
      if (kind === 'replace_all') {
        return `${idx + 1}. replace_all`;
      }
      return `${idx + 1}. ${kind}`;
    });

  const recentAppliedChanges = threadMessages
    .filter((m) => m.sender === 'assistant' && !!(m.actionData as any)?.appliedAt)
    .slice(-recentAppliedLimit)
    .map((m, idx) => {
      const versions = Array.isArray((m.actionData as any)?.chatVersions)
        ? ((m.actionData as any).chatVersions as any[])
        : [];
      const beforeSections = Array.isArray((m.actionData as any)?.beforeState?.sections)
        ? ((m.actionData as any).beforeState.sections as any[])
        : [];
      const afterSections = Array.isArray((m.actionData as any)?.afterState?.sections)
        ? ((m.actionData as any).afterState.sections as any[])
        : [];

      const beforeMap = new Map(beforeSections.map((s) => [stripHtmlAndCode(s?.id), sectionDisplayText(s)]));
      const changedSnippets: string[] = [];
      for (const after of afterSections) {
        const id = stripHtmlAndCode(after?.id);
        if (!id) continue;
        const before = beforeMap.get(id) || '';
        const next = sectionDisplayText(after);
        if (before && next && before !== next) {
          changedSnippets.push(`${before.slice(0, 70)} -> ${next.slice(0, 70)}`);
        }
        if (changedSnippets.length >= 2) break;
      }

      const changeSummary = changedSnippets.length > 0 ? changedSnippets.join(' | ') : 'content changed';
      return `${idx + 1}. applied edits (${versions.length} version rows): ${changeSummary}`;
    });

  const imageIndex = (context?.sections || [])
    .filter((s) => s.type === 'image')
    .slice(0, 10)
    .map((s, idx) => {
      const caption = stripHtmlAndCode(s.caption || s.text || 'image');
      const url = stripHtmlAndCode(s.url || '');
      return `${idx + 1}. ID=${s.id}; caption="${caption.slice(0, 90)}"; url="${url.slice(0, 120)}"`;
    });

  const memoryBlocks: string[] = [];
  if (context?.selectedField) {
    const selectionHeader =
      context.selectedField === 'title'
        ? 'Current strict selection scope: title'
        : `Current strict selection scope: section ${context.activeSectionId || '(missing id)'}`;
    const selectedText = normalizeLayoutText(context.selectedText || '');
    memoryBlocks.push(
      `${selectionHeader}${selectedText ? `\nSelected text snapshot: ${selectedText.slice(0, 260)}` : ''}`
    );
  }
  if (recentUserPrompts.length > 0) {
    memoryBlocks.push(`Recent user intents:\n${recentUserPrompts.join('\n')}`);
  }
  if (recentActions.length > 0) {
    memoryBlocks.push(`Recent assistant actions:\n${recentActions.join('\n')}`);
  }
  if (imageIndex.length > 0) {
    memoryBlocks.push(`Current image sections:\n${imageIndex.join('\n')}`);
  }
  if (recentAppliedChanges.length > 0) {
    memoryBlocks.push(`Recent persisted content changes:\n${recentAppliedChanges.join('\n')}`);
  }

  return memoryBlocks.join('\n\n').slice(0, maxChars);
}

function buildFallbackResponse(
  fallback: { actionType: ActionKind; actionData?: Record<string, unknown>; message?: string },
  meta?: ChatAssistantResponse['meta']
): ChatAssistantResponse {
  const normalizedActionData =
    fallback.actionType === 'editor_ops' && fallback.actionData
      ? (() => {
          const operations = Array.isArray((fallback.actionData as any).operations)
            ? coerceEditorOps((fallback.actionData as any).operations as any[])
            : [];
          const currentOriginals = Array.isArray((fallback.actionData as any).operationOriginals)
            ? ((fallback.actionData as any).operationOriginals as any[])
            : [];
          if (operations.length > 0 && currentOriginals.length !== operations.length) {
            return {
              ...fallback.actionData,
              operations,
              operationOriginals: operations.map((op, opIndex) => ({
                opIndex,
                op: op.op,
                sectionId: op.sectionId,
                afterSectionId: op.afterSectionId,
                originalText: '',
                anchorOriginalText: '',
              })),
            };
          }
          return fallback.actionData;
        })()
      : fallback.actionData;

  const hasAction =
    fallback.actionType === 'edit_section' ||
    fallback.actionType === 'replace_all' ||
    fallback.actionType === 'editor_ops';

  return {
    message: {
      id: `ai-${Date.now()}`,
      threadId: '',
      sender: 'assistant',
      text: stripHtmlAndCode(
        fallback.message || 'Prepared the requested update. Review and press Replace to apply.'
      ),
      showDiffCard: hasAction,
      actionType: hasAction ? fallback.actionType : undefined,
      actionData: normalizedActionData || undefined,
      createdAt: new Date().toISOString(),
    },
    actionType: fallback.actionType,
    actionData: normalizedActionData,
    meta,
  };
}

function inferFallbackAction(
  message: string,
  context?: SanitizedContext
): { actionType: ActionKind; actionData?: Record<string, unknown>; message?: string } | null {
  const lower = message.toLowerCase();
  const isTitleScoped = context?.selectedField === 'title';
  const isSectionScoped = context?.selectedField === 'section' && !!context?.activeSectionId;
  const wantsImageTarget = /\b(image|photo|visual)\b/.test(lower);
  let targetSectionId = chooseTargetSectionId(message, context, { preferImage: false });
  let targetImageSectionId = chooseTargetSectionId(message, context, { preferImage: true });
  if (isSectionScoped) {
    targetSectionId = context?.activeSectionId;
    targetImageSectionId = undefined;
  }
  if (isTitleScoped) {
    targetSectionId = undefined;
    targetImageSectionId = undefined;
  }
  const activeSection = context?.sections.find(
    (s) => s.id === (wantsImageTarget ? targetImageSectionId || targetSectionId : targetSectionId)
  );
  const colorMatch = message.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  const imageUrlMatch = message.match(/https?:\/\/\S+/i);

  const findNamedColor = (): string | undefined => {
    const names = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'gray', 'grey'];
    return names.find((name) => new RegExp(`\\b${name}\\b`).test(lower));
  };

  const color = sanitizeColor(colorMatch ? colorMatch[0] : findNamedColor());
  const wantsBold = /\bbold\b/.test(lower) && !/\bunbold\b|remove bold|not bold|normal weight/.test(lower);
  const wantsItalic = /\bitalic\b/.test(lower) && !/remove italic|not italic|normal style/.test(lower);
  const wantsUnbold = /\bunbold\b|remove bold|not bold|normal weight/.test(lower);
  const wantsUnitalic = /remove italic|not italic|normal style/.test(lower);
  const boldValue = wantsBold ? true : wantsUnbold ? false : undefined;
  const italicValue = wantsItalic ? true : wantsUnitalic ? false : undefined;
  const operations: EditorOp[] = [];

  if (!isTitleScoped && isSubtitleOnlyRequest(message)) {
    const currentSubtitle = normalizeLayoutText(context?.subtitle || '');
    const editedSubtitle = normalizeLayoutText(deriveSubtitleEditText(message, currentSubtitle));
    if (editedSubtitle !== currentSubtitle || editedSubtitle === '') {
      return {
        actionType: 'edit_section',
        actionData: {
          sectionId: 'subtitle',
          originalText: currentSubtitle,
          editedText: editedSubtitle,
          explanation: 'Applied the requested update to the subtitle only.',
        },
      };
    }
  }

  const pushOp = (op: EditorOp) => {
    const key = JSON.stringify(op);
    const exists = operations.some((x) => JSON.stringify(x) === key);
    if (!exists) operations.push(op);
  };

  const insertImageMatch = message.match(
    /(?:add|insert|include)\s+(?:an?\s+)?(?:new\s+)?(?:image|photo|visual)(?:\s+after)?(?:\s+this\s+(?:section|paragraph|block|image))?/i
  );
  if (insertImageMatch && !isTitleScoped) {
    const target = targetSectionId || targetImageSectionId;
    const captionMatch = message.match(/(?:caption|with)\s+"?([^"\n]+)"?/i);
    const description = stripHtmlAndCode(captionMatch?.[1] || message);
    pushOp({
      op: 'insert_image_after',
      ...(target ? { afterSectionId: target } : {}),
      text: description,
      caption: normalizeLayoutText(description).slice(0, 160),
      url: stripHtmlAndCode(imageUrlMatch?.[0] || defaultImageUrl(description)),
    });
  }

  if (/(change|update|replace).*(image|photo|visual)/.test(lower) && !isTitleScoped) {
    const imageSectionId =
      (activeSection?.type === 'image' ? activeSection.id : undefined) ||
      targetImageSectionId ||
      context?.sections.find((s) => s.type === 'image')?.id;
    if (imageSectionId) {
      const captionMatch = message.match(/(?:caption|to)\s+"?([^"\n]+)"?/i);
      const caption = normalizeLayoutText(captionMatch?.[1] || message);
      pushOp({
        op: 'replace_image',
        sectionId: imageSectionId,
        caption: caption.slice(0, 180),
        text: caption,
        ...(imageUrlMatch?.[0] ? { url: stripHtmlAndCode(imageUrlMatch[0]) } : {}),
      });
    }
  }

  const renameMatch = message.match(/(?:rename|change)\s+(?:the\s+)?title\s+(?:to|as)\s+"?([^"\n]+)"?/i);
  if (renameMatch?.[1]) {
    pushOp({ op: 'rename_title', text: stripHtmlAndCode(renameMatch[1]) });
  }

  if (lower.includes('title') && (typeof boldValue === 'boolean' || typeof italicValue === 'boolean' || !!color)) {
    pushOp({
      op: 'style_title',
      ...(typeof boldValue === 'boolean' ? { bold: boldValue } : {}),
      ...(typeof italicValue === 'boolean' ? { italic: italicValue } : {}),
      ...(color ? { color } : {}),
    });
  }

  const wantsDeleteSection = /(remove|delete)\s+(this\s+)?(paragraph|section|block|line)/.test(lower);
  if (!isTitleScoped && /(remove|delete)\s+(this\s+)?(paragraph|section|block|line)/.test(lower) && targetSectionId) {
    pushOp({ op: 'delete_section', sectionId: targetSectionId });
  }

  const hasReplaceIntent = /\b(replace|rewrite|rewritten|reword|reworded)\b/.test(lower);
  const genericRewriteIntent =
    /\b(rewrite|rewritten|reword|reworded|polish|polished|refine|refined|improve|improved|shorten|expand|simplify|formal|professional|casual|grammar|correct)\b/.test(
      lower
    );
  const quotedSnippets = extractQuotedSnippets(message);
  const explicitTargetSnippet = quotedSnippets.length >= 2 ? quotedSnippets[0] : undefined;
  const explicitReplacement = quotedSnippets.length >= 2 ? quotedSnippets[1] : undefined;
  const replacementFromWith = hasReplaceIntent
    ? message.match(/(?:replace|rewrite)\b[\s\S]{0,260}?\bwith\s+"?([^"\n]+)"?/i)?.[1]
    : undefined;
  const replacementText = hasReplaceIntent
    ? normalizeReplaceSectionText(explicitReplacement || replacementFromWith || '')
    : '';
  const replaceTargetBySnippet = hasReplaceIntent
    ? findSectionIdBySnippet(explicitTargetSnippet, context, { preferImage: false })
    : undefined;
  const replaceTargetSectionId = replaceTargetBySnippet || targetSectionId;

  if (hasReplaceIntent && replacementText && isTitleScoped && !wantsDeleteSection) {
    pushOp({
      op: 'rename_title',
      text: replacementText,
    });
  } else if (hasReplaceIntent && replacementText && replaceTargetSectionId && !wantsDeleteSection) {
    pushOp({
      op: 'replace_section_text',
      sectionId: replaceTargetSectionId,
      text: replacementText,
    });
  }

  if (genericRewriteIntent && !replacementText && !wantsDeleteSection) {
    if (isTitleScoped) {
      const sourceText = normalizeLayoutText(context?.selectedText || context?.title || '');
      const rewritten = buildRewriteFallbackText(sourceText, lower);
      if (rewritten) {
        pushOp({
          op: 'rename_title',
          text: rewritten,
        });
      }
    } else if (replaceTargetSectionId) {
      const sourceSection = context?.sections.find((s) => s.id === replaceTargetSectionId);
      const sourceText = normalizeLayoutText(
        context?.selectedText || sectionDisplayText(sourceSection)
      );
      const rewritten = buildRewriteFallbackText(sourceText, lower);
      if (rewritten) {
        pushOp({
          op: 'replace_section_text',
          sectionId: replaceTargetSectionId,
          text: rewritten,
        });
      }
    }
  }

  if (
    (typeof boldValue === 'boolean' || typeof italicValue === 'boolean' || !!color) &&
    targetSectionId &&
    !wantsDeleteSection &&
    !isTitleScoped
  ) {
    const titleOnly = lower.includes('title') && !/(section|paragraph|block|this)/.test(lower);
    if (!titleOnly) {
      pushOp({
        op: 'style_section',
        sectionId: targetSectionId,
        ...(typeof boldValue === 'boolean' ? { bold: boldValue } : {}),
        ...(typeof italicValue === 'boolean' ? { italic: italicValue } : {}),
        ...(color ? { color } : {}),
      });
    }
  }

  if (operations.length > 0) {
    return {
      actionType: 'editor_ops',
      actionData: {
        operations,
        explanation: 'Prepared updates from your instruction.',
      },
    };
  }

  return null;
}

function isLikelyQuestionOnly(message: string): boolean {
  const clean = stripHtmlAndCode(message).trim().toLowerCase();
  if (!clean) return false;
  if (!clean.includes('?')) return false;
  const editSignals =
    /\b(rewrite|replace|edit|change|update|remove|delete|bold|italic|color|style|make|shorten|expand|improve|add)\b/.test(
      clean
    );
  const questionLead = /^(what|why|how|when|where|which|who|can|could|should|would|is|are|do|does)\b/.test(clean);
  return questionLead && !editSignals;
}

function inferScopedSelectionAction(
  message: string,
  context?: SanitizedContext
): { actionType: ActionKind; actionData?: Record<string, unknown>; message?: string } | null {
  if (!context?.selectedField) return null;

  const clean = stripHtmlAndCode(message);
  const lower = clean.toLowerCase();
  if (isLikelyQuestionOnly(clean)) {
    return null;
  }

  const selectedText = normalizeLayoutText(context.selectedText || '');
  const colorMatch = clean.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  const imageUrlMatch = clean.match(/https?:\/\/\S+/i);
  const namedColor = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'gray', 'grey']
    .find((name) => new RegExp(`\\b${name}\\b`, 'i').test(clean));
  const color = sanitizeColor(colorMatch ? colorMatch[0] : namedColor);
  const wantsBold = /\bbold\b/.test(lower) && !/\bunbold\b|remove bold|not bold|normal weight/.test(lower);
  const wantsItalic = /\bitalic\b/.test(lower) && !/remove italic|not italic|normal style/.test(lower);
  const wantsUnbold = /\bunbold\b|remove bold|not bold|normal weight/.test(lower);
  const wantsUnitalic = /remove italic|not italic|normal style/.test(lower);
  const boldValue = wantsBold ? true : wantsUnbold ? false : undefined;
  const italicValue = wantsItalic ? true : wantsUnitalic ? false : undefined;
  const hasStyleIntent = typeof boldValue === 'boolean' || typeof italicValue === 'boolean' || Boolean(color);
  const rewriteIntent =
    /\b(rewrite|reword|paraphrase|shorten|concise|expand|elaborate|simplify|formal|professional|casual|improve|polish|refine|grammar|correct)\b/.test(
      lower
    );
  const removeIntent =
    /\b(remove|delete|erase|clear)\b/.test(lower) &&
    !/\b(remove|delete|clear)\s+(?:the\s+)?(?:bold|italic|color|colour|style|format(?:ting)?|highlight)\b/.test(
      lower
    );
  const replaceIntent = /\b(replace|change|update|set)\b/.test(lower);
  const styleCommandIntent =
    hasStyleIntent &&
    /\b(color|colour|bold|italic|style|font)\b/.test(lower) &&
    !/\b(rewrite|reword|paraphrase|shorten|expand|simplify|improve|polish|refine|grammar|correct)\b/.test(lower);
  const styleOnlyIntent = styleCommandIntent && !rewriteIntent && !removeIntent;
  const quotedSnippets = extractQuotedSnippets(clean);
  const explicitReplacement =
    quotedSnippets.length >= 2
      ? quotedSnippets[1]
      : replaceIntent
        ? clean.match(/(?:replace|change|update|set)\b[\s\S]{0,260}?\b(?:with|to|as)\s+["']([^"'\n]+)["']/i)?.[1]
        : undefined;
  const replacementText = styleOnlyIntent ? '' : normalizeReplaceSectionText(explicitReplacement || '');
  const operations: EditorOp[] = [];

  const pushUnique = (op: EditorOp) => {
    const exists = operations.some((x) => JSON.stringify(x) === JSON.stringify(op));
    if (!exists) operations.push(op);
  };

  if (context.selectedField === 'title') {
    if (hasStyleIntent) {
      pushUnique({
        op: 'style_title',
        ...(typeof boldValue === 'boolean' ? { bold: boldValue } : {}),
        ...(typeof italicValue === 'boolean' ? { italic: italicValue } : {}),
        ...(color ? { color } : {}),
        ...(selectedText ? { selectedText } : {}),
      });
    }

    if (removeIntent && /\btitle\b/.test(lower)) {
      pushUnique({
        op: 'rename_title',
        text: '',
        ...(selectedText ? { selectedText } : {}),
      });
    } else if (replacementText) {
      pushUnique({
        op: 'rename_title',
        text: replacementText,
        ...(selectedText ? { selectedText } : {}),
      });
    } else if (rewriteIntent && !styleOnlyIntent) {
      const sourceText = normalizeLayoutText(selectedText || context.title || '');
      const rewritten = buildRewriteFallbackText(sourceText, lower);
      if (rewritten) {
        pushUnique({
          op: 'rename_title',
          text: rewritten,
          ...(selectedText ? { selectedText } : {}),
        });
      }
    }

    if (operations.length === 0) return null;
    return {
      actionType: 'editor_ops',
      actionData: {
        operations,
        explanation: 'Prepared a strictly scoped update for the selected title field.',
      },
      message: 'Prepared a scoped update for the selected title field.',
    };
  }

  const scopedSectionId =
    stripHtmlAndCode(context.activeSectionId) ||
    findSectionIdBySnippet(selectedText, context, { preferImage: false }) ||
    findSectionIdBySnippet(selectedText, context, { preferImage: true }) ||
    '';
  if (!scopedSectionId) return null;

  const scopedSection = context.sections.find((s) => s.id === scopedSectionId);
  const scopedIsImage = scopedSection?.type === 'image';

  if (hasStyleIntent) {
    pushUnique({
      op: 'style_section',
      sectionId: scopedSectionId,
      ...(typeof boldValue === 'boolean' ? { bold: boldValue } : {}),
      ...(typeof italicValue === 'boolean' ? { italic: italicValue } : {}),
      ...(color ? { color } : {}),
      ...(selectedText ? { selectedText } : {}),
    });
  }

  if (removeIntent) {
    if (selectedText) {
      pushUnique({
        op: 'delete_section',
        sectionId: scopedSectionId,
        selectedText,
      });
    } else {
      pushUnique({
        op: 'delete_section',
        sectionId: scopedSectionId,
      });
    }
  } else if (scopedIsImage && /\b(image|photo|caption|url|replace image|change image)\b/.test(lower)) {
    const captionRaw =
      clean.match(/(?:caption|to|as)\s+"?([^"\n]+)"?/i)?.[1] ||
      replacementText ||
      normalizeLayoutText(selectedText || scopedSection?.caption || scopedSection?.text || '');
    const caption = normalizeLayoutText(captionRaw).slice(0, 180);
    pushUnique({
      op: 'replace_image',
      sectionId: scopedSectionId,
      text: caption || 'Image',
      caption: caption || 'Image',
      ...(imageUrlMatch?.[0] ? { url: stripHtmlAndCode(imageUrlMatch[0]) } : {}),
      ...(selectedText ? { selectedText } : {}),
    });
  } else if (replacementText) {
    pushUnique({
      op: 'replace_section_text',
      sectionId: scopedSectionId,
      text: replacementText,
      ...(selectedText ? { selectedText } : {}),
    });
  } else if (rewriteIntent && !styleOnlyIntent) {
    const sourceText = normalizeLayoutText(selectedText || sectionDisplayText(scopedSection));
    const rewritten = buildRewriteFallbackText(sourceText, lower);
    if (rewritten) {
      pushUnique({
        op: 'replace_section_text',
        sectionId: scopedSectionId,
        text: rewritten,
        ...(selectedText ? { selectedText } : {}),
      });
    }
  }

  if (operations.length === 0) return null;
  return {
    actionType: 'editor_ops',
    actionData: {
      operations,
      explanation: 'Prepared a strictly scoped update for the selected editor field.',
    },
    message: 'Prepared a scoped update for the selected editor field.',
  };
}

function hasStrictSelectionScope(context?: SanitizedContext): boolean {
  if (!context?.selectedField) return false;
  if (context.selectedField === 'title') return true;
  return Boolean(
    context.activeSectionId ||
      findSectionIdBySnippet(context.selectedText, context, { preferImage: false }) ||
      findSectionIdBySnippet(context.selectedText, context, { preferImage: true })
  );
}

function enforceSelectedScope(
  actionType: ActionKind,
  actionData: Record<string, unknown> | undefined,
  context?: SanitizedContext
): { actionType: ActionKind; actionData?: Record<string, unknown> } {
  if (!context || !hasStrictSelectionScope(context)) {
    return { actionType, actionData };
  }

  const explanationSuffix = 'Scoped strictly to the currently selected editor area.';
  const scopedSelectedText = normalizeLayoutText(context.selectedText || '');

  if (actionType === 'replace_all') {
    return {
      actionType: 'none',
      actionData: undefined,
    };
  }

  if (context.selectedField === 'title') {
    if (actionType === 'edit_section') {
      const editedText = normalizeLayoutText(actionData?.editedText);
      if (!editedText) return { actionType: 'none', actionData: undefined };
      return {
        actionType: 'editor_ops',
        actionData: {
          operations: [
            {
              op: 'rename_title',
              text: editedText,
              ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
            },
          ],
          explanation:
            normalizeLayoutText(actionData?.explanation) || explanationSuffix,
        },
      };
    }

    if (actionType === 'editor_ops') {
      const rawOps = Array.isArray(actionData?.operations) ? (actionData.operations as any[]) : [];
      const incoming = coerceEditorOps(rawOps);
      const scoped: EditorOp[] = [];

      for (const op of incoming) {
        if (op.op === 'style_title' || op.op === 'rename_title') {
          scoped.push({
            ...op,
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          });
          continue;
        }
        if (op.op === 'replace_section_text' && op.text) {
          scoped.push({
            op: 'rename_title',
            text: op.text,
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          });
          continue;
        }
        if (op.op === 'style_section') {
          scoped.push({
            op: 'style_title',
            ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
            ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
            ...(op.color ? { color: op.color } : {}),
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          });
        }
      }

      const deduped = dedupeEditorOps(scoped);
      if (deduped.length === 0) {
        return { actionType: 'none', actionData: undefined };
      }
      return {
        actionType: 'editor_ops',
        actionData: {
          ...actionData,
          operations: deduped,
          explanation:
            normalizeLayoutText(actionData?.explanation) || explanationSuffix,
        },
      };
    }

    return { actionType, actionData };
  }

  // selectedField === 'section'
  const scopedSectionId =
    stripHtmlAndCode(context.activeSectionId) ||
    findSectionIdBySnippet(scopedSelectedText, context, { preferImage: false }) ||
    findSectionIdBySnippet(scopedSelectedText, context, { preferImage: true }) ||
    '';
  if (!scopedSectionId) {
    return { actionType: 'none', actionData: undefined };
  }
  const scopedSection = context.sections.find((s) => s.id === scopedSectionId);
  const scopedIsImage = scopedSection?.type === 'image';

  if (actionType === 'edit_section') {
    const editedText = normalizeLayoutText(actionData?.editedText);
    if (!editedText) return { actionType: 'none', actionData: undefined };
    if (scopedIsImage) {
      return {
        actionType: 'editor_ops',
        actionData: {
          operations: [
            {
              op: 'replace_image',
              sectionId: scopedSectionId,
              text: editedText,
              caption: editedText,
              ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
            },
          ],
          explanation:
            normalizeLayoutText(actionData?.explanation) || explanationSuffix,
        },
      };
    }
    return {
      actionType: 'editor_ops',
      actionData: {
        operations: [
          {
            op: 'replace_section_text',
            sectionId: scopedSectionId,
            text: editedText,
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          },
        ],
        explanation:
          normalizeLayoutText(actionData?.explanation) || explanationSuffix,
      },
    };
  }

  if (actionType === 'editor_ops') {
    const rawOps = Array.isArray(actionData?.operations) ? (actionData.operations as any[]) : [];
    const scoped = coerceEditorOps(rawOps)
      .filter((op) => op.op !== 'style_title' && op.op !== 'rename_title')
      .map((op) => {
        if (op.op === 'replace_image') {
          if (!scopedIsImage) {
            return null;
          }
          return {
            ...op,
            sectionId: scopedSectionId,
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          };
        }
        if (scopedSelectedText && op.op === 'insert_image_after') {
          return null;
        }
        if (scopedSelectedText && op.op === 'delete_section') {
          return {
            op: 'delete_section',
            sectionId: scopedSectionId,
            selectedText: scopedSelectedText,
          } as EditorOp;
        }
        if (op.op === 'insert_image_after') {
          return {
            ...op,
            afterSectionId: scopedSectionId,
            sectionId: undefined,
            ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
          };
        }
        return {
          ...op,
          sectionId: scopedSectionId,
          ...(scopedSelectedText ? { selectedText: scopedSelectedText } : {}),
        };
      })
      .filter(Boolean) as EditorOp[];
    const deduped = dedupeEditorOps(scoped);
    if (deduped.length === 0) {
      return { actionType: 'none', actionData: undefined };
    }
    return {
      actionType: 'editor_ops',
      actionData: {
        ...actionData,
        operations: deduped,
        explanation:
          normalizeLayoutText(actionData?.explanation) || explanationSuffix,
      },
    };
  }

  return { actionType, actionData };
}

function resolveSectionId(
  rawSectionId: unknown,
  message: string,
  context?: SanitizedContext,
  options?: { preferImage?: boolean; originalTextHint?: string }
): string | undefined {
  if (!context) return undefined;
  const incoming = stripHtmlAndCode(rawSectionId);
  if (incoming === 'title' || incoming === 'subtitle') {
    return incoming;
  }
  if (incoming && context.sections.some((s) => s.id === incoming)) {
    return incoming;
  }
  const byHint = findSectionIdBySnippet(options?.originalTextHint, context, options);
  if (byHint) return byHint;
  return chooseTargetSectionId(message, context, options);
}

function enforceSubtitleOnlyAction(
  actionType: ActionKind,
  actionData: Record<string, unknown> | undefined,
  message: string,
  context?: SanitizedContext
): { actionType: ActionKind; actionData?: Record<string, unknown> } {
  if (!context || !isSubtitleOnlyRequest(message)) {
    return { actionType, actionData };
  }
  if (hasStrictSelectionScope(context)) {
    return { actionType, actionData };
  }

  const currentSubtitle = normalizeLayoutText(context.subtitle || '');
  const editedSubtitle = normalizeLayoutText(deriveSubtitleEditText(message, currentSubtitle));

  const alreadySubtitleEdit =
    actionType === 'edit_section' &&
    stripHtmlAndCode(actionData?.sectionId) === 'subtitle' &&
    normalizeLayoutText(actionData?.editedText).length > 0;
  if (alreadySubtitleEdit) {
    return {
      actionType,
      actionData: {
        ...actionData,
        sectionId: 'subtitle',
        originalText: currentSubtitle,
      },
    };
  }

  return {
    actionType: 'edit_section',
    actionData: {
      sectionId: 'subtitle',
      originalText: currentSubtitle,
      editedText: editedSubtitle,
      explanation:
        normalizeLayoutText(actionData?.explanation) || 'Applied the requested update to the subtitle only.',
    },
  };
}

function enforceNumberedListIntent(
  actionType: ActionKind,
  actionData: Record<string, unknown> | undefined,
  message: string
): { actionType: ActionKind; actionData?: Record<string, unknown> } {
  if (!actionData || (actionType !== 'editor_ops' && actionType !== 'edit_section')) {
    return { actionType, actionData };
  }

  const lower = stripHtmlAndCode(message).toLowerCase();
  const requestsNumberedList =
    /\b(numbered list|numbered|1\s*(?:to|-)\s*\d+|checklist)\b/.test(lower) &&
    /\b(point|item|list)\b/.test(lower);
  if (!requestsNumberedList) {
    return { actionType, actionData };
  }

  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const explicitCount =
    Number(lower.match(/\b(\d+)\s*(?:point|points|item|items)\b/)?.[1] || 0) ||
    wordToNumber[lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:point|points|item|items)\b/)?.[1] || ''] ||
    0;

  const extractListLikeItems = (raw: unknown): string[] =>
    normalizeLayoutText(raw)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^common pitfalls and how to avoid them\b/i.test(line))
      .filter((line) => !/\bfocus on clear,\s*actionable outcomes\b/i.test(line))
      .map((line) =>
        line
          .replace(/^(\d+)[.)]\s+/, '')
          .replace(/^[-*]\s+/, '')
          .trim()
      )
      .filter(Boolean);

  const extractClauseItems = (raw: unknown): string[] => {
    const source = normalizeLayoutText(raw);
    if (!source) return [];
    return source
      .split(/(?:[.!?]\s+|;\s+|:\s+|\s+,(?=\s*(?:and|or|while|which|that)\b))/)
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter((part) => part.length >= 16)
      .filter((part) => !/^[A-Z][\w\s-]{0,36}$/.test(part));
  };

  const buildNumberedText = (
    primaryRaw: unknown,
    selectedRaw: unknown,
    preferredCount: number
  ): string | null => {
    const primaryItems = extractListLikeItems(primaryRaw);
    const selectedItems = extractListLikeItems(selectedRaw);
    const clauseItems = primaryItems.length >= 2 ? [] : extractClauseItems(primaryRaw);

    let items = primaryItems.length >= 2 ? primaryItems : clauseItems;
    if (items.length < 2 && selectedItems.length >= 2) {
      items = selectedItems;
    }
    if (items.length < 2) {
      return null;
    }

    const targetCount =
      preferredCount > 0
        ? preferredCount
        : selectedItems.length >= 2
          ? selectedItems.length
          : items.length;

    const merged: string[] = [];
    const pushUnique = (value: string) => {
      const clean = normalizeLayoutText(value);
      if (!clean) return;
      if (merged.some((entry) => normalizeLayoutText(entry) === clean)) return;
      merged.push(clean);
    };

    items.forEach(pushUnique);
    if (merged.length < targetCount) {
      selectedItems.forEach(pushUnique);
    }

    if (merged.length < 2) {
      return null;
    }

    const finalItems = merged.slice(0, Math.max(targetCount, 2));
    return finalItems.map((item, index) => `${index + 1}. ${item}`).join('\n');
  };

  if (actionType === 'edit_section') {
    const numbered = buildNumberedText(actionData.editedText, actionData.selectedText || actionData.originalText, explicitCount);
    if (!numbered) {
      return { actionType, actionData };
    }
    return {
      actionType,
      actionData: {
        ...actionData,
        editedText: numbered,
      },
    };
  }

  const rawOps = Array.isArray(actionData.operations) ? (actionData.operations as any[]) : [];
  const normalizedOps = coerceEditorOps(rawOps).map((op) => {
    if (op.op !== 'replace_section_text' || !op.text) return op;
    const numbered = buildNumberedText(op.text, op.selectedText, explicitCount);
    if (!numbered) return op;
    return { ...op, text: numbered };
  });

  let constrainedOps = dedupeEditorOps(normalizedOps);

  const replaceOps = constrainedOps.filter(
    (op) => op.op === 'replace_section_text' && stripHtmlAndCode(op.sectionId || '') && normalizeLayoutText(op.text || '')
  );
  const rewriteOnlyIntent =
    /\b(rewrite|rephrase|improve|refine|better|concise|concise|shorten)\b/.test(lower) &&
    !/\b(title|subtitle|image|caption|heading|h1|h2|h3|cover)\b/.test(lower);

  if (rewriteOnlyIntent && replaceOps.length >= 2) {
    const sectionCounts = new Map<string, number>();
    replaceOps.forEach((op) => {
      const key = stripHtmlAndCode(op.sectionId || '');
      if (!key) return;
      sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
    });
    const dominantEntry = Array.from(sectionCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    const dominantSectionId = dominantEntry?.[0] || '';
    const dominantCount = dominantEntry?.[1] || 0;
    const targetCount = Math.max(explicitCount || 0, 2);

    if (dominantSectionId && dominantCount >= Math.min(targetCount, 2)) {
      let seenDominantReplace = 0;
      constrainedOps = constrainedOps.filter((op) => {
        if (op.op === 'replace_section_text') {
          const key = stripHtmlAndCode(op.sectionId || '');
          if (key !== dominantSectionId) return false;
          seenDominantReplace += 1;
          return seenDominantReplace <= targetCount;
        }
        if (op.op === 'style_section') {
          const key = stripHtmlAndCode(op.sectionId || '');
          return !key || key === dominantSectionId;
        }
        return true;
      });
    }
  }

  return {
    actionType,
    actionData: {
      ...actionData,
      operations: constrainedOps,
    },
  };
}

function enrichActionWithContext(
  actionType: ActionKind,
  actionData: Record<string, unknown> | undefined,
  message: string,
  context?: SanitizedContext
): { actionType: ActionKind; actionData?: Record<string, unknown> } {
  if (!context || !actionData) return { actionType, actionData };

  if (actionType === 'edit_section') {
    const resolvedSectionId = resolveSectionId(
      actionData.sectionId,
      message,
      context,
      { originalTextHint: normalizeLayoutText(actionData.originalText) }
    );
    const targetSection = context.sections.find((s) => s.id === resolvedSectionId);
    const originalText =
      normalizeLayoutText(actionData.originalText) ||
      sectionDisplayText(targetSection);
    const selectedText =
      normalizeLayoutText(actionData.selectedText) ||
      (context.selectedField === 'section' ? normalizeLayoutText(context.selectedText || '') : '');
    if (!resolvedSectionId || !normalizeLayoutText(actionData.editedText)) {
      return { actionType: 'none', actionData: undefined };
    }
    return {
      actionType,
      actionData: {
        ...actionData,
        sectionId: resolvedSectionId,
        originalText: selectedText || originalText,
        ...(selectedText ? { selectedText } : {}),
      },
    };
  }

  if (actionType === 'editor_ops') {
    const rawOps = Array.isArray(actionData.operations) ? (actionData.operations as any[]) : [];
    const operations = coerceEditorOps(rawOps).map((op) => {
      if (op.op === 'style_title' || op.op === 'rename_title') return op;
      if (op.op === 'replace_image') {
        const sectionId =
          resolveSectionId(op.sectionId, message, context, { preferImage: true, originalTextHint: op.text || op.caption }) ||
          op.sectionId;
        return { ...op, ...(sectionId ? { sectionId } : {}) };
      }
      if (op.op === 'insert_image_after') {
        const afterSectionId =
          resolveSectionId(op.afterSectionId || op.sectionId, message, context, {
            preferImage: false,
            originalTextHint: op.text || op.caption,
          }) ||
          op.afterSectionId ||
          op.sectionId;
        return { ...op, ...(afterSectionId ? { afterSectionId } : {}) };
      }
      const sectionId =
        resolveSectionId(op.sectionId, message, context, {
          preferImage: false,
          originalTextHint: op.text,
        }) || op.sectionId;
      return { ...op, ...(sectionId ? { sectionId } : {}) };
    }).filter((op) => {
      if (op.op === 'style_title' || op.op === 'rename_title') return true;
      if (op.op === 'insert_image_after') return Boolean(op.afterSectionId || op.sectionId);
      return Boolean(op.sectionId);
    });

    const deduped = dedupeEditorOps(operations);
    const operationOriginals = deduped.map((op, opIndex) => {
      const targetSection = context.sections.find((s) => s.id === op.sectionId);
      const anchorSection = context.sections.find((s) => s.id === (op.afterSectionId || op.sectionId));
      return {
        opIndex,
        op: op.op,
        sectionId: op.sectionId,
        afterSectionId: op.afterSectionId,
        originalText: normalizeLayoutText(op.selectedText || '') || sectionDisplayText(targetSection),
        anchorOriginalText: sectionDisplayText(anchorSection),
      };
    });

    if (deduped.length === 0) {
      return { actionType: 'none', actionData: undefined };
    }

    return {
      actionType,
      actionData: {
        ...actionData,
        operations: deduped,
        operationOriginals,
      },
    };
  }

  return { actionType, actionData };
}

function sanitizeAction(parsed: any): { actionType: ActionKind; actionData?: Record<string, unknown> } {
  const actionType: ActionKind =
    parsed?.actionType === 'edit_section' || parsed?.actionType === 'replace_all' || parsed?.actionType === 'editor_ops'
      ? parsed.actionType
      : 'none';

  if (actionType === 'edit_section') {
    const sectionId = stripHtmlAndCode(parsed?.actionData?.sectionId);
    const editedText = normalizeLayoutText(parsed?.actionData?.editedText);
    const originalText = normalizeLayoutText(parsed?.actionData?.originalText);
    const selectedText = normalizeLayoutText(parsed?.actionData?.selectedText);
    if (!sectionId || !editedText) return { actionType: 'none' as ActionKind, actionData: undefined };
    return {
      actionType,
      actionData: {
        sectionId,
        originalText,
        editedText,
        ...(selectedText ? { selectedText } : {}),
        explanation: normalizeLayoutText(parsed?.actionData?.explanation),
      },
    };
  }

  if (actionType === 'replace_all') {
    const sectionsRaw = Array.isArray(parsed?.actionData?.sections) ? parsed.actionData.sections : [];
    const sections = sectionsRaw.map((s: any, idx: number) =>
      sanitizeSectionShape(s, s?.id || `sec-${idx}`)
    );
    if (sections.length === 0) return { actionType: 'none' as ActionKind, actionData: undefined };
    return {
      actionType,
      actionData: {
        title: normalizeLayoutText(parsed?.actionData?.title),
        sections,
        explanation: normalizeLayoutText(parsed?.actionData?.explanation),
      },
    };
  }

  if (actionType === 'editor_ops') {
    const rawOps = Array.isArray(parsed?.actionData?.operations) ? parsed.actionData.operations : [];
    const operations = coerceEditorOps(rawOps);
    if (operations.length === 0) return { actionType: 'none' as ActionKind, actionData: undefined };
    return {
      actionType,
      actionData: {
        operations,
        explanation: normalizeLayoutText(parsed?.actionData?.explanation),
      },
    };
  }

  return { actionType: 'none', actionData: undefined };
}

export async function processChat(
  threadMessages: ChatMessage[],
  newMessage: string,
  blogContext?: {
    title: string;
    subtitle?: string;
    tone: string;
    audience: string;
    sections: BlogSection[];
    activeSectionId?: string;
    selectedText?: string;
    selectedField?: 'title' | 'section';
  },
  userId?: string,
  blogId?: string
): Promise<ChatAssistantResponse> {
  const cleanContext = sanitizeContext(blogContext);
  const cleanUserMessage = stripHtmlAndCode(newMessage);
  const isComplexInstruction = isLikelyComplexInstruction(cleanUserMessage);
  const contextPlan = buildPromptContextPlan(cleanContext, cleanUserMessage, isComplexInstruction);
  const promptContext = contextPlan.promptContext || cleanContext;
  const scopedFallbackCandidate = hasStrictSelectionScope(cleanContext)
    ? inferScopedSelectionAction(cleanUserMessage, cleanContext)
    : null;
  const fallbackCandidate = scopedFallbackCandidate || inferFallbackAction(cleanUserMessage, cleanContext);

  const ambiguityGuard = detectAmbiguousPromptTarget(cleanUserMessage, cleanContext);
  if (ambiguityGuard) {
    const ambiguityMeta: ChatAssistantResponse['meta'] = {
      tokenUsage: {
        totalTokens: 0,
      },
      contextPlan: {
        mode: contextPlan.mode,
        reason: 'needs_disambiguation',
        totalSections: contextPlan.totalSections,
        promptSections: contextPlan.promptSections,
      },
      model: 'clarification_guard',
      latencyMs: 0,
    };
    const optionsPreview = ambiguityGuard.options
      .slice(0, 3)
      .map((option) => `${option.occurrence}. ${option.previewText.slice(0, 90)}`)
      .join(' | ');
    const clarificationMessage = `I found ${ambiguityGuard.options.length} matching areas for "${ambiguityGuard.snippet}". Choose the exact occurrence to edit, then I will apply your prompt only there.${optionsPreview ? ` Matches: ${optionsPreview}` : ''}`;
    return buildFallbackResponse(
      {
        actionType: 'none',
        actionData: {
          __meta: {
            needsDisambiguation: true,
            ambiguityType: 'multiple_matches',
            snippet: ambiguityGuard.snippet,
            prompt: ambiguityGuard.prompt,
            options: ambiguityGuard.options,
          },
        },
        message: clarificationMessage,
      },
      ambiguityMeta
    );
  }

  const ai = getAIProvider();
  const isPackedMode = contextPlan.mode !== 'full';
  const threadMemory = buildThreadMemory(threadMessages, promptContext, {
    maxChars: isPackedMode ? 1200 : 2200,
    recentPrompts: isPackedMode ? 4 : 6,
    recentActions: isPackedMode ? 4 : 6,
    recentAppliedChanges: isPackedMode ? 2 : 4,
  });
  const systemPrompt = buildChatAssistantPrompt(promptContext, threadMemory);
  const model = config.ai.modelChat;

  const messages: AIMessage[] = [{ role: 'system', content: systemPrompt }];

  const historyLimit = contextPlan.mode === 'full' ? 26 : 10;
  const recent = threadMessages.slice(-historyLimit);
  for (const msg of recent) {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: stripHtmlAndCode(msg.text),
    });
  }

  messages.push({ role: 'user', content: cleanUserMessage });

  const startTime = Date.now();
  let result;
  let lastError: any;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = await ai.complete(messages, {
        model,
        temperature: 0.2,
        maxTokens: 4096,
        responseFormat: 'json',
      });
      lastError = undefined;
      break;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }

  if (!result) {
    const fallbackMeta: ChatAssistantResponse['meta'] = {
      tokenUsage: {
        totalTokens: 0,
      },
      contextPlan: {
        mode: contextPlan.mode,
        reason: contextPlan.reason,
        totalSections: contextPlan.totalSections,
        promptSections: contextPlan.promptSections,
      },
      model,
      latencyMs: Date.now() - startTime,
    };
    await logPrompt({
      userId,
      blogId,
      endpoint: 'chat_assistant',
      userPrompt: cleanUserMessage,
      systemPrompt,
      model,
      tokensUsed: 0,
      latencyMs: Date.now() - startTime,
      status: 'error',
      response: lastError?.message || 'unknown chat completion error',
    });
    if (fallbackCandidate) {
      const scopedFallback = enforceSelectedScope(
        fallbackCandidate.actionType,
        fallbackCandidate.actionData,
        cleanContext
      );
      return buildFallbackResponse({
        ...fallbackCandidate,
        actionType: scopedFallback.actionType,
        actionData: scopedFallback.actionData,
        message:
          fallbackCandidate.message ||
          (hasStrictSelectionScope(cleanContext)
            ? 'Prepared a scoped update for your selected editor area.'
            : undefined),
      }, fallbackMeta);
    }
    return buildFallbackResponse({
      actionType: 'none',
      actionData: undefined,
      message:
        'I could not complete this edit request right now. Please retry once, and I will apply your exact requested changes.',
    }, fallbackMeta);
  }

  const latencyMs = Date.now() - startTime;

  await logPrompt({
    userId,
    blogId,
    endpoint: 'chat_assistant',
    userPrompt: cleanUserMessage,
    systemPrompt: systemPrompt.slice(0, 500),
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
    parsed = {
      message: result.content,
      actionType: 'none',
      actionData: null,
    };
  }

  let { actionType, actionData } = sanitizeAction(parsed);
  const fallbackSanitized =
    fallbackCandidate?.actionType === 'editor_ops' &&
    Array.isArray(fallbackCandidate.actionData?.operations)
      ? dedupeEditorOps(
          coerceEditorOps(fallbackCandidate.actionData.operations as any[])
        )
      : [];

  if (actionType === 'none' && fallbackCandidate) {
    actionType = fallbackCandidate.actionType;
    actionData = fallbackCandidate.actionData;
    parsed.message = fallbackCandidate.message || parsed.message;
  }

  if (fallbackSanitized.length > 0) {
    if (actionType === 'editor_ops') {
      const currentOps = coerceEditorOps(
        Array.isArray((actionData as any)?.operations) ? ((actionData as any).operations as any[]) : []
      );
      const operations = dedupeEditorOps([...currentOps, ...fallbackSanitized]);
      actionData = {
        ...(actionData || {}),
        operations,
        explanation:
          normalizeLayoutText((actionData as any)?.explanation) ||
          'Prepared updates from your instruction.',
      };
      actionType = 'editor_ops';
    } else if (actionType === 'edit_section') {
      const sectionId = stripHtmlAndCode((actionData as any)?.sectionId);
      const editedText = normalizeLayoutText((actionData as any)?.editedText);
      const editOp: EditorOp | null =
        sectionId && editedText
          ? {
              op: 'replace_section_text',
              sectionId,
              text: editedText,
            }
          : null;
      const operations = dedupeEditorOps([
        ...(editOp ? [editOp] : []),
        ...fallbackSanitized,
      ]);
      if (operations.length > 0) {
        actionType = 'editor_ops';
        actionData = {
          operations,
          explanation:
            normalizeLayoutText((actionData as any)?.explanation) ||
            'Prepared updates from your instruction.',
        };
      }
    } else if (actionType === 'replace_all') {
      actionType = 'editor_ops';
      actionData = {
        operations: fallbackSanitized,
        explanation:
          normalizeLayoutText((actionData as any)?.explanation) ||
          'Prepared updates from your instruction.',
      };
    } else if (actionType === 'none' && isComplexInstruction) {
      actionType = 'editor_ops';
      actionData = {
        operations: fallbackSanitized,
        explanation: 'Prepared updates from your instruction.',
      };
    }
  }

  const enriched = enrichActionWithContext(
    actionType,
    actionData,
    cleanUserMessage,
    cleanContext
  );
  actionType = enriched.actionType;
  actionData = enriched.actionData;

  const scoped = enforceSelectedScope(actionType, actionData, cleanContext);
  actionType = scoped.actionType;
  actionData = scoped.actionData;

  const subtitleScoped = enforceSubtitleOnlyAction(actionType, actionData, cleanUserMessage, cleanContext);
  actionType = subtitleScoped.actionType;
  actionData = subtitleScoped.actionData;

  const listScoped = enforceNumberedListIntent(actionType, actionData, cleanUserMessage);
  actionType = listScoped.actionType;
  actionData = listScoped.actionData;

  if (actionType === 'editor_ops' && actionData) {
    const operations = Array.isArray((actionData as any).operations)
      ? coerceEditorOps((actionData as any).operations as any[])
      : [];
    const currentOriginals = Array.isArray((actionData as any).operationOriginals)
      ? ((actionData as any).operationOriginals as any[])
      : [];
    if (operations.length > 0 && currentOriginals.length !== operations.length) {
      (actionData as any).operationOriginals = operations.map((op, opIndex) => ({
        opIndex,
        op: op.op,
        sectionId: op.sectionId,
        afterSectionId: op.afterSectionId,
        originalText: '',
        anchorOriginalText: '',
      }));
    }
  }

  const scopedFallbackMessage =
    hasStrictSelectionScope(cleanContext) && actionType === 'none'
      ? 'I could not map that instruction to the selected editor area. Select the exact title/section and try again.'
      : '';
  const responseText = stripHtmlAndCode(parsed?.message || result.content || scopedFallbackMessage).trim();
  const hasAction = actionType === 'edit_section' || actionType === 'replace_all' || actionType === 'editor_ops';
  const promptTokens =
    Number.isFinite(result.promptTokens as number) && (result.promptTokens as number) > 0
      ? Number(result.promptTokens)
      : undefined;
  const completionTokens =
    Number.isFinite(result.completionTokens as number) && (result.completionTokens as number) > 0
      ? Number(result.completionTokens)
      : undefined;
  const totalTokens = Number.isFinite(result.tokensUsed) ? Math.max(0, Number(result.tokensUsed)) : 0;

  return {
    message: {
      id: `ai-${Date.now()}`,
      threadId: '',
      sender: 'assistant',
      text: responseText,
      showDiffCard: hasAction,
      actionType: hasAction ? actionType : undefined,
      actionData: actionData || undefined,
      createdAt: new Date().toISOString(),
    },
    actionType,
    actionData,
    meta: {
      tokenUsage: {
        totalTokens,
        ...(promptTokens ? { promptTokens } : {}),
        ...(completionTokens ? { completionTokens } : {}),
      },
      contextPlan: {
        mode: contextPlan.mode,
        reason: contextPlan.reason,
        totalSections: contextPlan.totalSections,
        promptSections: contextPlan.promptSections,
      },
      model: result.model,
      latencyMs,
    },
  };
}
