import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Blog } from '../types/index.js';
import { stripHtmlAndCode } from '../utils/plainText.js';
import { buildBlogMarkdown } from './blogExport.js';

interface DevtoPublishResult {
  articleId: number;
  url: string;
  publishedAt: string;
}

const toTag = (value: string): string => {
  const cleaned = stripHtmlAndCode(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return cleaned;
};

const selectMainImage = (blog: Blog): string | undefined => {
  const imageSection = blog.sections.find((section) => section.type === 'image' && section.url);
  const candidate = stripHtmlAndCode(imageSection?.url || '');
  if (!candidate) return undefined;
  if (candidate.startsWith('//')) return `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  return candidate;
};

export const publishBlogToDevto = async (blog: Blog): Promise<DevtoPublishResult> => {
  if (!config.devtoApiKey) {
    throw new AppError(400, 'DEVTO_API_KEY is missing. Add it to .env before publishing.');
  }

  const tags = (blog.keywords || [])
    .map(toTag)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 4);

  const bodyMarkdown = buildBlogMarkdown(blog);
  if (!bodyMarkdown) {
    throw new AppError(400, 'Blog content is empty and cannot be published.');
  }

  const payload = {
    article: {
      title: stripHtmlAndCode(blog.title),
      body_markdown: bodyMarkdown,
      published: true,
      tags,
      main_image: selectMainImage(blog),
      description: stripHtmlAndCode(blog.metaDescription || blog.subtitle || '').slice(0, 280) || undefined,
    },
  };

  const response = await fetch(config.devtoApiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.forem.api-v1+json',
      'api-key': config.devtoApiKey,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    const errorSummary = stripHtmlAndCode(rawBody).slice(0, 400) || `HTTP ${response.status}`;
    throw new AppError(502, `Dev.to publish failed: ${errorSummary}`);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  const articleIdRaw = parsed.id;
  const articleId =
    typeof articleIdRaw === 'number' && Number.isFinite(articleIdRaw)
      ? articleIdRaw
      : Number(stripHtmlAndCode(String(articleIdRaw ?? '0')));
  const url =
    stripHtmlAndCode(String(parsed.url || '')) ||
    (stripHtmlAndCode(String(parsed.path || '')).startsWith('/')
      ? `https://dev.to${stripHtmlAndCode(String(parsed.path || ''))}`
      : '');

  if (!url) {
    throw new AppError(502, 'Dev.to response did not include a publish URL.');
  }

  return {
    articleId: Number.isFinite(articleId) && articleId > 0 ? articleId : 0,
    url,
    publishedAt: new Date().toISOString(),
  };
};
