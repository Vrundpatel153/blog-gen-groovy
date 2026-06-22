// ============================================================================
// Blog Persistence Service — Supabase CRUD for blogs and sections.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Blog, BlogSection } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { stripHtmlAndCode } from '../utils/plainText.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
const DEVTO_PUBLISH_LOG_MARKER = '__devto_publish__';

function isUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function isMissingDevtoColumnError(message: string): boolean {
  const lower = String(message || '').toLowerCase();
  return lower.includes('devto_url') || lower.includes('devto_article_id') || lower.includes('devto_published_at');
}

function parseDevtoLogPayload(raw: unknown): {
  url?: string;
  articleId?: number;
  publishedAt?: string;
} {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const url = typeof parsed.url === 'string' ? parsed.url : undefined;
    const articleId =
      typeof parsed.articleId === 'number'
        ? parsed.articleId
        : parsed.articleId
          ? Number(parsed.articleId)
          : undefined;
    const publishedAt = typeof parsed.publishedAt === 'string' ? parsed.publishedAt : undefined;
    return {
      url,
      articleId: Number.isFinite(articleId as number) ? (articleId as number) : undefined,
      publishedAt,
    };
  } catch {
    return {};
  }
}

async function loadDevtoPublishLogMap(
  userId: string,
  blogIds: string[]
): Promise<Map<string, { url?: string; articleId?: number; publishedAt?: string }>> {
  if (!Array.isArray(blogIds) || blogIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('prompt_logs')
    .select('blog_id, response, created_at')
    .eq('user_id', userId)
    .eq('prompt', DEVTO_PUBLISH_LOG_MARKER)
    .in('blog_id', blogIds)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return new Map();
  }

  const map = new Map<string, { url?: string; articleId?: number; publishedAt?: string }>();
  for (const row of data as any[]) {
    const blogId = String(row.blog_id || '');
    if (!blogId || map.has(blogId)) continue;
    const payload = parseDevtoLogPayload(row.response);
    const fallbackPublishedAt =
      typeof row.created_at === 'string' && row.created_at ? row.created_at : undefined;
    map.set(blogId, {
      url: payload.url,
      articleId: payload.articleId,
      publishedAt: payload.publishedAt || fallbackPublishedAt,
    });
  }
  return map;
}

function applyDevtoMetadata(
  blog: Blog,
  metadata?: { url?: string; articleId?: number; publishedAt?: string }
): Blog {
  if (!metadata?.url) return blog;
  return {
    ...blog,
    publishedToDevto: true,
    devtoUrl: blog.devtoUrl || metadata.url,
    devtoArticleId: blog.devtoArticleId ?? metadata.articleId,
    devtoPublishedAt: blog.devtoPublishedAt || metadata.publishedAt,
  };
}

async function saveDevtoPublishLog(params: {
  userId: string;
  blogId: string;
  articleId: number;
  url: string;
  publishedAt?: string;
}): Promise<void> {
  await supabase.from('prompt_logs').insert({
    user_id: params.userId,
    blog_id: params.blogId,
    prompt: DEVTO_PUBLISH_LOG_MARKER,
    response: JSON.stringify({
      articleId: params.articleId,
      url: params.url,
      publishedAt: params.publishedAt || new Date().toISOString(),
    }),
    tokens_used: 0,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapDbBlogToApi(dbBlog: any, dbSections: any[] = []): Blog {
  return {
    id: dbBlog.id,
    userId: dbBlog.user_id,
    title: dbBlog.title,
    subtitle: dbBlog.subtitle || undefined,
    slug: dbBlog.slug || undefined,
    metaDescription: dbBlog.meta_description || undefined,
    status: dbBlog.status,
    words: dbBlog.words,
    readTime: dbBlog.read_time,
    seoScore: dbBlog.seo_score,
    tone: dbBlog.tone,
    audience: dbBlog.audience,
    language: dbBlog.language || 'English',
    blogType: dbBlog.blog_type || 'Informative Blog',
    keywords: dbBlog.keywords || [],
    promptUsed: dbBlog.prompt_used || undefined,
    publishedToDevto: Boolean(dbBlog.devto_url),
    devtoArticleId:
      typeof dbBlog.devto_article_id === 'number'
        ? dbBlog.devto_article_id
        : dbBlog.devto_article_id
          ? Number(dbBlog.devto_article_id)
          : undefined,
    devtoUrl: dbBlog.devto_url || undefined,
    devtoPublishedAt: dbBlog.devto_published_at || undefined,
    createdAt: dbBlog.created_at,
    updatedAt: dbBlog.updated_at,
    sections: dbSections
      .sort((a: any, b: any) => a.position_order - b.position_order)
      .map((s: any) => ({
        id: s.id,
        type: s.type,
        text: s.text || undefined,
        level: s.level || undefined,
        url: s.url || undefined,
        caption: s.caption || undefined,
      })),
  };
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function listBlogs(userId: string): Promise<Blog[]> {
  const { data, error } = await supabase
    .from('blogs')
    .select('*, blog_sections(*)')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  if (error) throw new AppError(500, `Failed to list blogs: ${error.message}`);

  const blogs = (data || []).map((b: any) => mapDbBlogToApi(b, b.blog_sections || []));
  const withoutDevto = blogs.filter((blog) => !blog.devtoUrl).map((blog) => blog.id);
  if (withoutDevto.length === 0) {
    return blogs;
  }

  const logMap = await loadDevtoPublishLogMap(userId, withoutDevto);
  return blogs.map((blog) => applyDevtoMetadata(blog, logMap.get(blog.id)));
}

export async function listPublishedBlogs(userId: string): Promise<Blog[]> {
  const blogs = await listBlogs(userId);
  return blogs.filter((blog) => Boolean(blog.devtoUrl));
}

export async function getBlogById(blogId: string): Promise<Blog> {
  const { data, error } = await supabase
    .from('blogs')
    .select('*, blog_sections(*)')
    .eq('id', blogId)
    .single();

  if (error || !data) throw new AppError(404, 'Blog not found');

  let mapped = mapDbBlogToApi(data, data.blog_sections || []);
  if (!mapped.devtoUrl) {
    const userId = String((data as any)?.user_id || mapped.userId || '');
    if (userId) {
      const logMap = await loadDevtoPublishLogMap(userId, [blogId]);
      mapped = applyDevtoMetadata(mapped, logMap.get(blogId));
    }
  }
  return mapped;
}

export async function createBlog(params: {
  userId: string;
  title: string;
  subtitle?: string;
  slug?: string;
  metaDescription?: string;
  status?: string;
  tone: string;
  audience: string;
  language?: string;
  blogType?: string;
  keywords: string[];
  promptUsed?: string;
  sections: BlogSection[];
}): Promise<Blog> {
  // Calculate word count
  const words = params.sections.reduce((acc, s) => {
    const text =
      s.type === 'image'
        ? stripHtmlAndCode(s.caption || s.text || '')
        : stripHtmlAndCode(s.text || '');
    return acc + (text ? text.split(/\s+/).filter(Boolean).length : 0);
  }, 0);

  // 1. Insert blog
  const { data: blogRow, error: blogErr } = await supabase
    .from('blogs')
    .insert({
      user_id: params.userId,
      title: params.title,
      subtitle: params.subtitle || null,
      slug: params.slug || null,
      meta_description: params.metaDescription || null,
      status: params.status || 'Draft',
      words,
      read_time: `${Math.max(1, Math.ceil(words / 200))} min`,
      seo_score: Math.floor(Math.random() * 15) + 80,
      tone: params.tone,
      audience: params.audience,
      language: params.language || 'English',
      blog_type: params.blogType || 'Informative Blog',
      keywords: params.keywords,
      prompt_used: params.promptUsed || null,
    })
    .select()
    .single();

  if (blogErr || !blogRow) throw new AppError(500, `Failed to create blog: ${blogErr?.message}`);

  // 2. Insert sections
  if (params.sections.length > 0) {
    const sectionRows = params.sections.map((s, idx) => {
      const row: Record<string, unknown> = {
        blog_id: blogRow.id,
        position_order: idx,
        type: s.type,
        text: s.text || null,
        level: s.level || null,
        url: s.url || null,
        caption: s.caption || null,
      };
      if (isUuid(s.id)) {
        row.id = s.id;
      }
      return row;
    });

    const { data: sectionData, error: secErr } = await supabase
      .from('blog_sections')
      .insert(sectionRows)
      .select();

    if (secErr) throw new AppError(500, `Failed to create sections: ${secErr.message}`);

    return mapDbBlogToApi(blogRow, sectionData || []);
  }

  return mapDbBlogToApi(blogRow, []);
}

export async function updateBlog(
  blogId: string,
  updates: {
    title?: string;
    subtitle?: string;
    status?: string;
    tone?: string;
    audience?: string;
    keywords?: string[];
    sections?: BlogSection[];
    devtoArticleId?: number;
    devtoUrl?: string;
    devtoPublishedAt?: string;
  }
): Promise<Blog> {
  // 1. Update blog metadata
  const metaUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) metaUpdate.title = updates.title;
  if (updates.subtitle !== undefined) metaUpdate.subtitle = updates.subtitle;
  if (updates.status !== undefined) metaUpdate.status = updates.status;
  if (updates.tone !== undefined) metaUpdate.tone = updates.tone;
  if (updates.audience !== undefined) metaUpdate.audience = updates.audience;
  if (updates.keywords !== undefined) metaUpdate.keywords = updates.keywords;
  if (updates.devtoArticleId !== undefined) metaUpdate.devto_article_id = updates.devtoArticleId;
  if (updates.devtoUrl !== undefined) metaUpdate.devto_url = updates.devtoUrl;
  if (updates.devtoPublishedAt !== undefined) metaUpdate.devto_published_at = updates.devtoPublishedAt;

  // If sections are provided, recalculate word count
  if (updates.sections) {
    metaUpdate.words = updates.sections.reduce((acc, s) => {
      const text =
        s.type === 'image'
          ? stripHtmlAndCode(s.caption || s.text || '')
          : stripHtmlAndCode(s.text || '');
      return acc + (text ? text.split(/\s+/).filter(Boolean).length : 0);
    }, 0);
    metaUpdate.read_time = `${Math.max(1, Math.ceil(metaUpdate.words / 200))} min`;
  }

  const { error: updateErr } = await supabase
    .from('blogs')
    .update(metaUpdate)
    .eq('id', blogId);

  if (updateErr) throw new AppError(500, `Failed to update blog: ${updateErr.message}`);

  // 2. Replace sections if provided
  if (updates.sections) {
    const { error: deleteErr } = await supabase.from('blog_sections').delete().eq('blog_id', blogId);
    if (deleteErr) throw new AppError(500, `Failed to replace sections: ${deleteErr.message}`);

    const sectionRows = updates.sections.map((s, idx) => {
      const row: Record<string, unknown> = {
        blog_id: blogId,
        position_order: idx,
        type: s.type,
        text: s.text || null,
        level: s.level || null,
        url: s.url || null,
        caption: s.caption || null,
      };
      // Preserve stable section IDs whenever valid UUIDs are supplied by the client.
      if (isUuid(s.id)) {
        row.id = s.id;
      }
      return row;
    });

    if (sectionRows.length > 0) {
      const { error: insertErr } = await supabase.from('blog_sections').insert(sectionRows);
      if (insertErr) throw new AppError(500, `Failed to insert replacement sections: ${insertErr.message}`);
    }
  }

  return getBlogById(blogId);
}

export async function markBlogPublishedToDevto(
  blogId: string,
  details: {
    articleId: number;
    url: string;
    publishedAt?: string;
  },
  userId?: string
): Promise<Blog> {
  const { error } = await supabase
    .from('blogs')
    .update({
      status: 'Published',
      devto_article_id: details.articleId,
      devto_url: details.url,
      devto_published_at: details.publishedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', blogId);

  if (error) {
    if (isMissingDevtoColumnError(error.message)) {
      const fallbackUserId = userId || (await getBlogById(blogId)).userId;
      await saveDevtoPublishLog({
        userId: fallbackUserId,
        blogId,
        articleId: details.articleId,
        url: details.url,
        publishedAt: details.publishedAt,
      });
      const blog = await getBlogById(blogId);
      return applyDevtoMetadata(blog, {
        url: details.url,
        articleId: details.articleId,
        publishedAt: details.publishedAt,
      });
    }
    throw new AppError(500, `Failed to save Dev.to publish metadata: ${error.message}`);
  }

  return getBlogById(blogId);
}

export async function archiveBlog(blogId: string): Promise<void> {
  const { error } = await supabase
    .from('blogs')
    .update({ archived_at: new Date().toISOString(), status: 'Archived' })
    .eq('id', blogId);

  if (error) throw new AppError(500, `Failed to archive blog: ${error.message}`);
}
