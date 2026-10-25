import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import monoFontUrl from '../assets/fonts/IBMPlexMono-Regular.ttf?url';
import sansFontUrl from '../assets/fonts/IBMPlexSans-Regular.ttf?url';
import { PAGE_BASE_SIZES, marginFor } from './pdfOptions';

const MAX_PAGES = 5000;
const MAX_LAYOUT_LINES = 260_000;
const FONT_URLS = { mono: monoFontUrl, sans: sansFontUrl };
const TEXT_COLOR = rgb(0.12, 0.12, 0.11);
const NUMBER_COLOR = rgb(0.43, 0.43, 0.41);

class TextPdfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TextPdfError';
    this.code = code;
  }
}

function sanitizeText(text, supported) {
  let replaced = 0;
  let output = '';
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0x0a) {
      output += '\n';
      continue;
    }
    if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      !supported.has(codePoint)
    ) {
      output += '?';
      replaced += 1;
      continue;
    }
    output += character;
  }

  return { text: output, replaced };
}

function fittedChunk(line, start, font, fontSize, maxWidth) {
  let low = start + 1;
  let high = line.length;
  let best = start + 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const width = font.widthOfTextAtSize(line.slice(start, middle), fontSize);
    if (width <= maxWidth) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(best, start + 1);
}

function wrapLine(line, font, fontSize, maxWidth) {
  if (!line || font.widthOfTextAtSize(line, fontSize) <= maxWidth) return [line];

  const chunks = [];
  let start = 0;
  while (start < line.length) {
    if (font.widthOfTextAtSize(line.slice(start), fontSize) <= maxWidth) {
      chunks.push(line.slice(start));
      break;
    }
    const fit = fittedChunk(line, start, font, fontSize, maxWidth);
    let end = fit;
    if (fit < line.length) {
      const space = line.lastIndexOf(' ', fit);
      if (space > start + 1) end = space;
    }
    chunks.push(line.slice(start, end));
    start = end;
    while (line[start] === ' ' || line[start] === '\n') start += 1;
    if (start === fit && end === fit) start = fit;
  }

  return chunks.length ? chunks : [''];
}

export async function buildTextPdf({ text, options, title, onProgress }) {
  const family = options?.font === 'sans' ? 'sans' : 'mono';
  const fontSize = Math.min(24, Math.max(7, Number(options?.fontSize) || 11));
  const lineNumbers = Boolean(options?.lineNumbers);
  const wrap = options?.wrap !== false;
  const pageBase = PAGE_BASE_SIZES[options?.pageSize] ?? PAGE_BASE_SIZES.a4;
  const margin = marginFor(options?.margin).points;

  onProgress?.({ label: 'Loading font' });
  let fontBytes;
  try {
    const response = await fetch(FONT_URLS[family]);
    if (!response.ok) throw new Error('Font request failed.');
    fontBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new TextPdfError(
      'FONT_LOAD_FAILED',
      'The PDF font could not be loaded. Reload the page and try again.',
    );
  }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const sanitized = sanitizeText(text, supported);

  onProgress?.({ label: 'Laying out text' });
  const sourceLines = sanitized.text.split('\n');
  const sourceDigits = String(Math.max(1, sourceLines.length)).length;
  const gutter =
    lineNumbers
      ? Math.max(3, sourceDigits + 1) * font.widthOfTextAtSize('0', fontSize * 0.78) + 10
      : 0;
  const maxWidth = Math.max(
    24,
    pageBase.width - margin * 2 - gutter,
  );

  const lines = [];
  for (const line of sourceLines) {
    if (!wrap) {
      lines.push(line);
    } else {
      lines.push(...wrapLine(line, font, fontSize, maxWidth));
    }
    if (lines.length > MAX_LAYOUT_LINES) {
      throw new TextPdfError(
        'TEXT_TOO_LONG',
        'This text needs more than 5,000 pages. Split it into smaller files.',
      );
    }
  }

  const lineHeight = fontSize * 1.45;
  const usableHeight = pageBase.height - margin * 2;
  const linesPerPage = Math.max(1, Math.floor((usableHeight - fontSize) / lineHeight) + 1);
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  if (pageCount > MAX_PAGES) {
    throw new TextPdfError(
      'TEXT_TOO_LONG',
      'This text needs more than 5,000 pages. Split it into smaller files.',
    );
  }

  onProgress?.({ label: 'Writing PDF' });
  const contentX = margin + gutter;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.addPage([pageBase.width, pageBase.height]);
    const start = pageIndex * linesPerPage;
    const end = Math.min(lines.length, start + linesPerPage);
    const top = pageBase.height - margin - fontSize;

    for (let index = start; index < end; index += 1) {
      const line = lines[index];
      const y = top - (index - start) * lineHeight;
      if (lineNumbers) {
        const number = String(index + 1);
        const numberWidth = font.widthOfTextAtSize(number, fontSize * 0.78);
        page.drawText(number, {
          x: margin + gutter - 10 - numberWidth,
          y,
          size: fontSize * 0.78,
          font,
          color: NUMBER_COLOR,
        });
      }
      if (line) {
        page.drawText(line, {
          x: contentX,
          y,
          size: fontSize,
          font,
          color: TEXT_COLOR,
        });
      }
    }
  }

  const now = new Date();
  doc.setTitle(title || 'Text document');
  doc.setCreator('Reformat');
  doc.setProducer('Reformat');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const bytes = await doc.save();
  return { bytes, pages: pageCount, replaced: sanitized.replaced };
}
