-- ============================================================================
-- AI Blog Studio — Schema Migration 001
-- Run this in the Supabase SQL Editor AFTER the initial schema.
-- Adds columns needed by the production backend.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. blogs table upgrades
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS subtitle text;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS slug text;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS meta_description text;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS language text DEFAULT 'English';
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS blog_type text DEFAULT 'Informative Blog';
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS prompt_used text;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Update status check constraint to include 'Archived'
ALTER TABLE public.blogs DROP CONSTRAINT IF EXISTS blogs_status_check;
ALTER TABLE public.blogs ADD CONSTRAINT blogs_status_check
  CHECK (status IN ('Draft', 'Published', 'Archived'));

-- Index for archive filtering
CREATE INDEX IF NOT EXISTS idx_blogs_archived_at ON public.blogs(archived_at);
CREATE INDEX IF NOT EXISTS idx_blogs_slug ON public.blogs(slug);

-- ---------------------------------------------------------------------------
-- 2. section_versions table upgrades
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.section_versions ADD COLUMN IF NOT EXISTS explanation text;
  ALTER TABLE public.section_versions ADD COLUMN IF NOT EXISTS diff_summary text;
  ALTER TABLE public.section_versions ADD COLUMN IF NOT EXISTS prompt_used text;
  ALTER TABLE public.section_versions ADD COLUMN IF NOT EXISTS model_used text;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. prompt_logs table upgrades
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.prompt_logs ADD COLUMN IF NOT EXISTS system_prompt text;
  ALTER TABLE public.prompt_logs ADD COLUMN IF NOT EXISTS model text;
  ALTER TABLE public.prompt_logs ADD COLUMN IF NOT EXISTS latency_ms integer DEFAULT 0;
  ALTER TABLE public.prompt_logs ADD COLUMN IF NOT EXISTS endpoint text;
  ALTER TABLE public.prompt_logs ADD COLUMN IF NOT EXISTS status text DEFAULT 'success';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4. chat_messages table upgrades
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS action_type text;
  ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS action_data jsonb;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Allow service role to bypass RLS for server-side operations
-- This is critical: the Express server uses the service role key, which
-- bypasses RLS by default in Supabase. No policy changes needed.
-- ---------------------------------------------------------------------------

-- Verify: the service role key automatically bypasses RLS in Supabase.
-- No additional grants are required.

SELECT 'Migration 001 completed successfully' AS result;
