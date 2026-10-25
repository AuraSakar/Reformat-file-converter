import { formatBytes } from './format';

export class TargetSizeError extends Error {
  constructor(bestBytes, targetBytes) {
    super(
      `The smallest result was ${formatBytes(bestBytes)}, still above the ${formatBytes(targetBytes)} target. Reduce the dimensions or choose a different format.`,
    );
    this.name = 'TargetSizeError';
    this.code = 'TARGET_SIZE_UNREACHABLE';
    this.bestBytes = bestBytes;
    this.targetBytes = targetBytes;
  }
}

/**
 * Finds the highest quality that fits the target. Encoding starts at the
 * current canvas size: quality is binary-searched, then the canvas is reduced
 * if even the minimum quality is too large. The canvas is reused for each
 * quality attempt so only downscaling allocates a new bitmap.
 */
export async function fitCanvasUnderTarget({
  canvas,
  type,
  targetBytes,
  encode,
  downscale,
  onProgress,
}) {
  let current = canvas;
  let best = null;
  let attempt = 0;

  while (current && attempt < 12) {
    attempt += 1;
    const supportsQuality = type !== 'image/png';
    onProgress?.({ label: 'Fitting target size', attempt });

    if (!supportsQuality) {
      const blob = await encode(current, undefined);
      best = chooseSmaller(best, blob, current);
      if (blob.size <= targetBytes) {
        return { blob, quality: null, width: current.width, height: current.height };
      }
    } else {
      const high = await encode(current, 0.95);
      best = chooseSmaller(best, high, current);
      if (high.size <= targetBytes) {
        return { blob: high, quality: 0.95, width: current.width, height: current.height };
      }

      const low = await encode(current, 0.05);
      best = chooseSmaller(best, low, current);
      if (low.size <= targetBytes) {
        let lo = 0.05;
        let hi = 0.95;
        let bestFit = { blob: low, quality: 0.05 };

        for (let index = 0; index < 8; index += 1) {
          const quality = (lo + hi) / 2;
          const blob = await encode(current, quality);
          if (blob.size <= targetBytes) {
            lo = quality;
            bestFit = { blob, quality };
          } else {
            hi = quality;
          }
        }

        return {
          blob: bestFit.blob,
          quality: bestFit.quality,
          width: current.width,
          height: current.height,
        };
      }
    }

    if (Math.min(current.width, current.height) <= 16) break;

    // File size roughly follows pixel count, so sqrt of the size ratio is a
    // good first guess at the scale needed for the next attempt.
    const ratio = Math.sqrt(targetBytes / Math.max(best?.blob?.size ?? 1, 1)) * 0.94;
    const factor = Math.min(0.9, Math.max(0.25, ratio));
    const next = downscale(current, factor);
    if (!next || next === current) break;
    current = next;
  }

  throw new TargetSizeError(best?.blob?.size ?? 0, targetBytes);
}

function chooseSmaller(current, blob, canvas) {
  if (!current || blob.size < current.blob.size) {
    return { blob, width: canvas.width, height: canvas.height };
  }
  return current;
}
