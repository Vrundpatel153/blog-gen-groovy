// ============================================================================
// Blog Persistence Service — Supabase CRUD for blogs and sections.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Blog, BlogSection } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { stripHtmlAndCode } from '../utils/plainText.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

function isUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
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

  return (data || []).map((b: any) => mapDbBlogToApi(b, b.blog_sections || []));
}

export async function getBlogById(blogId: string): Promise<Blog> {
  const { data, error } = await supabase
    .from('blogs')
    .select('*, blog_sections(*)')
    .eq('id', blogId)
    .single();

  if (error || !data) throw new AppError(404, 'Blog not found');

  return mapDbBlogToApi(data, data.blog_sections || []);
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

export async function archiveBlog(blogId: string): Promise<void> {
  const { error } = await supabase
    .from('blogs')
    .update({ archived_at: new Date().toISOString(), status: 'Archived' })
    .eq('id', blogId);

  if (error) throw new AppError(500, `Failed to archive blog: ${error.message}`);
}
