// ============================================================================
// Blog Service — Frontend API client (talks to Express backend, not Supabase)
// ============================================================================

import type { Blog } from '../components/MockData';

const API_BASE = '/api';
type BlogExportFormat = 'md' | 'html' | 'pdf';

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/;
const BLOCKED_IMAGE_HOSTS = new Set([
  'example.com',
  'www.example.com',
  'images.example.com',
]);

const buildFallbackImageUrl = (seed: string): string => {
  const normalizedSeed = encodeURIComponent((seed || 'blog-image').slice(0, 120));
  return `https://picsum.photos/seed/${normalizedSeed}/1280/720`;
};

const generateClientId = (seed: string, idx: number): string => {
  const randomUUID = (globalThis as any)?.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call((globalThis as any).crypto);
  }
  return `${seed}-${idx}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeImageUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';

  const wrappedMarkdown = value.match(/^!\[[^\]]*]\(([^)]+)\)$/);
  if (wrappedMarkdown?.[1]) {
    value = wrappedMarkdown[1].trim();
  }

  value = value.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '').trim();
  if (value.startsWith('//')) {
    value = `https:${value}`;
  }
  if (/\s/.test(value)) {
    value = value.split(/\s+/)[0] || '';
  }

  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (BLOCKED_IMAGE_HOSTS.has(host)) {
        return '';
      }
    } catch {
      return '';
    }
    return value;
  }

  if (/^(data:image\/|\/|\.\/|\.\.\/)/i.test(value)) {
    return value;
  }
  return '';
};

const normalizeSectionsForEditor = (rawSections: any[]): Blog['sections'] => {
  const sections: Blog['sections'] = [];

  rawSections.forEach((rawSection, index) => {
    const baseId = String(rawSection?.id || generateClientId('sec', index + 1));
    const type = rawSection?.type;
    const rawText = typeof rawSection?.text === 'string' ? rawSection.text : '';

    if (type === 'image' || rawSection?.url || rawSection?.imageUrl || rawSection?.src) {
      const normalizedUrl =
        normalizeImageUrl(rawSection?.url || rawSection?.imageUrl || rawSection?.src) ||
        (() => {
          const inlineMatch = rawText.match(/!\[[^\]]*]\(([^)]+)\)/);
          return normalizeImageUrl(inlineMatch?.[1] || '');
        })() ||
        buildFallbackImageUrl(baseId);

      sections.push({
        id: baseId,
        type: 'image',
        text: rawText || rawSection?.caption || '',
        level: rawSection?.level,
        url: normalizedUrl,
        caption: rawSection?.caption || '',
      });
      return;
    }

    const markdownImageRegex = new RegExp(MARKDOWN_IMAGE_PATTERN.source, 'g');
    const markdownImages = [...rawText.matchAll(markdownImageRegex)];
    if (markdownImages.length > 0) {
      const paragraphText = rawText.replace(markdownImageRegex, '').trim();
      if (paragraphText) {
        sections.push({
          id: baseId,
          type: type || 'paragraph',
          text: paragraphText,
          level: rawSection?.level,
          url: rawSection?.url,
          caption: rawSection?.caption,
        });
      }

      markdownImages.forEach((match, imgIndex) => {
        const alt = (match[1] || '').trim();
        const url = normalizeImageUrl(match[2]) || buildFallbackImageUrl(`${baseId}-img-${imgIndex + 1}`);
        sections.push({
          id: generateClientId(`${baseId}-img`, imgIndex + 1),
          type: 'image',
          text: alt,
          url,
          caption: alt,
        });
      });
      return;
    }

    sections.push({
      id: baseId,
      type: type || 'paragraph',
      text: rawText,
      level: rawSection?.level,
      url: rawSection?.url,
      caption: rawSection?.caption,
    });
  });

  return sections;
};

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.error || `API error: ${res.status}`);
  }

  return json.data as T;
}

// Map backend Blog shape to frontend Blog shape
function mapApiBlogToFrontend(apiBlog: any): Blog {
  return {
    id: apiBlog.id,
    title: apiBlog.title,
    subtitle: typeof apiBlog.subtitle === 'string' ? apiBlog.subtitle : '',
    status: apiBlog.status === 'Archived' ? 'Draft' : apiBlog.status,
    lastSaved: `Saved ${new Date(apiBlog.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    words: apiBlog.words,
    readTime: apiBlog.readTime,
    seoScore: apiBlog.seoScore,
    tone: apiBlog.tone,
    audience: apiBlog.audience,
    keywords: apiBlog.keywords || [],
    publishedToDevto: Boolean(apiBlog.publishedToDevto || apiBlog.devtoUrl),
    devtoArticleId:
      typeof apiBlog.devtoArticleId === 'number'
        ? apiBlog.devtoArticleId
        : apiBlog.devtoArticleId
          ? Number(apiBlog.devtoArticleId)
          : undefined,
    devtoUrl: typeof apiBlog.devtoUrl === 'string' ? apiBlog.devtoUrl : '',
    devtoPublishedAt: typeof apiBlog.devtoPublishedAt === 'string' ? apiBlog.devtoPublishedAt : '',
    sections: normalizeSectionsForEditor(apiBlog.sections || []),
  };
}

const parseFilenameFromDisposition = (header: string | null, fallback: string): string => {
  if (!header) return fallback;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const basicMatch = header.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] || fallback;
};

export const blogService = {
  async getBlogs(_userId?: string): Promise<Blog[]> {
    const data = await apiFetch<any[]>('/blogs');
    return data.map(mapApiBlogToFrontend);
  },

  async getBlogById(blogId: string): Promise<Blog | null> {
    try {
      const data = await apiFetch<any>(`/blogs/${blogId}`);
      return mapApiBlogToFrontend(data);
    } catch {
      return null;
    }
  },

  async generateBlog(promptData: {
    prompt: string;
    blogType: string;
    tone: string;
    audience: string;
    language: string;
    length: string;
    seoKeywords: string;
    preferences: string[];
  }): Promise<Blog> {
    const data = await apiFetch<any>('/blogs/generate', {
      method: 'POST',
      body: JSON.stringify(promptData),
    });
    return mapApiBlogToFrontend(data);
  },

  async createBlog(blog: Omit<Blog, 'id'>, _userId: string): Promise<Blog> {
    // For backwards compat — uses the update/save flow instead
    const data = await apiFetch<any>('/blogs/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: blog.title,
        blogType: 'Informative Blog',
        tone: blog.tone,
        audience: blog.audience,
        language: 'English',
        length: 'Medium (~1200 words)',
        seoKeywords: blog.keywords.join(', '),
        preferences: [],
      }),
    });
    return mapApiBlogToFrontend(data);
  },

  async updateBlog(blog: Blog, _userId?: string): Promise<Blog> {
    const data = await apiFetch<any>(`/blogs/${blog.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: blog.title,
        subtitle: blog.subtitle || '',
        status: blog.status,
        tone: blog.tone,
        audience: blog.audience,
        keywords: blog.keywords,
        sections: blog.sections,
      }),
    });
    return mapApiBlogToFrontend(data);
  },

  async deleteBlog(blogId: string): Promise<boolean> {
    await apiFetch(`/blogs/${blogId}`, { method: 'DELETE' });
    return true;
  },

  async getPublishedBlogs(): Promise<Blog[]> {
    const data = await apiFetch<any[]>('/blogs/published');
    return data.map(mapApiBlogToFrontend);
  },

  async publishToDevto(blogId: string): Promise<Blog> {
    const data = await apiFetch<any>(`/blogs/${blogId}/publish/devto`, {
      method: 'POST',
    });
    return mapApiBlogToFrontend(data);
  },

  async exportBlog(blogId: string, format: BlogExportFormat): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`${API_BASE}/blogs/${blogId}/export/${format}`, {
      method: 'GET',
    });

    if (!response.ok) {
      let message = `Failed to export .${format}`;
      try {
        const data = await response.json();
        if (data?.error) {
          message = String(data.error);
        }
      } catch {
        // ignore parse failures for non-JSON errors
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const filename = parseFilenameFromDisposition(
      response.headers.get('Content-Disposition'),
      `blog.${format}`
    );
    return { blob, filename };
  },

  async editSection(
    sectionId: string,
    blogId: string,
    instruction: string,
    currentText: string,
    blogTitle?: string,
    blogTone?: string
  ): Promise<{
    originalText: string;
    editedText: string;
    explanation: string;
    versionId: string;
  }> {
    return apiFetch(`/sections/${sectionId}/edit?blogId=${blogId}`, {
      method: 'POST',
      body: JSON.stringify({
        instruction,
        currentText,
        sectionType: 'paragraph',
        blogTitle,
        blogTone,
      }),
    });
  },

  async getVersions(blogId: string): Promise<any[]> {
    return apiFetch(`/sections/versions/${blogId}`);
  },

  async rollbackVersion(sectionId: string, versionId: string): Promise<void> {
    await apiFetch(`/sections/${sectionId}/rollback/${versionId}`, { method: 'POST' });
  },

  async createChatVersions(params: {
    blogId: string;
    prompt?: string;
    changes: Array<{
      sectionId: string;
      originalText: string;
      editedText: string;
      explanation?: string;
    }>;
  }): Promise<Array<{ id: string; sectionId: string; blogId: string }>> {
    return apiFetch('/sections/versions/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};
