import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { getAIProvider } from './aiProvider.js';
import type { BlogSection } from '../types/index.js';
import { stripHtmlAndCode } from '../utils/plainText.js';
import crypto from 'crypto';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

function computeContentHash(content: string): string {
  const md5 = crypto.createHash('md5').update(content).digest('hex');
  return `h${md5.slice(0, 8)}`;
}

export async function syncBlogChunks(blogId: string, sections: BlogSection[]): Promise<void> {
  if (!blogId || !sections) return;

  try {
    // 1. Delete existing chunks for this blog
    const { error: deleteErr } = await supabase
      .from('blog_chunks')
      .delete()
      .eq('blog_id', blogId);

    if (deleteErr) {
      console.error(`[blogChunks] Failed to delete existing chunks for blog ${blogId}:`, deleteErr.message);
      return;
    }

    // 2. Filter and prepare chunks
    let lastHeading = '';
    const chunkInputs: Array<{ sectionId: string; content: string; heading: string; metadata: any }> = [];
    sections.forEach((sec, idx) => {
      let content = '';
      if (sec.type === 'heading') {
        content = stripHtmlAndCode(sec.text || '').trim();
        lastHeading = content;
      } else if (sec.type === 'callout') {
        content = stripHtmlAndCode(sec.text || '').trim();
      } else if (sec.type === 'image') {
        content = stripHtmlAndCode(sec.caption || sec.text || '').trim();
      } else {
        content = stripHtmlAndCode(sec.text || '').trim();
      }

      if (content && content.length >= 3) {
        chunkInputs.push({
          sectionId: sec.id,
          content,
          heading: lastHeading || '',
          metadata: {
            sectionType: sec.type,
            headingLevel: sec.level || null,
            positionOrder: idx
          }
        });
      }
    });

    if (chunkInputs.length === 0) return;

    // 3. Batch generate embeddings using the ai provider
    const ai = getAIProvider();
    const texts = chunkInputs.map((chunk) => chunk.content);
    const embeddings = await ai.embed(texts);

    // 4. Map chunks with embeddings and insert to database
    const chunkRows = chunkInputs.map((chunk, idx) => ({
      blog_id: blogId,
      section_id: chunk.sectionId,
      chunk_index: 0,
      heading: chunk.heading || '',
      content: chunk.content,
      content_hash: computeContentHash(chunk.content),
      embedding: embeddings[idx],
      metadata_json: chunk.metadata,
      updated_at: new Date().toISOString()
    }));

    const { error: insertErr } = await supabase
      .from('blog_chunks')
      .insert(chunkRows);

    if (insertErr) {
      console.error(`[blogChunks] Failed to insert chunks for blog ${blogId}:`, insertErr.message);
    } else {
      console.log(`[blogChunks] Successfully synchronized ${chunkRows.length} chunks for blog ${blogId}.`);
    }
  } catch (err: any) {
    console.error(`[blogChunks] Error synchronizing blog chunks:`, err.message || err);
  }
}
