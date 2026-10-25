export const COMPRESS_PRESETS = Object.freeze([
  {
    value: 'light',
    label: 'Light',
    dpi: 150,
    quality: 0.8,
    hint: 'Keeps more detail. Best for scans with fine print.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    dpi: 120,
    quality: 0.7,
    hint: 'A good default for notes, forms and scanned pages.',
  },
  {
    value: 'strong',
    label: 'Strong',
    dpi: 90,
    quality: 0.55,
    hint: 'Smallest files. Fine print can become soft.',
  },
]);

export const DEFAULT_COMPRESS_SETTINGS = Object.freeze({
  strategy: 'keep',
  preset: 'balanced',
  grayscale: false,
  targetEnabled: false,
  targetValue: '2',
  targetUnit: 'MB',
});

export function presetFor(value) {
  return COMPRESS_PRESETS.find((preset) => preset.value === value) ?? COMPRESS_PRESETS[1];
}

export function targetBytesForCompress(settings) {
  if (!settings.targetEnabled) return null;
  const value = Number(settings.targetValue);
  const multiplier = settings.targetUnit === 'MB' ? 1024 * 1024 : 1024;
  const bytes = Math.round(value * multiplier);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

export function validateCompressSettings(settings) {
  if (settings.strategy !== 'keep' && settings.strategy !== 'raster') {
    return 'Choose a compression method.';
  }
  if (!COMPRESS_PRESETS.some((preset) => preset.value === settings.preset)) {
    return 'Choose a compression strength.';
  }
  if (settings.targetEnabled) {
    const value = Number(settings.targetValue);
    const multiplier = settings.targetUnit === 'MB' ? 1024 * 1024 : 1024;
    const bytes = value * multiplier;
    if (!Number.isFinite(value) || value <= 0 || bytes < 1024 || bytes > 40 * 1024 * 1024) {
      return 'Enter a target size between 1 KB and 40 MB.';
    }
  }
  return null;
}

export function attemptsFor(settings) {
  const chosen = presetFor(settings.preset);
  if (!settings.targetEnabled) return [chosen];

  const start = COMPRESS_PRESETS.findIndex((preset) => preset.value === chosen.value);
  const attempts = COMPRESS_PRESETS.slice(Math.max(0, start));
  const last = attempts[attempts.length - 1];
  if (!last || last.dpi > 72 || last.quality > 0.4) {
    attempts.push({ value: 'smallest', label: 'Smallest', dpi: 72, quality: 0.4 });
  }
  return attempts;
}
