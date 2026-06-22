// ============================================================================
// Prompt Logger Service — logs every AI call for debugging and analytics.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

export interface LogPromptParams {
  userId?: string;
  blogId?: string;
  endpoint: string;
  userPrompt: string;
  systemPrompt: string;
  response?: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  status: 'success' | 'error';
}

export async function logPrompt(params: LogPromptParams): Promise<void> {
  try {
    await supabase.from('prompt_logs').insert({
      user_id: params.userId || null,
      blog_id: params.blogId || null,
      endpoint: params.endpoint,
      prompt: params.userPrompt,
      system_prompt: params.systemPrompt,
      response: params.response || null,
      model: params.model,
      tokens_used: params.tokensUsed,
      latency_ms: params.latencyMs,
      status: params.status,
    });
  } catch (err) {
    // Never let logging failures break the main flow
    console.error('[PromptLogger] Failed to log prompt:', err);
  }
}
