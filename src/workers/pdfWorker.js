import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';

const MAX_CANVAS_DIMENSION = 16384;
const MAX_OUTPUT_PIXELS = 64_000_000;
const THUMB_MAX = 128;

class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

class WorkerCanvasFactory {
  create(width, height) {
    if (width <= 0 || height <= 0) throw new JobError('RENDER_FAILED', 'Invalid page size.');
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext('2d', { willReadFrequently: true }),
    };
  }

  reset(entry, width, height) {
    if (!entry?.canvas || width <= 0 || height <= 0) {
      throw new JobError('RENDER_FAILED', 'Invalid page size.');
    }
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry) {
    if (!entry?.canvas) return;
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

class WorkerBinaryDataFactory {
  constructor({ cMapUrl = null, standardFontDataUrl = null, wasmUrl = null } = {}) {
    this.cMapUrl = cMapUrl;
    this.standardFontDataUrl = standardFontDataUrl;
    this.wasmUrl = wasmUrl;
  }

  async fetch({ kind, filename }) {
    const base = this[kind];
    if (!base) throw new Error(`Missing ${kind} URL.`);
    const response = await fetch(`${base}${filename}`);
    if (!response.ok) throw new Error(response.statusText || 'Asset request failed.');
    return new Uint8Array(await response.arrayBuffer());
  }
}

class WorkerFilterFactory {
  addFilter() {
    return 'none';
  }

  addHCMFilter() {
    return 'none';
  }

  addAlphaFilter() {
    return 'none';
  }

  addLuminosityFilter() {
    return 'none';
  }

  addHighlightHCMFilter() {
    return 'none';
  }

  addKnockoutFilter() {
    return 'none';
  }

  addSelectionHCMFilter() {
    return 'none';
  }

  addSelectionFilter() {
    return 'none';
  }

  createSelectionStyle() {
    return null;
  }

  destroy() {}
}

function friendlyMessage(error) {
  if (error instanceof JobError) return error.message;
  if (error?.name === 'PasswordException') {
    return 'This PDF is password-protected. Unlock it and try again.';
  }
  if (/encrypted/i.test(error?.message || '')) {
    return 'This PDF is password-protected. Unlock it and try again.';
  }
  if (
    error?.name === 'InvalidPDFException' ||
    /invalid pdf|no pdf header|expected instance of pdfdict|reading 'pages'|trailer|xref/i.test(
      error?.message || '',
    )
  ) {
    return 'This PDF could not be read. It may be damaged or not a real PDF.';
  }
  return error?.message || 'The PDF could not be processed. The file may be damaged.';
}

async function openForRendering(bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    CanvasFactory: WorkerCanvasFactory,
    FilterFactory: WorkerFilterFactory,
    BinaryDataFactory: WorkerBinaryDataFactory,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    useWasm: true,
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    return { doc, task };
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
}

function scaleForPage(page, dpi = 150) {
  const base = page.getViewport({ scale: 1 });
  const requested = Math.max(dpi, 24) / 72;
  const limit = Math.min(
    MAX_CANVAS_DIMENSION / Math.max(1, base.width),
    MAX_CANVAS_DIMENSION / Math.max(1, base.height),
    Math.sqrt(MAX_OUTPUT_PIXELS / Math.max(1, base.width * base.height)),
  );
  return {
    base,
    scale: Math.max(0.001, Math.min(requested, limit)),
    clamped: requested > limit,
  };
}

async function renderPage(page, scale, type, quality) {
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new JobError('CANVAS_FAILED', 'This browser could not create a page canvas.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({
    canvasContext: context,
    viewport,
    background: '#ffffff',
  }).promise;

  const blob = await canvas.convertToBlob({
    type,
    ...(type === 'image/jpeg' ? { quality } : {}),
  });
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height };
}

async function renderThumbnail(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.5, THUMB_MAX / Math.max(1, base.width, base.height));
  return renderPage(page, Math.max(0.02, scale), 'image/png');
}

async function inspectPdf(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { pages: doc.getPageCount() };
  } catch (error) {
    throw new JobError('PDF_UNREADABLE', friendlyMessage(error));
  }
}

async function splitPrepare(bytes, onProgress) {
  onProgress?.({ label: 'Opening PDF' });
  const { doc, task } = await openForRendering(bytes);
  try {
    const pages = doc.numPages;
    if (!pages) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');
    const thumbs = [];

    for (let index = 1; index <= pages; index += 1) {
      const page = await doc.getPage(index);
      onProgress?.({
        label: `Rendering page ${index} of ${pages}`,
        done: index - 1,
        total: pages,
      });
      const image = await renderThumbnail(page);
      const size = page.getViewport({ scale: 1 });
      thumbs.push({
        page: index,
        blob: image.blob,
        width: image.width,
        height: image.height,
        pageWidth: size.width,
        pageHeight: size.height,
      });
      page.cleanup();
    }

    return { pages, thumbs };
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function splitPdf(bytes, pageNumbers, title) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    throw new JobError('NO_PAGES', 'Select at least one page to extract.');
  }

  let source;
  try {
    source = await PDFDocument.load(bytes);
  } catch (error) {
    throw new JobError('PDF_UNREADABLE', friendlyMessage(error));
  }

  const total = source.getPageCount();
  const indexes = [];
  for (const page of pageNumbers) {
    if (!Number.isInteger(page) || page < 1 || page > total) {
      throw new JobError('BAD_RANGE', `Page ${page} is outside this ${total}-page PDF.`);
    }
    indexes.push(page - 1);
  }

  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, indexes);
  copied.forEach((page) => output.addPage(page));
  const now = new Date();
  output.setTitle(title);
  output.setCreator('Reformat');
  output.setProducer('Reformat');
  output.setCreationDate(now);
  output.setModificationDate(now);

  const result = await output.save();
  return { blob: new Blob([result], { type: 'application/pdf' }), pages: indexes.length };
}

async function mergePdfs(documents, title) {
  if (!Array.isArray(documents) || documents.length < 2) {
    throw new JobError('NOT_ENOUGH_FILES', 'Add at least two PDFs to merge.');
  }

  const output = await PDFDocument.create();
  let pages = 0;

  for (const document of documents) {
    let source;
    try {
      source = await PDFDocument.load(document.bytes);
    } catch (error) {
      throw new JobError(
        'PDF_UNREADABLE',
        `${document.name || 'One of the PDFs'}: ${friendlyMessage(error)}`,
      );
    }
    const copied = await output.copyPages(source, source.getPageIndices());
    copied.forEach((page) => output.addPage(page));
    pages += copied.length;
  }

  if (pages === 0) throw new JobError('PDF_EMPTY', 'The PDFs did not contain any pages.');
  const now = new Date();
  output.setTitle(title);
  output.setCreator('Reformat');
  output.setProducer('Reformat');
  output.setCreationDate(now);
  output.setModificationDate(now);

  const result = await output.save();
  return { blob: new Blob([result], { type: 'application/pdf' }), pages };
}

async function pdfToImages(bytes, options, onProgress) {
  const dpi = Number(options?.dpi) || 150;
  const type = options?.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const extension = type === 'image/jpeg' ? 'jpg' : 'png';
  const baseName = options?.baseName || 'document';

  onProgress?.({ label: 'Opening PDF' });
  const { doc, task } = await openForRendering(bytes);
  const entries = {};
  let clamped = false;

  try {
    const total = doc.numPages;
    if (!total) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');
    const digits = String(total).length;

    for (let index = 1; index <= total; index += 1) {
      onProgress?.({
        label: `Rendering page ${index} of ${total}`,
        done: index - 1,
        total,
      });
      const page = await doc.getPage(index);
      const { base, scale, clamped: hitLimit } = scaleForPage(page, dpi);
      clamped ||= hitLimit;
      const image = await renderPage(page, scale, type, 0.9);
      const name = `${baseName}-page-${String(index).padStart(digits, '0')}.${extension}`;
      entries[name] = new Uint8Array(await image.blob.arrayBuffer());
      page.cleanup();
      if (base.width <= 0 || base.height <= 0) {
        throw new JobError('PDF_EMPTY', 'This PDF has an unreadable page size.');
      }
    }

    onProgress?.({ label: 'Packing ZIP', done: total, total });
    const zipped = zipSync(entries, { level: 0 });
    return {
      blob: new Blob([zipped], { type: 'application/zip' }),
      pages: total,
      clamped,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function compressPdf(bytes, options, onProgress) {
  const dpi = Number(options?.dpi) || 150;
  const quality = Math.min(0.95, Math.max(0.35, Number(options?.quality) || 0.72));

  onProgress?.({ label: 'Opening PDF' });
  const { doc, task } = await openForRendering(bytes);
  const output = await PDFDocument.create();
  let clamped = false;

  try {
    const total = doc.numPages;
    if (!total) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');

    for (let index = 1; index <= total; index += 1) {
      onProgress?.({
        label: `Rendering page ${index} of ${total}`,
        done: index - 1,
        total,
      });
      const page = await doc.getPage(index);
      const { base, scale, clamped: hitLimit } = scaleForPage(page, dpi);
      clamped ||= hitLimit;
      const image = await renderPage(page, scale, 'image/jpeg', quality);
      const embedded = await output.embedJpg(new Uint8Array(await image.blob.arrayBuffer()));
      const outputPage = output.addPage([base.width, base.height]);
      outputPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
      });
      page.cleanup();
    }

    onProgress?.({ label: 'Writing PDF', done: total, total });
    const now = new Date();
    output.setTitle(options?.title || 'Compressed document');
    output.setCreator('Reformat');
    output.setProducer('Reformat');
    output.setCreationDate(now);
    output.setModificationDate(now);
    const result = await output.save();
    return {
      blob: new Blob([result], { type: 'application/pdf' }),
      pages: total,
      clamped,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data ?? {};
  if (!id || !action) return;

  try {
    let result;
    if (action === 'inspect') {
      result = await inspectPdf(payload.bytes);
    } else if (action === 'split-prepare') {
      result = await splitPrepare(payload.bytes, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else if (action === 'split') {
      result = await splitPdf(payload.bytes, payload.pages, payload.title);
    } else if (action === 'merge') {
      result = await mergePdfs(payload.documents, payload.title);
    } else if (action === 'pdf-to-images') {
      result = await pdfToImages(payload.bytes, payload.options, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else if (action === 'compress') {
      result = await compressPdf(payload.bytes, payload.options, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else {
      throw new JobError('UNKNOWN_ACTION', 'Unknown PDF action.');
    }

    self.postMessage({ id, type: 'done', result });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      code: error?.code || 'PDF_FAILED',
      message: friendlyMessage(error),
    });
  }
};
