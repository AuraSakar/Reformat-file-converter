import { fitCanvasUnderTarget, TargetSizeError } from '../lib/targetSize';
import { normalizeJpegOrientation } from '../lib/exif';
import { pageBoxFor } from '../lib/pdfOptions';

const MAX_CANVAS_DIMENSION = 16384;
const MAX_OUTPUT_PIXELS = 100_000_000;

class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data ?? {};
  if (!id || !action) return;

  try {
    let result;
    if (action === 'convert') {
      result = await convertImage(payload, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else if (action === 'thumbnail') {
      result = await createThumbnail(payload);
    } else if (action === 'pdf-page') {
      result = await renderPdfPage(payload, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
    } else {
      throw new JobError('UNKNOWN_ACTION', 'Unknown conversion action.');
    }
    self.postMessage({ id, type: 'done', result });
  } catch (error) {
    const message =
      error instanceof TargetSizeError
        ? error.message
        : error?.code
          ? error.message
          : 'The image could not be converted. The file may be damaged or use a format this browser cannot decode.';
    self.postMessage({
      id,
      type: 'error',
      code: error?.code || 'CONVERSION_FAILED',
      message,
    });
  }
};

async function convertImage(payload, onProgress) {
  const { source, kind, orientation = 1, options } = payload;
  if (!source || !options?.type) {
    throw new JobError('INVALID_JOB', 'The conversion settings were incomplete.');
  }

  onProgress?.({ label: 'Reading image' });
  const decoded = await decodeBitmap(source, kind, orientation);
  const bitmap = decoded.bitmap;
  const exifOrientation = decoded.orientation;
  try {
    if (!bitmap.width || !bitmap.height) {
      throw new JobError('DECODE_FAILED', 'The image has no readable dimensions.');
    }

    const rotation = normalizeRotation(options.rotation);
    const flattensTransparency =
      options.type === 'image/jpeg' || options.type === 'image/bmp';
    const background = flattensTransparency ? normalizeColor(options.background) : null;
    const encodeOptions = { icoSizes: options.icoSizes };
    let baseScale = computeBaseScale(bitmap.width, bitmap.height, exifOrientation, options);

    const targetBytes =
      Number.isFinite(options.targetBytes) && options.targetBytes > 0
        ? options.targetBytes
        : null;

    baseScale = protectCanvasSize(
      bitmap,
      exifOrientation,
      rotation,
      baseScale,
      Boolean(targetBytes),
    );

    onProgress?.({ label: 'Resizing image' });
    let canvas = renderCanvas({
      bitmap,
      orientation: exifOrientation,
      rotation,
      scale: baseScale,
      background,
    });

    if (!targetBytes) {
      onProgress?.({ label: 'Encoding image' });
      const quality = qualityFormat(options.type)
        ? clampQuality(options.quality)
        : undefined;
      const blob = await encodeCanvas(canvas, options.type, quality, encodeOptions);
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        quality: quality ?? null,
      };
    }

    const fitted = await fitCanvasUnderTarget({
      canvas,
      type: options.type,
      targetBytes,
      encode: (target, quality) => encodeCanvas(target, options.type, quality, encodeOptions),
      downscale: downscaleCanvas,
      onProgress,
    });

    return {
      blob: fitted.blob,
      width: fitted.width,
      height: fitted.height,
      quality: fitted.quality,
    };
  } finally {
    bitmap.close();
  }
}

async function createThumbnail({ source, kind, orientation = 1 }) {
  const decoded = await decodeBitmap(source, kind, orientation);
  const bitmap = decoded.bitmap;
  try {
    const [orientedWidth, orientedHeight] = orientedDimensions(
      bitmap.width,
      bitmap.height,
      decoded.orientation,
    );
    const scale = Math.min(1, 96 / Math.max(orientedWidth, orientedHeight));
    const canvas = renderCanvas({
      bitmap,
      orientation: decoded.orientation,
      rotation: 0,
      scale,
      background: null,
    });
    const blob = await encodeCanvas(canvas, 'image/png');
    return { blob, width: orientedWidth, height: orientedHeight };
  } finally {
    bitmap.close();
  }
}

async function renderPdfPage(payload, onProgress) {
  const { source, kind, options } = payload;
  if (!source || !options) {
    throw new JobError('INVALID_JOB', 'The PDF page settings were incomplete.');
  }

  onProgress?.({ label: 'Reading image' });
  const decoded = await decodeBitmap(source, kind, 1);
  const bitmap = decoded.bitmap;

  try {
    const rotation = normalizeRotation(options.rotation);
    const [orientedWidth, orientedHeight] = orientedDimensions(
      bitmap.width,
      bitmap.height,
      decoded.orientation,
    );
    const swap = rotation === 90 || rotation === 270;
    const displayWidth = swap ? orientedHeight : orientedWidth;
    const displayHeight = swap ? orientedWidth : orientedHeight;
    if (!displayWidth || !displayHeight) {
      throw new JobError('DECODE_FAILED', 'The image has no readable dimensions.');
    }

    const box = pageBoxFor({
      pageSize: options.pageSize,
      orientation: options.orientation,
      margin: options.margin,
      aspect: displayWidth / displayHeight,
    });

    let dpi = Number(options.dpi);
    if (!Number.isFinite(dpi) || dpi <= 0) dpi = 150;
    dpi = Math.max(
      36,
      Math.min(
        dpi,
        (MAX_CANVAS_DIMENSION * 72) / Math.max(box.pageWidth, box.pageHeight),
        Math.sqrt((MAX_OUTPUT_PIXELS * 72 * 72) / (box.pageWidth * box.pageHeight)),
      ),
    );

    // Keep the page raster at the requested DPI unless it would exceed the
    // canvas limits; the image itself is fitted separately below.
    const pageWidth = Math.max(1, Math.round((box.pageWidth * dpi) / 72));
    const pageHeight = Math.max(1, Math.round((box.pageHeight * dpi) / 72));
    const canvas = new OffscreenCanvas(pageWidth, pageHeight);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new JobError('CANVAS_FAILED', 'This browser could not create a page canvas.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageWidth, pageHeight);

    const marginPixels = (box.margin * dpi) / 72;
    const contentWidth = Math.max(1, pageWidth - marginPixels * 2);
    const contentHeight = Math.max(1, pageHeight - marginPixels * 2);
    const scale =
      options.fit === 'fill'
        ? Math.max(contentWidth / displayWidth, contentHeight / displayHeight)
        : Math.min(contentWidth / displayWidth, contentHeight / displayHeight);

    let renderScale = scale;
    renderScale = Math.min(
      renderScale,
      (MAX_CANVAS_DIMENSION * 0.98) / Math.max(displayWidth, displayHeight),
      (Math.sqrt(MAX_OUTPUT_PIXELS / (displayWidth * displayHeight)) * 0.98),
    );
    renderScale = Math.max(renderScale, 0.001);

    onProgress?.({ label: 'Rendering page' });
    const rendered = renderCanvas({
      bitmap,
      orientation: decoded.orientation,
      rotation,
      scale: renderScale,
      background: null,
    });

    const drawWidth = displayWidth * scale;
    const drawHeight = displayHeight * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    if (options.fit === 'fill') {
      context.save();
      context.beginPath();
      context.rect(marginPixels, marginPixels, contentWidth, contentHeight);
      context.clip();
    }
    context.drawImage(rendered, x, y, drawWidth, drawHeight);
    if (options.fit === 'fill') context.restore();

    onProgress?.({ label: 'Encoding page' });
    const quality = clampQuality(options.quality ?? 0.82);
    const blob = await encodeCanvas(canvas, 'image/jpeg', quality);

    return {
      blob,
      pageWidth: box.pageWidth,
      pageHeight: box.pageHeight,
      width: pageWidth,
      height: pageHeight,
      dpi: Math.round(dpi),
    };
  } finally {
    bitmap.close();
  }
}

async function decodeBitmap(source, kind, orientationHint = 1) {
  if (typeof createImageBitmap !== 'function') {
    throw new JobError(
      'BROWSER_UNSUPPORTED',
      'This browser cannot decode images in the background. Use a current version of Chrome, Edge, Firefox or Safari.',
    );
  }

  let input = source;
  let orientation = orientationHint;
  if (kind === 'jpeg') {
    // Browsers apply EXIF rotation at decode time even when asked not to, so
    // reset the orientation tag first and rotate with the canvas transform.
    try {
      const bytes = new Uint8Array(await source.arrayBuffer());
      orientation = normalizeJpegOrientation(bytes);
      if (orientation > 1) {
        input = new Blob([bytes], { type: 'image/jpeg' });
      }
    } catch {
      orientation = 1;
    }
  }

  try {
    const bitmap = await createImageBitmap(input, {
      imageOrientation: 'none',
      premultiplyAlpha: 'default',
    });
    return { bitmap, orientation };
  } catch {
    const messages = {
      svg: 'The SVG could not be rendered. It may contain unsupported markup.',
      avif: 'This browser cannot decode AVIF. Try a current Chrome, Edge, Firefox or Safari.',
      ico: 'This browser cannot decode this ICO file. Try converting it to PNG first.',
      gif: 'This browser cannot decode this GIF. Try a current browser.',
      bmp: 'This browser cannot decode this BMP. Try converting it to PNG first.',
    };
    throw new JobError(
      kind === 'svg' ? 'SVG_DECODE_FAILED' : 'DECODE_FAILED',
      messages[kind] ||
        'The image could not be read. The file may be damaged or use a format this browser cannot decode.',
    );
  }
}

function orientedDimensions(width, height, orientation) {
  return orientation >= 5 && orientation <= 8 ? [height, width] : [width, height];
}

function orientationMatrix(orientation, width, height) {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, width, 0];
    case 7:
      return [0, -1, -1, 0, width, height];
    case 8:
      return [0, -1, 1, 0, 0, height];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

function renderCanvas({ bitmap, orientation, rotation, scale, background }) {
  const [orientedWidth, orientedHeight] = orientedDimensions(
    bitmap.width,
    bitmap.height,
    orientation,
  );
  const scaledWidth = Math.max(1, Math.round(orientedWidth * scale));
  const scaledHeight = Math.max(1, Math.round(orientedHeight * scale));
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? scaledHeight : scaledWidth;
  const height = swap ? scaledWidth : scaledHeight;

  if (
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_OUTPUT_PIXELS
  ) {
    throw new JobError(
      'OUTPUT_TOO_LARGE',
      'The requested output is too large for this browser. Choose a smaller resize.',
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new JobError('CANVAS_FAILED', 'This browser could not create an output canvas.');
  }

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const matrix = orientationMatrix(orientation, orientedWidth, orientedHeight);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.translate(width / 2, height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.translate(-scaledWidth / 2, -scaledHeight / 2);
  context.scale(scale, scale);
  context.transform(...matrix);
  context.drawImage(bitmap, 0, 0);

  return canvas;
}

function computeBaseScale(width, height, orientation, options) {
  if (options.type === 'image/x-icon') return 1;
  const [orientedWidth, orientedHeight] = orientedDimensions(width, height, orientation);

  if (options.resizeMode === 'percent') {
    const percent = Number(options.percent);
    if (!Number.isFinite(percent) || percent <= 0) {
      throw new JobError('INVALID_RESIZE', 'Enter a resize percentage above 0.');
    }
    return percent / 100;
  }

  if (options.resizeMode === 'max') {
    const maxWidth = positiveNumber(options.maxWidth);
    const maxHeight = positiveNumber(options.maxHeight);
    let scale = 1;
    if (maxWidth && orientedWidth > maxWidth) scale = Math.min(scale, maxWidth / orientedWidth);
    if (maxHeight && orientedHeight > maxHeight) {
      scale = Math.min(scale, maxHeight / orientedHeight);
    }
    return scale;
  }

  return 1;
}

function protectCanvasSize(bitmap, orientation, rotation, scale, hasTarget) {
  const [orientedWidth, orientedHeight] = orientedDimensions(
    bitmap.width,
    bitmap.height,
    orientation,
  );
  const swap = rotation === 90 || rotation === 270;
  const width = (swap ? orientedHeight : orientedWidth) * scale;
  const height = (swap ? orientedWidth : orientedHeight) * scale;

  if (width * height <= MAX_OUTPUT_PIXELS && Math.max(width, height) <= MAX_CANVAS_DIMENSION) {
    return scale;
  }

  if (!hasTarget) {
    throw new JobError(
      'OUTPUT_TOO_LARGE',
      'The requested output is too large for this browser. Choose a smaller resize.',
    );
  }

  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / (width * height));
  const dimensionScale = MAX_CANVAS_DIMENSION / Math.max(width, height);
  return scale * Math.min(0.98, pixelScale, dimensionScale);
}

function downscaleCanvas(canvas, factor) {
  const width = Math.max(1, Math.round(canvas.width * factor));
  const height = Math.max(1, Math.round(canvas.height * factor));
  if (width === canvas.width && height === canvas.height) return canvas;

  const next = new OffscreenCanvas(width, height);
  const context = next.getContext('2d');
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, width, height);
  return next;
}

async function encodeCanvas(canvas, type, quality, options = {}) {
  if (type === 'image/avif') return encodeAvif(canvas, quality);
  if (type === 'image/gif') return encodeGif(canvas);
  if (type === 'image/bmp') return encodeBmp(canvas);
  if (type === 'image/x-icon') return encodeIco(canvas, options.icoSizes);

  if (typeof canvas.convertToBlob !== 'function') {
    throw new JobError(
      'BROWSER_UNSUPPORTED',
      'This browser cannot encode images in the background. Use a current browser or update this one.',
    );
  }

  const encodeQuality = qualityFormat(type) ? quality : undefined;
  const encodeArgs =
    encodeQuality === undefined ? { type } : { type, quality: encodeQuality };
  let blob;
  try {
    blob = await canvas.convertToBlob(encodeArgs);
  } catch {
    throw new JobError('ENCODE_FAILED', 'The browser could not encode the output image.');
  }

  const actualType = blob?.type?.split(';')[0];
  if (!blob || blob.size === 0) {
    throw new JobError('ENCODE_FAILED', 'The browser produced an empty image.');
  }
  if (actualType !== type) {
    if (type === 'image/webp') {
      throw new JobError(
        'WEBP_UNSUPPORTED',
        'This browser cannot encode WebP. Choose JPG or PNG instead.',
      );
    }
    throw new JobError('ENCODE_FAILED', 'The browser could not create the requested format.');
  }
  return blob;
}

let avifEncoderPromise = null;

async function encodeAvif(canvas, quality) {
  try {
    if (!avifEncoderPromise) {
      avifEncoderPromise = import('@jsquash/avif').then((module) => module.encode);
    }
    const encode = await avifEncoderPromise;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const qualityPercent = Math.round(clampQuality(quality) * 100);
    const buffer = await encode(imageData, {
      quality: qualityPercent,
      speed: 8,
      lossless: qualityPercent >= 100,
    });
    return new Blob([buffer], { type: 'image/avif' });
  } catch {
    throw new JobError(
      'AVIF_ENCODE_FAILED',
      'AVIF encoding is not available in this browser. Choose JPG, PNG or WebP instead.',
    );
  }
}

let gifEncoderPromise = null;

async function encodeGif(canvas) {
  try {
    if (!gifEncoderPromise) {
      gifEncoderPromise = import('gifenc');
    }
    const { GIFEncoder, quantize, applyPalette } = await gifEncoderPromise;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hasAlpha = false;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) {
        hasAlpha = true;
        break;
      }
    }

    const format = hasAlpha ? 'rgba4444' : 'rgb565';
    const palette = quantize(
      data,
      256,
      hasAlpha ? { format, oneBitAlpha: true, clearAlpha: true } : { format },
    );
    const index = applyPalette(data, palette, format);
    let transparentIndex = -1;
    if (hasAlpha) {
      transparentIndex = palette.findIndex((color) => (color[3] ?? 255) === 0);
    }

    const gif = GIFEncoder();
    gif.writeFrame(index, width, height, {
      palette,
      delay: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    });
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  } catch {
    throw new JobError('GIF_ENCODE_FAILED', 'The GIF could not be encoded.');
  }
}

function encodeBmp(canvas) {
  const context = canvas.getContext('2d');
  if (!context) throw new JobError('ENCODE_FAILED', 'Canvas unavailable.');
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  for (let y = 0; y < height; y += 1) {
    const sourceRow = height - 1 - y;
    let offset = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow * width + x) * 4;
      bytes[offset] = data[source + 2];
      bytes[offset + 1] = data[source + 1];
      bytes[offset + 2] = data[source];
      offset += 3;
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

async function encodeIco(canvas, requestedSizes) {
  const sizes = [...new Set(requestedSizes ?? [])]
    .map(Number)
    .filter((size) => [16, 32, 48, 64, 128, 256].includes(size))
    .sort((a, b) => a - b);
  if (sizes.length === 0) {
    throw new JobError('ICO_SIZES', 'Choose at least one ICO size.');
  }

  const pngs = [];
  for (const size of sizes) {
    const square = new OffscreenCanvas(size, size);
    const context = square.getContext('2d');
    if (!context) throw new JobError('ENCODE_FAILED', 'Canvas unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = Math.min(size / canvas.width, size / canvas.height);
    const drawWidth = Math.max(1, Math.round(canvas.width * scale));
    const drawHeight = Math.max(1, Math.round(canvas.height * scale));
    context.drawImage(
      canvas,
      Math.round((size - drawWidth) / 2),
      Math.round((size - drawHeight) / 2),
      drawWidth,
      drawHeight,
    );
    const blob = await square.convertToBlob({ type: 'image/png' });
    pngs.push(new Uint8Array(await blob.arrayBuffer()));
    square.width = 0;
    square.height = 0;
  }

  const headerSize = 6 + sizes.length * 16;
  const total = headerSize + pngs.reduce((sum, png) => sum + png.length, 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, sizes.length, true);

  let offset = headerSize;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    bytes[entry] = size >= 256 ? 0 : size;
    bytes[entry + 1] = size >= 256 ? 0 : size;
    bytes[entry + 2] = 0;
    bytes[entry + 3] = 0;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, pngs[index].length, true);
    view.setUint32(entry + 12, offset, true);
    offset += pngs[index].length;
  });

  offset = headerSize;
  for (const png of pngs) {
    bytes.set(png, offset);
    offset += png.length;
  }

  return new Blob([buffer], { type: 'image/x-icon' });
}

function qualityFormat(type) {
  return type === 'image/jpeg' || type === 'image/webp' || type === 'image/avif';
}

function normalizeRotation(value) {
  const rotation = Number(value);
  if (rotation === 90 || rotation === 180 || rotation === 270) return rotation;
  return 0;
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? value : '#ffffff';
}

function clampQuality(value) {
  const quality = Number(value);
  if (!Number.isFinite(quality)) return 0.85;
  return Math.min(1, Math.max(0.05, quality));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
