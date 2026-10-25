import { convertHeicToJpeg } from './heic';
import { rasterizeSvg } from './svg';
import { convertTiffToPng } from './tiff';

export async function prepareImageSource(file, kind) {
  if (kind === 'heic') {
    try {
      const blob = await convertHeicToJpeg(file);
      return { blob, kind: 'jpeg', orientation: 1 };
    } catch {
      const error = new Error(
        'The HEIC file could not be decoded. It may be damaged or use a format this browser cannot read.',
      );
      error.code = 'HEIC_DECODE_FAILED';
      throw error;
    }
  }

  if (kind === 'svg') {
    try {
      const rasterized = await rasterizeSvg(file);
      return { blob: rasterized.blob, kind: 'png', orientation: 1 };
    } catch (error) {
      const failure = new Error(error?.message || 'The SVG could not be rendered.');
      failure.code = 'SVG_DECODE_FAILED';
      throw failure;
    }
  }

  if (kind === 'tiff') {
    try {
      const blob = await convertTiffToPng(file);
      return { blob, kind: 'png', orientation: 1 };
    } catch (error) {
      const failure = new Error(error?.message || 'The TIFF could not be read.');
      failure.code = 'TIFF_DECODE_FAILED';
      throw failure;
    }
  }

  return { blob: file, kind, orientation: 1 };
}
