// ============================================================================
// Version Service — tracks before/after snapshots for every AI edit.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { SectionVersion } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { getBlogById } from './blogPersistence.js';
import { syncBlogChunks } from './blogChunks.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

function mapVersion(row: any): SectionVersion {
  return {
    id: row.id,
    sectionId: row.section_id,
    blogId: row.blog_id,
    originalText: row.original_text,
    editedText: row.edited_text,
    explanation: row.explanation || undefined,
    diffSummary: row.diff_summary || undefined,
    promptUsed: row.prompt_used || undefined,
    modelUsed: row.model_used || undefined,
    isApplied: row.is_applied,
    createdAt: row.created_at,
  };
}

export async function createVersion(params: {
  sectionId: string;
  blogId: string;
  originalText: string;
  editedText: string;
  explanation?: string;
  diffSummary?: string;
  promptUsed?: string;
  modelUsed?: string;
}): Promise<SectionVersion> {
  const { data, error } = await supabase
    .from('section_versions')
    .insert({
      section_id: params.sectionId,
      blog_id: params.blogId,
      original_text: params.originalText,
      edited_text: params.editedText,
      explanation: params.explanation || null,
      diff_summary: params.diffSummary || null,
      prompt_used: params.promptUsed || null,
      model_used: params.modelUsed || null,
      is_applied: false,
    })
    .select()
    .single();

  if (error || !data) throw new AppError(500, `Failed to save version: ${error?.message}`);
  return mapVersion(data);
}

export async function getVersionsForBlog(blogId: string): Promise<SectionVersion[]> {
  const { data, error } = await supabase
    .from('section_versions')
    .select('*')
    .eq('blog_id', blogId)
    .order('created_at', { ascending: false });

  if (error) throw new AppError(500, `Failed to fetch versions: ${error.message}`);
  return (data || []).map(mapVersion);
}

export async function applyVersion(versionId: string, sectionId: string): Promise<void> {
  // Get the version
  const { data: version, error: verErr } = await supabase
    .from('section_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (verErr || !version) throw new AppError(404, 'Version not found');

  // Update the section text
  const { error: updateErr } = await supabase
    .from('blog_sections')
    .update({ text: version.edited_text, updated_at: new Date().toISOString() })
    .eq('id', sectionId);

  if (updateErr) throw new AppError(500, `Failed to apply version: ${updateErr.message}`);

  // Mark version as applied
  await supabase
    .from('section_versions')
    .update({ is_applied: true })
    .eq('id', versionId);

  // Sync chunks
  try {
    const blog = await getBlogById(version.blog_id);
    if (blog && blog.sections) {
      await syncBlogChunks(version.blog_id, blog.sections);
    }
  } catch (err) {
    console.error('[versionService] Failed to sync blog chunks after apply:', err);
  }
}

export async function rollbackToVersion(versionId: string): Promise<void> {
  const { data: version, error: verErr } = await supabase
    .from('section_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (verErr || !version) throw new AppError(404, 'Version not found');

  // Restore original text to the section
  const { error: updateErr } = await supabase
    .from('blog_sections')
    .update({ text: version.original_text, updated_at: new Date().toISOString() })
    .eq('id', version.section_id);

  if (updateErr) throw new AppError(500, `Failed to rollback: ${updateErr.message}`);

  // Sync chunks
  try {
    const blog = await getBlogById(version.blog_id);
    if (blog && blog.sections) {
      await syncBlogChunks(version.blog_id, blog.sections);
    }
  } catch (err) {
    console.error('[versionService] Failed to sync blog chunks after rollback:', err);
  }
}
