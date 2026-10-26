import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import { zipSync } from 'fflate';
import { attemptsFor, presetFor } from '../lib/compressOptions';

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

async function renderPage(page, scale, type, quality, options = {}) {
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

  if (options.grayscale && type === 'image/jpeg') {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = Math.round(
        pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114,
      );
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
  }

  const blob = await canvas.convertToBlob({
    type,
    ...(type === 'image/jpeg' || type === 'image/webp' ? { quality } : {}),
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

function pageGroupLabel(group, total) {
  const digits = String(total).length;
  const pad = (page) => String(page).padStart(digits, '0');
  if (group.length === 1) return `page-${pad(group[0])}`;
  const consecutive = group.every((page, index) => index === 0 || page === group[index - 1] + 1);
  if (consecutive) return `pages-${pad(group[0])}-${pad(group[group.length - 1])}`;
  return `pages-${group.map(pad).join('-')}`;
}

async function splitPdfGroups(bytes, groups, title) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new JobError('NO_PAGES', 'Select at least one page to split.');
  }

  let source;
  try {
    source = await PDFDocument.load(bytes);
  } catch (error) {
    throw new JobError('PDF_UNREADABLE', friendlyMessage(error));
  }

  const total = source.getPageCount();
  const entries = {};
  let pages = 0;

  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new JobError('NO_PAGES', 'A split group had no pages.');
    }
    const indexes = group.map((page) => {
      if (!Number.isInteger(page) || page < 1 || page > total) {
        throw new JobError('BAD_RANGE', `Page ${page} is outside this ${total}-page PDF.`);
      }
      return page - 1;
    });

    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, indexes);
    copied.forEach((page) => output.addPage(page));
    const now = new Date();
    output.setTitle(`${title} - ${pageGroupLabel(group, total)}`);
    output.setCreator('Reformat');
    output.setProducer('Reformat');
    output.setCreationDate(now);
    output.setModificationDate(now);
    const result = await output.save();
    entries[`${title}-${pageGroupLabel(group, total)}.pdf`] = new Uint8Array(result);
    pages += group.length;
  }

  const zipped = zipSync(entries, { level: 0 });
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    pages,
    files: groups.length,
  };
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

async function organizePdf(bytes, order, title) {
  if (!Array.isArray(order) || order.length === 0) {
    throw new JobError('NO_PAGES', 'Keep at least one page before saving.');
  }

  let source;
  try {
    source = await PDFDocument.load(bytes);
  } catch (error) {
    throw new JobError('PDF_UNREADABLE', friendlyMessage(error));
  }

  const total = source.getPageCount();
  const seen = new Set();
  for (const entry of order) {
    const page = Number(entry?.page);
    if (!Number.isInteger(page) || page < 1 || page > total) {
      throw new JobError('BAD_PAGE', `Page ${entry?.page} is outside this ${total}-page PDF.`);
    }
    if (seen.has(page)) {
      throw new JobError('DUPLICATE_PAGE', `Page ${page} appears more than once.`);
    }
    seen.add(page);
  }

  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    order.map((entry) => Number(entry.page) - 1),
  );
  copied.forEach((page, index) => {
    const extra = [0, 90, 180, 270].includes(Number(order[index]?.rotation))
      ? Number(order[index].rotation)
      : 0;
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + extra) % 360));
    output.addPage(page);
  });

  const now = new Date();
  output.setTitle(title || 'Organized document');
  output.setCreator('Reformat');
  output.setProducer('Reformat');
  output.setCreationDate(now);
  output.setModificationDate(now);
  const result = await output.save();
  return { blob: new Blob([result], { type: 'application/pdf' }), pages: copied.length };
}

async function pdfToImages(bytes, options, onProgress) {
  const dpi = Number(options?.dpi) || 150;
  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(options?.type)
    ? options.type
    : 'image/png';
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const baseName = options?.baseName || 'document';

  onProgress?.({ label: 'Opening PDF' });
  const { doc, task } = await openForRendering(bytes);
  const entries = {};
  let clamped = false;

  try {
    const total = doc.numPages;
    if (!total) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');
    const digits = String(total).length;
    const requested =
      Array.isArray(options?.pages) && options.pages.length > 0
        ? [...new Set(options.pages)].sort((a, b) => a - b)
        : Array.from({ length: total }, (_, index) => index + 1);

    for (let index = 0; index < requested.length; index += 1) {
      const pageNumber = Number(requested[index]);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
        throw new JobError('BAD_RANGE', `Page ${requested[index]} is outside this ${total}-page PDF.`);
      }
      onProgress?.({
        label: `Rendering page ${pageNumber} of ${total}`,
        done: index,
        total: requested.length,
      });
      const page = await doc.getPage(pageNumber);
      const { base, scale, clamped: hitLimit } = scaleForPage(page, dpi);
      clamped ||= hitLimit;
      const image = await renderPage(page, scale, type, 0.9);
      if (image.blob.type !== type) {
        throw new JobError(
          'IMAGE_FORMAT_UNSUPPORTED',
          'This browser cannot encode the selected image format. Choose PNG or JPG instead.',
        );
      }
      const name = `${baseName}-page-${String(pageNumber).padStart(digits, '0')}.${extension}`;
      entries[name] = new Uint8Array(await image.blob.arrayBuffer());
      page.cleanup();
      if (base.width <= 0 || base.height <= 0) {
        throw new JobError('PDF_EMPTY', 'This PDF has an unreadable page size.');
      }
    }

    onProgress?.({ label: 'Packing ZIP', done: requested.length, total: requested.length });
    const zipped = zipSync(entries, { level: 0 });
    return {
      blob: new Blob([zipped], { type: 'application/zip' }),
      pages: requested.length,
      clamped,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

function pdfNamePart(value) {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : null;
}

function pdfNumberField(dict, key, fallback = null) {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

function encodedStreamBytes(stream) {
  if (stream instanceof PDFRawStream) return stream.contents;
  if (typeof stream.getContents === 'function') return stream.getContents();
  return new Uint8Array();
}

function imageFilterNames(dict) {
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter) return [];
  if (filter instanceof PDFName) {
    const name = pdfNamePart(filter);
    return name ? [name] : [];
  }
  if (filter instanceof PDFArray) {
    return filter
      .asArray()
      .map((entry) => pdfNamePart(entry))
      .filter(Boolean);
  }
  return [];
}

function imageColorComponents(dict) {
  const colorSpace = dict.lookup(PDFName.of('ColorSpace'));
  if (colorSpace instanceof PDFName) {
    const name = pdfNamePart(colorSpace);
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return 3;
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return 1;
    if (name === 'DeviceCMYK' || name === 'CMYK') return 4;
    return null;
  }
  if (colorSpace instanceof PDFArray) {
    const family = pdfNamePart(colorSpace.get(0));
    if (family === 'ICCBased') {
      const profile = colorSpace.lookup(1);
      if (profile instanceof PDFStream) {
        const count = pdfNumberField(profile.dict, 'N');
        if (count === 1 || count === 3 || count === 4) return count;
      }
    }
    if (family === 'CalRGB') return 3;
    if (family === 'CalGray') return 1;
  }
  return null;
}

function isOptimizableImage(stream) {
  if (!(stream instanceof PDFStream)) return false;
  const dict = stream.dict;
  if (pdfNamePart(dict.get(PDFName.of('Subtype'))) !== 'Image') return false;
  const imageMask = dict.lookup(PDFName.of('ImageMask'));
  if (imageMask instanceof PDFBool && imageMask.asBoolean()) return false;
  if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'))) return false;
  if (dict.has(PDFName.of('Decode'))) return false;
  if (pdfNumberField(dict, 'BitsPerComponent', 8) !== 8) return false;
  const width = pdfNumberField(dict, 'Width', 0);
  const height = pdfNumberField(dict, 'Height', 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return false;
  }
  return width * height <= 40_000_000;
}

async function decodeImageSource(stream, dict, width, height) {
  const filters = imageFilterNames(dict);
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    const bitmap = await createImageBitmap(
      new Blob([encodedStreamBytes(stream)], { type: 'image/jpeg' }),
      { imageOrientation: 'none', premultiplyAlpha: 'default' },
    );
    return { bitmap, width, height };
  }

  const supported = new Set([
    'FlateDecode',
    'ASCII85Decode',
    'ASCIIHexDecode',
    'RunLengthDecode',
    'LZWDecode',
  ]);
  if (filters.some((name) => !supported.has(name))) return null;
  if (!(stream instanceof PDFRawStream)) return null;

  const components = imageColorComponents(dict);
  if (!components) return null;

  const decoded = decodePDFRawStream(stream).decode();
  const pixelCount = width * height;
  const expected = pixelCount * components;
  if (decoded.length < expected) return null;

  const rgba = new Uint8ClampedArray(pixelCount * 4);
  if (components === 3) {
    for (let source = 0, target = 0; source < expected; source += 3, target += 4) {
      rgba[target] = decoded[source];
      rgba[target + 1] = decoded[source + 1];
      rgba[target + 2] = decoded[source + 2];
      rgba[target + 3] = 255;
    }
  } else if (components === 1) {
    for (let source = 0, target = 0; source < expected; source += 1, target += 4) {
      const value = decoded[source];
      rgba[target] = value;
      rgba[target + 1] = value;
      rgba[target + 2] = value;
      rgba[target + 3] = 255;
    }
  } else {
    for (let source = 0, target = 0; source < expected; source += 4, target += 4) {
      const c = decoded[source] / 255;
      const m = decoded[source + 1] / 255;
      const y = decoded[source + 2] / 255;
      const k = decoded[source + 3] / 255;
      rgba[target] = Math.round(255 * (1 - c) * (1 - k));
      rgba[target + 1] = Math.round(255 * (1 - m) * (1 - k));
      rgba[target + 2] = Math.round(255 * (1 - y) * (1 - k));
      rgba[target + 3] = 255;
    }
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return { canvas, width, height };
}

function targetImageDimensions(width, height, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  if (!Number.isFinite(scale) || scale >= 0.98) return null;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function encodeImageAtSize(stream, dict, width, height, targetWidth, targetHeight, quality) {
  let source;
  try {
    source = await decodeImageSource(stream, dict, width, height);
  } catch {
    return null;
  }
  if (!source) return null;

  const target = targetImageDimensions(width, height, targetWidth, targetHeight);
  if (!target) {
    source.bitmap?.close();
    if (source.canvas) {
      source.canvas.width = 0;
      source.canvas.height = 0;
    }
    return null;
  }

  try {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source.bitmap ?? source.canvas, 0, 0, target.width, target.height);
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: Math.min(0.95, Math.max(0.35, quality)),
    });
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || blob.type !== 'image/jpeg' || !blob.size) return null;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: target.width,
      height: target.height,
    };
  } catch {
    return null;
  } finally {
    source.bitmap?.close();
    if (source.canvas) {
      source.canvas.width = 0;
      source.canvas.height = 0;
    }
  }
}

function collectImageGroups(doc, dpi) {
  const groups = new Map();
  let pagesWithImages = 0;
  const pageCount = doc.getPageCount();

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.getPage(pageIndex);
    const rotation = page.getRotation().angle % 180;
    const rawWidth = page.getWidth();
    const rawHeight = page.getHeight();
    const pageWidth = rotation ? rawHeight : rawWidth;
    const pageHeight = rotation ? rawWidth : rawHeight;
    const targetWidth = Math.max(1, Math.floor((pageWidth / 72) * dpi));
    const targetHeight = Math.max(1, Math.floor((pageHeight / 72) * dpi));
    let pageHasImage = false;
    const seenForms = new Set();

    const walkResources = (resources) => {
      if (!(resources instanceof PDFDict)) return;
      const xobjects = resources.lookup(PDFName.of('XObject'));
      if (!(xobjects instanceof PDFDict)) return;

      for (const [name, value] of xobjects.entries()) {
        const object = xobjects.lookup(name);
        if (!(object instanceof PDFStream)) continue;
        const subtype = pdfNamePart(object.dict.get(PDFName.of('Subtype')));

        if (subtype === 'Form') {
          if (seenForms.has(object)) continue;
          seenForms.add(object);
          walkResources(object.dict.lookup(PDFName.of('Resources')));
          continue;
        }

        if (subtype !== 'Image' || !isOptimizableImage(object)) continue;
        pageHasImage = true;
        const width = pdfNumberField(object.dict, 'Width', 0);
        const height = pdfNumberField(object.dict, 'Height', 0);
        const ref = doc.context.getObjectRef(object);
        const key = ref ? ref.toString() : object;
        let group = groups.get(key);
        if (!group) {
          group = {
            stream: object,
            dict: object.dict,
            width,
            height,
            targetWidth: 0,
            targetHeight: 0,
            originalBytes: encodedStreamBytes(object).length,
            usages: [],
          };
          groups.set(key, group);
        }
        group.targetWidth = Math.max(group.targetWidth, targetWidth);
        group.targetHeight = Math.max(group.targetHeight, targetHeight);
        group.usages.push({ dict: xobjects, name });
      }
    };

    walkResources(page.node.Resources());
    if (pageHasImage) pagesWithImages += 1;
  }

  return { groups: [...groups.values()], pagesWithImages };
}

function describePdfImages(doc, groups, pagesWithImages) {
  const pages = doc.getPageCount();
  let kind = 'text';
  if (groups.length > 0) {
    kind = pagesWithImages >= Math.max(1, Math.ceil(pages * 0.5)) ? 'scanned' : 'mixed';
  }
  return { kind, pages, imageCount: groups.length, pagesWithImages };
}

function stripCompressionMetadata(doc) {
  doc.catalog.delete(PDFName.of('Metadata'));
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : null;
  if (info instanceof PDFDict) {
    for (const [key] of info.entries()) info.delete(key);
  }
}

function removeUnreachableObjects(doc) {
  const context = doc.context;
  const seenRefs = new Set();

  const visit = (value) => {
    if (!value) return;
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      visit(context.lookup(value));
      return;
    }
    if (value instanceof PDFDict) {
      for (const [, child] of value.entries()) visit(child);
      return;
    }
    if (value instanceof PDFArray) {
      for (const child of value.asArray()) visit(child);
      return;
    }
    if (value instanceof PDFStream) {
      visit(value.dict);
    }
  };

  visit(context.trailerInfo.Root);
  visit(context.trailerInfo.Info);
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seenRefs.has(ref.toString())) context.delete(ref);
  }
}

async function compressKeepText(bytes, config, onProgress, prefix) {
  onProgress?.({ label: prefixedProgress(prefix, 'Analyzing PDF'), done: 0, total: 0 });
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPageCount();
  if (!pages) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');

  const { groups, pagesWithImages } = collectImageGroups(doc, config.dpi);
  const analysis = describePdfImages(doc, groups, pagesWithImages);
  const candidates = groups
    .map((group) => ({
      group,
      target: targetImageDimensions(
        group.width,
        group.height,
        group.targetWidth,
        group.targetHeight,
      ),
    }))
    .filter((entry) => entry.target);

  let reencodedImages = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const { group, target } = candidates[index];
    onProgress?.({
      label: prefixedProgress(
        prefix,
        `Optimizing image ${index + 1} of ${candidates.length}`,
      ),
      done: index,
      total: candidates.length,
    });
    const result = await encodeImageAtSize(
      group.stream,
      group.dict,
      group.width,
      group.height,
      group.targetWidth,
      group.targetHeight,
      config.quality,
    );
    if (!result || result.bytes.length >= group.originalBytes) continue;

    const embedded = await doc.embedJpg(result.bytes);
    for (const usage of group.usages) {
      usage.dict.set(usage.name, embedded.ref);
    }
    reencodedImages += 1;
  }

  onProgress?.({
    label: prefixedProgress(prefix, 'Writing PDF'),
    done: candidates.length,
    total: candidates.length,
  });
  stripCompressionMetadata(doc);
  removeUnreachableObjects(doc);
  const saved = await doc.save({ useObjectStreams: true });
  return {
    bytes: saved,
    pages,
    analysis,
    strategy: 'keep',
    reencodedImages,
    clamped: false,
  };
}

async function compressRaster(bytes, config, options, onProgress, prefix) {
  onProgress?.({ label: prefixedProgress(prefix, 'Analyzing PDF'), done: 0, total: 0 });
  const analysisDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const analysisGroups = collectImageGroups(analysisDoc, config.dpi);
  const analysis = describePdfImages(
    analysisDoc,
    analysisGroups.groups,
    analysisGroups.pagesWithImages,
  );

  const { doc, task } = await openForRendering(bytes.slice());
  const output = await PDFDocument.create();
  let clamped = false;

  try {
    const total = doc.numPages;
    if (!total) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');

    for (let index = 1; index <= total; index += 1) {
      onProgress?.({
        label: prefixedProgress(prefix, `Rendering page ${index} of ${total}`),
        done: index - 1,
        total,
      });
      const page = await doc.getPage(index);
      const { base, scale, clamped: hitLimit } = scaleForPage(page, config.dpi);
      clamped ||= hitLimit;
      const image = await renderPage(page, scale, 'image/jpeg', config.quality, {
        grayscale: Boolean(options?.grayscale),
      });
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

    onProgress?.({
      label: prefixedProgress(prefix, 'Writing PDF'),
      done: total,
      total,
    });
    const saved = await output.save({ useObjectStreams: true });
    return {
      bytes: saved,
      pages: total,
      analysis,
      strategy: 'raster',
      reencodedImages: total,
      clamped,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

function prefixedProgress(prefix, label) {
  return prefix ? `${prefix} · ${label}` : label;
}

async function compressPdf(bytes, options, onProgress) {
  const strategy = options?.strategy === 'raster' ? 'raster' : 'keep';
  const chosen = presetFor(options?.preset);
  const targetValue = Number(options?.targetBytes);
  const targetBytes =
    Number.isFinite(targetValue) && targetValue >= 1024
      ? targetValue
      : null;
  const attempts = attemptsFor({
    preset: chosen.value,
    targetEnabled: Boolean(targetBytes),
  });

  let best = null;
  let attemptsRun = 0;
  for (let index = 0; index < attempts.length; index += 1) {
    attemptsRun += 1;
    const attempt = attempts[index];
    const prefix = attempts.length > 1 ? `Pass ${index + 1} of ${attempts.length}` : '';
    const config = { dpi: attempt.dpi, quality: attempt.quality };
    const result =
      strategy === 'raster'
        ? await compressRaster(bytes, config, options, onProgress, prefix)
        : await compressKeepText(bytes, config, onProgress, prefix);

    if (!best || result.bytes.length < best.bytes.length) {
      best = { ...result, attempt: index + 1, preset: attempt.label };
    }
    if (!targetBytes || result.bytes.length <= targetBytes) break;
  }

  if (!best) throw new JobError('PDF_EMPTY', 'This PDF has no pages.');
  const unchanged = best.bytes.length >= bytes.length;
  const finalBytes = unchanged ? bytes : best.bytes;

  return {
    blob: new Blob([finalBytes], { type: 'application/pdf' }),
    pages: best.pages,
    analysis: best.analysis,
    strategy,
    preset: best.preset,
    before: bytes.length,
    after: finalBytes.length,
    unchanged,
    reencodedImages: best.reencodedImages,
    clamped: Boolean(best.clamped),
    targetBytes,
    targetMet: targetBytes ? finalBytes.length <= targetBytes : true,
    attempts: attemptsRun,
  };
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
    } else if (action === 'split-zip') {
      result = await splitPdfGroups(payload.bytes, payload.groups, payload.title);
    } else if (action === 'organize') {
      result = await organizePdf(payload.bytes, payload.order, payload.title);
    } else if (action === 'pdf-to-images') {
      result = await pdfToImages(payload.bytes, payload.options, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else if (action === 'compress') {
      result = await compressPdf(payload.bytes, payload.options, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else if (action === 'text-to-pdf') {
      const { buildTextPdf } = await import('../lib/textPdf.js');
      result = await buildTextPdf({
        text: payload.text,
        options: payload.options,
        title: payload.title,
        onProgress: (progress) => {
          self.postMessage({ id, type: 'progress', progress });
        },
      });
    } else if (action === 'measure-text-pdf') {
      const { measureTextPdf } = await import('../lib/textPdf.js');
      result = await measureTextPdf({
        text: payload.text,
        options: payload.options,
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
