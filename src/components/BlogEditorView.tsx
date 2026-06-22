import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as Icons from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Blockquote from '@tiptap/extension-blockquote';
import Image from '@tiptap/extension-image';
import type { Blog, BlogSection } from './MockData';
import { blogService } from '../services/blogService';
import { chatService } from '../services/chatService';

interface BlogEditorViewProps {
  blog: Blog;
  onBack: () => void;
  onUpdateBlog: (updatedBlog: Blog) => void;
  isDarkSidebar: boolean;
  onToggleSidebarTheme: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
  createdAt?: string;
  showDiffCard?: boolean;
  actionType?: string;
  actionData?: any;
}

interface TitleStyleState {
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

interface EditorOp {
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
}

interface DiffCardContent {
  originalText: string;
  suggestedText: string;
  explanation: string;
  suggestedStyle?: TitleStyleState;
}

interface OperationOriginalSnapshot {
  opIndex?: number;
  op?: string;
  sectionId?: string;
  afterSectionId?: string;
  originalText?: string;
  anchorOriginalText?: string;
}

interface SectionVersionItem {
  id: string;
  sectionId: string;
  blogId: string;
  originalText: string;
  editedText: string;
  explanation?: string;
  diffSummary?: string;
  promptUsed?: string;
  modelUsed?: string;
  isApplied?: boolean;
  createdAt: string;
}

interface HistoryDiffPreviewItem {
  message: ChatMessage;
  diff: DiffCardContent;
  sectionTypeHint: BlogSection['type'];
}

interface SelectedEditorScope {
  field: 'title' | 'section' | null;
  sectionId: string | null;
  text: string;
}

const preserveHtmlListMarkers = (value: string): string => {
  if (!value || !/[<](ol|ul|li|\/li)[^>]*>/i.test(value)) return value;

  let text = value;

  text = text.replace(/<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi, (_match, attrs, inner) => {
    const startMatch = String(attrs || '').match(/\bstart\s*=\s*["']?(\d+)/i);
    let index = startMatch ? Number(startMatch[1]) : 1;
    if (!Number.isFinite(index) || index <= 0) index = 1;
    const items = String(inner || '').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    if (items.length === 0) return '\n';
    const converted = items
      .map((rawItem) => {
        const content = rawItem
          .replace(/<\/?li\b[^>]*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!content) return '';
        const line = `${index}. ${content}`;
        index += 1;
        return line;
      })
      .filter(Boolean);
    return converted.length > 0 ? `\n${converted.join('\n')}\n` : '\n';
  });

  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner) => {
    const items = String(inner || '').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    if (items.length === 0) return '\n';
    const converted = items
      .map((rawItem) => {
        const content = rawItem
          .replace(/<\/?li\b[^>]*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return content ? `- ${content}` : '';
      })
      .filter(Boolean);
    return converted.length > 0 ? `\n${converted.join('\n')}\n` : '\n';
  });

  text = text
    .replace(/<\/li>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/blockquote>/gi, '\n');

  return text;
};

const sanitizePlainText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const cleaned = preserveHtmlListMarkers(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .trim();

  return cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
};

const sanitizeDisplayText = (value: unknown): string =>
  sanitizePlainText(value)
    .replace(/\bsec-[a-z0-9-]+\b/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeLayoutText = (value: unknown): string => {
  const text = sanitizePlainText(value);
  if (!text) return '';

  let normalized = text
    .replace(/\s+[\u2022\u00B7\u25AA]\s+/g, '\n- ')
    .replace(/\s+-\s+/g, '\n- ')
    .replace(/\s+\*\s+/g, '\n- ')
    .replace(/\s+(\d+)[.)]\s+/g, '\n$1. ');

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^[\u2022\u00B7\u25AA]\s+/, '- ')
        .replace(/^[-*]\s+/, '- ')
        .replace(/^(\d+)[)]\s+/, '$1. ')
        .replace(/\s+/g, ' ')
        .trim()
    );

  normalized = lines.join('\n');

  return normalized.trim();
};

type ParsedList =
  | { kind: 'ordered'; items: string[]; start: number }
  | { kind: 'bullet'; items: string[] };

type ContentBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'ordered'; items: string[]; start: number }
  | { kind: 'bullet'; items: string[] };

const parseListLines = (value: unknown): ParsedList | null => {
  const text = normalizeLayoutText(value);
  if (!text) return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const orderedMatches = lines.map((line) => line.match(/^(\d+)[.)]\s+(.+)$/));
  if (orderedMatches.every(Boolean)) {
    const first = Number(orderedMatches[0]?.[1] || '1');
    return {
      kind: 'ordered',
      start: Number.isFinite(first) && first > 0 ? first : 1,
      items: orderedMatches.map((match) => sanitizeDisplayText(match?.[2] || '')).filter(Boolean),
    };
  }

  const bulletMatches = lines.map((line) => line.match(/^[-*]\s+(.+)$/) || line.match(/^[\u2022\u00B7\u25AA]\s+(.+)$/));
  if (bulletMatches.every(Boolean)) {
    return {
      kind: 'bullet',
      items: bulletMatches.map((match) => sanitizeDisplayText(match?.[1] || '')).filter(Boolean),
    };
  }

  return null;
};

const parseContentBlocks = (value: unknown): ContentBlock[] => {
  const normalized = normalizeLayoutText(value);
  if (!normalized) return [];

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const orderedMatch = lines[i].match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedMatch) {
      const start = Number(orderedMatch[1]) || 1;
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^(\d+)[.)]\s+(.+)$/);
        if (!match) break;
        items.push(sanitizeDisplayText(match[2] || ''));
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ kind: 'ordered', start, items });
        continue;
      }
    }

    const bulletMatch = lines[i].match(/^[-*]\s+(.+)$/) || lines[i].match(/^[\u2022\u00B7\u25AA]\s+(.+)$/);
    if (bulletMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^[-*]\s+(.+)$/) || lines[i].match(/^[\u2022\u00B7\u25AA]\s+(.+)$/);
        if (!match) break;
        items.push(sanitizeDisplayText(match[1] || ''));
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ kind: 'bullet', items });
        continue;
      }
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const listLike =
        lines[i].match(/^(\d+)[.)]\s+(.+)$/) ||
        lines[i].match(/^[-*]\s+(.+)$/) ||
        lines[i].match(/^[\u2022\u00B7\u25AA]\s+(.+)$/);
      if (listLike) break;
      paragraphLines.push(lines[i]);
      i += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') });
    }
  }

  return blocks;
};

const coerceImplicitOrderedListText = (value: string): string => {
  const normalized = normalizeLayoutText(value);
  if (!normalized) return normalized;

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) return normalized;
  if (
    lines.some(
      (line) =>
        /^(\d+)[.)]\s+/.test(line) ||
        /^[-*]\s+/.test(line) ||
        /^[\u2022\u00B7\u25AA]\s+/.test(line)
    )
  ) {
    return normalized;
  }

  const looksShortAndTitleLike = lines.every((line) => line.length <= 120 && line.split(/\s+/).length <= 16);
  if (!looksShortAndTitleLike) return normalized;

  const titleLikeCount = lines.filter((line) => /^[A-Z0-9]/.test(line)).length;
  if (titleLikeCount < Math.ceil(lines.length * 0.7)) return normalized;

  const sentenceLikeCount = lines.filter((line) => /[,:;!?]/.test(line) || /\.$/.test(line)).length;
  if (sentenceLikeCount > Math.floor(lines.length / 3)) return normalized;

  return lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n');
};

const defaultImageUrl = (seedText: string): string => {
  const seed = encodeURIComponent(sanitizePlainText(seedText).slice(0, 120) || 'blog-image');
  return `https://picsum.photos/seed/${seed}/1280/720`;
};

const BLOCKED_IMAGE_HOSTS = new Set([
  'example.com',
  'www.example.com',
  'images.example.com',
]);

const normalizeEditorImageUrl = (value: unknown, fallbackSeed?: string): string => {
  if (typeof value !== 'string') {
    return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
  }

  let normalized = value.trim();
  if (!normalized) {
    return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
  }

  const markdownMatch = normalized.match(/^!\[[^\]]*]\(([^)]+)\)$/);
  if (markdownMatch?.[1]) {
    normalized = markdownMatch[1].trim();
  }

  normalized = normalized.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '').trim();
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  }

  if (!normalized) {
    return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const host = url.hostname.toLowerCase();
      if (BLOCKED_IMAGE_HOSTS.has(host)) {
        return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
      }
    } catch {
      return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
    }
    return normalized;
  }

  if (/^(data:image\/|\/|\.\/|\.\.\/)/i.test(normalized)) {
    return normalized;
  }

  return fallbackSeed ? defaultImageUrl(fallbackSeed) : '';
};

const applyImageElementFallback = (imgEl: HTMLImageElement) => {
  imgEl.onerror = () => {
    const seed = sanitizePlainText(
      imgEl.getAttribute('alt') || imgEl.getAttribute('id') || imgEl.getAttribute('data-id') || 'blog-image'
    );
    const fallback = defaultImageUrl(seed || 'blog-image');
    if (imgEl.getAttribute('src') !== fallback) {
      imgEl.setAttribute('src', fallback);
    }
    imgEl.onerror = null;
  };
};

const generateUuid = (): string => {
  const randomUUID = (globalThis as any)?.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call((globalThis as any).crypto);
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): boolean =>
  typeof value === 'string' && UUID_PATTERN.test(value.trim());

const escapeHtml = (value: unknown): string =>
  sanitizePlainText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textToHtml = (value: unknown): string =>
  escapeHtml(value)
    .split('\n')
    .map((line) => line.trim())
    .join('<br />');

const ensureStableSectionIds = (sections: BlogSection[]): BlogSection[] => {
  const seen = new Set<string>();
  return sections.map((sec) => {
    let nextId = sanitizePlainText(sec.id || '');
    if (!isUuid(nextId) || seen.has(nextId)) {
      nextId = generateUuid();
    }
    seen.add(nextId);
    return { ...sec, id: nextId };
  });
};

// Serialize blog sections to a single HTML document for TipTap
export const serializeSectionsToHtml = (sections: BlogSection[]): string => {
  return sections
    .map((sec) => {
      const safeId = sanitizePlainText(sec.id || '');
      const idAttr = safeId ? ` id="${safeId}" data-id="${safeId}"` : '';
      if (sec.type === 'heading') {
        const level = sec.level === 1 ? 'h1' : sec.level === 3 ? 'h3' : 'h2';
        return `<${level}${idAttr}>${textToHtml(sec.text || '')}</${level}>`;
      } else if (sec.type === 'callout') {
        return `<blockquote${idAttr}>${textToHtml(sec.text || '')}</blockquote>`;
      } else if (sec.type === 'image') {
        const altText = escapeHtml(sec.caption || '');
        const url = normalizeEditorImageUrl(sec.url || '', sec.caption || sec.text || safeId || 'blog-image');
        return `<img${idAttr} src="${url}" alt="${altText}" />`;
      } else {
        const parsedList = parseListLines(sec.text || '');
        if (parsedList && parsedList.items.length > 0) {
          const tag = parsedList.kind === 'ordered' ? 'ol' : 'ul';
          const startAttr =
            parsedList.kind === 'ordered' && parsedList.start > 1 ? ` start="${parsedList.start}"` : '';
          const itemsHtml = parsedList.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
          return `<${tag}${idAttr}${startAttr}>${itemsHtml}</${tag}>`;
        }
        const text = textToHtml(sec.text || '');
        return `<p${idAttr}>${text || '<br />'}</p>`;
      }
    })
    .join('');
};

// Parse single HTML document from TipTap back to blog sections
export const parseHtmlToSections = (html: string, previousSections: BlogSection[] = []): BlogSection[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;
  const sections: BlogSection[] = [];
  
  Array.from(body.children).forEach((el, index) => {
    const tagName = el.tagName.toLowerCase();
    const fallbackId = previousSections[index]?.id || generateUuid();
    const hasDirectImage = tagName === 'img';
    const nestedImage = hasDirectImage ? null : el.querySelector('img');
    const imageEl = (hasDirectImage ? el : nestedImage) as HTMLImageElement | null;

    if (imageEl) {
      const imageId =
        imageEl.getAttribute('id') ||
        imageEl.getAttribute('data-id') ||
        el.getAttribute('id') ||
        el.getAttribute('data-id') ||
        previousSections[index]?.id ||
        generateUuid();
      const figureCaption =
        tagName === 'figure'
          ? (el.querySelector('figcaption') as HTMLElement | null)?.textContent || ''
          : '';
      const caption = sanitizePlainText(
        figureCaption || imageEl.getAttribute('alt') || imageEl.getAttribute('title') || ''
      );

      sections.push({
        id: imageId,
        type: 'image',
        text: sanitizePlainText(caption || ''),
        url: normalizeEditorImageUrl(
          imageEl.getAttribute('src') || '',
          caption || imageId || previousSections[index]?.id || `img-${index + 1}`
        ),
        caption,
      });
      return;
    }

    let type: 'heading' | 'paragraph' | 'callout' | 'image' = 'paragraph';
    let level: number | undefined;
    let text = sanitizePlainText((el as HTMLElement).innerText || el.textContent || '');
    if (tagName === 'h2' || tagName === 'h1' || tagName === 'h3' || tagName === 'h4') {
      type = 'heading';
      level = tagName === 'h1' ? 1 : tagName === 'h3' ? 3 : 2;
    } else if (tagName === 'blockquote') {
      type = 'callout';
    } else if (tagName === 'ul' || tagName === 'ol') {
      const orderedStartAttr = Number((el as HTMLOListElement).getAttribute?.('start') || '1');
      const orderedStart =
        Number.isFinite(orderedStartAttr) && orderedStartAttr > 0 ? orderedStartAttr : 1;
      const items = Array.from(el.querySelectorAll(':scope > li'));
      text = items
        .map((li, liIndex) => {
          const content = normalizeLayoutText(li.textContent || '');
          if (!content) return '';
          return tagName === 'ol' ? `${orderedStart + liIndex}. ${content}` : `- ${content}`;
        })
        .filter(Boolean)
        .join('\n');
    }

    sections.push({
      id: el.getAttribute('id') || el.getAttribute('data-id') || fallbackId,
      type,
      text,
      level,
      url: '',
      caption: '',
    });
  });

  return ensureStableSectionIds(sections);
};


export const BlogEditorView: React.FC<BlogEditorViewProps> = ({
  blog,
  onBack,
  onUpdateBlog,
  isDarkSidebar,
  onToggleSidebarTheme,
}) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'outline' | 'seo' | 'history'>('editor');
  const [deviceLayout, setDeviceLayout] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [hoveredTop, setHoveredTop] = useState<number>(0);
  const [activeTooltipSectionId, setActiveTooltipSectionId] = useState<string | null>(null);
  
  // Local blog state for immediate cursor updates and debounced save
  const [localBlog, setLocalBlog] = useState<Blog>(blog);
  const [titleStyle, setTitleStyle] = useState<TitleStyleState>({});
  const [sectionStyleMap, setSectionStyleMap] = useState<Record<string, TitleStyleState>>({});

  const saveTimeoutRef = useRef<any>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const isInternalUpdateRef = useRef<boolean>(false);
  const skipEditorOnUpdateRef = useRef<number>(0);
  const latestSectionsRef = useRef<BlogSection[]>(blog.sections || []);
  const latestSectionStylesRef = useRef<Record<string, TitleStyleState>>({});

  // AI Assistant state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedEditorScope, setSelectedEditorScope] = useState<SelectedEditorScope>({
    field: null,
    sectionId: null,
    text: '',
  });
  const selectedEditorScopeRef = useRef<SelectedEditorScope>({
    field: null,
    sectionId: null,
    text: '',
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getSectionScopeText = (sectionId: string | null | undefined): string => {
    if (!sectionId) return '';
    const section = localBlog.sections.find((s) => s.id === sectionId);
    if (!section) return '';
    return normalizeLayoutText(
      section.type === 'image'
        ? section.caption || section.text || section.url || ''
        : section.text || ''
    );
  };

  const getSectionComparableText = (section: BlogSection): string =>
    normalizeLayoutText(
      section.type === 'image'
        ? section.caption || section.text || section.url || ''
        : section.text || ''
    );

  const stripListPrefix = (line: string): string =>
    normalizeLayoutText(line).replace(/^(\d+)[.)]\s+/, '').replace(/^[-*â€¢Â·â–ª]\s+/, '').trim();

  const resolveSectionIdFromSelectedText = (selectedText: string): string | null => {
    const needle = normalizeLayoutText(selectedText);
    if (!needle) return null;

    const exact = localBlog.sections.find((s) => getSectionComparableText(s) === needle);
    if (exact?.id) return exact.id;

    const direct = localBlog.sections.find((s) => getSectionComparableText(s).includes(needle));
    if (direct?.id) return direct.id;

    const normalizedNeedle = needle
      .split('\n')
      .map((line) => stripListPrefix(line))
      .filter(Boolean)
      .join('\n');
    if (!normalizedNeedle) return null;

    const fallback = localBlog.sections.find((s) => {
      const comparable = getSectionComparableText(s);
      const normalizedComparable = comparable
        .split('\n')
        .map((line) => stripListPrefix(line))
        .filter(Boolean)
        .join('\n');
      return normalizedComparable.includes(normalizedNeedle);
    });

    return fallback?.id || null;
  };

  const updateSelectedEditorScope = (next: SelectedEditorScope) => {
    const normalized: SelectedEditorScope = {
      field: next.field,
      sectionId:
        next.field === 'section'
          ? (sanitizePlainText(next.sectionId || '') || null)
          : null,
      text: normalizeLayoutText(next.text || ''),
    };

    const prev = selectedEditorScopeRef.current;
    if (
      prev.field === normalized.field &&
      prev.sectionId === normalized.sectionId &&
      prev.text === normalized.text
    ) {
      return;
    }

    selectedEditorScopeRef.current = normalized;
    setSelectedEditorScope(normalized);

    if (normalized.field === 'section') {
      setActiveSectionId(normalized.sectionId);
    } else if (normalized.field === 'title') {
      setActiveSectionId(null);
    }
  };

  const clearSelectedEditorScope = () => {
    updateSelectedEditorScope({ field: null, sectionId: null, text: '' });
    setActiveSectionId(null);
  };

  const syncTitleSelectionScope = () => {
    const el = titleRef.current;
    if (!el) return;

    const rawValue = el.value || '';
    const hasRange =
      typeof el.selectionStart === 'number' &&
      typeof el.selectionEnd === 'number' &&
      el.selectionEnd > el.selectionStart;
    if (!hasRange) {
      const current = selectedEditorScopeRef.current;
      if (current.field === 'title') {
        clearSelectedEditorScope();
      }
      return;
    }

    const text = rawValue.slice(el.selectionStart, el.selectionEnd);
    const normalized = normalizeLayoutText(text);
    if (!normalized) {
      clearSelectedEditorScope();
      return;
    }

    updateSelectedEditorScope({
      field: 'title',
      sectionId: null,
      text: normalized,
    });
  };

  const resolveSectionIdAtSelection = (editorInstance: any, pos: number): string | null => {
    const domResult = editorInstance?.view?.domAtPos?.(pos);
    const domNode = domResult?.node as Node | undefined;
    if (!domNode || !editorInstance?.view?.dom) return null;

    const root = editorInstance.view.dom as HTMLElement;
    let blockEl: HTMLElement | null =
      domNode.nodeType === Node.TEXT_NODE ? (domNode.parentElement as HTMLElement | null) : (domNode as HTMLElement);

    while (blockEl && blockEl !== root && blockEl.parentElement !== root) {
      blockEl = blockEl.parentElement;
    }

    if (!blockEl) return null;
    const id = blockEl.getAttribute('id') || blockEl.getAttribute('data-id');
    return sanitizePlainText(id || '') || null;
  };

  const syncEditorSelectionScope = (editorInstance: any) => {
    if (!editorInstance?.state) return;

    const { from, to, empty } = editorInstance.state.selection;
    if (empty || to <= from) {
      const current = selectedEditorScopeRef.current;
      if (current.field === 'section' || current.field === 'title') {
        clearSelectedEditorScope();
      }
      return;
    }

    const sectionId = resolveSectionIdAtSelection(editorInstance, from);
    const selectedText = normalizeLayoutText(
      editorInstance.state.doc.textBetween(from, to, '\n', '\n')
    );

    if (!selectedText) {
      clearSelectedEditorScope();
      return;
    }

    updateSelectedEditorScope({
      field: 'section',
      sectionId: sectionId || resolveSectionIdFromSelectedText(selectedText),
      text: selectedText,
    });
  };

  const sectionComparableText = (sec: BlogSection): string =>
    normalizeLayoutText(sec.type === 'image' ? sec.caption || sec.text || sec.url || '' : sec.text || '');

  const areSectionsEquivalent = (left: BlogSection[] = [], right: BlogSection[] = []): boolean => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      const a = left[i];
      const b = right[i];
      if (!a || !b) return false;
      if (sanitizePlainText(a.id) !== sanitizePlainText(b.id)) return false;
      if (a.type !== b.type) return false;
      if (sectionComparableText(a) !== sectionComparableText(b)) return false;
      if (sanitizePlainText(a.url || '') !== sanitizePlainText(b.url || '')) return false;
    }
    return true;
  };

const isBlogContentEquivalent = (left: Blog, right: Blog): boolean =>
  normalizeLayoutText(left.title || '') === normalizeLayoutText(right.title || '') &&
  normalizeLayoutText(left.subtitle || '') === normalizeLayoutText(right.subtitle || '') &&
  areSectionsEquivalent(left.sections || [], right.sections || []);

  // Sync state when blog prop changes (including server-saved section IDs)
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    setLocalBlog((prev) => (isBlogContentEquivalent(prev, blog) ? prev : blog));
  }, [blog]);

  useEffect(() => {
    latestSectionsRef.current = localBlog.sections || [];
  }, [localBlog.sections]);

  useEffect(() => {
    const current = selectedEditorScopeRef.current;
    if (current.field !== 'section' || !current.sectionId) return;
    const refreshedText = getSectionScopeText(current.sectionId);
    if (!refreshedText || refreshedText === current.text) return;
    updateSelectedEditorScope({
      field: 'section',
      sectionId: current.sectionId,
      text: refreshedText,
    });
  }, [localBlog.sections]);

  useEffect(() => {
    latestSectionStylesRef.current = sectionStyleMap;
  }, [sectionStyleMap]);

  // Reset title style when switching to another blog
  useEffect(() => {
    setTitleStyle({});
    setSectionStyleMap({});
  }, [blog.id]);

  useEffect(() => {
    const allowed = new Set(localBlog.sections.map((s) => s.id));
    setSectionStyleMap((prev) => {
      const next: Record<string, TitleStyleState> = {};
      let changed = false;
      for (const [id, style] of Object.entries(prev)) {
        if (allowed.has(id)) {
          next[id] = style;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [localBlog.sections]);

  // Auto-adjust title textarea height
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [localBlog.title]);

  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.style.height = 'auto';
      subtitleRef.current.style.height = `${subtitleRef.current.scrollHeight}px`;
    }
  }, [localBlog.subtitle]);

  const debounceUpdateParent = (updatedBlog: Blog) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      onUpdateBlog(updatedBlog);
    }, 1000);
  };

  // Instantiate single stable editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        paragraph: false,
      }),
      Underline,
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-brand-primary underline cursor-pointer' },
      }),
      Image.extend({
        addAttributes() {
          return {
            ...(this.parent?.() || {}),
            id: {
              default: null,
              parseHTML: (el) => el.getAttribute('id') || el.getAttribute('data-id'),
              renderHTML: (attrs) => (attrs.id ? { id: attrs.id, 'data-id': attrs.id } : {}),
            },
          };
        },
      }),
      Paragraph.extend({
        addAttributes() {
          return {
            id: {
              default: null,
              parseHTML: (el) => el.getAttribute('id') || el.getAttribute('data-id'),
              renderHTML: (attrs) => (attrs.id ? { id: attrs.id, 'data-id': attrs.id } : {}),
            },
          };
        },
      }),
      Heading.extend({
        addAttributes() {
          return {
            id: {
              default: null,
              parseHTML: (el) => el.getAttribute('id') || el.getAttribute('data-id'),
              renderHTML: (attrs) => (attrs.id ? { id: attrs.id, 'data-id': attrs.id } : {}),
            },
          };
        },
      }),
      Blockquote.extend({
        addAttributes() {
          return {
            id: {
              default: null,
              parseHTML: (el) => el.getAttribute('id') || el.getAttribute('data-id'),
              renderHTML: (attrs) => (attrs.id ? { id: attrs.id, 'data-id': attrs.id } : {}),
            },
          };
        },
      }),
    ],
    content: serializeSectionsToHtml(localBlog.sections),
    onUpdate: ({ editor }) => {
      if (skipEditorOnUpdateRef.current > 0) {
        skipEditorOnUpdateRef.current -= 1;
        return;
      }
      const html = editor.getHTML();
      const updatedSections = ensureStableSectionIds(
        parseHtmlToSections(html, latestSectionsRef.current)
      );
      const wordCount = updatedSections.reduce((acc, sec) => {
        const countSource =
          sec.type === 'image'
            ? normalizeLayoutText(sec.caption || sec.text || '')
            : normalizeLayoutText(sec.text || '');
        if (countSource) {
          return acc + countSource.split(/\s+/).filter(Boolean).length;
        }
        return acc;
      }, 0);
      
      isInternalUpdateRef.current = true;
      setLocalBlog((prev) => {
        const updatedBlog = {
          ...prev,
          sections: updatedSections,
          words: wordCount,
          readTime: `${Math.max(1, Math.ceil(wordCount / 200))} min`,
        };
        debounceUpdateParent(updatedBlog);
        return updatedBlog;
      });
    },
    onSelectionUpdate: ({ editor }) => {
      syncEditorSelectionScope(editor);
    },
    editorProps: {
      attributes: {
        class:
          'focus:outline-none w-full font-serif text-[var(--blog-ink-body)] text-[1.04rem] leading-[1.9] min-h-[500px] text-justify',
      },
    },
  });

  const setEditorContentSilently = (sections: BlogSection[]) => {
    if (!editor) return;
    skipEditorOnUpdateRef.current += 1;
    editor.commands.setContent(serializeSectionsToHtml(sections));
  };

  const setEditorHtmlSilently = (html: string) => {
    if (!editor) return;
    skipEditorOnUpdateRef.current += 1;
    editor.commands.setContent(html);
  };

  // Sync editor content when localBlog changes externally
  useEffect(() => {
    if (editor && localBlog) {
      if (isInternalUpdateRef.current) {
        isInternalUpdateRef.current = false;
        return;
      }
      const currentHtml = editor.getHTML();
      const currentSections = parseHtmlToSections(currentHtml, latestSectionsRef.current);
      const hasEquivalentContent = areSectionsEquivalent(currentSections, localBlog.sections);
      if (hasEquivalentContent) return;
      if (editor.isFocused) return;

      setEditorContentSilently(localBlog.sections);
      applyStoredSectionStyles(latestSectionStylesRef.current);
    }
  }, [localBlog.sections, editor]);

  useEffect(() => {
    if (!editor?.view?.dom) return;
    const root = editor.view.dom as HTMLElement;
    const images = root.querySelectorAll('img');
    images.forEach((img) => applyImageElementFallback(img as HTMLImageElement));
  }, [editor, localBlog.sections]);

  // Preview Modal state
  const [previewMessage, setPreviewMessage] = useState<ChatMessage | null>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const [historyPreviewVersion, setHistoryPreviewVersion] = useState<SectionVersionItem | null>(null);
  const [historyDiffPreview, setHistoryDiffPreview] = useState<HistoryDiffPreviewItem | null>(null);

  // Right Chat Sidebar Width Resizing state & handlers
  const [rightSidebarWidth, setRightSidebarWidth] = useState(360);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const startResizingRight = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizingRight(true);
  };

  useEffect(() => {
    if (!isResizingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate right sidebar width based on cursor position relative to the right of the window
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 260 && newWidth < 600) {
        setRightSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingRight]);

  // Versions history state
  const [versions, setVersions] = useState<SectionVersionItem[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const loadVersions = useCallback(async () => {
    setIsLoadingVersions(true);
    try {
      const data = await blogService.getVersions(blog.id);
      setVersions((data || []) as SectionVersionItem[]);
    } catch (err) {
      console.error('Failed to load versions:', err);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [blog.id]);

  // Fetch threads and messages on mount
  useEffect(() => {
    const initChat = async () => {
      try {
        const threads = await chatService.getThreads(blog.id);
        if (threads && threads.length > 0) {
          const active = threads[0];
          setThreadId(active.id);
          const msgs = await chatService.getMessages(active.id);
          const mappedMessages = msgs.map((m: any) => ({
            id: m.id,
            sender: m.sender,
            text: m.text,
            time: new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: m.createdAt || new Date().toISOString(),
            showDiffCard: m.showDiffCard,
            actionType: m.actionType,
            actionData: m.actionData,
          }));
          setChatMessages(mappedMessages);

          const latestApplied = [...mappedMessages]
            .reverse()
            .find((m) => m.sender === 'assistant' && m.actionData?.appliedAt && !m.actionData?.revertedAt);
          const persistedTitleStyle = latestApplied?.actionData?.afterState?.titleStyle;
          const persistedSectionStyles = latestApplied?.actionData?.afterState?.sectionStyles;
          if (persistedTitleStyle && typeof persistedTitleStyle === 'object') {
            setTitleStyle(persistedTitleStyle as TitleStyleState);
          }
          if (persistedSectionStyles && typeof persistedSectionStyles === 'object') {
            setSectionStyleMap(persistedSectionStyles as Record<string, TitleStyleState>);
          }
        } else {
          const newThread = await chatService.createThread(blog.id, `Chat for ${blog.title}`);
          setThreadId(newThread.id);
          setChatMessages([]);
        }
      } catch (err) {
        console.error('Failed to initialize chat thread:', err);
      }
    };
    initChat();
  }, [blog.id]);

  // Fetch versions when the History tab is clicked
  useEffect(() => {
    if (activeTab === 'history') {
      loadVersions();
    }
  }, [activeTab, loadVersions]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  // Auto-scroll preview to first changed area
  useEffect(() => {
    if (!previewMessage) return;
    const timer = setTimeout(() => {
      const target = previewContentRef.current?.querySelector('.preview-changed');
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [previewMessage]);


  const getNodeRangeBySectionId = (sectionId: string): { from: number; to: number } | null => {
    if (!editor) return null;
    let range: { from: number; to: number } | null = null;

    editor.state.doc.descendants((node, pos) => {
      if (node.attrs?.id === sectionId) {
        const from = pos + 1;
        const to = pos + node.nodeSize - 1;
        range = { from, to };
        return false;
      }
      return true;
    });

    return range;
  };

  const resolveSectionId = (
    sectionId: string | undefined,
    sections: BlogSection[]
  ): string | undefined => {
    const raw = sanitizePlainText(sectionId || '');
    if (!raw) return undefined;
    if (sections.some((s) => s.id === raw)) return raw;

    const autoMatch = raw.match(/^sec-auto-(\d+)$/i);
    if (autoMatch) {
      const idx = Number(autoMatch[1]);
      if (Number.isFinite(idx) && sections[idx]?.id) return sections[idx].id;
    }

    return undefined;
  };

  const findSectionIdByOriginalText = (
    originalText: string | undefined,
    sections: BlogSection[]
  ): string | undefined => {
    const needle = normalizeLayoutText(originalText || '').slice(0, 160);
    if (!needle) return undefined;
    const exact = sections.find((s) => normalizeLayoutText(s.text || s.caption || '') === needle);
    if (exact) return exact.id;
    const partial = sections.find((s) =>
      normalizeLayoutText(s.text || s.caption || '').includes(needle.slice(0, 80))
    );
    return partial?.id;
  };

  const resolveEditorOpsForSections = (operations: EditorOp[], sections: BlogSection[]): EditorOp[] =>
    operations.map((op) => {
      const resolvedSectionId = resolveSectionId(op.sectionId, sections);
      const resolvedAfterId = resolveSectionId(op.afterSectionId || op.sectionId, sections);
      return {
        ...op,
        ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
        ...(resolvedAfterId ? { afterSectionId: resolvedAfterId } : {}),
        ...(op.selectedText ? { selectedText: normalizeLayoutText(op.selectedText) } : {}),
      };
    });

  const replaceSelectedTextInText = (
    sourceText: string,
    selectedText: string,
    replacementText: string
  ): { nextText: string; didReplace: boolean } => {
    const sourceRaw = typeof sourceText === 'string' ? sourceText : '';
    const needleRaw = typeof selectedText === 'string' ? selectedText : '';
    const replacementRaw = sanitizeDisplayText(replacementText || '');
    const needle = normalizeLayoutText(needleRaw);

    if (!needle) {
      return { nextText: replacementRaw, didReplace: sourceRaw !== replacementRaw };
    }

    const directIndex = needleRaw ? sourceRaw.indexOf(needleRaw) : -1;
    if (directIndex >= 0) {
      const nextText =
        sourceRaw.slice(0, directIndex) +
        replacementRaw +
        sourceRaw.slice(directIndex + needleRaw.length);
      return { nextText, didReplace: true };
    }

    const sourceLower = sourceRaw.toLowerCase();
    const needleLower = needleRaw.toLowerCase();
    const caseInsensitiveIndex = sourceLower.indexOf(needleLower);
    if (caseInsensitiveIndex >= 0) {
      const nextText =
        sourceRaw.slice(0, caseInsensitiveIndex) +
        replacementRaw +
        sourceRaw.slice(caseInsensitiveIndex + needleRaw.length);
      return { nextText, didReplace: true };
    }

    // If normalized values match, the whole field was selected.
    if (normalizeLayoutText(sourceRaw) === needle) {
      return { nextText: replacementRaw, didReplace: sourceRaw !== replacementRaw };
    }

    // List-aware fallback: match selected lines without numbering/bullets and
    // preserve the existing list format when replacing list content.
    const sourceLines = sourceRaw.split(/\r?\n/);
    const needleLines = needle.split('\n').map((line) => normalizeLayoutText(line));
    const sourceComparable = sourceLines.map((line) => stripListPrefix(line));
    const needleComparable = needleLines.map((line) => stripListPrefix(line)).filter(Boolean);
    const replacementLinesRaw = replacementRaw
      .split(/\r?\n/)
      .map((line) => sanitizeDisplayText(line))
      .filter(Boolean);

    if (sourceComparable.length > 0 && needleComparable.length > 0) {
      let matchedStart = -1;
      for (let i = 0; i <= sourceComparable.length - needleComparable.length; i += 1) {
        const windowSlice = sourceComparable.slice(i, i + needleComparable.length);
        const isMatch = windowSlice.every((line, idx) => line === needleComparable[idx]);
        if (isMatch) {
          matchedStart = i;
          break;
        }
      }

      if (matchedStart >= 0) {
        const matchedEnd = matchedStart + needleComparable.length;
        const matchedSourceLines = sourceLines.slice(matchedStart, matchedEnd);

        const orderedMatch = matchedSourceLines.every((line) => /^(\d+)[.)]\s+/.test(line.trim()));
        const bulletMatch = matchedSourceLines.every((line) => /^[-*•·▪]\s+/.test(line.trim()));

        let formattedReplacement = replacementLinesRaw;
        if (orderedMatch && replacementLinesRaw.length > 0) {
          const firstLine = matchedSourceLines[0]?.trim() || '';
          const startNumber = Number((firstLine.match(/^(\d+)[.)]\s+/) || [])[1] || '1');
          formattedReplacement = replacementLinesRaw.map(
            (line, idx) => `${startNumber + idx}. ${stripListPrefix(line)}`
          );
        } else if (bulletMatch && replacementLinesRaw.length > 0) {
          formattedReplacement = replacementLinesRaw.map((line) => `- ${stripListPrefix(line)}`);
        }

        const nextLines = [
          ...sourceLines.slice(0, matchedStart),
          ...formattedReplacement,
          ...sourceLines.slice(matchedEnd),
        ];
        const nextText = nextLines.join('\n');
        return { nextText, didReplace: nextText !== sourceRaw };
      }
    }

    return { nextText: sourceRaw, didReplace: false };
  };

  const findSelectedTextRangeInSection = (
    sectionId: string,
    selectedText: string
  ): { from: number; to: number } | null => {
    if (!editor) return null;
    const range = getNodeRangeBySectionId(sectionId);
    if (!range) return null;
    const needle = normalizeLayoutText(selectedText || '');
    if (!needle) return null;

    const source = editor.state.doc.textBetween(range.from, range.to, '\n', '\n');
    const directIndex = source.indexOf(needle);
    const caseInsensitiveIndex = source.toLowerCase().indexOf(needle.toLowerCase());
    const idx = directIndex >= 0 ? directIndex : caseInsensitiveIndex;
    if (idx < 0) return null;

    return {
      from: range.from + idx,
      to: range.from + idx + needle.length,
    };
  };

  const applyInlineStyleToSelectedText = (sectionId: string, selectedText: string, op: EditorOp): boolean => {
    if (!editor) return false;
    const range = findSelectedTextRangeInSection(sectionId, selectedText);
    if (!range || range.from >= range.to) return false;

    let chain = editor.chain().setTextSelection({ from: range.from, to: range.to });
    if (typeof op.bold === 'boolean') {
      chain = op.bold ? chain.setMark('bold') : chain.unsetMark('bold');
    }
    if (typeof op.italic === 'boolean') {
      chain = op.italic ? chain.setMark('italic') : chain.unsetMark('italic');
    }
    if (op.color) {
      chain = chain.setColor(op.color);
    }
    return chain.run();
  };

  const resolveEditorOpsWithSnapshots = (
    operations: EditorOp[],
    sections: BlogSection[],
    operationOriginals?: OperationOriginalSnapshot[]
  ): EditorOp[] => {
    const base = resolveEditorOpsForSections(operations, sections);
    return base
      .map((op, index) => {
        if (op.op === 'style_title' || op.op === 'rename_title') return op;

        const snapshotByIndex = operationOriginals?.find((x) => x?.opIndex === index);
        const snapshot = snapshotByIndex || operationOriginals?.[index];
        const resolvedFromOriginal = findSectionIdByOriginalText(snapshot?.originalText, sections);
        const resolvedFromAnchor = findSectionIdByOriginalText(snapshot?.anchorOriginalText, sections);
        const resolvedFromSelected = findSectionIdByOriginalText(op.selectedText, sections);

        const nextSectionId = op.sectionId || resolvedFromOriginal || resolvedFromSelected;
        if (op.op === 'insert_image_after') {
          const nextAfter = op.afterSectionId || nextSectionId || resolvedFromAnchor || resolvedFromSelected;
          return {
            ...op,
            ...(nextSectionId ? { sectionId: nextSectionId } : {}),
            ...(nextAfter ? { afterSectionId: nextAfter } : {}),
          };
        }

        return {
          ...op,
          ...(nextSectionId ? { sectionId: nextSectionId } : {}),
        };
      })
      .filter((op) => {
        if (op.op === 'style_title' || op.op === 'rename_title') return true;
        if (op.op === 'insert_image_after') return Boolean(op.afterSectionId || op.sectionId);
        return Boolean(op.sectionId);
      });
  };

  const applySectionStyle = (sectionId: string, op: EditorOp): boolean => {
    if (!editor) return false;
    const range = getNodeRangeBySectionId(sectionId);
    if (!range || range.from > range.to) return false;

    let chain = editor.chain().setTextSelection({ from: range.from, to: range.to });

    if (typeof op.bold === 'boolean') {
      chain = op.bold ? chain.setMark('bold') : chain.unsetMark('bold');
    }

    if (typeof op.italic === 'boolean') {
      chain = op.italic ? chain.setMark('italic') : chain.unsetMark('italic');
    }

    if (op.color) {
      chain = chain.setColor(op.color);
    }

    return chain.run();
  };

  const applyStoredSectionStyles = (styles: Record<string, TitleStyleState>) => {
    if (!editor) return;
    const wasFocused = editor.isFocused;
    const previous = editor.state.selection;
    const maxPos = Math.max(1, editor.state.doc.content.size);

    for (const [sectionId, style] of Object.entries(styles || {})) {
      applySectionStyle(sectionId, {
        op: 'style_section',
        sectionId,
        ...(typeof style.bold === 'boolean' ? { bold: style.bold } : {}),
        ...(typeof style.italic === 'boolean' ? { italic: style.italic } : {}),
        ...(style.color ? { color: style.color } : {}),
      });
    }

    if (wasFocused) {
      const from = Math.min(Math.max(previous.from, 1), maxPos);
      const to = Math.min(Math.max(previous.to, 1), maxPos);
      editor.commands.setTextSelection({ from, to });
    }
  };

  const handleApplyEditorOps = (
    operations: EditorOp[],
    operationOriginals?: OperationOriginalSnapshot[]
  ): boolean => {
    if (!operations || operations.length === 0) return false;
    const resolvedOps = resolveEditorOpsWithSnapshots(operations, localBlog.sections, operationOriginals);

    let updatedTitle = localBlog.title;
    let updatedSections = [...localBlog.sections];
    let nextSectionStyles: Record<string, TitleStyleState> = { ...sectionStyleMap };
    let didApply = false;
    let shouldResetEditorContent = false;

    for (const op of resolvedOps) {
      if (op.op === 'rename_title' && op.text) {
        const nextTitle = normalizeLayoutText(op.text);
        if (op.selectedText) {
          const replaced = replaceSelectedTextInText(updatedTitle, op.selectedText, nextTitle);
          if (replaced.didReplace) {
            updatedTitle = replaced.nextText;
            didApply = true;
          }
        } else if (nextTitle && nextTitle !== updatedTitle) {
          updatedTitle = nextTitle;
          didApply = true;
        }
        continue;
      }

      if (op.op === 'style_title') {
        const hasStyleUpdate =
          typeof op.bold === 'boolean' || typeof op.italic === 'boolean' || Boolean(op.color);
        if (!hasStyleUpdate) continue;
        setTitleStyle((prev) => ({
          ...prev,
          ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
          ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
          ...(op.color ? { color: op.color } : {}),
        }));
        didApply = true;
        continue;
      }

      if (op.op === 'delete_section' && op.sectionId) {
        if (op.selectedText) {
          const selected = normalizeLayoutText(op.selectedText);
          let changed = false;
          updatedSections = updatedSections.map((s) => {
            if (s.id !== op.sectionId || s.type === 'image') return s;
            const replaced = replaceSelectedTextInText(s.text || '', selected, '');
            if (!replaced.didReplace) return s;
            changed = true;
            return { ...s, text: replaced.nextText };
          });
          if (changed) didApply = true;
          if (changed) shouldResetEditorContent = true;
          continue;
        }
        const beforeLen = updatedSections.length;
        updatedSections = updatedSections.filter((s) => s.id !== op.sectionId);
        delete nextSectionStyles[op.sectionId];
        if (updatedSections.length !== beforeLen) didApply = true;
        if (updatedSections.length !== beforeLen) shouldResetEditorContent = true;
        continue;
      }

      if (op.op === 'replace_section_text' && op.sectionId && op.text) {
        const nextText = normalizeLayoutText(op.text);
        let changed = false;
        updatedSections = updatedSections.map((s) => {
          if (s.id !== op.sectionId) return s;
          if (op.selectedText && s.type !== 'image') {
            const replaced = replaceSelectedTextInText(s.text || '', op.selectedText, nextText);
            if (!replaced.didReplace) return s;
            if (s.text !== replaced.nextText) changed = true;
            return { ...s, text: replaced.nextText };
          }
          if (s.text !== nextText) changed = true;
          return { ...s, text: nextText };
        });
        if (changed) didApply = true;
        if (changed) shouldResetEditorContent = true;
        continue;
      }

      if (op.op === 'replace_image' && op.sectionId) {
        let changed = false;
        updatedSections = updatedSections.map((s) =>
          s.id === op.sectionId
            ? {
                ...s,
                type: 'image',
                text: normalizeLayoutText(op.text || s.text || op.caption || 'Image'),
                caption: normalizeLayoutText(op.caption || s.caption || op.text || ''),
                url: normalizeEditorImageUrl(op.url || s.url || '', op.text || op.caption || s.caption || s.text || 'image'),
              }
            : s
        );
        const target = updatedSections.find((s) => s.id === op.sectionId);
        if (target) changed = true;
        if (changed) didApply = true;
        if (changed) shouldResetEditorContent = true;
        continue;
      }

      if (op.op === 'insert_image_after') {
        const newImage: BlogSection = {
          id: generateUuid(),
          type: 'image',
          text: normalizeLayoutText(op.text || op.caption || 'Image'),
          caption: normalizeLayoutText(op.caption || op.text || 'Image'),
          url: normalizeEditorImageUrl(op.url || '', op.text || op.caption || 'image'),
        };
        const anchorId = op.afterSectionId || op.sectionId;
        const anchorIdx = anchorId ? updatedSections.findIndex((s) => s.id === anchorId) : -1;
        if (anchorIdx >= 0) {
          updatedSections.splice(anchorIdx + 1, 0, newImage);
        } else {
          updatedSections.push(newImage);
        }
        didApply = true;
        shouldResetEditorContent = true;
        continue;
      }

      if (op.op === 'style_section' && op.sectionId) {
        const hasTarget = updatedSections.some((s) => s.id === op.sectionId);
        const hasStyleUpdate =
          typeof op.bold === 'boolean' || typeof op.italic === 'boolean' || Boolean(op.color);
        if (!hasTarget || !hasStyleUpdate) continue;
        if (op.selectedText) {
          const appliedInline = applyInlineStyleToSelectedText(op.sectionId, op.selectedText, op);
          if (appliedInline) didApply = true;
          continue;
        }
        nextSectionStyles[op.sectionId] = {
          ...(nextSectionStyles[op.sectionId] || {}),
          ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
          ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
          ...(op.color ? { color: op.color } : {}),
        };
        applySectionStyle(op.sectionId, op);
        didApply = true;
      }
    }

    if (!didApply) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: 'sys-' + Date.now(),
          sender: 'assistant',
          text: 'I could not match the exact location to edit. Please highlight the paragraph and try again.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return false;
    }

    const updatedBlog = {
      ...localBlog,
      title: updatedTitle,
      sections: updatedSections,
    };

    setLocalBlog(updatedBlog);
    setSectionStyleMap(nextSectionStyles);
    debounceUpdateParent(updatedBlog);

    if (editor) {
      if (shouldResetEditorContent) {
        setEditorContentSilently(updatedSections);
      }
      applyStoredSectionStyles(nextSectionStyles);
    }

    setChatMessages((prev) => [
      ...prev,
      {
        id: 'sys-' + Date.now(),
        sender: 'assistant',
        text: 'Updated. Applied ' + resolvedOps.length + ' requested editor update' + (resolvedOps.length > 1 ? 's' : '') + '.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    return true;
  };


  const buildEditorOpsPreview = (
    operations: EditorOp[],
    operationOriginals?: OperationOriginalSnapshot[]
  ) => {
    const resolvedOps = resolveEditorOpsWithSnapshots(operations, localBlog.sections, operationOriginals);
    let nextTitle = localBlog.title;
    let nextSections = [...localBlog.sections];
    const nextTitleStyle: TitleStyleState = { ...titleStyle };
    const previewSectionStyles: Record<string, TitleStyleState> = { ...sectionStyleMap };

    for (const op of resolvedOps) {
      if (op.op === 'rename_title' && op.text) {
        const renamed = normalizeLayoutText(op.text);
        if (op.selectedText) {
          const replaced = replaceSelectedTextInText(nextTitle, op.selectedText, renamed);
          if (replaced.didReplace) {
            nextTitle = replaced.nextText;
          }
        } else {
          nextTitle = renamed;
        }
        continue;
      }

      if (op.op === 'style_title') {
        if (typeof op.bold === 'boolean') nextTitleStyle.bold = op.bold;
        if (typeof op.italic === 'boolean') nextTitleStyle.italic = op.italic;
        if (op.color) nextTitleStyle.color = op.color;
        continue;
      }

      if (op.op === 'delete_section' && op.sectionId) {
        if (op.selectedText) {
          nextSections = nextSections.map((s) => {
            if (s.id !== op.sectionId || s.type === 'image') return s;
            const replaced = replaceSelectedTextInText(s.text || '', op.selectedText || '', '');
            return replaced.didReplace ? { ...s, text: replaced.nextText } : s;
          });
        } else {
          nextSections = nextSections.filter((s) => s.id !== op.sectionId);
        }
        continue;
      }

      if (op.op === 'replace_section_text' && op.sectionId && op.text) {
        const replacedText = normalizeLayoutText(op.text);
        nextSections = nextSections.map((s) => {
          if (s.id !== op.sectionId) return s;
          if (op.selectedText && s.type !== 'image') {
            const replaced = replaceSelectedTextInText(s.text || '', op.selectedText, replacedText);
            return replaced.didReplace ? { ...s, text: replaced.nextText } : s;
          }
          return { ...s, text: replacedText };
        });
        continue;
      }

      if (op.op === 'replace_image' && op.sectionId) {
        nextSections = nextSections.map((s) =>
          s.id === op.sectionId
            ? {
                ...s,
                type: 'image',
                text: normalizeLayoutText(op.text || s.text || op.caption || 'Image'),
                caption: normalizeLayoutText(op.caption || s.caption || op.text || ''),
                url: normalizeEditorImageUrl(op.url || s.url || '', op.text || op.caption || s.caption || s.text || 'image'),
              }
            : s
        );
        continue;
      }

      if (op.op === 'insert_image_after') {
        const newImage: BlogSection = {
          id: `preview-${op.afterSectionId || op.sectionId || 'root'}`,
          type: 'image',
          text: normalizeLayoutText(op.text || op.caption || 'Image'),
          caption: normalizeLayoutText(op.caption || op.text || 'Image'),
          url: normalizeEditorImageUrl(op.url || '', op.text || op.caption || 'image'),
        };
        const anchorId = op.afterSectionId || op.sectionId;
        const anchorIdx = anchorId ? nextSections.findIndex((s) => s.id === anchorId) : -1;
        if (anchorIdx >= 0) {
          nextSections.splice(anchorIdx + 1, 0, newImage);
        } else {
          nextSections.push(newImage);
        }
        continue;
      }

      if (op.op === 'style_section' && op.sectionId) {
        if (!op.selectedText) {
          previewSectionStyles[op.sectionId] = {
            ...(previewSectionStyles[op.sectionId] || {}),
            ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
            ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
            ...(op.color ? { color: op.color } : {}),
          };
        }
      }
    }

    return {
      title: nextTitle,
      titleStyle: nextTitleStyle,
      sections: nextSections,
      sectionStyles: previewSectionStyles,
    };
  };

  // Replace text in editor with the AI suggestion from the diff card
  const handleReplaceInEditor = (sectionId: string, newText: string, sectionTitle: string): boolean => {
    const safeText = normalizeLayoutText(newText);
    if (sectionId === 'title') {
      if (safeText === normalizeLayoutText(localBlog.title)) return false;
      const updated = { ...localBlog, title: safeText };
      setLocalBlog(updated);
      debounceUpdateParent(updated);
    } else if (sectionId === 'subtitle') {
      if (safeText === normalizeLayoutText(localBlog.subtitle || '')) return false;
      const updated = { ...localBlog, subtitle: safeText };
      setLocalBlog(updated);
      debounceUpdateParent(updated);
    } else {
      const target = localBlog.sections.find((sec) => sec.id === sectionId);
      if (!target) return false;
      const updatedSections = localBlog.sections.map((sec) =>
        sec.id === sectionId
          ? sec.type === 'image'
            ? { ...sec, text: safeText, caption: safeText }
            : { ...sec, text: safeText }
          : sec
      );
      const updated = { ...localBlog, sections: updatedSections };
      setLocalBlog(updated);
      debounceUpdateParent(updated);
      setEditorContentSilently(updatedSections);
      applyStoredSectionStyles(latestSectionStylesRef.current);
    }

    // Append a system notification message to chat
    setChatMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        sender: 'assistant',
        text: `Updated. Section "${sectionTitle}" has been replaced in the editor.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    return true;
  };

  // Replace the entire blog content and title in the editor
  const handleReplaceAllInEditor = (nextSections: BlogSection[], newTitle?: string, newSubtitle?: string): boolean => {
    if (!Array.isArray(nextSections) || nextSections.length === 0) return false;
    const sanitizedSections = ensureStableSectionIds(
      nextSections.map((sec) => ({
        ...sec,
        id: isUuid(sec.id || '') ? sanitizePlainText(sec.id) : generateUuid(),
        text: normalizeLayoutText(sec.text || ''),
        caption: normalizeLayoutText(sec.caption || ''),
      }))
    );
    const updated = {
      ...localBlog,
      title: newTitle ? normalizeLayoutText(newTitle) : localBlog.title,
      subtitle:
        typeof newSubtitle === 'string'
          ? normalizeLayoutText(newSubtitle)
          : localBlog.subtitle || '',
      sections: sanitizedSections,
    };
    setLocalBlog(updated);
    setSectionStyleMap({});
    debounceUpdateParent(updated);
    setEditorContentSilently(sanitizedSections);

    setChatMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        sender: 'assistant',
        text: `Updated. The full blog content${
          newTitle || typeof newSubtitle === 'string' ? ' and article header' : ''
        } has been replaced in the editor.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    return true;
  };

  // Reject/Dismiss a suggested edit diff card
  const handleRejectEdit = (messageId: string, silent = false) => {
    setChatMessages((prev) => {
      const updated = prev.map((msg) =>
        msg.id === messageId ? { ...msg, showDiffCard: false } : msg
      );
      if (silent) {
        return updated;
      }
      return [
        ...updated,
        {
          id: `sys-${Date.now()}`,
          sender: 'assistant',
          text: `Suggestion rejected.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
    });

    chatService
      .updateMessageActionData(messageId, { showDiffCard: false })
      .catch((err) => console.warn('Failed to persist rejected suggestion state:', err));
  };

  // Handle clicking "Ask AI" next to a section
  const handleAskAISection = (section: BlogSection) => {
    setActiveSectionId(section.id);
    updateSelectedEditorScope({
      field: 'section',
      sectionId: section.id,
      text: normalizeLayoutText(
        section.type === 'image'
          ? section.caption || section.text || section.url || ''
          : section.text || ''
      ),
    });
    setChatInput(`Improve this section: `);
    const textarea = document.querySelector('textarea[placeholder="Ask anything about your blog..."]') as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
    }
  };

  const normalizeAssistantActionData = (
    actionType: string | undefined,
    rawActionData: any,
    selectionScope?: SelectedEditorScope
  ): any => {
    if (!rawActionData || typeof rawActionData !== 'object') return rawActionData;
    const scopeField = selectionScope?.field || null;
    const scopeText = normalizeLayoutText(selectionScope?.text || '');
    const scopeSectionId = sanitizePlainText(selectionScope?.sectionId || '');

    if (actionType === 'editor_ops' && Array.isArray(rawActionData.operations)) {
      const incomingOriginals = Array.isArray(rawActionData?.operationOriginals)
        ? (rawActionData.operationOriginals as OperationOriginalSnapshot[])
        : undefined;
      const inferredScopeSectionId =
        scopeField === 'section' && scopeText && !scopeSectionId
          ? resolveSectionIdFromSelectedText(scopeText)
          : null;
      const effectiveScopeSectionId = scopeSectionId || inferredScopeSectionId || '';
      const scopedSection = scopeSectionId
        ? localBlog.sections.find((s) => s.id === scopeSectionId)
        : inferredScopeSectionId
          ? localBlog.sections.find((s) => s.id === inferredScopeSectionId)
        : null;
      const scopedIsImage = scopedSection?.type === 'image';
      const operations = resolveEditorOpsWithSnapshots(
        rawActionData.operations as EditorOp[],
        localBlog.sections,
        incomingOriginals
      );

      const mappedOperations =
        scopeField === 'section' && effectiveScopeSectionId && scopeText
          ? operations
              .filter((op) => op.op !== 'style_title' && op.op !== 'rename_title')
              .map((op) => {
                if (op.op === 'insert_image_after') {
                  return null;
                }
                if (op.op === 'replace_image') {
                  if (!scopedIsImage) return null;
                  return {
                    ...op,
                    sectionId: effectiveScopeSectionId,
                    selectedText: scopeText,
                  } as EditorOp;
                }
                if (scopedIsImage && op.op === 'replace_section_text' && op.text) {
                  return {
                    op: 'replace_image',
                    sectionId: effectiveScopeSectionId,
                    text: op.text,
                    caption: op.text,
                    selectedText: scopeText,
                  } as EditorOp;
                }
                return {
                  ...op,
                  sectionId: effectiveScopeSectionId,
                  selectedText: scopeText,
                } as EditorOp;
              })
              .filter(Boolean) as EditorOp[]
          : scopeField === 'title' && scopeText
            ? operations.map((op) => {
                if (op.op === 'rename_title' || op.op === 'style_title') {
                  return { ...op, selectedText: scopeText };
                }
                if (op.op === 'replace_section_text') {
                  return { op: 'rename_title', text: op.text, selectedText: scopeText } as EditorOp;
                }
                if (op.op === 'style_section') {
                  return {
                    op: 'style_title',
                    selectedText: scopeText,
                    ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
                    ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
                    ...(op.color ? { color: op.color } : {}),
                  } as EditorOp;
                }
                return op;
              })
            : operations;

      const operationOriginals = mappedOperations.map((op, opIndex) => {
        const targetSection = localBlog.sections.find((s) => s.id === op.sectionId);
        const anchorSection = localBlog.sections.find((s) => s.id === (op.afterSectionId || op.sectionId));
        return {
          opIndex,
          op: op.op,
          sectionId: op.sectionId,
          afterSectionId: op.afterSectionId,
          originalText:
            normalizeLayoutText(op.selectedText || '') ||
            normalizeLayoutText(
              targetSection?.type === 'image'
                ? targetSection.caption || targetSection.text || targetSection.url || ''
                : targetSection?.text || ''
            ),
          anchorOriginalText: normalizeLayoutText(
            anchorSection?.type === 'image'
              ? anchorSection.caption || anchorSection.text || anchorSection.url || ''
              : anchorSection?.text || ''
          ),
        };
      });

      return {
        ...rawActionData,
        operations: mappedOperations,
        operationOriginals,
      };
    }

    if (actionType === 'edit_section') {
      const requestedId = sanitizePlainText(rawActionData.sectionId || '');
      const resolvedId =
        resolveSectionId(requestedId, localBlog.sections) ||
        findSectionIdByOriginalText(sanitizePlainText(rawActionData.originalText || ''), localBlog.sections) ||
        requestedId;
      const target = localBlog.sections.find((s) => s.id === resolvedId);
      const originalText =
        normalizeLayoutText(rawActionData.originalText || '') ||
        (resolvedId === 'title'
          ? normalizeLayoutText(localBlog.title)
          : resolvedId === 'subtitle'
            ? normalizeLayoutText(localBlog.subtitle || '')
            :
        normalizeLayoutText(
          target?.type === 'image'
            ? target.caption || target.text || target.url || ''
            : target?.text || ''
        ));
      return {
        ...rawActionData,
        sectionId:
          scopeField === 'title'
            ? 'title'
            : scopeField === 'section' && scopeSectionId
              ? scopeSectionId
              : resolvedId,
        originalText: scopeField === 'section' && scopeText ? scopeText : originalText,
        ...(scopeField === 'section' && scopeText ? { selectedText: scopeText } : {}),
        ...(scopeField === 'title' && scopeText ? { selectedText: scopeText } : {}),
      };
    }

    return rawActionData;
  };

  // Submit AI prompt
  const handleSendChat = async (textToSend?: string) => {
    const messageText = textToSend || chatInput;
    if (!messageText.trim()) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: messageText,
      createdAt: new Date().toISOString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setChatInput('');
    setIsTyping(true);

    try {
      let activeThread = threadId;
      if (!activeThread) {
        const thread = await chatService.createThread(blog.id, `Chat for ${blog.title}`);
        activeThread = thread.id;
        setThreadId(thread.id);
      }

      const blogContext = {
        title: localBlog.title,
        subtitle: localBlog.subtitle || '',
        tone: localBlog.tone || 'Professional',
        audience: localBlog.audience || 'General',
        sections: localBlog.sections || [],
        selectedField: selectedEditorScopeRef.current.field || undefined,
        selectedText: selectedEditorScopeRef.current.text || undefined,
      };
      const resolvedScopedSectionId =
        selectedEditorScopeRef.current.field === 'section'
          ? selectedEditorScopeRef.current.sectionId ||
            resolveSectionIdFromSelectedText(selectedEditorScopeRef.current.text || '') ||
            activeSectionId ||
            undefined
          : undefined;
      const finalBlogContext = {
        ...blogContext,
        activeSectionId:
          selectedEditorScopeRef.current.field === 'section'
            ? resolvedScopedSectionId
            : activeSectionId || undefined,
      };
      const selectionScopeSnapshot: SelectedEditorScope = {
        field: selectedEditorScopeRef.current.field,
        sectionId: resolvedScopedSectionId || selectedEditorScopeRef.current.sectionId,
        text: selectedEditorScopeRef.current.text,
      };

      const response = await chatService.sendMessage(activeThread, messageText, finalBlogContext);
      const normalizedActionData = normalizeAssistantActionData(
        response.actionType,
        response.actionData,
        selectionScopeSnapshot
      );

      const aiMsg: ChatMessage = {
        id: response.assistantMessage.id,
        sender: 'assistant',
        text: sanitizePlainText(response.assistantMessage.text),
        createdAt: response.assistantMessage.createdAt || new Date().toISOString(),
        showDiffCard: response.assistantMessage.showDiffCard,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actionType: response.actionType,
        actionData: normalizedActionData,
      };

      setChatMessages((prev) => [...prev, aiMsg]);
      if (normalizedActionData && response.assistantMessage?.id) {
        chatService
          .updateMessageActionData(response.assistantMessage.id, {
            actionData: normalizedActionData,
            showDiffCard: response.assistantMessage.showDiffCard,
          })
          .catch((err) => console.warn('Failed to persist normalized action data:', err));
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: 'Sorry, I encountered an error. Please verify the backend is running and try again.',
          createdAt: new Date().toISOString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = async () => {
    try {
      const newThread = await chatService.createThread(blog.id, `Chat ${new Date().toLocaleDateString()}`);
      setThreadId(newThread.id);
      setChatMessages([]);
    } catch (err) {
      console.error('Failed to create new thread:', err);
    }
  };

  const handleRollback = async (sectionId: string, versionId: string) => {
    if (confirm('Are you sure you want to rollback to this version? This will overwrite the current section text.')) {
      try {
        await blogService.rollbackVersion(sectionId, versionId);
        const refreshed = await blogService.getBlogById(blog.id);
        if (refreshed) {
          setLocalBlog(refreshed);
          onUpdateBlog(refreshed);
        }
        loadVersions();
        alert('Section successfully rolled back!');
      } catch (err) {
        console.error('Failed to rollback:', err);
        alert('Rollback failed. Please try again.');
      }
    }
  };

  const cloneSections = (sections: BlogSection[]): BlogSection[] =>
    sections.map((sec) => ({
      ...sec,
      text: normalizeLayoutText(sec.text || ''),
      caption: normalizeLayoutText(sec.caption || ''),
    }));

  const buildNextSnapshotFromMessage = (
    msg: ChatMessage,
    baseBlog: Blog,
    baseTitleStyle: TitleStyleState
  ): {
    title: string;
    subtitle: string;
    sections: BlogSection[];
    titleStyle: TitleStyleState;
    sectionStyles: Record<string, TitleStyleState>;
  } => {
    const next = {
      title: normalizeLayoutText(baseBlog.title),
      subtitle: normalizeLayoutText(baseBlog.subtitle || ''),
      sections: cloneSections(baseBlog.sections),
      titleStyle: { ...baseTitleStyle },
      sectionStyles: { ...sectionStyleMap },
    };

    if (msg.actionType === 'replace_all' && Array.isArray(msg.actionData?.sections)) {
      next.title = normalizeLayoutText(msg.actionData?.title || next.title);
      next.subtitle = normalizeLayoutText(msg.actionData?.subtitle || next.subtitle);
      next.sections = cloneSections(msg.actionData.sections as BlogSection[]);
      next.sectionStyles = {};
      return next;
    }

    if (msg.actionType === 'edit_section' && msg.actionData?.sectionId) {
      const requestedId = sanitizePlainText(msg.actionData.sectionId);
      const sectionId =
        resolveSectionId(requestedId, next.sections) ||
        findSectionIdByOriginalText(sanitizePlainText(msg.actionData.originalText || ''), next.sections) ||
        requestedId;
      const edited = normalizeLayoutText(msg.actionData.editedText || '');
      const selectedText = normalizeLayoutText(msg.actionData.selectedText || '');
      if (sectionId === 'title') {
        if (selectedText) {
          const replaced = replaceSelectedTextInText(next.title, selectedText, edited);
          if (replaced.didReplace) {
            next.title = replaced.nextText;
          }
        } else {
          next.title = edited || next.title;
        }
      } else if (sectionId === 'subtitle') {
        if (selectedText) {
          const replaced = replaceSelectedTextInText(next.subtitle, selectedText, edited);
          if (replaced.didReplace) {
            next.subtitle = replaced.nextText;
          }
        } else {
          next.subtitle = edited || next.subtitle;
        }
      } else {
        next.sections = next.sections.map((sec) =>
          sec.id === sectionId
            ? sec.type === 'image'
              ? selectedText
                ? (() => {
                    const source = sec.caption || sec.text || '';
                    const replaced = replaceSelectedTextInText(source, selectedText, edited);
                    return replaced.didReplace
                      ? { ...sec, text: replaced.nextText, caption: replaced.nextText }
                      : sec;
                  })()
                : { ...sec, text: edited, caption: edited || sec.caption }
              : selectedText
                ? (() => {
                    const replaced = replaceSelectedTextInText(sec.text || '', selectedText, edited);
                    return replaced.didReplace ? { ...sec, text: replaced.nextText } : sec;
                  })()
                : { ...sec, text: edited }
            : sec
        );
      }
      return next;
    }

    if (msg.actionType === 'editor_ops' && Array.isArray(msg.actionData?.operations)) {
      const ops = resolveEditorOpsWithSnapshots(
        msg.actionData.operations as EditorOp[],
        next.sections,
        Array.isArray(msg.actionData?.operationOriginals)
          ? (msg.actionData.operationOriginals as OperationOriginalSnapshot[])
          : undefined
      );
      for (const op of ops) {
        if (op.op === 'rename_title' && op.text) {
          const renamed = normalizeLayoutText(op.text);
          if (op.selectedText) {
            const replaced = replaceSelectedTextInText(next.title, op.selectedText, renamed);
            if (replaced.didReplace) {
              next.title = replaced.nextText;
            }
          } else {
            next.title = renamed;
          }
          continue;
        }
        if (op.op === 'style_title') {
          next.titleStyle = {
            ...next.titleStyle,
            ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
            ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
            ...(op.color ? { color: op.color } : {}),
          };
          continue;
        }
        if (op.op === 'delete_section' && op.sectionId) {
          if (op.selectedText) {
            next.sections = next.sections.map((s) => {
              if (s.id !== op.sectionId || s.type === 'image') return s;
              const replaced = replaceSelectedTextInText(s.text || '', op.selectedText || '', '');
              return replaced.didReplace ? { ...s, text: replaced.nextText } : s;
            });
          } else {
            next.sections = next.sections.filter((s) => s.id !== op.sectionId);
            delete next.sectionStyles[op.sectionId];
          }
          continue;
        }
        if (op.op === 'replace_section_text' && op.sectionId) {
          const newText = normalizeLayoutText(op.text || '');
          next.sections = next.sections.map((s) =>
            s.id === op.sectionId
              ? op.selectedText && s.type !== 'image'
                ? (() => {
                    const replaced = replaceSelectedTextInText(s.text || '', op.selectedText || '', newText);
                    return replaced.didReplace ? { ...s, text: replaced.nextText } : s;
                  })()
                : { ...s, text: newText }
              : s
          );
          continue;
        }
        if (op.op === 'replace_image' && op.sectionId) {
          next.sections = next.sections.map((s) =>
            s.id === op.sectionId
              ? {
                  ...s,
                  type: 'image',
                  text: normalizeLayoutText(op.text || s.text || op.caption || 'Image'),
                  caption: normalizeLayoutText(op.caption || s.caption || op.text || 'Image'),
                  url: normalizeEditorImageUrl(op.url || s.url || '', op.text || op.caption || s.caption || s.text || 'image'),
                }
              : s
          );
          continue;
        }
        if (op.op === 'insert_image_after') {
          const anchorId = op.afterSectionId || op.sectionId;
          const newImage: BlogSection = {
            id: generateUuid(),
            type: 'image',
            text: normalizeLayoutText(op.text || op.caption || 'Image'),
            caption: normalizeLayoutText(op.caption || op.text || 'Image'),
            url: normalizeEditorImageUrl(op.url || '', op.text || op.caption || 'image'),
          };
          const anchorIdx = anchorId ? next.sections.findIndex((s) => s.id === anchorId) : -1;
          if (anchorIdx >= 0) next.sections.splice(anchorIdx + 1, 0, newImage);
          else next.sections.push(newImage);
          continue;
        }
        if (op.op === 'style_section' && op.sectionId) {
          if (!op.selectedText) {
            next.sectionStyles[op.sectionId] = {
              ...(next.sectionStyles[op.sectionId] || {}),
              ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
              ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
              ...(op.color ? { color: op.color } : {}),
            };
          }
        }
      }
    }

    return next;
  };

  const buildVersionChanges = (beforeSections: BlogSection[], afterSections: BlogSection[]) => {
    const beforeMap = new Map(beforeSections.map((s) => [s.id, s]));
    const afterMap = new Map(afterSections.map((s) => [s.id, s]));
    const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const changes: Array<{ sectionId: string; originalText: string; editedText: string; explanation?: string }> = [];
    const imageVersionText = (section: BlogSection): string => {
      const label = normalizeLayoutText(section.caption || section.text || '');
      const url = sanitizePlainText(section.url || '');
      return normalizeLayoutText([label, url].filter(Boolean).join('\n')) || label || url;
    };

    for (const id of ids) {
      const before = beforeMap.get(id);
      const after = afterMap.get(id);
      if (!before && !after) continue;
      if (!before || !after) continue;

      const originalText = normalizeLayoutText(
        before.type === 'image' ? imageVersionText(before) : before.text || ''
      );
      const editedText = normalizeLayoutText(
        after.type === 'image' ? imageVersionText(after) : after.text || ''
      );
      if (originalText !== editedText) {
        changes.push({
          sectionId: id,
          originalText,
          editedText,
        });
      }
    }

    return changes;
  };

  const applySuggestionMessage = async (msg: ChatMessage): Promise<boolean> => {
    const alreadyReplaced = Boolean(msg.actionData?.appliedAt);
    if (alreadyReplaced) return false;

    const beforeEditorHtml = editor?.getHTML?.() || serializeSectionsToHtml(localBlog.sections);
    const beforeState = {
      title: normalizeLayoutText(localBlog.title),
      subtitle: normalizeLayoutText(localBlog.subtitle || ''),
      sections: cloneSections(localBlog.sections),
      titleStyle: { ...titleStyle },
      sectionStyles: { ...sectionStyleMap },
      editorHtml: beforeEditorHtml,
    };
    const afterState = buildNextSnapshotFromMessage(msg, localBlog, titleStyle);
    let didApply = false;

    if (msg.actionType === 'editor_ops' && Array.isArray(msg.actionData?.operations)) {
      didApply = handleApplyEditorOps(
        msg.actionData.operations as EditorOp[],
        Array.isArray(msg.actionData?.operationOriginals)
          ? (msg.actionData.operationOriginals as OperationOriginalSnapshot[])
          : undefined
      );
    } else if (msg.actionType === 'replace_all' && Array.isArray(msg.actionData?.sections)) {
      didApply = handleReplaceAllInEditor(
        msg.actionData.sections as BlogSection[],
        msg.actionData.title,
        msg.actionData.subtitle
      );
    } else if (msg.actionData?.sectionId && msg.actionData?.editedText) {
      const requestedId = sanitizePlainText(msg.actionData.sectionId);
      const resolvedId =
        resolveSectionId(requestedId, localBlog.sections) ||
        findSectionIdByOriginalText(sanitizePlainText(msg.actionData.originalText || ''), localBlog.sections) ||
        requestedId;
      const selectedText = normalizeLayoutText(msg.actionData.selectedText || '');
      if (selectedText && resolvedId && resolvedId !== 'title' && resolvedId !== 'subtitle') {
        const replacement = normalizeLayoutText(msg.actionData.editedText);
        let changed = false;
        const updatedSections = localBlog.sections.map((sec) => {
          if (sec.id !== resolvedId) return sec;
          if (sec.type === 'image') {
            const source = sec.caption || sec.text || '';
            const replaced = replaceSelectedTextInText(source, selectedText, replacement);
            if (!replaced.didReplace) return sec;
            changed = true;
            return { ...sec, text: replaced.nextText, caption: replaced.nextText };
          }
          const replaced = replaceSelectedTextInText(sec.text || '', selectedText, replacement);
          if (!replaced.didReplace) return sec;
          changed = true;
          return { ...sec, text: replaced.nextText };
        });
        if (changed) {
          const updated = { ...localBlog, sections: updatedSections };
          setLocalBlog(updated);
          debounceUpdateParent(updated);
          setEditorContentSilently(updatedSections);
          applyStoredSectionStyles(latestSectionStylesRef.current);
          didApply = true;
        }
      } else if (selectedText && resolvedId === 'title') {
        const replacement = normalizeLayoutText(msg.actionData.editedText);
        const replaced = replaceSelectedTextInText(localBlog.title, selectedText, replacement);
        if (replaced.didReplace) {
          const updated = { ...localBlog, title: replaced.nextText };
          setLocalBlog(updated);
          debounceUpdateParent(updated);
          didApply = true;
        }
      } else if (selectedText && resolvedId === 'subtitle') {
        const replacement = normalizeLayoutText(msg.actionData.editedText);
        const replaced = replaceSelectedTextInText(localBlog.subtitle || '', selectedText, replacement);
        if (replaced.didReplace) {
          const updated = { ...localBlog, subtitle: replaced.nextText };
          setLocalBlog(updated);
          debounceUpdateParent(updated);
          didApply = true;
        }
      } else {
        if (resolvedId === 'subtitle') {
          const updated = {
            ...localBlog,
            subtitle: normalizeLayoutText(msg.actionData.editedText || localBlog.subtitle || ''),
          };
          setLocalBlog(updated);
          debounceUpdateParent(updated);
          didApply = true;
        } else {
          didApply = handleReplaceInEditor(
            resolvedId,
            normalizeLayoutText(msg.actionData.editedText),
            sanitizePlainText(msg.actionData.sectionTitle || 'Section')
          );
        }
      }
    }

    if (!didApply) {
      return false;
    }

    let chatVersions: Array<{ id: string; sectionId: string; blogId: string }> = [];
    const versionChanges = buildVersionChanges(beforeState.sections, afterState.sections);
    if (versionChanges.length > 0) {
      try {
        chatVersions = await blogService.createChatVersions({
          blogId: localBlog.id,
          prompt: sanitizePlainText(msg.text),
          changes: versionChanges,
        });
      } catch (err) {
        console.warn('Failed to persist chat versions:', err);
      }
    }

    const afterEditorHtml = editor?.getHTML?.() || serializeSectionsToHtml(afterState.sections);
    const nextActionData = {
      ...(msg.actionData || {}),
      appliedAt: new Date().toISOString(),
      revertedAt: null,
      beforeState,
      afterState: {
        ...afterState,
        editorHtml: afterEditorHtml,
      },
      chatVersions,
    };

    setChatMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, actionData: nextActionData, showDiffCard: true } : m))
    );

    try {
      await chatService.updateMessageActionData(msg.id, {
        actionData: nextActionData,
        showDiffCard: true,
      });
    } catch (err) {
      console.warn('Failed to persist applied action state:', err);
    }
    return true;
  };

  const revertSuggestionMessage = async (msg: ChatMessage) => {
    const beforeState = msg.actionData?.beforeState;
    const chatVersions = Array.isArray(msg.actionData?.chatVersions)
      ? (msg.actionData.chatVersions as Array<{ id?: string; sectionId?: string }>)
      : [];

    if (beforeState?.sections) {
      const restoredSectionsFromSnapshot = cloneSections(beforeState.sections as BlogSection[]);
      const restoredFromHtml =
        typeof beforeState.editorHtml === 'string' && beforeState.editorHtml.trim().length > 0
          ? ensureStableSectionIds(parseHtmlToSections(beforeState.editorHtml, restoredSectionsFromSnapshot))
          : null;
      const restoredSections =
        restoredFromHtml && restoredFromHtml.length > 0 ? restoredFromHtml : restoredSectionsFromSnapshot;
      const restoredStyles = (beforeState.sectionStyles || {}) as Record<string, TitleStyleState>;
      const restored: Blog = {
        ...localBlog,
        title: normalizeLayoutText(beforeState.title || localBlog.title),
        subtitle: normalizeLayoutText(beforeState.subtitle || localBlog.subtitle || ''),
        sections: restoredSections,
      };

      setLocalBlog(restored);
      debounceUpdateParent(restored);
      setTitleStyle((beforeState.titleStyle || {}) as TitleStyleState);
      setSectionStyleMap(restoredStyles);
      if (typeof beforeState.editorHtml === 'string' && beforeState.editorHtml.trim().length > 0) {
        setEditorHtmlSilently(beforeState.editorHtml);
      } else {
        setEditorContentSilently(restoredSections);
      }
      applyStoredSectionStyles(restoredStyles);
    } else if (chatVersions.length > 0) {
      try {
        await Promise.all(
          chatVersions
            .filter((v) => !!v?.id && !!v?.sectionId)
            .map((v) => blogService.rollbackVersion(sanitizePlainText(v.sectionId || ''), sanitizePlainText(v.id || '')))
        );
        const refreshed = await blogService.getBlogById(blog.id);
        if (refreshed) {
          setLocalBlog(refreshed);
          onUpdateBlog(refreshed);
          setSectionStyleMap({});
          setEditorContentSilently(refreshed.sections);
        }
      } catch (err) {
        console.warn('Failed to rollback via persisted versions:', err);
      }
    } else {
      return;
    }

    setChatMessages((prev) => [
      ...prev.map((m) =>
        m.id === msg.id
          ? {
              ...m,
              actionData: {
                ...(m.actionData || {}),
                revertedAt: new Date().toISOString(),
              },
            }
          : m
      ),
      {
        id: `sys-${Date.now()}`,
        sender: 'assistant',
        text: 'Reverted. Restored the previous content state for this AI change.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    try {
      await chatService.updateMessageActionData(msg.id, {
        actionData: {
          ...(msg.actionData || {}),
          revertedAt: new Date().toISOString(),
        },
        showDiffCard: true,
      });
    } catch (err) {
      console.warn('Failed to persist reverted action state:', err);
    }
  };

  const clipCardText = (value: string, max = 420): string => {
    void max;
    return normalizeLayoutText(value);
  };

  const getSectionDisplayText = (sectionId?: string): string => {
    if (!sectionId) return '';
    if (sectionId === 'title') return normalizeLayoutText(localBlog.title);
    if (sectionId === 'subtitle') return normalizeLayoutText(localBlog.subtitle || '');
    const resolvedId = resolveSectionId(sectionId, localBlog.sections) || sectionId;
    const section = localBlog.sections.find((sec) => sec.id === resolvedId);
    if (!section) return '';
    if (section.type === 'image') {
      return normalizeLayoutText(section.caption || section.url || '');
    }
    return normalizeLayoutText(section.text || '');
  };

  const extractImageUrlFromText = (value: unknown): string => {
    const raw = typeof value === 'string' ? value : '';
    if (!raw) return '';
    const markdownMatch = raw.match(/!\[[^\]]*]\(([^)]+)\)/);
    const urlMatch = raw.match(/https?:\/\/\S+/i);
    const candidate = sanitizePlainText(markdownMatch?.[1] || urlMatch?.[0] || '');
    if (!candidate) return '';
    return normalizeEditorImageUrl(candidate, 'history-image');
  };

  const mergeStyle = (current: TitleStyleState | undefined, op: EditorOp): TitleStyleState => ({
    ...(current || {}),
    ...(typeof op.bold === 'boolean' ? { bold: op.bold } : {}),
    ...(typeof op.italic === 'boolean' ? { italic: op.italic } : {}),
    ...(op.color ? { color: op.color } : {}),
  });

  const toTextStyle = (style?: TitleStyleState): React.CSSProperties | undefined => {
    if (!style) return undefined;
    return {
      color: style.color || undefined,
      fontStyle: typeof style.italic === 'boolean' ? (style.italic ? 'italic' : 'normal') : undefined,
      fontWeight: typeof style.bold === 'boolean' ? (style.bold ? 700 : 400) : undefined,
    };
  };

  const renderListOrTextContent = (
    value: string,
    opts?: {
      style?: React.CSSProperties;
      textClassName?: string;
      orderedListClassName?: string;
      bulletListClassName?: string;
      itemClassName?: string;
    }
  ) => {
    const clean = coerceImplicitOrderedListText(normalizeLayoutText(value));
    const blocks = parseContentBlocks(clean);
    if (blocks.length > 0) {
      if (blocks.length === 1 && blocks[0].kind === 'ordered') {
        const ordered = blocks[0];
        return (
          <ol
            className={opts?.orderedListClassName || 'list-decimal pl-6 space-y-1'}
            style={opts?.style}
            start={ordered.start > 1 ? ordered.start : undefined}
          >
            {ordered.items.map((item, idx) => (
              <li key={`olist-${idx}`} className={opts?.itemClassName || 'leading-relaxed'}>
                {item}
              </li>
            ))}
          </ol>
        );
      }

      if (blocks.length === 1 && blocks[0].kind === 'bullet') {
        const bullet = blocks[0];
        return (
          <ul className={opts?.bulletListClassName || 'list-disc pl-6 space-y-1'} style={opts?.style}>
            {bullet.items.map((item, idx) => (
              <li key={`ulist-${idx}`} className={opts?.itemClassName || 'leading-relaxed'}>
                {item}
              </li>
            ))}
          </ul>
        );
      }

      return (
        <div className="space-y-2" style={opts?.style}>
          {blocks.map((block, idx) => {
            if (block.kind === 'ordered') {
              return (
                <ol
                  key={`mix-ol-${idx}`}
                  className={opts?.orderedListClassName || 'list-decimal pl-6 space-y-1'}
                  start={block.start > 1 ? block.start : undefined}
                >
                  {block.items.map((item, itemIdx) => (
                    <li key={`mix-ol-item-${idx}-${itemIdx}`} className={opts?.itemClassName || 'leading-relaxed'}>
                      {item}
                    </li>
                  ))}
                </ol>
              );
            }

            if (block.kind === 'bullet') {
              return (
                <ul key={`mix-ul-${idx}`} className={opts?.bulletListClassName || 'list-disc pl-6 space-y-1'}>
                  {block.items.map((item, itemIdx) => (
                    <li key={`mix-ul-item-${idx}-${itemIdx}`} className={opts?.itemClassName || 'leading-relaxed'}>
                      {item}
                    </li>
                  ))}
                </ul>
              );
            }

            return (
              <p key={`mix-p-${idx}`} className={opts?.textClassName || 'whitespace-pre-wrap leading-relaxed'}>
                {block.text}
              </p>
            );
          })}
        </div>
      );
    }

    return (
      <p className={opts?.textClassName || 'whitespace-pre-wrap leading-relaxed'} style={opts?.style}>
        {clean}
      </p>
    );
  };

  const buildEditorOpsCardText = (
    operations: EditorOp[],
    operationOriginals?: OperationOriginalSnapshot[]
  ) => {
    const originalLines: string[] = [];
    const suggestedLines: string[] = [];
    let suggestedStyle: TitleStyleState | undefined;
    const listOrDeleteTargets = new Set(
      operations
        .filter((op) => op.op === 'replace_section_text' || op.op === 'delete_section' || op.op === 'replace_image')
        .map((op) => sanitizePlainText(op.sectionId || ''))
        .filter(Boolean)
    );
    const pushUniqueLine = (bucket: string[], text: string) => {
      const normalized = normalizeLayoutText(text);
      if (!normalized) return;
      if (bucket.some((line) => normalizeLayoutText(line) === normalized)) return;
      bucket.push(normalized);
    };

    for (const [index, op] of operations.entries()) {
      const originalSnapshot =
        operationOriginals?.find((x) => x.opIndex === index) || operationOriginals?.[index];
      if (op.op === 'rename_title') {
        pushUniqueLine(originalLines, op.selectedText || localBlog.title);
        pushUniqueLine(suggestedLines, op.text || '');
        continue;
      }

      if (op.op === 'style_title') {
        const cleanTitle = normalizeLayoutText(op.selectedText || localBlog.title);
        pushUniqueLine(originalLines, cleanTitle);
        pushUniqueLine(suggestedLines, cleanTitle);
        suggestedStyle = mergeStyle(suggestedStyle, op);
        continue;
      }

      if (op.op === 'replace_section_text') {
        const current =
          normalizeLayoutText(originalSnapshot?.originalText || '') ||
          getSectionDisplayText(op.sectionId) ||
          normalizeLayoutText(op.selectedText || '');
        if (current) {
          pushUniqueLine(originalLines, current);
        }
        pushUniqueLine(suggestedLines, op.text || '');
        continue;
      }

      if (op.op === 'delete_section') {
        const current =
          normalizeLayoutText(originalSnapshot?.originalText || '') ||
          getSectionDisplayText(op.sectionId) ||
          normalizeLayoutText(op.selectedText || '');
        if (current) {
          pushUniqueLine(originalLines, current);
        }
        pushUniqueLine(
          suggestedLines,
          op.selectedText ? 'This selected text will be removed.' : 'This selected section will be removed.'
        );
        continue;
      }

      if (op.op === 'replace_image' && op.sectionId) {
        const current =
          normalizeLayoutText(originalSnapshot?.originalText || '') ||
          getSectionDisplayText(op.sectionId) ||
          normalizeLayoutText(op.selectedText || '');
        if (current) {
          pushUniqueLine(originalLines, current);
        }
        pushUniqueLine(
          suggestedLines,
          op.caption || op.text || 'Image updated in the selected position.'
        );
        continue;
      }

      if (op.op === 'insert_image_after') {
        const anchor =
          normalizeLayoutText(originalSnapshot?.anchorOriginalText || '') ||
          getSectionDisplayText(op.afterSectionId || op.sectionId);
        if (anchor) {
          pushUniqueLine(originalLines, anchor);
        }
        pushUniqueLine(
          suggestedLines,
          op.caption || op.text || 'A new image will be inserted at the requested position.'
        );
        continue;
      }

      if (op.op === 'style_section') {
        const targetKey = sanitizePlainText(op.sectionId || '');
        if (targetKey && listOrDeleteTargets.has(targetKey)) {
          suggestedStyle = mergeStyle(suggestedStyle, op);
          continue;
        }
        const current =
          normalizeLayoutText(originalSnapshot?.originalText || '') ||
          getSectionDisplayText(op.sectionId);
        if (current) {
          pushUniqueLine(originalLines, current);
          pushUniqueLine(suggestedLines, current);
          suggestedStyle = mergeStyle(suggestedStyle, op);
        }
      }
    }

    return {
      originalText:
        clipCardText(originalLines.filter(Boolean).join('\n\n')) ||
        'Current editor content is ready for updates.',
      suggestedText:
        clipCardText(suggestedLines.filter(Boolean).join('\n\n')) ||
        'Requested editor updates are ready to apply.',
      suggestedStyle,
    };
  };

  const buildDiffCardContent = (msg: ChatMessage): DiffCardContent => {
    if (msg.actionType === 'editor_ops' && Array.isArray(msg.actionData?.operations)) {
      const opText = buildEditorOpsCardText(
        msg.actionData.operations as EditorOp[],
        Array.isArray(msg.actionData?.operationOriginals)
          ? (msg.actionData.operationOriginals as any[])
          : undefined
      );
      return {
        originalText: opText.originalText,
        suggestedText: opText.suggestedText,
        suggestedStyle: opText.suggestedStyle,
        explanation:
          sanitizeDisplayText(msg.actionData?.explanation || msg.text) ||
          'Applied the exact editor updates requested by you.',
      };
    }

    if (msg.actionType === 'replace_all' && Array.isArray(msg.actionData?.sections)) {
      const currentDoc = [
        localBlog.title,
        localBlog.subtitle || '',
        ...localBlog.sections
          .map((sec) => sec.text || sec.caption || '')
          .filter(Boolean),
      ].join('\n\n');

      const nextDoc = [
        msg.actionData?.title || localBlog.title,
        msg.actionData?.subtitle || localBlog.subtitle || '',
        ...(msg.actionData.sections as BlogSection[])
          .map((sec) => sec.text || sec.caption || '')
          .filter(Boolean),
      ].join('\n\n');

      return {
        originalText: clipCardText(normalizeLayoutText(currentDoc)),
        suggestedText: clipCardText(normalizeLayoutText(nextDoc)),
        explanation:
          sanitizeDisplayText(msg.actionData?.explanation || msg.text) ||
          'Prepared a full blog replacement based on your instruction.',
      };
    }

    const directOriginalText =
      sanitizeDisplayText(msg.actionData?.originalText || '') || getSectionDisplayText(msg.actionData?.sectionId);
    const directSuggestedText = sanitizeDisplayText(msg.actionData?.editedText || '');
    if (directOriginalText || directSuggestedText) {
      return {
        originalText: clipCardText(directOriginalText || 'Current selected content.'),
        suggestedText: clipCardText(directSuggestedText || 'Suggested update ready to apply.'),
        explanation:
          sanitizeDisplayText(msg.actionData?.explanation || msg.text) ||
          'Prepared an updated version from your prompt.',
      };
    }

    const beforeSectionsSnapshot = Array.isArray(msg.actionData?.beforeState?.sections)
      ? cloneSections(msg.actionData.beforeState.sections as BlogSection[])
      : null;
    const afterSectionsSnapshot = Array.isArray(msg.actionData?.afterState?.sections)
      ? cloneSections(msg.actionData.afterState.sections as BlogSection[])
      : null;

    if (beforeSectionsSnapshot && afterSectionsSnapshot) {
      const originalLines: string[] = [];
      const suggestedLines: string[] = [];
      const pushUniqueLine = (bucket: string[], value: string) => {
        const clean = normalizeLayoutText(value);
        if (!clean) return;
        if (bucket.some((line) => normalizeLayoutText(line) === clean)) return;
        bucket.push(clean);
      };

      const beforeTitle = normalizeLayoutText(msg.actionData?.beforeState?.title || localBlog.title);
      const afterTitle = normalizeLayoutText(msg.actionData?.afterState?.title || localBlog.title);
      if (beforeTitle !== afterTitle) {
        pushUniqueLine(originalLines, beforeTitle);
        pushUniqueLine(suggestedLines, afterTitle);
      }

      const beforeSubtitle = normalizeLayoutText(msg.actionData?.beforeState?.subtitle || '');
      const afterSubtitle = normalizeLayoutText(msg.actionData?.afterState?.subtitle || '');
      if (beforeSubtitle !== afterSubtitle) {
        pushUniqueLine(originalLines, beforeSubtitle);
        pushUniqueLine(suggestedLines, afterSubtitle);
      }

      const changedSections = buildVersionChanges(beforeSectionsSnapshot, afterSectionsSnapshot);
      changedSections.forEach((change) => {
        pushUniqueLine(originalLines, change.originalText);
        pushUniqueLine(suggestedLines, change.editedText);
      });

      if (originalLines.length > 0 || suggestedLines.length > 0) {
        return {
          originalText:
            clipCardText(originalLines.join('\n\n')) ||
            'Original content snapshot was not available for this change.',
          suggestedText:
            clipCardText(suggestedLines.join('\n\n')) ||
            'Updated content snapshot was not available for this change.',
          explanation:
            sanitizeDisplayText(msg.actionData?.explanation || msg.text) ||
            'Showing the exact changed content captured for this update.',
        };
      }
    }

    return {
      originalText: 'Current selected content.',
      suggestedText: 'Suggested update ready to apply.',
      explanation:
        sanitizeDisplayText(msg.actionData?.explanation || msg.text) ||
        'Prepared an updated version from your prompt.',
    };
  };

  const appliedChatHistory = useMemo(() => {
    return [...chatMessages]
      .filter((m) => m.sender === 'assistant' && !!m.actionData?.appliedAt)
      .sort((a, b) => {
        const ta = new Date(a.actionData?.appliedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.actionData?.appliedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
  }, [chatMessages]);

  const getSectionLabel = (sectionId: string): string => {
    const section = localBlog.sections.find((s) => s.id === sectionId);
    if (!section) return 'Section';
    if (section.type === 'heading') return `Heading: ${sanitizeDisplayText(section.text || '').slice(0, 70) || 'Heading'}`;
    if (section.type === 'image') return `Image: ${sanitizeDisplayText(section.caption || section.text || '').slice(0, 70) || 'Image'}`;
    return `Paragraph: ${sanitizeDisplayText(section.text || '').slice(0, 70) || 'Paragraph'}`;
  };

  const previewBeforeState = previewMessage?.actionData?.beforeState;
  const previewAfterState = previewMessage?.actionData?.afterState;
  const previewBeforeSections = Array.isArray(previewBeforeState?.sections)
    ? cloneSections(previewBeforeState.sections as BlogSection[])
    : null;
  const previewAfterSections = Array.isArray(previewAfterState?.sections)
    ? cloneSections(previewAfterState.sections as BlogSection[])
    : null;
  const previewHasPersistedState = Boolean(previewBeforeSections && previewAfterSections);
  const previewBaseTitle = previewHasPersistedState
    ? normalizeLayoutText(previewBeforeState?.title || localBlog.title)
    : normalizeLayoutText(localBlog.title);
  const previewBaseSubtitle = previewHasPersistedState
    ? normalizeLayoutText(previewBeforeState?.subtitle || localBlog.subtitle || '')
    : normalizeLayoutText(localBlog.subtitle || '');
  const previewBaseSections = previewHasPersistedState
    ? (previewBeforeSections as BlogSection[])
    : localBlog.sections;
  const previewBaseTitleStyle: TitleStyleState =
    previewHasPersistedState && typeof previewBeforeState?.titleStyle === 'object'
      ? ({ ...(previewBeforeState.titleStyle as TitleStyleState) } as TitleStyleState)
      : ({ ...titleStyle } as TitleStyleState);
  const previewBaseSectionStyles: Record<string, TitleStyleState> =
    previewHasPersistedState && typeof previewBeforeState?.sectionStyles === 'object'
      ? ({ ...(previewBeforeState.sectionStyles as Record<string, TitleStyleState>) } as Record<
          string,
          TitleStyleState
        >)
      : ({ ...sectionStyleMap } as Record<string, TitleStyleState>);
  const previewPersistedTitle = previewHasPersistedState
    ? normalizeLayoutText(previewAfterState?.title || previewBaseTitle)
    : '';
  const previewPersistedSubtitle = previewHasPersistedState
    ? normalizeLayoutText(previewAfterState?.subtitle || previewBaseSubtitle)
    : '';
  const previewPersistedSections = previewHasPersistedState
    ? (previewAfterSections as BlogSection[])
    : [];
  const previewPersistedTitleStyle: TitleStyleState =
    previewHasPersistedState && typeof previewAfterState?.titleStyle === 'object'
      ? ({ ...(previewAfterState.titleStyle as TitleStyleState) } as TitleStyleState)
      : ({ ...previewBaseTitleStyle } as TitleStyleState);
  const previewPersistedSectionStyles: Record<string, TitleStyleState> =
    previewHasPersistedState && typeof previewAfterState?.sectionStyles === 'object'
      ? ({ ...(previewAfterState.sectionStyles as Record<string, TitleStyleState>) } as Record<
          string,
          TitleStyleState
        >)
      : ({ ...previewBaseSectionStyles } as Record<string, TitleStyleState>);

  const previewOpsState =
    !previewHasPersistedState &&
    previewMessage?.actionType === 'editor_ops' &&
    Array.isArray(previewMessage.actionData?.operations)
      ? buildEditorOpsPreview(
          previewMessage.actionData.operations as EditorOp[],
          Array.isArray(previewMessage.actionData?.operationOriginals)
            ? (previewMessage.actionData.operationOriginals as OperationOriginalSnapshot[])
            : undefined
        )
      : null;
  const previewEditorOps: EditorOp[] =
    !previewHasPersistedState &&
    previewMessage?.actionType === 'editor_ops' &&
    Array.isArray(previewMessage.actionData?.operations)
      ? resolveEditorOpsWithSnapshots(
          previewMessage.actionData.operations as EditorOp[],
          previewBaseSections,
          Array.isArray(previewMessage.actionData?.operationOriginals)
            ? (previewMessage.actionData.operationOriginals as OperationOriginalSnapshot[])
            : undefined
        )
      : [];
  const previewAlreadyReplaced = Boolean(previewMessage?.actionData?.appliedAt);

  const sectionOpsById = previewEditorOps.reduce<Record<string, EditorOp[]>>((acc, op) => {
    if (!op.sectionId) return acc;
    acc[op.sectionId] = acc[op.sectionId] || [];
    acc[op.sectionId].push(op);
    return acc;
  }, {});

  const insertedAfterOps = previewEditorOps
    .filter((op) => op.op === 'insert_image_after')
    .reduce<Record<string, EditorOp[]>>((acc, op) => {
      const anchor = op.afterSectionId || op.sectionId;
      if (!anchor) return acc;
      acc[anchor] = acc[anchor] || [];
      acc[anchor].push(op);
      return acc;
    }, {});

  const getSectionPlain = (sec: BlogSection): string =>
    sanitizeDisplayText(sec.text || sec.caption || '');

  const sectionLooksSame = (a?: BlogSection, b?: BlogSection): boolean => {
    if (!a || !b) return false;
    return (
      a.type === b.type &&
      getSectionPlain(a) === getSectionPlain(b) &&
      sanitizeDisplayText(a.url || '') === sanitizeDisplayText(b.url || '') &&
      sanitizeDisplayText(a.caption || '') === sanitizeDisplayText(b.caption || '')
    );
  };

  const renderPreviewSectionBlock = (
    sec: BlogSection,
    key: string,
    opts?: { style?: TitleStyleState; highlight?: 'original' | 'new' }
  ) => {
    const textStyle = toTextStyle(opts?.style);
    const highlightClass =
      opts?.highlight === 'original'
        ? 'bg-red-100/80 border border-red-300 p-3 rounded-xl'
        : opts?.highlight === 'new'
        ? 'bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl'
        : '';

    if (sec.type === 'heading') {
      const headingLevel = sec.level === 3 ? 3 : 2;
      const headingClass =
        headingLevel === 3
          ? `text-[var(--blog-h3-size)] leading-[1.42] font-bold text-[#4a3e30] mt-4 mb-2 ${highlightClass}`
          : `text-[var(--blog-h2-size)] leading-[1.34] font-extrabold text-[#3a3024] mt-5 mb-2 ${highlightClass}`;
      const HeadingTag = headingLevel === 3 ? 'h3' : 'h2';
      return (
        <HeadingTag key={key} className={headingClass} style={textStyle}>
          {getSectionPlain(sec)}
        </HeadingTag>
      );
    }

    if (sec.type === 'callout') {
      return (
        <blockquote key={key} className={`${highlightClass}`} style={textStyle}>
          {renderListOrTextContent(getSectionPlain(sec), {
            textClassName: 'whitespace-pre-wrap leading-8',
            orderedListClassName: 'list-decimal pl-6 space-y-1',
            bulletListClassName: 'list-disc pl-6 space-y-1',
            itemClassName: 'leading-8',
          })}
        </blockquote>
      );
    }

    if (sec.type === 'image') {
      return (
        <div key={key} className={`my-6 ${highlightClass}`}>
          {sec.url ? (
            <img
              src={sec.url}
              alt={sanitizeDisplayText(sec.caption || '')}
              className="rounded-xl max-h-[440px] w-full mx-auto object-contain bg-amber-50/60 border border-amber-100 p-1.5"
              onError={(e) => {
                const target = e.currentTarget as HTMLImageElement;
                target.src = defaultImageUrl(sec.caption || sec.text || sec.id || 'blog-image');
              }}
            />
          ) : (
            <div className="text-sm text-slate-500 text-center py-4">No image in this section.</div>
          )}
          {sec.caption && <p className="text-center text-xs text-slate-400 mt-2">{sanitizeDisplayText(sec.caption)}</p>}
        </div>
      );
    }

    return (
      <div key={key} className={`text-justify leading-8 ${highlightClass}`}>
        {renderListOrTextContent(getSectionPlain(sec), {
          style: textStyle,
          textClassName: 'text-justify whitespace-pre-wrap leading-8',
          orderedListClassName: 'list-decimal pl-6 space-y-1 leading-8',
          bulletListClassName: 'list-disc pl-6 space-y-1 leading-8',
          itemClassName: 'leading-8',
        })}
      </div>
    );
  };

  const renderInlineChangeAtPosition = (
    keyBase: string,
    originalSec: BlogSection | null,
    newSec: BlogSection | null,
    newStyle?: TitleStyleState
  ) => (
    <div key={keyBase} className="space-y-2 preview-changed">
      {originalSec ? (
        renderPreviewSectionBlock(originalSec, `${keyBase}-old`, { highlight: 'original' })
      ) : (
        <p key={`${keyBase}-old-empty`} className="text-sm text-slate-600 bg-red-100/80 border border-red-300 p-3 rounded-xl">
          No original section at this location.
        </p>
      )}
      {newSec ? (
        renderPreviewSectionBlock(newSec, `${keyBase}-new`, { highlight: 'new', style: newStyle })
      ) : (
        <p key={`${keyBase}-new-empty`} className="text-sm text-slate-700 bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl">
          This section will be removed.
        </p>
      )}
    </div>
  );

  const getSectionTypeHint = (sectionId?: string | null): BlogSection['type'] => {
    if (!sectionId) return 'paragraph';
    const section = localBlog.sections.find((s) => s.id === sectionId);
    return section?.type || 'paragraph';
  };

  const toHistorySectionFromText = (
    rawValue: unknown,
    keySeed: string,
    sectionTypeHint?: BlogSection['type']
  ): BlogSection | null => {
    const normalizedText = normalizeLayoutText(rawValue);
    const imageUrl = extractImageUrlFromText(rawValue);
    if (!normalizedText && !imageUrl) return null;

    const typeHint = sectionTypeHint || 'paragraph';
    const quotedLike = /^>\s+/.test(normalizedText);
    const isImageLike = Boolean(imageUrl) || typeHint === 'image';

    if (isImageLike) {
      const caption = normalizeLayoutText(
        (normalizedText || '')
          .replace(/!\[[^\]]*]\(([^)]+)\)/g, ' ')
          .replace(/https?:\/\/\S+/gi, ' ')
      );
      const finalCaption = caption || normalizeLayoutText(rawValue) || 'Image';
      return {
        id: `${keySeed}-img`,
        type: 'image',
        text: finalCaption,
        caption: finalCaption,
        url: normalizeEditorImageUrl(imageUrl || '', finalCaption || keySeed),
      };
    }

    if (typeHint === 'heading') {
      return {
        id: `${keySeed}-heading`,
        type: 'heading',
        level: 2,
        text: normalizeLayoutText(normalizedText.replace(/^#+\s+/, '')),
      };
    }

    if (typeHint === 'callout' || quotedLike) {
      return {
        id: `${keySeed}-callout`,
        type: 'callout',
        text: normalizeLayoutText(normalizedText.replace(/^>\s+/gm, '')),
      };
    }

    return {
      id: `${keySeed}-para`,
      type: 'paragraph',
      text: normalizedText,
    };
  };

  const renderHistoryTextDiffBlock = (
    value: unknown,
    keySeed: string,
    opts?: {
      sectionTypeHint?: BlogSection['type'];
      highlight?: 'original' | 'new';
      style?: TitleStyleState;
    }
  ) => {
    const section = toHistorySectionFromText(value, keySeed, opts?.sectionTypeHint);
    if (!section) {
      const emptyMessage =
        opts?.highlight === 'new'
          ? 'No updated content available for this snapshot.'
          : 'No original content available for this snapshot.';
      return (
        <p
          key={`${keySeed}-empty`}
          className={`text-sm p-3 rounded-xl border ${
            opts?.highlight === 'new'
              ? 'bg-emerald-100/80 border-emerald-300 text-slate-700'
              : 'bg-red-100/80 border-red-300 text-slate-600'
          }`}
        >
          {emptyMessage}
        </p>
      );
    }
    return renderPreviewSectionBlock(section, keySeed, {
      highlight: opts?.highlight,
      style: opts?.style,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-slate-50 overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 bg-white border-b border-slate-200 select-none">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 py-1.5 px-3 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-xl text-xs font-semibold border border-transparent hover:border-slate-200 transition-all"
          >
            <Icons.ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-slate-800 leading-none truncate max-w-xs md:max-w-md">
              {blog.title}
            </h1>
            <div className="flex items-center gap-2">
              <span className="py-0.5 px-2 bg-brand-50 border border-brand-primary/30 text-brand-primary text-[10px] font-bold rounded-full">
                Status: {blog.status}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">{blog.lastSaved}</span>
            </div>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* Metadata */}
          <div className="hidden md:flex items-center gap-4 text-xs font-medium text-slate-400 border-r border-slate-200 pr-4">
            <span>{blog.words.toLocaleString()} words</span>
            <span className="flex items-center gap-1">
              <Icons.Check className="w-3.5 h-3.5 text-emerald-500 stroke-[3px]" />
              Saved
            </span>
          </div>

          {/* Layout Mode Toggles */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              onClick={() => setDeviceLayout('desktop')}
              className={`p-1.5 rounded-md transition-colors ${
                deviceLayout === 'desktop' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-700'
              }`}
              title="Desktop View"
            >
              <Icons.Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeviceLayout('tablet')}
              className={`p-1.5 rounded-md transition-colors ${
                deviceLayout === 'tablet' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-700'
              }`}
              title="Tablet View"
            >
              <Icons.Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeviceLayout('mobile')}
              className={`p-1.5 rounded-md transition-colors ${
                deviceLayout === 'mobile' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-700'
              }`}
              title="Mobile View"
            >
              <Icons.Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Theme Switcher */}
          <button
            onClick={onToggleSidebarTheme}
            className="p-2 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"
            title="Toggle Sidebar Theme"
          >
            {isDarkSidebar ? (
              <Icons.Moon className="w-4 h-4 text-slate-600" />
            ) : (
              <Icons.Sun className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {/* Publish Split Button */}
          <div className="flex items-center bg-brand-primary hover:bg-brand-primaryHover text-white rounded-xl shadow-md shadow-black/20 transition-colors">
            <button className="py-2 px-4 text-xs font-semibold border-r border-white/20 active:scale-[0.98]">
              Publish
            </button>
            <button className="py-2 px-2.5 active:scale-[0.98]">
              <Icons.ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Editor Layout (Workspace + Right Chat Panel) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Main Editor Work Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
          
          {/* Tab Selection */}
          <div className="bg-white border-b border-slate-200 px-6 flex items-center gap-6 select-none flex-shrink-0">
            {['Editor', 'Outline', 'SEO', 'History'].map((tab) => {
              const isSelected = activeTab === tab.toLowerCase();
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab.toLowerCase() as any)}
                  className={`py-3.5 text-xs font-semibold border-b-2 transition-all ${
                    isSelected
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* WYSIWYG Editor Interactive Toolbar */}
          <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center gap-1.5 select-none flex-shrink-0">
            {/* Format indicator */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600">
              <span>
                {editor?.isActive('heading')
                  ? `Heading ${editor.getAttributes('heading').level}`
                  : editor?.isActive('blockquote')
                  ? 'Quote'
                  : 'Paragraph'}
              </span>
            </div>

            <div className="w-px h-5 bg-slate-200 mx-1"></div>

            {/* Header sizes */}
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-1.5 rounded-md text-xs font-bold transition-colors ${
                editor?.isActive('heading', { level: 1 })
                  ? 'bg-slate-100 text-slate-800'
                  : 'text-slate-650 hover:bg-slate-50 hover:text-slate-800'
              }`}
              title="Heading 1"
            >
              H1
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-1.5 rounded-md text-xs font-bold transition-colors ${
                editor?.isActive('heading', { level: 2 })
                  ? 'bg-slate-100 text-slate-800'
                  : 'text-slate-650 hover:bg-slate-50 hover:text-slate-800'
              }`}
              title="Heading 2"
            >
              H2
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`p-1.5 rounded-md text-xs font-bold transition-colors ${
                editor?.isActive('heading', { level: 3 })
                  ? 'bg-slate-100 text-slate-800'
                  : 'text-slate-650 hover:bg-slate-50 hover:text-slate-800'
              }`}
              title="Heading 3"
            >
              H3
            </button>

            <div className="w-px h-5 bg-slate-200 mx-1"></div>

            {/* Lists */}
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('bulletList')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Bulleted List"
            >
              <Icons.List className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('orderedList')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Numbered List"
            >
              <Icons.ListOrdered className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-1"></div>

            {/* Styling */}
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('bold')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Bold"
            >
              <Icons.Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('italic')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Italic"
            >
              <Icons.Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('underline')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Underline"
            >
              <Icons.Underline className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('strike')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Strikethrough"
            >
              <Icons.Strikethrough className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-1"></div>

            {/* Media/Link */}
            <button
              onClick={() => {
                if (!editor) return;
                const previousUrl = editor.getAttributes('link').href;
                const url = window.prompt('Enter link URL:', previousUrl || '');
                if (url === null) return;
                if (url === '') {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  return;
                }
                editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
              }}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('link')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Link"
            >
              <Icons.Link2 className="w-4 h-4" />
            </button>
            {['#1e293b', '#0f766e', '#a2692b', '#b91c1c', '#0f172a'].map((hex) => (
              <button
                key={hex}
                onClick={() => editor?.chain().focus().setColor(hex).run()}
                className="w-5 h-5 rounded border border-slate-200 hover:scale-110 transition-transform"
                style={{ backgroundColor: hex }}
                title={`Apply color ${hex}`}
              />
            ))}
            <button
              onClick={() => editor?.chain().focus().unsetColor().run()}
              className="p-1.5 rounded-md text-xs border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Reset text color"
            >
              A
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              className={`p-1.5 rounded-md transition-colors ${
                editor?.isActive('blockquote')
                  ? 'bg-slate-100 text-slate-800 font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title="Quote block"
            >
              <Icons.Quote className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const imageUrl = window.prompt('Enter image URL');
                if (!imageUrl || !editor) return;
                const imageCaption = window.prompt('Image caption (optional)') || '';
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: 'image',
                    attrs: {
                      src: imageUrl,
                      alt: sanitizePlainText(imageCaption),
                      id: generateUuid(),
                    },
                  })
                  .run();
              }}
              className="p-1.5 rounded-md transition-colors text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              title="Insert image"
            >
              <Icons.ImagePlus className="w-4 h-4" />
            </button>
          </div>


          {/* Editor Content Area wrapper with Device Layout class */}
          <div className="flex-1 overflow-y-auto p-8 flex justify-center bg-[#f5efe4]">
            <div
              className={`h-fit blog-paper rounded-2xl px-10 py-12 transition-all duration-300 ${
                deviceLayout === 'desktop'
                  ? 'w-full max-w-[820px]'
                  : deviceLayout === 'tablet'
                  ? 'w-[640px]'
                  : 'w-[360px] px-6 py-8'
              }`}
            >
              {activeTab === 'editor' && (
                <>
                  {/* Blog Title inside Editor */}
                  <div
                    className="relative mb-6 group"
                    onMouseEnter={() => setHoveredSectionId('title')}
                    onMouseLeave={() => {
                      setHoveredSectionId(null);
                      setActiveTooltipSectionId(null);
                    }}
                  >
                    <textarea
                      ref={titleRef}
                      value={localBlog.title}
                      onFocus={() => syncTitleSelectionScope()}
                      onSelect={() => syncTitleSelectionScope()}
                      onKeyUp={() => syncTitleSelectionScope()}
                      onMouseUp={() => syncTitleSelectionScope()}
                      onChange={(e) => {
                        const updated = { ...localBlog, title: e.target.value };
                        setLocalBlog(updated);
                        debounceUpdateParent(updated);
                        syncTitleSelectionScope();
                      }}
                      rows={1}
                      style={{
                        color: titleStyle.color || undefined,
                        fontStyle:
                          typeof titleStyle.italic === 'boolean'
                            ? (titleStyle.italic ? 'italic' : 'normal')
                            : undefined,
                        fontWeight:
                          typeof titleStyle.bold === 'boolean'
                            ? (titleStyle.bold ? 900 : 700)
                            : undefined,
                      }}
                      className="w-full blog-doc-title border-none outline-none focus:ring-0 placeholder-[#b7a891] bg-transparent resize-none overflow-hidden"
                      placeholder="Enter Title..."
                    />
                    <textarea
                      ref={subtitleRef}
                      value={localBlog.subtitle || ''}
                      onFocus={() => {
                        if (selectedEditorScopeRef.current.field) {
                          clearSelectedEditorScope();
                        }
                      }}
                      onChange={(e) => {
                        const updated = { ...localBlog, subtitle: e.target.value };
                        setLocalBlog(updated);
                        debounceUpdateParent(updated);
                      }}
                      rows={2}
                      className="w-full blog-doc-subtitle mt-2 border-none outline-none focus:ring-0 placeholder-[#8f7f67] bg-transparent resize-none overflow-hidden"
                      placeholder="Add a subtitle to frame the article context..."
                    />

                    {/* Inline Ask AI widget for title */}
                    {hoveredSectionId === 'title' && (
                      <div className="absolute right-0 top-2 flex items-center gap-1.5 z-10">
                        <div className="relative">
                          <button
                            onClick={() => {
                              handleSendChat(`Optimize the blog title "${localBlog.title}"`);
                              setActiveTooltipSectionId('title');
                              setTimeout(() => setActiveTooltipSectionId(null), 2000);
                            }}
                            onMouseEnter={() => setActiveTooltipSectionId('title')}
                            onMouseLeave={() => setActiveTooltipSectionId(null)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-brand-50 border border-brand-primary text-brand-primary text-[11px] font-bold rounded-lg shadow-sm transition-all"
                          >
                            <Icons.Sparkles className="w-3 h-3 text-brand-primary" />
                            <span>Ask AI</span>
                          </button>

                          {activeTooltipSectionId === 'title' && (
                            <div className="absolute top-full right-0 mt-1 bg-slate-950 text-white text-[10px] py-1 px-2.5 rounded shadow-lg whitespace-nowrap z-20">
                              Ask AI to edit this section
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Editable Blog Blocks */}
                  <div
                    className="relative flex flex-col gap-5 blog-content"
                    onMouseMove={(e) => {
                      if (e.buttons !== 0) return;
                      if (!editor) return;
                      const dom = editor.view.dom;
                      const posResult = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
                      if (posResult) {
                        const pos = posResult.pos;
                        const { node: domNode } = editor.view.domAtPos(pos);
                        if (domNode) {
                          let blockEl: HTMLElement | null = domNode.nodeType === Node.TEXT_NODE ? domNode.parentElement : domNode as HTMLElement;
                          while (blockEl && blockEl !== dom && blockEl.parentElement !== dom) {
                            blockEl = blockEl.parentElement;
                          }
                          if (blockEl && blockEl.parentElement === dom) {
                            const nodeId = blockEl.getAttribute('id') || blockEl.getAttribute('data-id');
                            if (nodeId && nodeId !== hoveredSectionId) {
                              setHoveredSectionId(nodeId);
                              const nodeRect = blockEl.getBoundingClientRect();
                              const containerRect = e.currentTarget.getBoundingClientRect();
                              const relativeTop = nodeRect.top - containerRect.top + nodeRect.height / 2;
                              setHoveredTop(relativeTop);
                            }
                          }
                        }
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredSectionId(null);
                      setActiveTooltipSectionId(null);
                    }}
                  >
                    <EditorContent editor={editor} className="w-full blog-content max-w-none" />

                    {/* Ask AI Widget Overlay */}
                    {hoveredSectionId && hoveredSectionId !== 'title' && (
                      <div
                        className="absolute right-0 flex items-center gap-1.5 z-10 bg-white/95 backdrop-blur-sm pl-2 pr-8"
                        style={{ top: `${hoveredTop}px`, transform: 'translateY(-50%)' }}
                      >
                        <div className="relative">
                          <button
                            onClick={() => {
                              const sec = localBlog.sections.find((s) => s.id === hoveredSectionId);
                              if (sec) {
                                handleAskAISection(sec);
                                setActiveTooltipSectionId(hoveredSectionId);
                                setTimeout(() => setActiveTooltipSectionId(null), 2000);
                              }
                            }}
                            onMouseEnter={() => setActiveTooltipSectionId(hoveredSectionId)}
                            onMouseLeave={() => setActiveTooltipSectionId(null)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-brand-50 border border-brand-primary text-brand-primary text-[10px] font-bold rounded-lg shadow-sm transition-all"
                          >
                            <Icons.Sparkles className="w-2.5 h-2.5 text-brand-primary" />
                            <span>Ask AI</span>
                          </button>

                          {activeTooltipSectionId === hoveredSectionId && (
                            <div className="absolute top-full right-0 mt-1 bg-slate-950 text-white text-[9px] py-1 px-2.5 rounded shadow-lg whitespace-nowrap z-20">
                              Ask AI to edit this section
                            </div>
                          )}
                        </div>

                        <button className="p-1 hover:bg-slate-100 rounded text-slate-400 cursor-grab active:cursor-grabbing">
                          <Icons.GripVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'outline' && (
                <div className="flex flex-col gap-4">
                  <h2 className="text-xl font-bold text-slate-800 border-b pb-2">Document Outline</h2>
                  <div className="flex flex-col gap-2">
                    {localBlog.sections.map((section) => {
                      if (section.type === 'heading') {
                        const indent = section.level === 3 ? 'pl-6 text-slate-500 text-sm' : 'font-semibold text-slate-700';
                        return (
                          <div key={section.id} className={`flex items-center gap-2 py-1 ${indent}`}>
                            <Icons.Menu className="w-3.5 h-3.5 text-slate-400" />
                            <span>{section.text || "(Empty Heading)"}</span>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'seo' && (
                <div className="flex flex-col gap-5">
                  <h2 className="text-xl font-bold text-slate-800 border-b pb-2">SEO Optimization</h2>
                  
                  <div className="flex items-center gap-4 bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
                    <div className="w-12 h-12 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-lg shadow-sm">
                      {localBlog.seoScore}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">SEO Health Score</h3>
                      <p className="text-xs text-slate-500">Your content is well optimized for target search terms.</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Target Keywords</span>
                    <div className="flex flex-wrap gap-1.5">
                      {localBlog.keywords.map((kw, i) => (
                        <span key={i} className="py-1 px-2.5 bg-slate-100 border border-slate-200 text-slate-600 text-xs rounded-lg font-medium">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5 mt-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">SEO Checklist</span>
                    {[
                      { label: 'Blog title includes target keyword', checked: true },
                      { label: 'At least 3 headers (H2/H3) used', checked: localBlog.sections.filter(s => s.type === 'heading').length >= 3 },
                      { label: 'Introduction paragraph is under 150 words', checked: true },
                      { label: 'Includes key takeaways callout', checked: localBlog.sections.some(s => s.type === 'callout') },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 text-xs text-slate-600">
                        {item.checked ? (
                          <Icons.CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Icons.Circle className="w-4 h-4 text-slate-300" />
                        )}
                        <span className={item.checked ? 'line-through text-slate-400' : ''}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="flex flex-col gap-5">
                  <h2 className="text-xl font-bold text-slate-800 border-b pb-2">Version History</h2>
                  
                  {isLoadingVersions ? (
                    <div className="py-10 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                      <Icons.Loader className="w-5 h-5 animate-spin text-brand-primary" />
                      <span>Loading revision history...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                          <Icons.Sparkles className="w-4 h-4 text-brand-primary" />
                          Applied Chat Updates
                        </h3>
                        <span className="text-[10px] text-slate-400">{appliedChatHistory.length} updates</span>
                      </div>

                      {appliedChatHistory.length === 0 ? (
                        <div className="text-xs text-slate-400 py-2">
                          No applied chat updates yet.
                        </div>
                      ) : (
                        appliedChatHistory.map((msg) => {
                          const diff = buildDiffCardContent(msg);
                          const fallbackSectionType = getSectionTypeHint(
                            sanitizePlainText(msg.actionData?.sectionId || '') || null
                          );
                          const isReverted = Boolean(msg.actionData?.revertedAt);
                          const canRevert = Boolean(msg.actionData?.appliedAt) && !isReverted;
                          const appliedAt = msg.actionData?.appliedAt || msg.createdAt;
                          return (
                            <div key={`chat-history-${msg.id}`} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-3">
                              <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                                <span className="font-bold text-slate-700 flex items-center gap-1">
                                  <Icons.History className="w-3.5 h-3.5 text-slate-400" />
                                  Applied at {appliedAt ? new Date(appliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : msg.time}
                                </span>
                                <span className="text-slate-400">
                                  {appliedAt ? new Date(appliedAt).toLocaleDateString() : ''}
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded whitespace-pre-wrap">
                                {sanitizeDisplayText(diff.explanation || msg.text)}
                              </p>

                              <div className="bg-[#f5efe4] border border-amber-100 rounded-xl p-3 max-h-[21rem] overflow-y-auto">
                                <div className="blog-paper rounded-xl p-4 blog-content max-w-none space-y-3">
                                  <div className="space-y-2 preview-changed">
                                    {renderHistoryTextDiffBlock(diff.originalText, `history-card-${msg.id}-original`, {
                                      sectionTypeHint: fallbackSectionType,
                                      highlight: 'original',
                                    })}
                                    {renderHistoryTextDiffBlock(diff.suggestedText, `history-card-${msg.id}-new`, {
                                      sectionTypeHint: fallbackSectionType,
                                      highlight: 'new',
                                      style: diff.suggestedStyle,
                                    })}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-end gap-2 mt-1">
                                {isReverted && (
                                  <span className="py-1 px-2 text-[10px] rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    Reverted
                                  </span>
                                )}
                                <button
                                  onClick={() =>
                                    setHistoryDiffPreview({
                                      message: msg,
                                      diff,
                                      sectionTypeHint: fallbackSectionType,
                                    })
                                  }
                                  className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Icons.Eye className="w-3.5 h-3.5" />
                                  <span>Preview</span>
                                </button>
                                <button
                                  onClick={() => revertSuggestionMessage(msg)}
                                  disabled={!canRevert}
                                  className={`py-1.5 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                                    canRevert
                                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  <Icons.RotateCcw className="w-3.5 h-3.5" />
                                  <span>Revert</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}

                      <div className="flex items-center justify-between border-b border-slate-100 pt-2 pb-1">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                          <Icons.ListChecks className="w-4 h-4 text-slate-500" />
                          Saved Section Versions
                        </h3>
                        <span className="text-[10px] text-slate-400">{versions.length} versions</span>
                      </div>

                      {versions.length === 0 ? (
                        <div className="text-xs text-slate-400 py-2">
                          No section versions saved yet.
                        </div>
                      ) : (
                        versions.map((ver) => {
                          const sectionTypeHint = getSectionTypeHint(ver.sectionId);
                          const sectionStyleHint = sectionStyleMap[ver.sectionId];
                          return (
                          <div key={ver.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-3">
                            <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                              <span className="font-bold text-slate-700 flex items-center gap-1">
                                <Icons.History className="w-3.5 h-3.5 text-slate-400" />
                                Revision at {new Date(ver.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-slate-400">
                                {new Date(ver.createdAt).toLocaleDateString()}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-500">
                              {getSectionLabel(ver.sectionId)}
                            </div>

                            {ver.promptUsed && (
                              <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded whitespace-pre-wrap">
                                <span className="font-bold text-slate-400 uppercase tracking-wide text-[9px] block">Instruction</span>
                                {sanitizeDisplayText(ver.promptUsed)}
                              </div>
                            )}

                            <div className="bg-[#f5efe4] border border-amber-100 rounded-xl p-3 max-h-[21rem] overflow-y-auto">
                              <div className="blog-paper rounded-xl p-4 blog-content max-w-none space-y-2 preview-changed">
                                {renderHistoryTextDiffBlock(ver.originalText, `version-${ver.id}-before`, {
                                  sectionTypeHint,
                                  highlight: 'original',
                                })}
                                {renderHistoryTextDiffBlock(ver.editedText, `version-${ver.id}-after`, {
                                  sectionTypeHint,
                                  highlight: 'new',
                                  style: sectionStyleHint,
                                })}
                              </div>
                            </div>

                            <div className="flex justify-end gap-2 mt-1">
                              <button
                                onClick={() => setHistoryPreviewVersion(ver)}
                                className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
                              >
                                <Icons.Eye className="w-3.5 h-3.5" />
                                <span>Preview</span>
                              </button>
                              <button
                                onClick={() => handleRollback(ver.sectionId, ver.id)}
                                className="py-1.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
                              >
                                <Icons.RotateCcw className="w-3.5 h-3.5" />
                                <span>Revert to this version</span>
                              </button>
                            </div>
                          </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer Metadata status bar */}
          <footer className="h-10 bg-white border-t border-slate-200 px-6 flex items-center justify-between text-[11px] font-semibold text-slate-400 select-none flex-shrink-0">
            <div className="flex items-center gap-4">
              <span>Words: {localBlog.words}</span>
              <span>Characters: {localBlog.words * 6.7 | 0}</span>
              <span>Read time: {localBlog.readTime}</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>{localBlog.tone || "General Tone"}</span>
              </div>
              <span>Audience: {localBlog.audience}</span>
              <div className="flex items-center gap-1.5">
                <span>SEO:</span>
                <span className="w-5 h-5 rounded-full border border-emerald-500 bg-emerald-50 text-emerald-600 text-[10px] font-bold flex items-center justify-center">
                  {localBlog.seoScore}
                </span>
              </div>
            </div>
          </footer>
        </div>

        {/* Resize handle divider between Editor Workspace and Right Sidebar */}
        <div
          onMouseDown={startResizingRight}
          className={`w-1 hover:w-1.5 active:w-1.5 cursor-col-resize h-full transition-all flex-shrink-0 select-none ${
            isResizingRight ? 'bg-slate-500' : 'bg-slate-800 hover:bg-slate-600'
          }`}
        />

        {/* Right AI Assistant Chat Sidebar */}
        <aside
          style={{ width: rightSidebarWidth }}
          className="flex-shrink-0 bg-[#171a20] border-l border-[#313847] flex flex-col justify-between overflow-hidden"
        >
          {/* Assistant Header */}
          <div className="p-4 border-b border-[#313847] bg-[#171a20] flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <Icons.Bot className="w-4 h-4 text-slate-200" />
              <span className="text-sm font-bold text-slate-100">AI Assistant</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1 py-1 px-2.5 bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-200 text-[10px] font-bold rounded-lg transition-all"
              >
                <Icons.Plus className="w-3 h-3" />
                <span>New Chat</span>
              </button>
              
              <button className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-200 rounded">
                <Icons.ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Chat Messages Log */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#0d0f13]">
            {chatMessages.map((msg) => {
              const isUser = msg.sender === 'user';
              const diffCard = !isUser && msg.showDiffCard && msg.actionData ? buildDiffCardContent(msg) : null;
              const isReplaced = Boolean(msg.actionData?.appliedAt);
              const isReverted = Boolean(msg.actionData?.revertedAt);
              const isApplied = isReplaced && !isReverted;
              const canRevert = Boolean(msg.actionData?.beforeState && isApplied);
              const hasChatVersions =
                Array.isArray(msg.actionData?.chatVersions) &&
                (msg.actionData?.chatVersions as Array<unknown>).length > 0;
              return (
                <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}>
                  {/* Sender Metadata (AI only) */}
                  {!isUser && (
                    <div className="flex items-center gap-1.5 px-1 select-none">
                      <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-slate-100">
                        <Icons.Bot className="w-2.5 h-2.5" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-100">AI Assistant</span>
                      <span className="text-[9px] text-slate-500">{msg.time}</span>
                    </div>
                  )}

                  {/* Bubble text */}
                  {msg.text && (
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                        isUser
                          ? 'bg-brand-primary text-white font-medium rounded-tr-none'
                          : 'bg-[#171a20] border border-[#2f3540] text-slate-200 rounded-tl-none shadow-sm'
                      }`}
                    >
                      {sanitizeDisplayText(msg.text)}
                    </div>
                  )}

                  {isUser && (
                    <span className="text-[9px] text-slate-500 px-1 select-none">{msg.time}</span>
                  )}

                  {/* Comparative Diff Card (Premium Dynamic UI) */}
                  {diffCard && (
                    <div className="w-full bg-[#171a20] border border-[#2f3540] rounded-2xl p-4 shadow-sm flex flex-col gap-4 my-1.5 select-none">
                      <div className="flex flex-col gap-3.5 pb-1">
                        <div className="border border-red-300 bg-red-100/70 rounded-2xl overflow-hidden shadow-sm">
                          <div className="bg-red-200/70 border-b border-red-300 px-4 py-2 text-[11px] font-extrabold text-red-800 uppercase tracking-[0.18em]">
                            ORIGINAL TEXT
                          </div>
                          <div className="px-4 py-3 max-h-64 overflow-y-auto">
                            {renderListOrTextContent(diffCard.originalText, {
                              textClassName: 'text-[14px] text-[#4a3c2d] leading-relaxed whitespace-pre-wrap',
                              orderedListClassName: 'list-decimal pl-6 space-y-1 text-[14px] text-[#4a3c2d]',
                              bulletListClassName: 'list-disc pl-6 space-y-1 text-[14px] text-[#4a3c2d]',
                              itemClassName: 'leading-relaxed',
                            })}
                          </div>
                        </div>

                        <div className="border border-emerald-300 bg-emerald-100/70 rounded-2xl overflow-hidden shadow-sm">
                          <div className="bg-emerald-200/70 border-b border-emerald-300 px-4 py-2 text-[11px] font-extrabold text-emerald-800 uppercase tracking-[0.18em]">
                            SUGGESTED EDIT
                          </div>
                          <div
                            className="px-4 py-3 text-[14px] text-[#3b3024] leading-relaxed whitespace-pre-wrap font-semibold max-h-64 overflow-y-auto"
                            style={toTextStyle(diffCard.suggestedStyle)}
                          >
                            {renderListOrTextContent(diffCard.suggestedText, {
                              style: toTextStyle(diffCard.suggestedStyle),
                              textClassName: 'text-[14px] text-[#3b3024] leading-relaxed whitespace-pre-wrap font-semibold',
                              orderedListClassName: 'list-decimal pl-6 space-y-1 text-[14px] text-[#3b3024] font-semibold',
                              bulletListClassName: 'list-disc pl-6 space-y-1 text-[14px] text-[#3b3024] font-semibold',
                              itemClassName: 'leading-relaxed',
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 text-[13px] leading-relaxed">
                        <div className="flex items-center gap-2 text-emerald-600 font-bold">
                          <Icons.CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span>AI Explanation</span>
                        </div>
                        <p className="text-slate-200 bg-[#0f131a] px-4 py-3 rounded-xl whitespace-pre-wrap">
                          {sanitizeDisplayText(diffCard.explanation)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                        {isReplaced && (
                          <span className="py-1 px-2 text-[10px] rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Replaced
                          </span>
                        )}
                        {isReverted && (
                          <span className="py-1 px-2 text-[10px] rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Reverted
                          </span>
                        )}
                        <button
                          onClick={() => applySuggestionMessage(msg)}
                          disabled={isReplaced}
                          className={`min-w-[130px] py-2.5 px-4 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm ${
                            isReplaced
                              ? 'bg-emerald-500 text-white cursor-default'
                              : 'bg-brand-primary hover:bg-brand-primaryHover text-white shadow-black/25'
                          }`}
                        >
                          <Icons.Check className="w-4 h-4" />
                          <span>{isReplaced ? 'Replaced' : 'Replace'}</span>
                        </button>

                        <button
                          onClick={() => setPreviewMessage(msg)}
                          className="py-2.5 px-4 border border-[#313847] hover:bg-slate-800 hover:text-slate-100 text-slate-300 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                          title="Preview changes applied to whole blog"
                        >
                          <Icons.Eye className="w-4 h-4" />
                          <span>Preview</span>
                        </button>

                        <button
                          onClick={() => handleRejectEdit(msg.id)}
                          className="py-2.5 px-4 border border-red-200 hover:bg-red-50 text-red-600 hover:text-red-700 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                          title="Reject suggestions"
                        >
                          <Icons.X className="w-4 h-4" />
                          <span>Reject</span>
                        </button>

                        {hasChatVersions && (
                          <button
                            onClick={() => setActiveTab('history')}
                            className="py-2.5 px-4 border border-[#313847] hover:bg-slate-800 text-slate-300 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                            title="Open Version History for rollback options"
                          >
                            <Icons.History className="w-4 h-4" />
                            <span>History</span>
                          </button>
                        )}

                        <button
                          onClick={() => revertSuggestionMessage(msg)}
                          disabled={!canRevert}
                          className={`py-2.5 px-4 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 ${
                            canRevert
                              ? 'border border-amber-200 hover:bg-amber-50 text-amber-700'
                              : 'border border-[#313847] text-slate-500 bg-[#11151d] cursor-not-allowed'
                          }`}
                          title={canRevert ? 'Revert this applied change' : 'Apply this suggestion first, then you can revert it'}
                        >
                          <Icons.RotateCcw className="w-4 h-4" />
                          <span>{canRevert ? 'Revert' : 'Revert (Apply first)'}</span>
                        </button>

                        {canRevert && (
                          <button
                            onClick={() => setActiveTab('history')}
                            className="py-2.5 px-4 border border-[#313847] hover:bg-slate-800 text-slate-300 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                            title="Open Version History"
                          >
                            <Icons.ListChecks className="w-4 h-4" />
                            <span>All Versions</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            const copyText =
                              sanitizeDisplayText(diffCard.suggestedText) || sanitizeDisplayText(msg.actionData?.editedText || '');
                            if (copyText) {
                              navigator.clipboard.writeText(copyText);
                              alert('Copied to clipboard!');
                            }
                          }}
                          className="py-2.5 px-3 border border-[#313847] hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center"
                          title="Copy content"
                        >
                          <Icons.Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {isTyping && (
              <div className="flex flex-col gap-1 items-start">
                <div className="flex items-center gap-1.5 px-1 select-none">
                  <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-slate-100">
                    <Icons.Bot className="w-2.5 h-2.5 animate-pulse" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-100">AI Assistant</span>
                </div>
                <div className="bg-[#171a20] border border-[#2f3540] rounded-2xl rounded-tl-none px-4 py-3 shadow-sm text-slate-500 text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Assistant Footer & Input prompt */}
          <div className="p-4 border-t border-[#313847] flex flex-col gap-3 select-none bg-[#171a20]">
            {/* Live selected editor scope indicator */}
            {selectedEditorScope.field && (
              <div className="border border-slate-700 bg-[#0f131b] rounded-xl p-2.5 flex flex-col gap-1.5 transition-all duration-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px] min-w-0">
                    <Icons.Crosshair className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">
                      Selected {selectedEditorScope.field === 'title' ? 'Title Field' : 'Section Text'}
                    </span>
                  </div>
                  <button
                    onClick={() => clearSelectedEditorScope()}
                    className="p-0.5 hover:bg-slate-800 rounded text-slate-300 flex-shrink-0"
                    title="Clear selected scope"
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-24 overflow-y-auto text-[11px] leading-relaxed whitespace-pre-wrap text-slate-200 bg-[#10141d] border border-slate-700 rounded-lg p-2">
                  {sanitizeDisplayText(
                    selectedEditorScope.text
                  ) || 'Select text in editor to scope chat edits.'}
                </div>
              </div>
            )}

            {/* Quick Actions / Suggestions */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Shorten this', prompt: 'Shorten the selected area to make it punchy' },
                { label: 'Make it more formal', prompt: 'Rewrite the selected area in a formal enterprise tone' },
                { label: 'Add statistics', prompt: 'Add industry statistics or data points to the selected area' },
              ].map((act, index) => (
                <button
                  key={index}
                  onClick={() => handleSendChat(act.prompt)}
                  className="py-1 px-2.5 bg-[#10141c] hover:bg-slate-900 hover:text-slate-100 border border-[#313847] text-slate-400 text-[10px] font-bold rounded-lg transition-all"
                >
                  {act.label}
                </button>
              ))}
            </div>

            {/* Chat Input field */}
            <div className="border border-[#313847] focus-within:border-slate-400 rounded-xl p-1.5 flex flex-col gap-1 transition-all relative bg-[#171a20]">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                placeholder="Ask anything about your blog..."
                className="w-full h-14 bg-transparent text-slate-100 text-xs placeholder-slate-500 outline-none resize-none px-2 py-1 leading-relaxed"
              />

              <div className="flex items-center justify-between px-1">
                {/* Media buttons */}
                <div className="flex items-center gap-1.5 text-slate-500">
                  <button className="p-1 hover:bg-slate-900 hover:text-slate-300 rounded transition-colors" title="Attach file">
                    <Icons.Paperclip className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 hover:bg-slate-900 hover:text-slate-300 rounded transition-colors" title="Add links">
                    <Icons.Link2 className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 hover:bg-slate-900 hover:text-slate-300 rounded transition-colors" title="Brand voice profiles">
                    <Icons.Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Send */}
                <button
                  onClick={() => handleSendChat()}
                  disabled={!chatInput.trim()}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    chatInput.trim()
                      ? 'bg-white text-black hover:bg-slate-200 shadow shadow-black/20'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Icons.ArrowRight className="w-3.5 h-3.5 stroke-[2.5px]" />
                </button>
              </div>
            </div>

            {/* Hint */}
            <span className="text-[9.5px] text-slate-500 font-medium text-center">
              AI can make mistakes. Review important info.
            </span>
          </div>
        </aside>
      </div>

      {/* Premium Preview Modal Overlay */}
      {previewMessage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-slideUp">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Icons.Eye className="w-4 h-4 text-brand-primary" />
                  <span>AI Edit Preview</span>
                </h3>
                <p className="text-[11px] text-slate-555 mt-0.5">
                  Reviewing how the entire blog post looks with the suggested edits applied.
                </p>
              </div>
              <button
                onClick={() => setPreviewMessage(null)}
                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body (Scrollable Document Preview) */}
            <div className="flex-1 overflow-y-auto p-8 bg-[#f5efe4] flex justify-center">
              <div ref={previewContentRef} className="w-full max-w-2xl blog-paper rounded-xl px-8 py-10 min-h-[500px]">
                {/* Preview Blog Title */}
                {(() => {
                  if (previewHasPersistedState) {
                    const oldTitle = sanitizeDisplayText(previewBaseTitle);
                    const newTitle = sanitizeDisplayText(previewPersistedTitle || previewBaseTitle);
                    const oldSubtitle = sanitizeDisplayText(previewBaseSubtitle);
                    const newSubtitle = sanitizeDisplayText(previewPersistedSubtitle || previewBaseSubtitle);
                    const titleStyleChanged =
                      JSON.stringify(previewBaseTitleStyle || {}) !==
                      JSON.stringify(previewPersistedTitleStyle || {});
                    const titleNeedsDiff = oldTitle !== newTitle || titleStyleChanged;
                    const subtitleNeedsDiff = oldSubtitle !== newSubtitle;

                    const titleNode = titleNeedsDiff ? (
                      <div className="mb-2 space-y-2 preview-changed">
                        <h1
                          className="blog-doc-title bg-red-100/80 border border-red-300 p-3 rounded-xl"
                          style={toTextStyle(previewBaseTitleStyle)}
                        >
                          {oldTitle}
                        </h1>
                        <h1
                          className="blog-doc-title bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl"
                          style={toTextStyle(previewPersistedTitleStyle)}
                        >
                          {newTitle}
                        </h1>
                      </div>
                    ) : (
                      <h1 className="blog-doc-title mb-2" style={toTextStyle(previewPersistedTitleStyle)}>
                        {newTitle}
                      </h1>
                    );

                    const subtitleNode =
                      subtitleNeedsDiff && (oldSubtitle || newSubtitle) ? (
                        <div className="mb-4 space-y-2 preview-changed">
                          <p className="blog-doc-subtitle bg-red-100/80 border border-red-300 p-3 rounded-xl">
                            {oldSubtitle || 'No subtitle.'}
                          </p>
                          <p className="blog-doc-subtitle bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl">
                            {newSubtitle || 'Subtitle removed.'}
                          </p>
                        </div>
                      ) : newSubtitle ? (
                        <p className="blog-doc-subtitle mb-4">{newSubtitle}</p>
                      ) : null;

                    return (
                      <>
                        {titleNode}
                        {subtitleNode}
                      </>
                    );
                  }

                  const previewSelectedText = normalizeLayoutText(previewMessage.actionData?.selectedText || '');
                  const previewEditedText = sanitizeDisplayText(previewMessage.actionData?.editedText || '');
                  const nextTitle = previewOpsState
                    ? previewOpsState.title
                    : (previewMessage.actionType === 'replace_all' && previewMessage.actionData.title)
                    ? sanitizeDisplayText(previewMessage.actionData.title)
                    : (previewMessage.actionType === 'edit_section' && previewMessage.actionData.sectionId === 'title')
                    ? (previewSelectedText
                        ? (() => {
                            const replaced = replaceSelectedTextInText(previewBaseTitle, previewSelectedText, previewEditedText);
                            return replaced.didReplace ? replaced.nextText : previewEditedText;
                          })()
                        : previewEditedText)
                    : sanitizeDisplayText(previewBaseTitle);
                  const nextSubtitle =
                    previewMessage.actionType === 'replace_all'
                      ? sanitizeDisplayText(previewMessage.actionData.subtitle || previewBaseSubtitle)
                      : previewMessage.actionType === 'edit_section' &&
                        sanitizePlainText(previewMessage.actionData.sectionId || '') === 'subtitle'
                      ? (previewSelectedText
                          ? (() => {
                              const replaced = replaceSelectedTextInText(
                                previewBaseSubtitle,
                                previewSelectedText,
                                previewEditedText
                              );
                              return replaced.didReplace ? replaced.nextText : previewEditedText;
                            })()
                          : previewEditedText)
                      : sanitizeDisplayText(previewBaseSubtitle);

                  const titleChangedForEdit =
                    previewMessage.actionType === 'edit_section' && previewMessage.actionData.sectionId === 'title';
                  const titleChangedForOps = previewEditorOps.some(
                    (op) => op.op === 'rename_title' || op.op === 'style_title'
                  );
                  const titleChangedForReplaceAll =
                    previewMessage.actionType === 'replace_all' &&
                    sanitizeDisplayText(previewMessage.actionData.title || previewBaseTitle) !==
                      sanitizeDisplayText(previewBaseTitle);
                  const titleNeedsDiff = titleChangedForEdit || titleChangedForOps || titleChangedForReplaceAll;
                  const subtitleChangedForEdit =
                    previewMessage.actionType === 'edit_section' &&
                    sanitizePlainText(previewMessage.actionData.sectionId || '') === 'subtitle';
                  const subtitleChangedForReplaceAll =
                    previewMessage.actionType === 'replace_all' &&
                    sanitizeDisplayText(previewMessage.actionData.subtitle || previewBaseSubtitle) !==
                      sanitizeDisplayText(previewBaseSubtitle);
                  const subtitleNeedsDiff = subtitleChangedForEdit || subtitleChangedForReplaceAll;

                  const titleNode = titleNeedsDiff ? (
                    <div className="mb-2 space-y-2 preview-changed">
                      <h1 className="blog-doc-title bg-red-100/80 border border-red-300 p-3 rounded-xl">
                        {sanitizeDisplayText(previewBaseTitle)}
                      </h1>
                      <h1
                        className="blog-doc-title bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl"
                        style={previewOpsState ? toTextStyle(previewOpsState.titleStyle) : undefined}
                      >
                        {sanitizeDisplayText(nextTitle)}
                      </h1>
                    </div>
                  ) : (
                    <h1
                      className="blog-doc-title mb-2"
                      style={previewOpsState ? toTextStyle(previewOpsState.titleStyle) : undefined}
                    >
                      {sanitizeDisplayText(nextTitle)}
                    </h1>
                  );

                  const subtitleNode =
                    subtitleNeedsDiff &&
                    (sanitizeDisplayText(previewBaseSubtitle) || sanitizeDisplayText(nextSubtitle)) ? (
                      <div className="mb-4 space-y-2 preview-changed">
                        <p className="blog-doc-subtitle bg-red-100/80 border border-red-300 p-3 rounded-xl">
                          {sanitizeDisplayText(previewBaseSubtitle) || 'No subtitle.'}
                        </p>
                        <p className="blog-doc-subtitle bg-emerald-100/80 border border-emerald-300 p-3 rounded-xl">
                          {sanitizeDisplayText(nextSubtitle) || 'Subtitle removed.'}
                        </p>
                      </div>
                    ) : sanitizeDisplayText(nextSubtitle) ? (
                      <p className="blog-doc-subtitle mb-4">{sanitizeDisplayText(nextSubtitle)}</p>
                    ) : null;

                  return (
                    <>
                      {titleNode}
                      {subtitleNode}
                    </>
                  );
                })()}

                <hr className="border-slate-200 mb-6" />

                {/* Preview Blog Content */}
                <div className="blog-content max-w-none text-[15px] leading-relaxed space-y-4">
                  {previewHasPersistedState
                    ? (() => {
                        const maxLength = Math.max(previewBaseSections.length, previewPersistedSections.length);
                        return Array.from({ length: maxLength }).map((_, idx) => {
                          const oldSec = previewBaseSections[idx];
                          const newSec = previewPersistedSections[idx];
                          const newStyle = newSec ? previewPersistedSectionStyles[newSec.id] : undefined;

                          if (sectionLooksSame(oldSec, newSec) && newSec) {
                            return renderPreviewSectionBlock(newSec, `snapshot-same-${idx}`, { style: newStyle });
                          }

                          return renderInlineChangeAtPosition(
                            `snapshot-diff-${idx}`,
                            oldSec || null,
                            newSec || null,
                            newStyle
                          );
                        });
                      })()
                    : previewMessage.actionType === 'editor_ops' && previewOpsState
                    ? (() => {
                        const rendered: React.ReactNode[] = [];
                        const localSectionIds = new Set(previewBaseSections.map((s) => s.id));
                        const renderedInsertedIds = new Set<string>();

                        previewBaseSections.forEach((sec, idx) => {
                          const ops = sectionOpsById[sec.id] || [];
                          const hasDelete = ops.some((op) => op.op === 'delete_section');
                          const replaceOp = ops.find((op) => op.op === 'replace_section_text');
                          const replaceImageOp = ops.find((op) => op.op === 'replace_image');
                          const hasStyle = ops.some((op) => op.op === 'style_section');
                          const nextSec = previewOpsState.sections.find((s) => s.id === sec.id);
                          const nextStyle = previewOpsState.sectionStyles[sec.id];

                          if (hasDelete) {
                            rendered.push(renderInlineChangeAtPosition(`ops-${sec.id}-${idx}`, sec, null));
                          } else if (replaceOp || replaceImageOp || hasStyle) {
                            const replaced: BlogSection = nextSec || {
                              ...sec,
                              type: replaceImageOp ? 'image' : sec.type,
                              text: sanitizeDisplayText(replaceOp?.text || replaceImageOp?.text || sec.text || ''),
                              caption: sanitizeDisplayText(replaceImageOp?.caption || sec.caption || ''),
                              url: sanitizeDisplayText(replaceImageOp?.url || sec.url || ''),
                            };
                            rendered.push(
                              renderInlineChangeAtPosition(`ops-${sec.id}-${idx}`, sec, replaced, nextStyle)
                            );
                          } else if (nextSec) {
                            rendered.push(
                              renderPreviewSectionBlock(nextSec, `ops-keep-${sec.id}-${idx}`, { style: nextStyle })
                            );
                          }

                          const insertOps = insertedAfterOps[sec.id] || [];
                          for (const [insIdx, insOp] of insertOps.entries()) {
                            const insertedMatch = previewOpsState.sections.find(
                              (s) =>
                                !localSectionIds.has(s.id) &&
                                sanitizeDisplayText(s.caption || '') === sanitizeDisplayText(insOp.caption || insOp.text || '')
                            );
                            if (insertedMatch) {
                              renderedInsertedIds.add(insertedMatch.id);
                            }
                            const inserted = insertedMatch || {
                              id: `ins-${sec.id}-${insIdx}`,
                              type: 'image',
                              text: sanitizeDisplayText(insOp.text || insOp.caption || 'Image'),
                              caption: sanitizeDisplayText(insOp.caption || insOp.text || 'Image'),
                              url: sanitizeDisplayText(insOp.url || defaultImageUrl(insOp.text || insOp.caption || 'image')),
                            };

                            rendered.push(
                              renderInlineChangeAtPosition(
                                `ops-insert-${sec.id}-${insIdx}`,
                                null,
                                inserted
                              )
                            );
                          }
                        });

                        const trailingInserted = previewOpsState.sections.filter(
                          (s) => !localSectionIds.has(s.id) && !renderedInsertedIds.has(s.id)
                        );
                        trailingInserted.forEach((inserted, idx) => {
                          rendered.push(
                            renderInlineChangeAtPosition(`ops-insert-end-${idx}`, null, inserted)
                          );
                        });

                        return rendered;
                      })()
                    : (previewMessage.actionType === 'replace_all' && Array.isArray(previewMessage.actionData.sections))
                    ? (() => {
                        const nextSections = previewMessage.actionData.sections as BlogSection[];
                        const maxLength = Math.max(previewBaseSections.length, nextSections.length);
                        return Array.from({ length: maxLength }).map((_, idx) => {
                          const oldSec = previewBaseSections[idx];
                          const newSec = nextSections[idx];

                          if (sectionLooksSame(oldSec, newSec) && newSec) {
                            return renderPreviewSectionBlock(newSec, `replace-same-${idx}`);
                          }

                          return renderInlineChangeAtPosition(
                            `replace-diff-${idx}`,
                            oldSec || null,
                            newSec || null
                          );
                        });
                      })()
                    : previewBaseSections.map((sec, idx) => {
                        const requestedId = sanitizePlainText(previewMessage.actionData.sectionId || '');
                        const resolvedPreviewEditId =
                          resolveSectionId(requestedId, previewBaseSections) ||
                          findSectionIdByOriginalText(
                            sanitizePlainText(previewMessage.actionData.originalText || ''),
                            previewBaseSections
                          ) ||
                          requestedId;
                        const isEdited = sec.id === resolvedPreviewEditId;
                        if (!isEdited) {
                          return renderPreviewSectionBlock(sec, `edit-keep-${sec.id}-${idx}`);
                        }

                        const selectedText = normalizeLayoutText(previewMessage.actionData.selectedText || '');
                        const editedRaw = sanitizeDisplayText(previewMessage.actionData.editedText || '');
                        const editedText =
                          selectedText
                            ? (() => {
                                const source = sec.type === 'image' ? sec.caption || sec.text || '' : sec.text || '';
                                const replaced = replaceSelectedTextInText(source, selectedText, editedRaw);
                                if (!replaced.didReplace) {
                                  return sec.type === 'image' ? sec.caption || sec.text || '' : sec.text || '';
                                }
                                return replaced.nextText;
                              })()
                            : editedRaw;
                        const editedSection: BlogSection = {
                          ...sec,
                          text: editedText,
                          ...(sec.type === 'image'
                            ? { caption: editedText }
                            : {}),
                        };
                        return renderInlineChangeAtPosition(
                          `edit-diff-${sec.id}-${idx}`,
                          sec,
                          editedSection
                        );
                      })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setPreviewMessage(null)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-650 rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const applied = await applySuggestionMessage(previewMessage);
                  if (applied) {
                    setPreviewMessage(null);
                  }
                }}
                disabled={previewAlreadyReplaced}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  previewAlreadyReplaced
                    ? 'bg-emerald-500 text-white cursor-not-allowed'
                    : 'bg-brand-primary hover:bg-brand-primaryHover text-white shadow-md shadow-black/25'
                }`}
              >
                <Icons.Check className="w-3.5 h-3.5" />
                <span>{previewAlreadyReplaced ? 'Replaced' : 'Apply & Replace Content'}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {historyDiffPreview && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn">
          {(() => {
            const { message, diff, sectionTypeHint } = historyDiffPreview;
            const isReverted = Boolean(message.actionData?.revertedAt);
            const canRevert = Boolean(message.actionData?.appliedAt) && !isReverted;
            const appliedAt = message.actionData?.appliedAt || message.createdAt;
            return (
              <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[82vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-slideUp">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                      <Icons.Eye className="w-4 h-4 text-brand-primary" />
                      <span>Applied Update Preview</span>
                    </h3>
                    <p className="text-[11px] text-slate-555 mt-0.5">
                      Compare original and updated content from this applied chat change.
                    </p>
                  </div>
                  <button
                    onClick={() => setHistoryDiffPreview(null)}
                    className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-[#f5efe4]">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-4">
                    <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                      <span className="font-bold text-slate-700">
                        {appliedAt ? new Date(appliedAt).toLocaleString() : 'Applied update'}
                      </span>
                      {isReverted ? (
                        <span className="py-1 px-2 text-[10px] rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Reverted
                        </span>
                      ) : (
                        <span className="py-1 px-2 text-[10px] rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Applied
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded whitespace-pre-wrap">
                      {sanitizeDisplayText(diff.explanation || message.text)}
                    </p>

                    <div className="bg-[#f5efe4] border border-amber-100 rounded-xl p-3 max-h-[62vh] overflow-y-auto">
                      <div className="blog-paper rounded-xl p-4 blog-content max-w-none space-y-3">
                        <div className="space-y-2 preview-changed">
                          {renderHistoryTextDiffBlock(diff.originalText, `history-preview-${message.id}-original`, {
                            sectionTypeHint,
                            highlight: 'original',
                          })}
                          {renderHistoryTextDiffBlock(diff.suggestedText, `history-preview-${message.id}-new`, {
                            sectionTypeHint,
                            highlight: 'new',
                            style: diff.suggestedStyle,
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
                  <button
                    onClick={() => setHistoryDiffPreview(null)}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-650 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={async () => {
                      if (!canRevert) return;
                      await revertSuggestionMessage(message);
                      setHistoryDiffPreview(null);
                    }}
                    disabled={!canRevert}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                      canRevert
                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <Icons.RotateCcw className="w-3.5 h-3.5" />
                    <span>{isReverted ? 'Already Reverted' : 'Revert This Change'}</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {historyPreviewVersion && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn">
          {(() => {
            const sectionTypeHint = getSectionTypeHint(historyPreviewVersion.sectionId);
            const sectionStyleHint = sectionStyleMap[historyPreviewVersion.sectionId];
            const originalSection = toHistorySectionFromText(
              historyPreviewVersion.originalText,
              `history-modal-${historyPreviewVersion.id}-original`,
              sectionTypeHint
            );
            const editedSection = toHistorySectionFromText(
              historyPreviewVersion.editedText,
              `history-modal-${historyPreviewVersion.id}-new`,
              sectionTypeHint
            );
            return (
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[82vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-slideUp">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Icons.Eye className="w-4 h-4 text-brand-primary" />
                  <span>Version Preview</span>
                </h3>
                <p className="text-[11px] text-slate-555 mt-0.5">
                  Compare this saved version before reverting.
                </p>
              </div>
              <button
                onClick={() => setHistoryPreviewVersion(null)}
                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-[#f5efe4]">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-700">
                    {getSectionLabel(historyPreviewVersion.sectionId)}
                  </span>
                  <span className="text-slate-400">
                    {new Date(historyPreviewVersion.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="bg-[#f5efe4] border border-amber-100 rounded-xl p-3 max-h-[62vh] overflow-y-auto">
                  <div className="blog-paper rounded-xl p-4 blog-content max-w-none space-y-3">
                    {originalSection || editedSection ? (
                      renderInlineChangeAtPosition(
                        `history-modal-${historyPreviewVersion.id}`,
                        originalSection,
                        editedSection,
                        sectionStyleHint
                      )
                    ) : (
                      <div className="space-y-2 preview-changed">
                        {renderHistoryTextDiffBlock(
                          historyPreviewVersion.originalText,
                          `history-modal-${historyPreviewVersion.id}-raw-old`,
                          { sectionTypeHint, highlight: 'original' }
                        )}
                        {renderHistoryTextDiffBlock(
                          historyPreviewVersion.editedText,
                          `history-modal-${historyPreviewVersion.id}-raw-new`,
                          { sectionTypeHint, highlight: 'new', style: sectionStyleHint }
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setHistoryPreviewVersion(null)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-650 rounded-xl text-xs font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  await handleRollback(historyPreviewVersion.sectionId, historyPreviewVersion.id);
                  setHistoryPreviewVersion(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700"
              >
                <Icons.RotateCcw className="w-3.5 h-3.5" />
                <span>Revert to This Version</span>
              </button>
            </div>
          </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};




