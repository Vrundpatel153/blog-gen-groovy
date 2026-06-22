// ============================================================================
// Chat Persistence Service — Supabase CRUD for threads and messages.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { ChatThread, ChatMessage } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function createThread(
  blogId: string,
  userId: string,
  title: string = 'New Conversation'
): Promise<ChatThread> {
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({ blog_id: blogId, user_id: userId, title })
    .select()
    .single();

  if (error || !data) throw new AppError(500, `Failed to create thread: ${error?.message}`);

  return {
    id: data.id,
    blogId: data.blog_id,
    userId: data.user_id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getThreadById(threadId: string): Promise<ChatThread | null> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('id', threadId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    blogId: data.blog_id,
    userId: data.user_id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getThreadsForBlog(blogId: string): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('blog_id', blogId)
    .order('updated_at', { ascending: false });

  if (error) throw new AppError(500, `Failed to fetch threads: ${error.message}`);

  return (data || []).map((t: any) => ({
    id: t.id,
    blogId: t.blog_id,
    userId: t.user_id,
    title: t.title,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function getMessagesForThread(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) throw new AppError(500, `Failed to fetch messages: ${error.message}`);

  return (data || []).map((m: any) => ({
    id: m.id,
    threadId: m.thread_id,
    sender: m.sender,
    text: m.text,
    showDiffCard: m.show_diff_card,
    actionType: m.action_type || undefined,
    actionData: m.action_data || undefined,
    createdAt: m.created_at,
  }));
}

export async function saveMessage(
  threadId: string,
  sender: 'user' | 'assistant',
  text: string,
  showDiffCard: boolean = false,
  actionType?: string,
  actionData?: Record<string, unknown>
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      thread_id: threadId,
      sender,
      text,
      show_diff_card: showDiffCard,
      action_type: actionType || null,
      action_data: actionData || null,
    })
    .select()
    .single();

  if (error || !data) throw new AppError(500, `Failed to save message: ${error?.message}`);

  // Update thread's updated_at
  await supabase
    .from('chat_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);

  return {
    id: data.id,
    threadId: data.thread_id,
    sender: data.sender,
    text: data.text,
    showDiffCard: data.show_diff_card,
    actionType: data.action_type || undefined,
    actionData: data.action_data || undefined,
    createdAt: data.created_at,
  };
}

export async function updateMessageActionData(
  messageId: string,
  params: {
    actionData?: Record<string, unknown>;
    showDiffCard?: boolean;
  }
): Promise<ChatMessage> {
  const updatePayload: Record<string, unknown> = {};
  if (params.actionData !== undefined) updatePayload.action_data = params.actionData;
  if (params.showDiffCard !== undefined) updatePayload.show_diff_card = params.showDiffCard;

  if (Object.keys(updatePayload).length === 0) {
    throw new AppError(400, 'No update payload provided for message');
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .update(updatePayload)
    .eq('id', messageId)
    .select()
    .single();

  if (error || !data) throw new AppError(500, `Failed to update message: ${error?.message}`);

  return {
    id: data.id,
    threadId: data.thread_id,
    sender: data.sender,
    text: data.text,
    showDiffCard: data.show_diff_card,
    actionType: data.action_type || undefined,
    actionData: data.action_data || undefined,
    createdAt: data.created_at,
  };
}
