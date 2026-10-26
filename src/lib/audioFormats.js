import { AUDIO_LIMITS, AUDIO_LIMITS_SMALL } from './config';

const MEGABYTE = 1024 * 1024;

export const AUDIO_OUTPUT_FORMATS = Object.freeze([
  {
    id: 'wav',
    label: 'WAV',
    extension: 'wav',
    mime: 'audio/wav',
    encoder: 'pcm_s16le',
    lossless: true,
    supportsCover: false,
    sampleRates: ['44100', '48000', '96000'],
    bitDepths: [16, 24],
  },
  {
    id: 'flac',
    label: 'FLAC',
    extension: 'flac',
    mime: 'audio/flac',
    encoder: 'flac',
    lossless: true,
    supportsCover: true,
    sampleRates: ['44100', '48000', '96000'],
    bitDepths: [16, 24],
  },
  {
    id: 'alac',
    label: 'M4A ALAC',
    extension: 'm4a',
    mime: 'audio/mp4',
    encoder: 'alac',
    lossless: true,
    supportsCover: true,
    sampleRates: ['44100', '48000', '96000'],
    bitDepths: [],
  },
  {
    id: 'mp3',
    label: 'MP3',
    extension: 'mp3',
    mime: 'audio/mpeg',
    encoder: 'libmp3lame',
    lossless: false,
    supportsCover: true,
    sampleRates: [],
    bitDepths: [],
  },
  {
    id: 'aac',
    label: 'M4A AAC',
    extension: 'm4a',
    mime: 'audio/mp4',
    encoder: 'aac',
    lossless: false,
    supportsCover: true,
    sampleRates: [],
    bitDepths: [],
  },
  {
    id: 'vorbis',
    label: 'OGG Vorbis',
    extension: 'ogg',
    mime: 'audio/ogg',
    encoder: 'libvorbis',
    lossless: false,
    supportsCover: false,
    sampleRates: [],
    bitDepths: [],
  },
]);

export const AUDIO_FORMATS_BY_ID = Object.freeze(
  Object.fromEntries(AUDIO_OUTPUT_FORMATS.map((format) => [format.id, format])),
);

export const AUDIO_PRESETS = Object.freeze([
  {
    id: 'lossless',
    label: 'Lossless',
    description: 'Keeps the decoded audio unchanged.',
  },
  {
    id: 'highest',
    label: 'Highest quality',
    description: 'Largest files, least additional loss.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Good quality with smaller files.',
  },
  {
    id: 'small',
    label: 'Small',
    description: 'Smallest files for sharing.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Set the bitrate or quality yourself.',
  },
]);

export const AUDIO_PRESET_VALUES = Object.freeze({
  highest: { mp3: '0', aac: '256k', vorbis: '8' },
  balanced: { mp3: '192k', aac: '160k', vorbis: '5' },
  small: { mp3: '128k', aac: '96k', vorbis: '3' },
});

export const AUDIO_CUSTOM_RANGES = Object.freeze({
  mp3: { label: 'Bitrate', unit: 'kbps', min: 96, max: 320, step: 1, default: 192 },
  aac: { label: 'Bitrate', unit: 'kbps', min: 96, max: 320, step: 1, default: 192 },
  vorbis: { label: 'Quality', unit: '', min: 0, max: 10, step: 1, default: 6 },
});

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  format: 'mp3',
  preset: 'highest',
  customValue: 192,
  sampleRate: 'keep',
  channels: 'keep',
  bitDepth: 'auto',
  keepTags: true,
});

const SOURCE_EXTENSIONS = {
  mp3: { label: 'MP3', video: false, lossless: false },
  wav: { label: 'WAV', video: false, lossless: true },
  flac: { label: 'FLAC', video: false, lossless: true },
  aac: { label: 'AAC', video: false, lossless: false },
  m4a: { label: 'M4A', video: false, lossless: false },
  ogg: { label: 'OGG', video: false, lossless: false },
  oga: { label: 'OGG', video: false, lossless: false },
  opus: { label: 'Opus', video: false, lossless: false },
  wma: { label: 'WMA', video: false, lossless: false },
  aiff: { label: 'AIFF', video: false, lossless: true },
  aif: { label: 'AIFF', video: false, lossless: true },
  amr: { label: 'AMR', video: false, lossless: false },
  '3gp': { label: '3GP', video: true, lossless: false },
  mp4: { label: 'MP4', video: true, lossless: false },
  m4v: { label: 'M4V', video: true, lossless: false },
  mkv: { label: 'MKV', video: true, lossless: false },
  webm: { label: 'WebM', video: true, lossless: false },
  mov: { label: 'MOV', video: true, lossless: false },
};

const BROWSER_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  '3gp': 'video/3gpp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const LOSSLESS_CODECS = new Set([
  'alac',
  'flac',
  'wavpack',
  'ape',
  'tta',
  'shorten',
  'truehd',
  'mlp',
  'wmalossless',
]);

function ascii(bytes, start, end) {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function extensionOf(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function sourceResult(extension, details = {}) {
  const known = SOURCE_EXTENSIONS[extension];
  if (!known && !details.label) return null;
  return {
    supported: true,
    kind: extension || 'audio',
    extension: extension || 'bin',
    label: details.label || known?.label || extension.toUpperCase(),
    isVideo: details.video ?? known?.video ?? false,
    lossless: details.lossless ?? known?.lossless ?? false,
  };
}

function unsupportedResult(name, message) {
  return {
    supported: false,
    kind: 'unsupported',
    extension: extensionOf(name),
    label: 'Unknown',
    message: message || `${name} is not a supported audio file.`,
  };
}

function ftypResult(bytes, extension) {
  const brands = new Set();
  for (let offset = 8; offset + 4 <= bytes.length && offset < 256; offset += 4) {
    const brand = ascii(bytes, offset, offset + 4).trim();
    if (brand) brands.add(brand);
  }

  if (['M4A', 'M4B', 'F4A', 'M4P'].some((brand) => brands.has(brand)) || extension === 'm4a') {
    return sourceResult('m4a');
  }
  if (['3gp4', '3gp5', '3gp6', '3gp7', '3ge6', '3ge7', '3gg6'].some((brand) => brands.has(brand)) || extension === '3gp') {
    return sourceResult('3gp');
  }
  if (extension === 'mov' || brands.has('qt')) return sourceResult('mov');
  if (extension === 'm4v' || brands.has('M4V')) return sourceResult('m4v');
  if (extension === 'mp4' || ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash'].some((brand) => brands.has(brand))) {
    return sourceResult('mp4');
  }
  return sourceResult(extension === 'm4a' ? 'm4a' : 'mp4');
}

export async function sniffAudioFile(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  } catch {
    return unsupportedResult(file.name, `${file.name} could not be read. Try downloading it again.`);
  }

  const extension = extensionOf(file.name);
  const head = ascii(bytes, 0, Math.min(bytes.length, 64 * 1024));

  if (bytes.length >= 4 && ascii(bytes, 0, 3) === 'ID3') {
    return sourceResult('mp3');
  }
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xf6) === 0xf0
  ) {
    return sourceResult('aac');
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x06) !== 0
  ) {
    return sourceResult('mp3');
  }
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) {
    return sourceResult('flac');
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') {
    return sourceResult('wav');
  }
  if (ascii(bytes, 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(bytes, 8, 12))) {
    return sourceResult(extension === 'aif' ? 'aif' : 'aiff');
  }
  if (ascii(bytes, 0, 4) === 'OggS') {
    if (head.includes('OpusHead') || extension === 'opus') return sourceResult('opus');
    return sourceResult(extension === 'oga' ? 'oga' : 'ogg');
  }
  if (
    startsWith(bytes, [
      0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
    ])
  ) {
    return sourceResult('wma');
  }
  if (head.startsWith('#!AMR')) {
    return sourceResult('amr');
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    if (extension === 'webm') return sourceResult('webm');
    if (extension === 'mkv') return sourceResult('mkv');
    return sourceResult('mkv', { label: 'Matroska / WebM', video: true });
  }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    return ftypResult(bytes, extension);
  }

  const fallback = SOURCE_EXTENSIONS[extension];
  if (fallback) return sourceResult(extension);

  return unsupportedResult(
    file.name,
    `${file.name} is not a supported audio or video file. Choose MP3, WAV, FLAC, AAC, M4A, OGG, Opus, WMA, AIFF, AMR, 3GP, MP4, MKV, WebM or MOV.`,
  );
}

export function audioMimeFor(extension, fallback = '') {
  return BROWSER_MIME[String(extension).toLowerCase()] || fallback || 'application/octet-stream';
}

export function canPreviewAudio(extension, fallbackMime = '') {
  if (typeof document === 'undefined') return false;
  const audio = document.createElement('audio');
  const mime = audioMimeFor(extension, fallbackMime);
  return audio.canPlayType(mime) !== '';
}

export function readMediaDuration(file, isVideo = false) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const media = document.createElement(isVideo ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    const timer = window.setTimeout(() => finish(null), 6000);
    media.preload = 'metadata';
    media.addEventListener('loadedmetadata', () => finish(media.duration), { once: true });
    media.addEventListener('error', () => finish(null), { once: true });
    media.src = url;
  });
}

export function audioLimitsForDevice() {
  if (typeof navigator === 'undefined') return AUDIO_LIMITS;
  const lowMemory =
    typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
  const touch =
    navigator.maxTouchPoints > 0 ||
    (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  return lowMemory || touch ? AUDIO_LIMITS_SMALL : AUDIO_LIMITS;
}

export function checkAudioBatchLimits(incomingFiles, existingItems, limits) {
  const accepted = [];
  const rejected = [];
  let fileCount = existingItems.length;
  let totalBytes = existingItems.reduce((sum, item) => sum + item.size, 0);
  const fileLimit = Math.round(limits.maxFileBytes / MEGABYTE);
  const totalLimit = Math.round(limits.maxTotalBytes / MEGABYTE);

  for (const file of incomingFiles) {
    if (file.size > limits.maxFileBytes) {
      rejected.push({
        file,
        reason: `${file.name} is larger than the ${fileLimit} MB per-file limit. Choose a smaller file.`,
      });
      continue;
    }
    if (fileCount >= limits.maxFiles) {
      rejected.push({
        file,
        reason: `The batch is limited to ${limits.maxFiles} files. ${file.name} was not added. Remove a file before adding more.`,
      });
      continue;
    }
    if (totalBytes + file.size > limits.maxTotalBytes) {
      rejected.push({
        file,
        reason: `Adding ${file.name} would exceed the ${totalLimit} MB batch limit. Remove a file before adding more.`,
      });
      continue;
    }
    accepted.push(file);
    fileCount += 1;
    totalBytes += file.size;
  }

  return { accepted, rejected };
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatSampleRate(rate) {
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) return '—';
  const value = Number(rate);
  if (value % 1000 === 0) return `${value / 1000} kHz`;
  return `${(value / 1000).toFixed(1)} kHz`;
}

export function audioFormatFor(id) {
  return AUDIO_FORMATS_BY_ID[id] ?? AUDIO_OUTPUT_FORMATS[0];
}

export function availableAudioFormats(encoderText) {
  return AUDIO_OUTPUT_FORMATS.filter((format) => {
    const pattern = new RegExp(`\\s${format.encoder}\\s`);
    return pattern.test(encoderText);
  });
}

export function customRangeFor(formatId) {
  return AUDIO_CUSTOM_RANGES[formatId] ?? null;
}

export function audioFormatChangePatch(settings, output) {
  const patch = { format: output.id };
  if (output.lossless) {
    patch.preset = 'lossless';
  } else if (settings.preset === 'lossless') {
    patch.preset = 'highest';
  } else if (settings.preset === 'custom') {
    patch.customValue = customRangeFor(output.id)?.default ?? 192;
  }
  if (
    settings.sampleRate !== 'keep' &&
    !output.sampleRates.includes(String(settings.sampleRate))
  ) {
    patch.sampleRate = 'keep';
  }
  if (output.lossless && settings.bitDepth !== 'auto' && !output.bitDepths.includes(Number(settings.bitDepth))) {
    patch.bitDepth = 'auto';
  }
  return patch;
}

export function normalizeAudioSettings(settings, formats) {
  if (!formats?.length) return settings;
  const output = formats.find((format) => format.id === settings.format) ?? formats[0];
  const patch = output.id === settings.format ? {} : audioFormatChangePatch(settings, output);
  if (output.lossless && settings.preset !== 'lossless') {
    patch.preset = 'lossless';
  } else if (!output.lossless && settings.preset === 'lossless') {
    patch.preset = 'highest';
  }
  if (output.lossless && settings.bitDepth !== 'auto' && !output.bitDepths.includes(Number(settings.bitDepth))) {
    patch.bitDepth = 'auto';
  }
  if (!output.lossless && settings.bitDepth !== 'auto') {
    patch.bitDepth = 'auto';
  }
  const range = output.lossless ? null : customRangeFor(output.id);
  if (range && settings.preset === 'custom') {
    const value = Number(settings.customValue);
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      patch.customValue = range.default;
    }
  }
  return Object.keys(patch).length ? { ...settings, ...patch } : settings;
}

export function sampleRateOptionsFor(format) {
  if (!format) return [];
  return [
    { value: 'keep', label: 'Keep original' },
    ...format.sampleRates.map((rate) => ({
      value: rate,
      label: `${Number(rate) / 1000} kHz`,
    })),
  ];
}

export function validateAudioSettings(settings, formats = AUDIO_OUTPUT_FORMATS) {
  const output = formats.find((format) => format.id === settings.format);
  if (!output) return 'Choose an output format that is available in this browser.';
  if (!output.lossless && settings.preset === 'custom') {
    const range = customRangeFor(output.id);
    const value = Number(settings.customValue);
    if (!range || !Number.isFinite(value) || value < range.min || value > range.max) {
      return `Enter ${range?.label.toLowerCase() || 'a custom value'} from ${range?.min ?? 0} to ${range?.max ?? 0}.`;
    }
  }
  if (
    settings.sampleRate !== 'keep' &&
    !output.sampleRates.includes(String(settings.sampleRate))
  ) {
    return 'Choose a sample rate this output format supports.';
  }
  if (
    output.lossless &&
    settings.bitDepth !== 'auto' &&
    !output.bitDepths.includes(Number(settings.bitDepth))
  ) {
    return 'Choose a bit depth this output format supports.';
  }
  return null;
}

export function qualityValueLabel(settings, output) {
  if (!output || output.lossless) return 'Lossless';
  if (settings.preset !== 'custom') {
    const label = AUDIO_PRESETS.find((preset) => preset.id === settings.preset)?.label ?? 'Custom';
    return label;
  }
  const range = customRangeFor(output.id);
  if (!range) return 'Custom';
  return range.unit ? `${settings.customValue} ${range.unit}` : `Quality ${settings.customValue}`;
}

export function audioQualityNote(settings, output, sourceLossless, sameFormat = false) {
  if (!output) return '';
  const changeNote =
    settings.sampleRate !== 'keep' || settings.channels !== 'keep'
      ? ' Changing the sample rate or channels alters the audio data.'
      : '';
  if (sameFormat) {
    const base = output.lossless
      ? `The file is already in this format. Re-encoding is lossless, but the file will not get smaller.`
      : 'The file is already in this format. Converting re-encodes it and may reduce quality.';
    return `${base}${changeNote}`;
  }
  if (output.lossless) {
    const base = `${output.label} is lossless audio, so this step does not remove more detail.`;
    const sourceNote =
      sourceLossless === false
        ? ' The selected source is already compressed, so detail already lost cannot be restored. The file will be larger.'
        : sourceLossless === true
          ? ' The file will usually be larger than a compressed source.'
          : '';
    return `${base}${sourceNote}${changeNote}`;
  }
  const sourceNote =
    sourceLossless === false
      ? ' Converting from one compressed format to another adds another generation of loss.'
      : sourceLossless === true
        ? ' Some detail is removed to make the file smaller.'
        : '';
  if (output.id === 'mp3') {
    return `MP3 uses a lossy encoder. Highest uses VBR V0, about 245 kbps.${sourceNote}${changeNote}`;
  }
  if (output.id === 'aac') {
    return `M4A AAC is widely supported. Highest uses 256 kbps.${sourceNote}${changeNote}`;
  }
  if (output.id === 'vorbis') {
    return `OGG Vorbis is efficient and open, but some older players cannot open it. Highest uses quality 8.${sourceNote}${changeNote}`;
  }
  return changeNote.trim();
}

export function isLosslessCodec(codecName) {
  const codec = String(codecName ?? '').toLowerCase();
  return codec.startsWith('pcm_') || LOSSLESS_CODECS.has(codec);
}

function resolveBitDepth(settings, output, sourceInfo) {
  if (!output?.lossless) return null;
  if (settings.bitDepth !== 'auto') return Number(settings.bitDepth) >= 24 ? 24 : 16;
  if (sourceInfo?.lossless !== true) return 16;
  const sourceBits = Number(sourceInfo?.bitDepth);
  if (Number.isFinite(sourceBits) && sourceBits >= 24) return 24;
  return 16;
}

function planChannels(settings, output, sourceInfo) {
  if (settings.channels === 'mono') return { channels: 1, adjustment: null };
  if (settings.channels === 'stereo') return { channels: 2, adjustment: null };
  const sourceChannels = Number(sourceInfo?.channels);
  if (sourceChannels > 2 && output.id === 'mp3') {
    return {
      channels: 2,
      adjustment: `${sourceInfo.channels} channels were mixed to stereo because ${output.label} does not encode surround audio in this converter.`,
    };
  }
  return { channels: null, adjustment: null };
}

function codecQualityArgs(settings, output) {
  if (output.lossless) {
    if (output.id === 'wav') {
      return ['-c:a', settings.bitDepth === 'auto' ? 'pcm_s16le' : settings.bitDepth >= 24 ? 'pcm_s24le' : 'pcm_s16le'];
    }
    return ['-c:a', output.encoder];
  }
  const range = customRangeFor(output.id);
  if (settings.preset === 'custom') {
    if (output.id === 'vorbis') {
      return ['-c:a', output.encoder, '-q:a', String(settings.customValue)];
    }
    return ['-c:a', output.encoder, '-b:a', `${settings.customValue}k`];
  }
  const value = AUDIO_PRESET_VALUES[settings.preset]?.[output.id];
  if (output.id === 'vorbis') return ['-c:a', output.encoder, '-q:a', value ?? '5'];
  if (output.id === 'mp3' && value === '0') return ['-c:a', output.encoder, '-q:a', '0'];
  return ['-c:a', output.encoder, '-b:a', value ?? `${range?.default ?? 192}k`];
}

export function buildAudioArgs({
  settings,
  output,
  sourceInfo,
  inputName,
  outputName,
  includeCover = false,
}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-i', inputName, '-map', '0:a:0'];
  const adjustments = [];

  args.push('-map_metadata', settings.keepTags ? '0' : '-1', '-map_chapters', '-1');

  if (
    includeCover &&
    settings.keepTags &&
    output.supportsCover &&
    sourceInfo?.coverIndex !== null &&
    sourceInfo?.coverIndex !== undefined
  ) {
    args.push(
      '-map',
      `0:${sourceInfo.coverIndex}`,
      '-c:v',
      'copy',
      '-disposition:v:0',
      'attached_pic',
    );
  }

  const channelPlan = planChannels(settings, output, sourceInfo);
  if (channelPlan.channels !== null) args.push('-ac', String(channelPlan.channels));
  if (channelPlan.adjustment) adjustments.push(channelPlan.adjustment);

  if (settings.sampleRate && settings.sampleRate !== 'keep') {
    args.push('-ar', String(settings.sampleRate));
  }

  args.push(...codecQualityArgs(settings, output));

  if (output.lossless) {
    const bitDepth = resolveBitDepth(settings, output, sourceInfo);
    if (output.id === 'wav') {
      args[args.length - 1] = bitDepth === 24 ? 'pcm_s24le' : 'pcm_s16le';
    } else if (output.id === 'flac') {
      args.push('-sample_fmt', bitDepth === 24 ? 's32' : 's16');
    } else if (output.id === 'alac') {
      args.push('-sample_fmt', bitDepth === 24 ? 's32p' : 's16p');
    }
  }

  if (output.id === 'mp3') args.push('-id3v2_version', '3');
  if (output.extension === 'm4a') args.push('-movflags', '+faststart');

  args.push(outputName);
  return { args, adjustments };
}
