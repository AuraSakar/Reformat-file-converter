import { OUTPUT_FORMATS } from './config';

export const DEFAULT_IMAGE_SETTINGS = Object.freeze({
  format: 'image/jpeg',
  quality: 0.85,
  targetEnabled: false,
  targetValue: '200',
  targetUnit: 'KB',
  resizeMode: 'none',
  maxWidth: '',
  maxHeight: '',
  percent: '100',
  rotation: 0,
  background: '#ffffff',
});

export function validateImageSettings(settings) {
  if (settings.targetEnabled) {
    const value = Number(settings.targetValue);
    const multiplier = settings.targetUnit === 'MB' ? 1024 * 1024 : 1024;
    const bytes = value * multiplier;
    if (!Number.isFinite(value) || value <= 0 || bytes < 1024 || bytes > 40 * 1024 * 1024) {
      return 'Enter a target size between 1 KB and 40 MB.';
    }
  }

  if (settings.resizeMode === 'max') {
    const hasWidth = String(settings.maxWidth).trim() !== '';
    const hasHeight = String(settings.maxHeight).trim() !== '';
    if (!hasWidth && !hasHeight) {
      return 'Enter a maximum width, a maximum height, or both.';
    }
    for (const value of [settings.maxWidth, settings.maxHeight]) {
      if (String(value).trim() === '') continue;
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        return 'Maximum width and height must be numbers above 0.';
      }
    }
  }

  if (settings.resizeMode === 'percent') {
    const percent = Number(settings.percent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 200) {
      return 'Enter a resize percentage from 1 to 200.';
    }
  }

  return null;
}

export function targetBytesFor(settings) {
  if (!settings.targetEnabled) return null;
  const value = Number(settings.targetValue);
  const multiplier = settings.targetUnit === 'MB' ? 1024 * 1024 : 1024;
  const bytes = Math.round(value * multiplier);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

export function outputFormatFor(settings) {
  return (
    OUTPUT_FORMATS.find((format) => format.value === settings.format) ?? OUTPUT_FORMATS[0]
  );
}

export function workerOptionsFor(settings) {
  return {
    type: settings.format,
    quality: Number(settings.quality),
    resizeMode: settings.resizeMode,
    maxWidth: String(settings.maxWidth).trim(),
    maxHeight: String(settings.maxHeight).trim(),
    percent: String(settings.percent).trim(),
    rotation: Number(settings.rotation),
    background: settings.background,
    targetBytes: targetBytesFor(settings),
  };
}
