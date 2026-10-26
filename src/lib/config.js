export const LIMITS = Object.freeze({
  maxFiles: 50,
  maxFileBytes: 40 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
});

export const IMAGE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.svg,.ico,.heic,.heif,.tif,.tiff,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/heic,image/heif,image/tiff';

export const PDF_ACCEPT = '.pdf,application/pdf';

export const AUDIO_LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 200 * 1024 * 1024,
  maxTotalBytes: 600 * 1024 * 1024,
});

export const AUDIO_LIMITS_SMALL = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 80 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
});

export const AUDIO_ACCEPT =
  '.mp3,.wav,.flac,.aac,.m4a,.ogg,.oga,.opus,.wma,.aiff,.aif,.amr,.3gp,.mp4,.m4v,.mkv,.webm,.mov,audio/*,video/mp4,video/quicktime,video/webm,video/x-matroska';

export const AUDIO_INPUT_FORMATS =
  'MP3, WAV, FLAC, AAC, M4A, OGG, Opus, WMA, AIFF, AMR, 3GP, or audio from MP4, MKV, WebM and MOV';

export const IMAGE_FORMAT_LABELS = Object.freeze({
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  gif: 'GIF',
  bmp: 'BMP',
  svg: 'SVG',
  ico: 'ICO',
  heic: 'HEIC',
  tiff: 'TIFF',
  pdf: 'PDF',
});

export const INPUT_FORMATS = 'JPG, PNG, WebP, AVIF, GIF, BMP, SVG, ICO, HEIC or TIFF';
export const PDF_FORMATS = 'PDF';

export const OUTPUT_FORMATS = Object.freeze([
  { value: 'image/jpeg', label: 'JPG', extension: 'jpg' },
  { value: 'image/png', label: 'PNG', extension: 'png' },
  { value: 'image/webp', label: 'WebP', extension: 'webp' },
  { value: 'image/avif', label: 'AVIF', extension: 'avif' },
  { value: 'image/gif', label: 'GIF', extension: 'gif' },
  { value: 'image/bmp', label: 'BMP', extension: 'bmp' },
  { value: 'image/x-icon', label: 'ICO', extension: 'ico' },
]);

export const PDF_DPI_OPTIONS = Object.freeze([72, 150, 200, 300]);
export const PDF_TO_IMAGES_DPI_OPTIONS = Object.freeze([72, 150, 200, 300]);
export const ICO_SIZES = Object.freeze([16, 32, 48, 64, 128, 256]);
export const TEXT_EXTENSIONS = Object.freeze([
  'txt', 'md', 'csv', 'c', 'cpp', 'h', 'java', 'py', 'js', 'json', 'm', 'v', 'vhd', 'asm',
]);
export const TEXT_ACCEPT = '.txt,.md,.csv,.c,.cpp,.h,.java,.py,.js,.json,.m,.v,.vhd,.asm,text/plain,text/markdown,text/csv,application/json';
export const COMPRESS_DPI_OPTIONS = Object.freeze([110, 150, 200]);
export const TEXT_MAX_CHARS = 5_000_000;
