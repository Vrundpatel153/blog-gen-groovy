import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Blog, BlogSection } from '../types/index.js';
import { normalizeLayoutText, stripHtmlAndCode } from '../utils/plainText.js';

export type BlogExportFormat = 'md' | 'html' | 'pdf';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 48;
const MAX_IMAGE_HEIGHT = 280;

const escapeHtml = (value: unknown): string =>
  stripHtmlAndCode(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeMarkdown = (value: unknown): string =>
  normalizeLayoutText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

const slugify = (value: string): string => {
  const normalized = stripHtmlAndCode(value || 'blog').toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  return slug || 'blog';
};

const parseList = (value: unknown):
  | { kind: 'ordered'; start: number; items: string[] }
  | { kind: 'bullet'; items: string[] }
  | null => {
  const lines = normalizeLayoutText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const ordered = lines.map((line) => line.match(/^(\d+)[.)]\s+(.+)$/));
  if (ordered.every(Boolean)) {
    const first = Number(ordered[0]?.[1] || '1');
    return {
      kind: 'ordered',
      start: Number.isFinite(first) && first > 0 ? first : 1,
      items: ordered.map((match) => normalizeLayoutText(match?.[2] || '')).filter(Boolean),
    };
  }

  const bullets = lines.map((line) => line.match(/^[-*]\s+(.+)$/));
  if (bullets.every(Boolean)) {
    return {
      kind: 'bullet',
      items: bullets.map((match) => normalizeLayoutText(match?.[1] || '')).filter(Boolean),
    };
  }

  return null;
};

const getSectionText = (section: BlogSection): string =>
  normalizeLayoutText(
    section.type === 'image' ? section.caption || section.text || section.url || '' : section.text || ''
  );

const getImageUrl = (section: BlogSection): string => {
  const raw = stripHtmlAndCode(section.url || '');
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
};

const renderParagraphMarkdown = (value: string): string => {
  if (!value) return '';
  const list = parseList(value);
  if (list?.kind === 'ordered') {
    return list.items.map((item, index) => `${list.start + index}. ${escapeMarkdown(item)}`).join('\n');
  }
  if (list?.kind === 'bullet') {
    return list.items.map((item) => `- ${escapeMarkdown(item)}`).join('\n');
  }
  return value
    .split('\n\n')
    .map((chunk) => escapeMarkdown(chunk))
    .join('\n\n');
};

const renderParagraphHtml = (value: string): string => {
  if (!value) return '';
  const list = parseList(value);
  if (list?.kind === 'ordered') {
    const startAttr = list.start > 1 ? ` start="${list.start}"` : '';
    const items = list.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return `<ol${startAttr}>${items}</ol>`;
  }
  if (list?.kind === 'bullet') {
    const items = list.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  return value
    .split('\n\n')
    .map((chunk) =>
      `<p>${escapeHtml(chunk)
        .split('\n')
        .join('<br />')}</p>`
    )
    .join('');
};

export const buildBlogMarkdown = (blog: Blog): string => {
  const parts: string[] = [];
  parts.push(`# ${escapeMarkdown(blog.title)}`);
  const subtitle = normalizeLayoutText(blog.subtitle || '');
  if (subtitle) {
    parts.push(`_${escapeMarkdown(subtitle)}_`);
  }
  parts.push('');

  blog.sections.forEach((section) => {
    if (section.type === 'heading') {
      const level = section.level === 1 ? '##' : section.level === 3 ? '####' : '###';
      const text = normalizeLayoutText(section.text || '');
      if (text) parts.push(`${level} ${escapeMarkdown(text)}`);
      parts.push('');
      return;
    }

    if (section.type === 'callout') {
      const text = normalizeLayoutText(section.text || '');
      if (text) {
        parts.push(
          text
            .split('\n')
            .map((line) => `> ${escapeMarkdown(line)}`)
            .join('\n')
        );
        parts.push('');
      }
      return;
    }

    if (section.type === 'image') {
      const imageUrl = getImageUrl(section);
      if (imageUrl) {
        const caption = normalizeLayoutText(section.caption || section.text || 'Blog image');
        parts.push(`![${escapeMarkdown(caption)}](${imageUrl})`);
        if (caption) {
          parts.push(`*${escapeMarkdown(caption)}*`);
        }
        parts.push('');
      }
      return;
    }

    const paragraph = renderParagraphMarkdown(getSectionText(section));
    if (paragraph) {
      parts.push(paragraph);
      parts.push('');
    }
  });

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const buildBlogHtmlBody = (blog: Blog): string => {
  const parts: string[] = [];
  parts.push(`<h1 class="blog-doc-title">${escapeHtml(blog.title)}</h1>`);
  const subtitle = normalizeLayoutText(blog.subtitle || '');
  if (subtitle) {
    parts.push(`<p class="blog-doc-subtitle">${escapeHtml(subtitle)}</p>`);
  }

  blog.sections.forEach((section) => {
    const text = getSectionText(section);
    if (section.type === 'heading') {
      const level = section.level === 1 ? 'h1' : section.level === 3 ? 'h3' : 'h2';
      if (text) parts.push(`<${level}>${escapeHtml(text)}</${level}>`);
      return;
    }

    if (section.type === 'callout') {
      if (text) {
        parts.push(
          `<blockquote>${escapeHtml(text)
            .split('\n')
            .join('<br />')}</blockquote>`
        );
      }
      return;
    }

    if (section.type === 'image') {
      const imageUrl = getImageUrl(section);
      if (!imageUrl) return;
      const caption = normalizeLayoutText(section.caption || section.text || '');
      parts.push(
        `<figure><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(caption || 'Blog image')}" loading="lazy" />${
          caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
        }</figure>`
      );
      return;
    }

    const paragraph = renderParagraphHtml(text);
    if (paragraph) {
      parts.push(paragraph);
    }
  });

  return parts.join('\n');
};

export const buildBlogHtmlDocument = (blog: Blog): string => {
  const body = buildBlogHtmlBody(blog);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(blog.title)}</title>
  <style>
    :root {
      --paper-bg: #fff9ef;
      --paper-border: #eadfca;
      --title: #2f261b;
      --body: #453a2d;
      --muted: #6f6150;
      --accent: #a2692b;
      --callout-bg: #fff4df;
      --callout-border: #d1a368;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 30px;
      background: #f5efe4;
      color: var(--body);
      font-family: "Merriweather", Georgia, "Times New Roman", serif;
      line-height: 1.9;
    }
    article {
      max-width: 900px;
      margin: 0 auto;
      background: var(--paper-bg);
      border: 1px solid var(--paper-border);
      border-radius: 16px;
      padding: 42px 44px;
      box-shadow: 0 12px 36px rgba(131, 104, 68, 0.12);
    }
    .blog-doc-title {
      margin: 0 0 8px;
      font-size: clamp(2.2rem, 4vw, 3.1rem);
      line-height: 1.1;
      color: var(--title);
    }
    .blog-doc-subtitle {
      margin: 0 0 28px;
      font-family: "Inter", system-ui, sans-serif;
      color: var(--muted);
      font-size: 1.06rem;
      line-height: 1.55;
    }
    h1, h2, h3 { color: var(--title); margin: 1.2rem 0 0.65rem; }
    h1 { font-size: 1.7rem; }
    h2 { font-size: 1.45rem; }
    h3 { font-size: 1.2rem; }
    p, li {
      text-align: justify;
      text-justify: inter-word;
      margin: 0.8rem 0;
    }
    ul, ol { margin: 0.9rem 0; padding-left: 1.8rem; }
    li::marker { color: var(--accent); font-weight: 700; }
    blockquote {
      margin: 1rem 0;
      border-left: 4px solid var(--callout-border);
      background: var(--callout-bg);
      border-radius: 12px;
      color: var(--muted);
      padding: 14px 16px;
      font-style: italic;
    }
    figure { margin: 1.25rem 0; }
    img {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--paper-border);
      display: block;
    }
    figcaption {
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.95rem;
      text-align: center;
      font-style: italic;
    }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <article>
    ${body}
  </article>
</body>
</html>`;
};

const wrapText = (font: PDFFont, size: number, maxWidth: number, value: string): string[] => {
  const chunks = normalizeLayoutText(value).split('\n');
  const lines: string[] = [];
  chunks.forEach((chunk) => {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      return;
    }
    let current = words[0] || '';
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i] || '';
      }
    }
    lines.push(current);
  });
  return lines;
};

const toImageBytes = async (rawUrl: string): Promise<Uint8Array | null> => {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
    const commaIndex = trimmed.indexOf(',');
    const base64 = commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : '';
    if (!base64) return null;
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const response = await fetch(trimmed);
    if (!response.ok) return null;
    const arr = await response.arrayBuffer();
    return new Uint8Array(arr);
  } catch {
    return null;
  }
};

const tryEmbedImage = async (pdfDoc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> => {
  try {
    return await pdfDoc.embedPng(bytes);
  } catch {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
};

type PdfCursor = {
  page: PDFPage;
  y: number;
};

const newPdfPage = (pdfDoc: PDFDocument): PdfCursor => {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  return { page, y: A4_HEIGHT - PAGE_MARGIN };
};

const ensurePageSpace = (pdfDoc: PDFDocument, cursor: PdfCursor, needed: number): PdfCursor => {
  if (cursor.y - needed < PAGE_MARGIN) {
    return newPdfPage(pdfDoc);
  }
  return cursor;
};

const drawWrappedLines = (
  pdfDoc: PDFDocument,
  cursorIn: PdfCursor,
  lines: string[],
  options: {
    font: PDFFont;
    size: number;
    lineHeight: number;
    color: ReturnType<typeof rgb>;
    x: number;
    maxWidth: number;
  }
): PdfCursor => {
  let cursor = cursorIn;
  lines.forEach((line) => {
    cursor = ensurePageSpace(pdfDoc, cursor, options.lineHeight + 4);
    cursor.page.drawText(line, {
      x: options.x,
      y: cursor.y,
      font: options.font,
      size: options.size,
      color: options.color,
      maxWidth: options.maxWidth,
      lineHeight: options.lineHeight,
    });
    cursor.y -= options.lineHeight;
  });
  return cursor;
};

export const buildBlogPdf = async (blog: Blog): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const contentWidth = A4_WIDTH - PAGE_MARGIN * 2;

  let cursor = newPdfPage(pdfDoc);

  const titleLines = wrapText(fontBold, 26, contentWidth, blog.title || 'Untitled Blog');
  cursor = drawWrappedLines(pdfDoc, cursor, titleLines, {
    font: fontBold,
    size: 26,
    lineHeight: 30,
    color: rgb(0.18, 0.14, 0.1),
    x: PAGE_MARGIN,
    maxWidth: contentWidth,
  });
  cursor.y -= 8;

  const subtitle = normalizeLayoutText(blog.subtitle || '');
  if (subtitle) {
    const subtitleLines = wrapText(fontItalic, 13, contentWidth, subtitle);
    cursor = drawWrappedLines(pdfDoc, cursor, subtitleLines, {
      font: fontItalic,
      size: 13,
      lineHeight: 17,
      color: rgb(0.43, 0.38, 0.3),
      x: PAGE_MARGIN,
      maxWidth: contentWidth,
    });
    cursor.y -= 16;
  } else {
    cursor.y -= 10;
  }

  for (const section of blog.sections) {
    if (section.type === 'image') {
      const url = getImageUrl(section);
      const caption = normalizeLayoutText(section.caption || section.text || '');
      const bytes = await toImageBytes(url);
      const embedded = bytes ? await tryEmbedImage(pdfDoc, bytes) : null;

      if (embedded) {
        const widthScale = contentWidth / embedded.width;
        const heightScale = MAX_IMAGE_HEIGHT / embedded.height;
        const scale = Math.min(widthScale, heightScale, 1);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;

        cursor = ensurePageSpace(pdfDoc, cursor, drawHeight + 40);
        cursor.page.drawImage(embedded, {
          x: PAGE_MARGIN + (contentWidth - drawWidth) / 2,
          y: cursor.y - drawHeight,
          width: drawWidth,
          height: drawHeight,
        });
        cursor.y -= drawHeight + 8;
      }

      if (caption) {
        const captionLines = wrapText(fontItalic, 11, contentWidth, caption);
        cursor = drawWrappedLines(pdfDoc, cursor, captionLines, {
          font: fontItalic,
          size: 11,
          lineHeight: 14,
          color: rgb(0.43, 0.38, 0.3),
          x: PAGE_MARGIN,
          maxWidth: contentWidth,
        });
      }
      cursor.y -= 14;
      continue;
    }

    if (section.type === 'heading') {
      const headingText = getSectionText(section);
      if (!headingText) continue;
      const headingSize = section.level === 1 ? 20 : section.level === 3 ? 15 : 17;
      const headingLines = wrapText(fontBold, headingSize, contentWidth, headingText);
      cursor.y -= 8;
      cursor = drawWrappedLines(pdfDoc, cursor, headingLines, {
        font: fontBold,
        size: headingSize,
        lineHeight: headingSize + 4,
        color: rgb(0.21, 0.17, 0.12),
        x: PAGE_MARGIN,
        maxWidth: contentWidth,
      });
      cursor.y -= 6;
      continue;
    }

    if (section.type === 'callout') {
      const calloutText = getSectionText(section);
      if (!calloutText) continue;
      const calloutLines = wrapText(fontItalic, 12, contentWidth - 24, calloutText);
      const calloutHeight = calloutLines.length * 16 + 18;
      cursor = ensurePageSpace(pdfDoc, cursor, calloutHeight + 12);
      cursor.page.drawRectangle({
        x: PAGE_MARGIN,
        y: cursor.y - calloutHeight,
        width: contentWidth,
        height: calloutHeight,
        color: rgb(1, 0.96, 0.88),
        borderColor: rgb(0.82, 0.64, 0.41),
        borderWidth: 1,
      });
      let calloutY = cursor.y - 14;
      calloutLines.forEach((line) => {
        cursor.page.drawText(line, {
          x: PAGE_MARGIN + 12,
          y: calloutY,
          font: fontItalic,
          size: 12,
          color: rgb(0.42, 0.37, 0.3),
          maxWidth: contentWidth - 24,
          lineHeight: 16,
        });
        calloutY -= 16;
      });
      cursor.y -= calloutHeight + 12;
      continue;
    }

    const text = getSectionText(section);
    if (!text) continue;

    const list = parseList(text);
    if (list?.kind === 'ordered') {
      const numbered = list.items.map((item, index) => `${list.start + index}. ${item}`);
      const listLines = numbered.flatMap((line) => wrapText(fontRegular, 12, contentWidth, line));
      cursor = drawWrappedLines(pdfDoc, cursor, listLines, {
        font: fontRegular,
        size: 12,
        lineHeight: 16,
        color: rgb(0.27, 0.22, 0.17),
        x: PAGE_MARGIN,
        maxWidth: contentWidth,
      });
      cursor.y -= 8;
      continue;
    }

    if (list?.kind === 'bullet') {
      const bullets = list.items.map((item) => `- ${item}`);
      const listLines = bullets.flatMap((line) => wrapText(fontRegular, 12, contentWidth, line));
      cursor = drawWrappedLines(pdfDoc, cursor, listLines, {
        font: fontRegular,
        size: 12,
        lineHeight: 16,
        color: rgb(0.27, 0.22, 0.17),
        x: PAGE_MARGIN,
        maxWidth: contentWidth,
      });
      cursor.y -= 8;
      continue;
    }

    const paragraphBlocks = text.split('\n\n');
    paragraphBlocks.forEach((block) => {
      const lines = wrapText(fontRegular, 12, contentWidth, block);
      cursor = drawWrappedLines(pdfDoc, cursor, lines, {
        font: fontRegular,
        size: 12,
        lineHeight: 17,
        color: rgb(0.27, 0.22, 0.17),
        x: PAGE_MARGIN,
        maxWidth: contentWidth,
      });
      cursor.y -= 8;
    });
  }

  return pdfDoc.save();
};

export const getExportMimeType = (format: BlogExportFormat): string => {
  if (format === 'md') return 'text/markdown; charset=utf-8';
  if (format === 'html') return 'text/html; charset=utf-8';
  return 'application/pdf';
};

export const buildExportFilename = (blog: Blog, format: BlogExportFormat): string =>
  `${slugify(blog.title || 'blog')}.${format}`;
