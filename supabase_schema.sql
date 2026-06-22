-- Supabase Database Schema for AI Blog Studio
-- Execute this in the Supabase SQL Editor to set up your tables and policies.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-------------------------------------------------------------------------------
-- 1. PROFILES TABLE (Linked to Supabase Auth users)
-------------------------------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  full_name text,
  avatar_url text,
  billing_tier text default 'Free'::text check (billing_tier in ('Free', 'Pro', 'Enterprise'))
);

comment on table public.profiles is 'User profile information created automatically on sign up.';

-------------------------------------------------------------------------------
-- 2. USER SETTINGS TABLE
-------------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid references public.profiles(id) on delete cascade primary key,
  theme text default 'light'::text check (theme in ('light', 'dark')),
  additional_prefs jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 3. BLOGS TABLE
-------------------------------------------------------------------------------
create table public.blogs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null default 'Untitled Blog'::text,
  status text not null default 'Draft'::text check (status in ('Draft', 'Published')),
  last_saved text not null default 'Saved just now'::text,
  words integer default 0 not null,
  read_time text default '1 min'::text,
  seo_score integer default 0 not null,
  tone text default 'Professional'::text,
  audience text default 'General Audience'::text,
  keywords text[] default '{}'::text[] not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 4. BLOG SECTIONS/BLOCKS TABLE
-------------------------------------------------------------------------------
create table public.blog_sections (
  id uuid default uuid_generate_v4() primary key,
  blog_id uuid references public.blogs(id) on delete cascade not null,
  position_order integer not null,
  type text not null check (type in ('paragraph', 'heading', 'callout', 'image')),
  text text,
  level integer,
  url text,
  caption text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 5. SECTION VERSIONS TABLE (For tracking AI before/after edits)
-------------------------------------------------------------------------------
create table public.section_versions (
  id uuid default uuid_generate_v4() primary key,
  section_id uuid references public.blog_sections(id) on delete cascade not null,
  blog_id uuid references public.blogs(id) on delete cascade not null,
  original_text text,
  edited_text text,
  is_applied boolean default false not null,
  diff_metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 6. CHAT THREADS TABLE
-------------------------------------------------------------------------------
create table public.chat_threads (
  id uuid default uuid_generate_v4() primary key,
  blog_id uuid references public.blogs(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null default 'New Conversation'::text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 7. CHAT MESSAGES TABLE
-------------------------------------------------------------------------------
create table public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references public.chat_threads(id) on delete cascade not null,
  sender text not null check (sender in ('user', 'assistant')),
  text text not null,
  show_diff_card boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- 8. PROMPT LOGS TABLE (For agent cost & audit logging)
-------------------------------------------------------------------------------
create table public.prompt_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete set null,
  blog_id uuid references public.blogs(id) on delete set null,
  prompt text not null,
  response text,
  tokens_used integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-------------------------------------------------------------------------------
-- INDEXES FOR PERFORMANCE
-------------------------------------------------------------------------------
create index idx_blogs_user_id on public.blogs(user_id);
create index idx_blogs_created_at on public.blogs(created_at desc);
create index idx_blog_sections_blog_id on public.blog_sections(blog_id);
create index idx_blog_sections_position on public.blog_sections(position_order);
create index idx_section_versions_section_id on public.section_versions(section_id);
create index idx_section_versions_blog_id on public.section_versions(blog_id);
create index idx_chat_threads_blog_id on public.chat_threads(blog_id);
create index idx_chat_threads_user_id on public.chat_threads(user_id);
create index idx_chat_messages_thread_id on public.chat_messages(thread_id);
create index idx_chat_messages_created_at on public.chat_messages(created_at asc);
create index idx_prompt_logs_user_id on public.prompt_logs(user_id);

-------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-------------------------------------------------------------------------------

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.blogs enable row level security;
alter table public.blog_sections enable row level security;
alter table public.section_versions enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.prompt_logs enable row level security;

-- Profiles Policies
create policy "Users can view any profile" on public.profiles for select using (true);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- User Settings Policies
create policy "Users can select own settings" on public.user_settings for select using (auth.uid() = user_id);
create policy "Users can insert own settings" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings" on public.user_settings for update using (auth.uid() = user_id);

-- Blogs Policies
create policy "Users can perform all actions on own blogs" on public.blogs 
  for all using (auth.uid() = user_id);

-- Blog Sections Policies (Checks ownership through the blogs parent relationship)
create policy "Users can perform all actions on own blog sections" on public.blog_sections
  for all using (
    exists (
      select 1 from public.blogs
      where blogs.id = blog_sections.blog_id and blogs.user_id = auth.uid()
    )
  );

-- Section Versions Policies
create policy "Users can perform all actions on own section versions" on public.section_versions
  for all using (
    exists (
      select 1 from public.blogs
      where blogs.id = section_versions.blog_id and blogs.user_id = auth.uid()
    )
  );

-- Chat Threads Policies
create policy "Users can perform all actions on own chat threads" on public.chat_threads
  for all using (auth.uid() = user_id);

-- Chat Messages Policies
create policy "Users can perform all actions on own chat messages" on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_messages.thread_id and chat_threads.user_id = auth.uid()
    )
  );

-- Prompt Logs Policies
create policy "Users can view own prompt logs" on public.prompt_logs for select using (auth.uid() = user_id);
create policy "Users can insert own prompt logs" on public.prompt_logs for insert with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- AUTOMATIC PROFILE SETUP TRIGGERS
-------------------------------------------------------------------------------

-- Trigger function to create profile & default settings when a user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  -- Create Profile
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );

  -- Create Default Settings
  insert into public.user_settings (user_id, theme)
  values (new.id, 'light');

  return new;
end;
$$ language plpgsql security definer;

-- Trigger execution bind
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
