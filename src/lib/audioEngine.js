import {
  audioFormatFor,
  availableAudioFormats,
  buildAudioArgs,
  isLosslessCodec,
} from './audioFormats';

const CORE_URL = new URL(
  `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`,
  window.location.origin,
).href;
const WASM_URL = CORE_URL.replace(/\.js$/, '.wasm');

let instance = null;
let loadPromise = null;
let knownFormats = null;
let assetsWarmed = false;
let generation = 0;
let jobCounter = 0;
let logSink = null;
let progressSink = null;

export class AudioCancelledError extends Error {
  constructor() {
    super('Conversion cancelled.');
    this.name = 'AudioCancelledError';
  }
}

export class AudioEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudioEngineError';
  }
}

function isCancelled(error) {
  return (
    error instanceof AudioCancelledError ||
    /called FFmpeg\.terminate|aborted/i.test(String(error?.message ?? error ?? ''))
  );
}

async function createInstance() {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (logSink) logSink.push(message);
  });
  ffmpeg.on('progress', (event) => {
    progressSink?.(event);
  });
  return ffmpeg;
}

async function runWithSink(ffmpeg, args, { logs, onProgress, timeout = -1 } = {}) {
  const previousLog = logSink;
  const previousProgress = progressSink;
  logSink = logs ?? null;
  progressSink = onProgress ?? null;
  try {
    return await ffmpeg.exec(args, timeout);
  } finally {
    logSink = previousLog;
    progressSink = previousProgress;
  }
}

async function safeDelete(ffmpeg, name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    return;
  }
}

async function warmAssets(onProgress) {
  if (assetsWarmed) return;
  const { downloadWithProgress } = await import('@ffmpeg/util');
  let data;
  try {
    data = await downloadWithProgress(WASM_URL, ({ total, received }) => {
      if (total > 0) {
        const percent = Math.min(94, Math.max(1, Math.round((received / total) * 94)));
        onProgress?.(percent);
      }
    });
  } catch {
    throw new AudioEngineError(
      'The audio engine could not be downloaded. Check your connection and try again.',
    );
  }
  if (!(data instanceof ArrayBuffer) || data.byteLength < 1_000_000) {
    throw new AudioEngineError(
      'The audio engine files could not be found. Reload the page and try again.',
    );
  }
  assetsWarmed = true;
  onProgress?.(95);
}

function parseDuration(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  return Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : null;
}

function parseLogDuration(logs, fallbackDuration) {
  for (const line of logs) {
    const match = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      return parseDuration(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), fallbackDuration);
    }
  }
  return parseDuration(null, fallbackDuration);
}

function infoFromLogs(logs, fallbackDuration) {
  const audioLine = logs.find((line) => /Stream #\d+:\d+.*: Audio:/.test(line));
  if (!audioLine) {
    if (/invalid data|could not find codec|error opening input/i.test(logs.join('\n'))) {
      throw new Error('This file could not be read. It may be damaged or use an unsupported codec.');
    }
    throw new Error('No audio track was found in this file.');
  }
  const codec = String(audioLine.match(/Audio:\s*([^,\s]+)/)?.[1] ?? '').toLowerCase();
  const rate = Number(audioLine.match(/(\d+) Hz/)?.[1]) || null;
  const mono = /\bmono\b/.test(audioLine);
  const stereo = /\bstereo\b/.test(audioLine);
  const channels = mono ? 1 : stereo ? 2 : Number(audioLine.match(/(\d+) channels/)?.[1]) || null;
  const bitMatch = audioLine.match(/\((\d+) bit\)/);
  const bitDepth = bitMatch ? Number(bitMatch[1]) : /pcm_s24/.test(codec) ? 24 : /pcm_s16/.test(codec) ? 16 : null;
  const coverLine = logs.find(
    (line) => /Stream #\d+:\d+.*: Video:/.test(line) && /\(attached pic\)/.test(line),
  );
  const coverIndex = coverLine ? Number(coverLine.match(/Stream #\d+:(\d+)/)?.[1]) : null;
  const hasVideo = logs.some(
    (line) => /Stream #\d+:\d+.*: Video:/.test(line) && !/\(attached pic\)/.test(line),
  );
  return {
    duration: parseLogDuration(logs, fallbackDuration),
    sampleRate: rate,
    channels,
    bitDepth,
    bitRate: null,
    codec,
    codecLabel: codec,
    lossless: isLosslessCodec(codec),
    coverIndex,
    isVideo: hasVideo,
  };
}

async function inspectAudio(ffmpeg, inputName, fallbackDuration) {
  const logs = [];
  await runWithSink(ffmpeg, ['-hide_banner', '-loglevel', 'info', '-i', inputName], {
    logs,
    timeout: 30000,
  });
  return infoFromLogs(logs, fallbackDuration);
}

function friendlyConversionError(raw) {
  const text = String(raw ?? '');
  if (/^(No audio track|This file could not be read|These settings are not supported|This file is too large|The selected output format)/.test(text)) {
    return text;
  }
  if (/out of memory|cannot enlarge memory|memory access out of bounds|oom|rangeerror/i.test(text)) {
    return 'This file is too large for the browser to convert. Try a shorter file.';
  }
  if (/invalid data found|could not find codec parameters|error opening input|moov atom not found/i.test(text)) {
    return 'This file could not be read. It may be damaged or use an unsupported codec.';
  }
  if (/unknown encoder|encoder .* not found|not currently supported/i.test(text)) {
    return 'The selected output format is not available in this browser engine. Choose another format.';
  }
  if (/error while opening encoder|invalid argument|codec not supported|bitrate|sample rate/i.test(text)) {
    return 'These settings are not supported for this file. Try another sample rate, channel option or output format.';
  }
  return 'The conversion failed. Try another output format or settings.';
}

async function loadEngine(onProgress) {
  if (instance?.loaded && knownFormats) {
    return { ffmpeg: instance, formats: knownFormats };
  }
  if (loadPromise) return loadPromise;

  const startedGeneration = generation;
  const promise = (async () => {
    await warmAssets(onProgress);
    if (startedGeneration !== generation) throw new AudioCancelledError();

    if (!instance) instance = await createInstance();
    const ffmpeg = instance;
    if (startedGeneration !== generation) {
      ffmpeg.terminate();
      if (instance === ffmpeg) instance = null;
      throw new AudioCancelledError();
    }

    onProgress?.(97);
    const logs = [];
    try {
      await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      if (startedGeneration !== generation) throw new AudioCancelledError();

      const encoderLogs = [];
      const code = await runWithSink(ffmpeg, ['-hide_banner', '-encoders'], {
        logs: encoderLogs,
      });
      if (code !== 0) {
        throw new AudioEngineError('The audio engine could not start. Reload the page and try again.');
      }
      if (startedGeneration !== generation) throw new AudioCancelledError();
      const formats = availableAudioFormats(encoderLogs.join('\n'));
      if (formats.length === 0) {
        throw new AudioEngineError(
          'The audio engine loaded, but no supported audio encoders were found.',
        );
      }
      knownFormats = formats;
      onProgress?.(100);
      return { ffmpeg, formats };
    } catch (error) {
      if (isCancelled(error)) {
        ffmpeg.terminate();
        if (instance === ffmpeg) instance = null;
        throw new AudioCancelledError();
      }
      if (instance === ffmpeg) {
        ffmpeg.terminate();
        instance = null;
      }
      if (error instanceof AudioEngineError) throw error;
      throw new AudioEngineError(
        'The audio engine could not load. Check your connection and try again.',
      );
    }
  })();

  loadPromise = promise;
  const clear = () => {
    if (loadPromise === promise) loadPromise = null;
  };
  promise.then(clear, clear);
  return promise;
}

export function getKnownAudioFormats() {
  return knownFormats;
}

export function terminateAudioEngine() {
  generation += 1;
  const current = instance;
  instance = null;
  loadPromise = null;
  current?.terminate();
}

export async function ensureAudioEngine(onProgress) {
  try {
    return await loadEngine(onProgress);
  } catch (error) {
    if (isCancelled(error)) throw new AudioCancelledError();
    if (error instanceof AudioEngineError) throw error;
    throw new AudioEngineError(
      'The audio engine could not load. Check your connection and try again.',
    );
  }
}

export async function convertAudioFile({
  file,
  extension,
  settings,
  fallbackDuration,
  onProgress,
}) {
  let ffmpeg;
  try {
    ({ ffmpeg } = await loadEngine());
  } catch (error) {
    if (isCancelled(error)) throw new AudioCancelledError();
    if (error instanceof AudioEngineError) throw error;
    throw new AudioEngineError('The audio engine could not load. Check your connection and try again.');
  }
  const output = audioFormatFor(settings.format);
  const id = ++jobCounter;
  const inputName = `audio-in-${id}.${extension || 'bin'}`;
  const outputName = `audio-out-${id}.${output.extension}`;
  const logs = [];

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    const data = await fetchFile(file);
    await ffmpeg.writeFile(inputName, data);
    onProgress?.(0);
    const info = await inspectAudio(ffmpeg, inputName, fallbackDuration);

    let built = buildAudioArgs({
      settings,
      output,
      sourceInfo: info,
      inputName,
      outputName,
      includeCover: true,
    });
    let code = await runWithSink(ffmpeg, built.args, { logs, onProgress });
    let coverDropped = false;

    if (
      code !== 0 &&
      info.coverIndex !== null &&
      settings.keepTags &&
      output.supportsCover
    ) {
      await safeDelete(ffmpeg, outputName);
      coverDropped = true;
      built = buildAudioArgs({
        settings,
        output,
        sourceInfo: info,
        inputName,
        outputName,
        includeCover: false,
      });
      code = await runWithSink(ffmpeg, built.args, { logs, onProgress });
    }

    if (code !== 0) throw new Error(logs.join('\n') || 'The conversion failed.');
    const bytes = await ffmpeg.readFile(outputName);
    return {
      blob: new Blob([bytes], { type: output.mime }),
      info,
      coverDropped,
      adjustments: built.adjustments,
    };
  } catch (error) {
    if (isCancelled(error)) throw new AudioCancelledError();
    if (error instanceof AudioEngineError) throw error;
    const message = friendlyConversionError(error?.message ?? error);
    if (message === 'This file is too large for the browser to convert. Try a shorter file.') {
      terminateAudioEngine();
    }
    throw new Error(message);
  } finally {
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
  }
}
