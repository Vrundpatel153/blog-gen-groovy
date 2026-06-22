// ============================================================================
// AI Blog Studio — Shared TypeScript Types
// Used by both server services and API route contracts.
// ============================================================================

// ---------------------------------------------------------------------------
// Database / Domain Models
// ---------------------------------------------------------------------------

export interface BlogSection {
  id: string;
  type: 'paragraph' | 'heading' | 'callout' | 'image';
  text?: string;
  level?: number;
  url?: string;
  caption?: string;
}

export interface Blog {
  id: string;
  userId: string;
  title: string;
  subtitle?: string;
  slug?: string;
  metaDescription?: string;
  status: 'Draft' | 'Published' | 'Archived';
  words: number;
  readTime: string;
  sections: BlogSection[];
  seoScore: number;
  tone: string;
  audience: string;
  language: string;
  blogType: string;
  keywords: string[];
  promptUsed?: string;
  publishedToDevto?: boolean;
  devtoArticleId?: number;
  devtoUrl?: string;
  devtoPublishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionVersion {
  id: string;
  sectionId: string;
  blogId: string;
  originalText: string;
  editedText: string;
  explanation?: string;
  diffSummary?: string;
  promptUsed?: string;
  modelUsed?: string;
  isApplied: boolean;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  blogId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  sender: 'user' | 'assistant';
  text: string;
  showDiffCard: boolean;
  actionType?: string;
  actionData?: Record<string, unknown>;
  createdAt: string;
}

export interface PromptLog {
  id: string;
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
  createdAt: string;
}

export interface UserProfile {
  id: string;
  fullName: string;
  avatarUrl?: string;
  billingTier: 'Free' | 'Pro' | 'Enterprise';
}

export interface UserSettings {
  userId: string;
  theme: 'light' | 'dark';
  additionalPrefs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API Request Types
// ---------------------------------------------------------------------------

export interface GenerateBlogRequest {
  prompt: string;
  blogType: string;
  tone: string;
  audience: string;
  language: string;
  length: string;
  seoKeywords: string;
  preferences: string[];
}

export interface EditSectionRequest {
  instruction: string;
  currentText: string;
  sectionType: string;
  blogTitle?: string;
  blogTone?: string;
  surroundingContext?: string;
}

export interface SendChatMessageRequest {
  message: string;
  blogContext?: {
    title: string;
    subtitle?: string;
    tone: string;
    audience: string;
    sections: BlogSection[];
    activeSectionId?: string;
    selectedText?: string;
    selectedField?: 'title' | 'section';
  };
}

export interface CreateChatThreadRequest {
  blogId: string;
  title?: string;
}

export interface UpdateBlogRequest {
  title?: string;
  subtitle?: string;
  status?: 'Draft' | 'Published' | 'Archived';
  tone?: string;
  audience?: string;
  keywords?: string[];
  sections?: BlogSection[];
  devtoArticleId?: number;
  devtoUrl?: string;
  devtoPublishedAt?: string;
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface EditSectionResponse {
  originalText: string;
  editedText: string;
  explanation: string;
  diffSummary?: string;
  versionId: string;
}

export interface GeneratedBlogData {
  title: string;
  subtitle: string;
  slug: string;
  metaDescription: string;
  sections: BlogSection[];
  keywords: string[];
  faq?: Array<{ question: string; answer: string }>;
  cta?: string;
}

export interface ChatAssistantResponse {
  message: ChatMessage;
  actionType?: 'edit_section' | 'replace_all' | 'editor_ops' | 'none';
  actionData?: Record<string, unknown>;
  meta?: {
    tokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens: number;
    };
    contextPlan?: {
      mode: 'full' | 'focused' | 'targeted';
      reason: string;
      totalSections: number;
      promptSections: number;
    };
    model?: string;
    latencyMs?: number;
  };
}

// ---------------------------------------------------------------------------
// AI Provider Types
// ---------------------------------------------------------------------------

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface AICompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason: string;
}

