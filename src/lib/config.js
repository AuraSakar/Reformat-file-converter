export const LIMITS = Object.freeze({
  maxFiles: 50,
  maxFileBytes: 40 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
});

export const IMAGE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.heic,.heif,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/svg+xml,image/heic,image/heif';

export const PDF_ACCEPT = '.pdf,application/pdf';

export const IMAGE_FORMAT_LABELS = Object.freeze({
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  svg: 'SVG',
  heic: 'HEIC',
  pdf: 'PDF',
});

export const INPUT_FORMATS = 'JPG, PNG, WebP, GIF, BMP, SVG or HEIC';
export const PDF_FORMATS = 'PDF';

export const OUTPUT_FORMATS = Object.freeze([
  { value: 'image/jpeg', label: 'JPG', extension: 'jpg' },
  { value: 'image/png', label: 'PNG', extension: 'png' },
  { value: 'image/webp', label: 'WebP', extension: 'webp' },
]);

export const PDF_DPI_OPTIONS = Object.freeze([72, 150, 300]);
export const PDF_TO_IMAGES_DPI_OPTIONS = Object.freeze([72, 150, 300]);
export const COMPRESS_DPI_OPTIONS = Object.freeze([110, 150, 200]);
