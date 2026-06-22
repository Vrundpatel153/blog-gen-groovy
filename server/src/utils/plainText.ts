function preserveHtmlListMarkers(value: string): string {
  if (!value || !/[<](ol|ul|li|\/li)[^>]*>/i.test(value)) return value;

  let text = value;

  text = text.replace(/<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi, (_match, attrs, inner) => {
    const startMatch = String(attrs || '').match(/\bstart\s*=\s*["']?(\d+)/i);
    let index = startMatch ? Number(startMatch[1]) : 1;
    if (!Number.isFinite(index) || index <= 0) index = 1;
    const items = String(inner || '').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    if (items.length === 0) return '\n';
    const converted = items
      .map((rawItem) => {
        const content = rawItem
          .replace(/<\/?li\b[^>]*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!content) return '';
        const line = `${index}. ${content}`;
        index += 1;
        return line;
      })
      .filter(Boolean);
    return converted.length > 0 ? `\n${converted.join('\n')}\n` : '\n';
  });

  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner) => {
    const items = String(inner || '').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    if (items.length === 0) return '\n';
    const converted = items
      .map((rawItem) => {
        const content = rawItem
          .replace(/<\/?li\b[^>]*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return content ? `- ${content}` : '';
      })
      .filter(Boolean);
    return converted.length > 0 ? `\n${converted.join('\n')}\n` : '\n';
  });

  text = text
    .replace(/<\/li>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/blockquote>/gi, '\n');

  return text;
}

export function stripHtmlAndCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = preserveHtmlListMarkers(input)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .trim();

  return cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .trim();
}

export function normalizeLayoutText(input: unknown): string {
  const text = stripHtmlAndCode(input);
  if (!text) return '';

  // Convert inline bullets into line-separated bullets.
  let normalized = text
    .replace(/\s+[\u2022\u00B7\u25AA]\s+/g, '\n- ')
    .replace(/\s+-\s+/g, '\n- ')
    .replace(/\s+\*\s+/g, '\n* ')
    .replace(/\s+(\d+)[.)]\s+/g, '\n$1. ');

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Ensure bullet/numbered items stay one-per-line and clean.
  const cleanedLines = lines.map((line) =>
    line
      .replace(/^[\u2022\u00B7\u25AA]\s+/, '- ')
      .replace(/^[-*]\s+/, '- ')
      .replace(/^(\d+)[)]\s+/, '$1. ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  normalized = cleanedLines.join('\n');

  // Add paragraph breaks for long prose to keep professional spacing.
  if (!/^([-*]|\d+[.]\s+)/m.test(normalized) && normalized.length > 520) {
    const sentences = normalized
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 5) {
      const chunks: string[] = [];
      let bucket: string[] = [];
      for (const sentence of sentences) {
        bucket.push(sentence);
        if (bucket.length >= 2) {
          chunks.push(bucket.join(' '));
          bucket = [];
        }
      }
      if (bucket.length > 0) {
        chunks.push(bucket.join(' '));
      }
      normalized = chunks.join('\n\n');
    }
  }

  return normalized.trim();
}

export function sanitizeSectionShape(raw: any, fallbackId: string) {
  const markdownImageMatch =
    typeof raw?.text === 'string'
      ? raw.text.match(/!\[([^\]]*)\]\(([^)]+)\)/)
      : null;

  const markdownImageCaption = normalizeLayoutText(markdownImageMatch?.[1] || '');
  const markdownImageUrl = stripHtmlAndCode(markdownImageMatch?.[2] || '');
  const normalizedUrlFromInput =
    stripHtmlAndCode(raw?.url || raw?.imageUrl || raw?.src) || markdownImageUrl;

  const pickText = (...values: unknown[]): string => {
    for (const value of values) {
      const normalized = normalizeLayoutText(value);
      if (normalized) return normalized;
    }
    return '';
  };

  const normalizedType =
    raw?.type === 'heading' || raw?.type === 'callout' || raw?.type === 'image'
      ? raw.type
      : normalizedUrlFromInput
        ? 'image'
        : typeof raw?.level === 'number' || raw?.heading || raw?.title
          ? 'heading'
          : 'paragraph';

  const levelRaw = typeof raw?.level === 'number' ? raw.level : Number(raw?.level);
  const level =
    Number.isFinite(levelRaw) && levelRaw >= 1 && levelRaw <= 3
      ? Math.round(levelRaw)
      : normalizedType === 'heading'
        ? 1
        : undefined;

  return {
    id: stripHtmlAndCode(raw?.id) || fallbackId,
    type: normalizedType,
    text:
      normalizedType === 'image'
        ? pickText(
            raw?.caption,
            raw?.alt,
            raw?.imageCaption,
            markdownImageCaption,
            raw?.text,
            raw?.content,
            raw?.body,
            raw?.paragraph,
            raw?.description,
            raw?.prompt
          )
        : pickText(raw?.text, raw?.content, raw?.body, raw?.paragraph, raw?.description, raw?.prompt),
    level,
    url: normalizedUrlFromInput || undefined,
    caption:
      pickText(raw?.caption, raw?.alt, raw?.imageCaption, markdownImageCaption) || undefined,
  };
}
