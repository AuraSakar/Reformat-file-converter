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
    const background =
      options.type === 'image/jpeg' ? normalizeColor(options.background) : null;
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
      const blob = await encodeCanvas(
        canvas,
        options.type,
        options.type === 'image/png' ? undefined : clampQuality(options.quality),
      );
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        quality: options.type === 'image/png' ? null : clampQuality(options.quality),
      };
    }

    const fitted = await fitCanvasUnderTarget({
      canvas,
      type: options.type,
      targetBytes,
      encode: (target, quality) => encodeCanvas(target, options.type, quality),
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
    throw new JobError(
      kind === 'svg' ? 'SVG_DECODE_FAILED' : 'DECODE_FAILED',
      kind === 'svg'
        ? 'The SVG could not be rendered. It may contain unsupported markup.'
        : 'The image could not be read. The file may be damaged or use a format this browser cannot decode.',
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

async function encodeCanvas(canvas, type, quality) {
  if (typeof canvas.convertToBlob !== 'function') {
    throw new JobError(
      'BROWSER_UNSUPPORTED',
      'This browser cannot encode images in the background. Use a current browser or update this one.',
    );
  }

  const options = quality === undefined ? { type } : { type, quality };
  let blob;
  try {
    blob = await canvas.convertToBlob(options);
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
