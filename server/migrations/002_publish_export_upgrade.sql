-- ============================================================================
-- AI Blog Studio — Schema Migration 002
-- Adds Dev.to publishing metadata columns for per-blog publish tracking.
-- Safe to run multiple times.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS devto_article_id bigint;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS devto_url text;
  ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS devto_published_at timestamp with time zone;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_blogs_devto_published_at ON public.blogs(devto_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blogs_devto_url ON public.blogs(devto_url);

SELECT 'Migration 002 completed successfully' AS result;
