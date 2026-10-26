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
const TRUNCATION_MARKER = '\u2026';

const fontBytesCache = new Map();
const measureFontCache = new Map();

class TextPdfError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TextPdfError';
    this.code = code;
  }
}

function layoutOptions(options) {
  return {
    family: options?.font === 'sans' ? 'sans' : 'mono',
    fontSize: Math.min(24, Math.max(7, Number(options?.fontSize) || 11)),
    lineNumbers: Boolean(options?.lineNumbers),
    wrap: options?.wrap !== false,
    pageBase: PAGE_BASE_SIZES[options?.pageSize] ?? PAGE_BASE_SIZES.a4,
    margin: marginFor(options?.margin).points,
  };
}

async function loadFontBytes(family) {
  if (!fontBytesCache.has(family)) {
    const pending = (async () => {
      try {
        const response = await fetch(FONT_URLS[family]);
        if (!response.ok) throw new Error('Font request failed.');
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new TextPdfError(
          'FONT_LOAD_FAILED',
          'The PDF font could not be loaded. Reload the page and try again.',
        );
      }
    })();
    fontBytesCache.set(family, pending);
    pending.catch(() => {
      if (fontBytesCache.get(family) === pending) fontBytesCache.delete(family);
    });
  }
  return fontBytesCache.get(family);
}

async function getMeasureFont(family) {
  if (!measureFontCache.has(family)) {
    const pending = (async () => {
      const bytes = await loadFontBytes(family);
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const font = await doc.embedFont(bytes, { subset: true });
      return { font, supported: new Set(font.getCharacterSet()) };
    })();
    measureFontCache.set(family, pending);
    pending.catch(() => {
      if (measureFontCache.get(family) === pending) measureFontCache.delete(family);
    });
  }
  return measureFontCache.get(family);
}

function sanitizeText(text, supported) {
  let replaced = 0;
  let output = '';
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0x0a || codePoint === 0x0c) {
      output += character;
      continue;
    }
    if (codePoint < 0x20 || codePoint === 0x7f || !supported.has(codePoint)) {
      output += '?';
      replaced += 1;
      continue;
    }
    output += character;
  }

  return { text: output, replaced };
}

function sourceLinesFrom(text) {
  const chunks = text.split('\f');
  const lines = [];
  let pageBreakBefore = false;

  chunks.forEach((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const parts = chunk.split('\n');
    if (!isLast && chunk.endsWith('\n')) parts.pop();

    if (chunk.length > 0) {
      parts.forEach((part, partIndex) => {
        lines.push({
          text: part,
          pageBreakBefore: pageBreakBefore && partIndex === 0,
        });
      });
    }
    pageBreakBefore = true;
  });

  if (lines.length === 0) lines.push({ text: '', pageBreakBefore: false });
  return lines;
}

function widthLookup(font) {
  const widths = new Map();
  return (character, size) => {
    let width = widths.get(character);
    if (width === undefined) {
      width = font.widthOfTextAtSize(character, 1);
      widths.set(character, width);
    }
    return width * size;
  };
}

function wrapLine(line, widthOf, fontSize, maxWidth) {
  if (!line) return [''];

  const characters = Array.from(line);
  const chunks = [];
  let start = 0;

  while (start < characters.length) {
    let width = 0;
    let end = start;
    while (end < characters.length) {
      const characterWidth = widthOf(characters[end], fontSize);
      if (end > start && width + characterWidth > maxWidth) break;
      width += characterWidth;
      end += 1;
    }
    if (end === characters.length) {
      chunks.push(characters.slice(start).join(''));
      break;
    }

    let space = end;
    while (space > start && characters[space] !== ' ') space -= 1;
    if (space > start + 1 && characters[space] === ' ') end = space;

    chunks.push(characters.slice(start, end).join(''));
    start = end;
    while (characters[start] === ' ') start += 1;
  }

  return chunks.length ? chunks : [''];
}

function truncateLine(line, widthOf, fontSize, maxWidth) {
  if (!line) return line;

  let lineWidth = 0;
  for (const character of line) lineWidth += widthOf(character, fontSize);
  if (lineWidth <= maxWidth) return line;

  const markerWidth = widthOf(TRUNCATION_MARKER, fontSize);
  if (markerWidth > maxWidth) return '';

  const characters = Array.from(line);
  let width = 0;
  let best = 0;
  while (best < characters.length) {
    const next = width + widthOf(characters[best], fontSize);
    if (next + markerWidth > maxWidth) break;
    width = next;
    best += 1;
  }

  return `${characters.slice(0, best).join('')}${TRUNCATION_MARKER}`;
}

function layoutText({ text, font, supported, options }) {
  const { fontSize, lineNumbers, wrap, pageBase, margin } = layoutOptions(options);
  const widthOf = widthLookup(font);
  const sanitized = sanitizeText(text, supported);
  const sourceLines = sourceLinesFrom(sanitized.text);
  const sourceDigits = String(Math.max(1, sourceLines.length)).length;
  const gutter = lineNumbers
    ? Math.max(3, sourceDigits + 1) * font.widthOfTextAtSize('0', fontSize * 0.78) + 10
    : 0;
  const maxWidth = Math.max(24, pageBase.width - margin * 2 - gutter);

  const lines = [];
  for (const source of sourceLines) {
    const parts = wrap
      ? wrapLine(source.text, widthOf, fontSize, maxWidth)
      : [truncateLine(source.text, widthOf, fontSize, maxWidth)];
    parts.forEach((part, index) => {
      lines.push({
        text: part,
        pageBreakBefore: index === 0 && source.pageBreakBefore,
        number: lines.length + 1,
      });
    });
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
  const pages = [];
  let current = [];

  for (const line of lines) {
    if (line.pageBreakBefore && current.length > 0) {
      pages.push(current);
      current = [];
    }
    current.push(line);
    if (current.length >= linesPerPage) {
      pages.push(current);
      current = [];
    }
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);

  if (pages.length > MAX_PAGES) {
    throw new TextPdfError(
      'TEXT_TOO_LONG',
      'This text needs more than 5,000 pages. Split it into smaller files.',
    );
  }

  return {
    sanitized,
    pages,
    lineHeight,
    gutter,
    maxWidth,
  };
}

export async function buildTextPdf({ text, options, title, onProgress }) {
  const { family, fontSize, lineNumbers, pageBase, margin } = layoutOptions(options);

  onProgress?.({ label: 'Loading font' });
  const fontBytes = await loadFontBytes(family);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let font;
  try {
    font = await doc.embedFont(fontBytes, { subset: true });
  } catch {
    throw new TextPdfError(
      'FONT_LOAD_FAILED',
      'The PDF font could not be loaded. Reload the page and try again.',
    );
  }

  const supported = new Set(font.getCharacterSet());
  onProgress?.({ label: 'Laying out text' });
  const layout = layoutText({ text, font, supported, options });

  onProgress?.({ label: 'Writing PDF' });
  const contentX = margin + layout.gutter;

  for (const pageLines of layout.pages) {
    const page = doc.addPage([pageBase.width, pageBase.height]);
    const top = pageBase.height - margin - fontSize;

    pageLines.forEach((line, index) => {
      const y = top - index * layout.lineHeight;
      if (lineNumbers) {
        const number = String(line.number);
        const numberWidth = font.widthOfTextAtSize(number, fontSize * 0.78);
        page.drawText(number, {
          x: margin + layout.gutter - 10 - numberWidth,
          y,
          size: fontSize * 0.78,
          font,
          color: NUMBER_COLOR,
        });
      }
      if (line.text) {
        page.drawText(line.text, {
          x: contentX,
          y,
          size: fontSize,
          font,
          color: TEXT_COLOR,
        });
      }
    });
  }

  const now = new Date();
  doc.setTitle(title || 'Text document');
  doc.setCreator('Reformat');
  doc.setProducer('Reformat');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const bytes = await doc.save();
  return { bytes, pages: layout.pages.length, replaced: layout.sanitized.replaced };
}

export async function measureTextPdf({ text, options }) {
  const { family } = layoutOptions(options);
  const { font, supported } = await getMeasureFont(family);
  const layout = layoutText({ text, font, supported, options });
  return {
    pages: layout.pages.length,
    replaced: layout.sanitized.replaced,
  };
}
