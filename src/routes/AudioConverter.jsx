import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { AudioQueue } from '../components/AudioQueue';
import { AudioSettings } from '../components/AudioSettings';
import { Button } from '../components/Button';
import { useToast } from '../components/Toasts';
import { AUDIO_ACCEPT, AUDIO_INPUT_FORMATS } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, makeId, uniqueName } from '../lib/files';
import {
  AUDIO_OUTPUT_FORMATS,
  DEFAULT_AUDIO_SETTINGS,
  audioFormatFor,
  audioLimitsForDevice,
  canPreviewAudio,
  checkAudioBatchLimits,
  normalizeAudioSettings,
  readMediaDuration,
  sniffAudioFile,
  validateAudioSettings,
} from '../lib/audioFormats';
import {
  AudioCancelledError,
  convertAudioFile,
  ensureAudioEngine,
  getKnownAudioFormats,
  terminateAudioEngine,
} from '../lib/audioEngine';
import { createZip } from '../lib/zip';

const initialKnownFormats = getKnownAudioFormats();

export default function AudioConverter() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(() =>
    normalizeAudioSettings(DEFAULT_AUDIO_SETTINGS, initialKnownFormats ?? AUDIO_OUTPUT_FORMATS),
  );
  const [formats, setFormats] = useState(initialKnownFormats);
  const [limits] = useState(() => audioLimitsForDevice());
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [zipping, setZipping] = useState(false);

  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const cancelledRef = useRef(false);
  const objectUrlsRef = useRef(new Set());
  const { notify } = useToast();

  const settingsError = useMemo(
    () => validateAudioSettings(settings, formats ?? AUDIO_OUTPUT_FORMATS),
    [settings, formats],
  );
  const convertible = items.filter((item) => item.convertible);
  const outputs = items.filter((item) => item.output?.blob);
  const hasLossySource = convertible.some((item) => item.lossless === false);
  const hasLosslessSource = convertible.some((item) => item.lossless === true);
  const sourceLossless = hasLossySource
    ? hasLosslessSource
      ? null
      : false
    : hasLosslessSource
      ? true
      : null;
  const selectedOutput = (formats ?? AUDIO_OUTPUT_FORMATS).find(
    (format) => format.id === settings.format,
  );
  const sameFormat =
    convertible.length > 0 &&
    Boolean(selectedOutput) &&
    convertible.every((item) => {
      if (selectedOutput.id === 'vorbis') {
        return item.sourceExtension === 'ogg' || item.sourceExtension === 'oga';
      }
      return item.sourceExtension === selectedOutput.id;
    });
  const fileLimit = Math.round(limits.maxFileBytes / (1024 * 1024));
  const totalLimit = Math.round(limits.maxTotalBytes / (1024 * 1024));

  useEffect(() => {
    aliveRef.current = true;
    cancelledRef.current = false;
    const urls = objectUrlsRef.current;
    return () => {
      aliveRef.current = false;
      cancelledRef.current = true;
      terminateAudioEngine();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const updateItem = useCallback((id, patch) => {
    if (!aliveRef.current) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) }
          : item,
      ),
    );
  }, []);

  const addFiles = useCallback(
    async (files) => {
      if (addingRef.current || busy) return;
      addingRef.current = true;
      const { accepted, rejected } = checkAudioBatchLimits(files, items, limits);
      rejected.forEach(({ reason }) => notify(reason, 'error'));
      if (accepted.length === 0) {
        addingRef.current = false;
        return;
      }

      setChecking(true);
      try {
        const additions = await Promise.all(
          accepted.map(async (file) => {
            let info;
            try {
              info = await sniffAudioFile(file);
            } catch {
              info = {
                supported: false,
                label: 'Unknown',
                message: `${file.name} could not be read. Try downloading it again.`,
              };
            }
            if (!info.supported) {
              return {
                id: makeId(),
                file,
                name: file.name,
                size: file.size,
                typeLabel: info.label || 'Unknown',
                convertible: false,
                status: 'error',
                statusText: 'Failed',
                error: info.message,
                duration: null,
                previewUrl: null,
                previewable: false,
              };
            }

            const previewable = canPreviewAudio(info.extension, file.type);
            let previewUrl = null;
            if (previewable) {
              previewUrl = URL.createObjectURL(file);
              objectUrlsRef.current.add(previewUrl);
            }
            return {
              id: makeId(),
              file,
              name: file.name,
              size: file.size,
              sourceExtension: info.extension,
              typeLabel: info.label,
              isVideo: info.isVideo,
              lossless: info.lossless,
              convertible: true,
              status: 'ready',
              statusText: 'Waiting',
              error: null,
              duration: null,
              progress: 0,
              previewUrl,
              previewable,
            };
          }),
        );

        if (!aliveRef.current) {
          for (const item of additions) {
            if (item.previewUrl) {
              URL.revokeObjectURL(item.previewUrl);
              objectUrlsRef.current.delete(item.previewUrl);
            }
          }
          return;
        }

        setItems((current) => [...current, ...additions]);
        setSummary('');
        setDirty(false);
        setLoadError('');

        for (const item of additions) {
          if (!item.convertible || !item.previewable) continue;
          readMediaDuration(item.file, item.isVideo).then((duration) => {
            if (!aliveRef.current || !duration) return;
            setItems((current) =>
              current.map((entry) =>
                entry.id === item.id ? { ...entry, duration } : entry,
              ),
            );
          });
        }
      } finally {
        addingRef.current = false;
        if (aliveRef.current) setChecking(false);
      }
    },
    [busy, items, limits, notify],
  );

  const removeItem = (item) => {
    if (busy) {
      notify('Wait for the current batch to finish before removing files.', 'warning');
      return;
    }
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      objectUrlsRef.current.delete(item.previewUrl);
    }
    if (item.output?.url) {
      URL.revokeObjectURL(item.output.url);
      objectUrlsRef.current.delete(item.output.url);
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setSummary('');
    setDirty(false);
  };

  const clearAll = () => {
    if (busy || checking) return;
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
    setItems([]);
    setSummary('');
    setDirty(false);
    setLoadError('');
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) =>
      normalizeAudioSettings(
        { ...current, ...patch },
        formats ?? AUDIO_OUTPUT_FORMATS,
      ),
    );
    if (items.some((item) => item.output)) setDirty(true);
  };

  const convertAll = async () => {
    if (busy || checking) return;
    if (settingsError) {
      notify(settingsError, 'error');
      return;
    }
    const targets = items.filter((item) => item.convertible);
    if (targets.length === 0) {
      notify('Add at least one supported audio or video file before converting.', 'warning');
      return;
    }

    cancelledRef.current = false;
    setCancelling(false);
    setBusy(true);
    setSummary('');
    setDirty(false);
    setLoadError('');
    setProgress({ done: 0, total: targets.length });
    for (const item of items) {
      if (!item.output?.url) continue;
      URL.revokeObjectURL(item.output.url);
      objectUrlsRef.current.delete(item.output.url);
    }
    setItems((current) =>
      current.map((item) =>
        item.convertible
          ? {
              ...item,
              status: 'ready',
              statusText: 'Waiting',
              progress: 0,
              error: null,
              output: null,
            }
          : item,
      ),
    );

    let activeId = null;
    let activeWorking = false;
    let finished = 0;
    let successes = 0;
    let failures = 0;
    let cancelled = false;

    try {
      setEngineLoading(true);
      setLoadProgress(0);
      const engine = await ensureAudioEngine((value) => {
        if (aliveRef.current) setLoadProgress(value);
      });
      if (!aliveRef.current) return;
      setFormats(engine.formats);
      setEngineLoading(false);
      setLoadProgress(100);

      const normalized = normalizeAudioSettings(settings, engine.formats);
      setSettings(normalized);
      if (normalized.format !== settings.format) {
        notify('That output format is not available in this browser. Choose an available format and try again.', 'warning');
        setSummary('Choose an available output format, then convert again.');
        return;
      }
      const nextError = validateAudioSettings(normalized, engine.formats);
      if (nextError) {
        notify(nextError, 'error');
        return;
      }

      const output = audioFormatFor(normalized.format);
      const usedNames = new Set();
      const outputNames = new Map(
        targets.map((item) => [
          item.id,
          uniqueName(baseNameOf(item.name), output.extension, usedNames),
        ]),
      );

      for (const item of targets) {
        if (cancelledRef.current) {
          cancelled = true;
          break;
        }
        activeId = item.id;
        activeWorking = true;
        updateItem(item.id, {
          status: 'working',
          statusText: 'Converting 0%',
          progress: 0,
          error: null,
          output: null,
        });

        try {
          let lastPercent = 0;
          const result = await convertAudioFile({
            file: item.file,
            extension: item.sourceExtension,
            settings: normalized,
            fallbackDuration: item.duration,
            onProgress: (event) => {
              if (!aliveRef.current || cancelledRef.current || activeId !== item.id) return;
              const ratio =
                Number.isFinite(event?.progress) && event.progress > 0
                  ? event.progress
                  : Number.isFinite(event?.time) && Number(item.duration) > 0
                    ? event.time / (Number(item.duration) * 1_000_000)
                    : 0;
              const percent = Math.min(99, Math.max(0, Math.round(ratio * 100)));
              if (percent === lastPercent) return;
              lastPercent = percent;
              updateItem(item.id, {
                progress: percent,
                statusText: `Converting ${percent}%`,
              });
            },
          });

          if (cancelledRef.current) {
            cancelled = true;
            break;
          }

          const notes = [];
          if (result.coverDropped) {
            notes.push('Cover art could not be copied; the audio and tags were saved without it.');
          }
          notes.push(...result.adjustments);
          const outputUrl = URL.createObjectURL(result.blob);
          objectUrlsRef.current.add(outputUrl);
          updateItem(item.id, {
            status: 'done',
            statusText: 'Done',
            progress: 100,
            error: null,
            duration: result.info.duration ?? item.duration,
            lossless: result.info.lossless,
            isVideo: result.info.isVideo,
            output: {
              blob: result.blob,
              name: outputNames.get(item.id),
              size: result.blob.size,
              note: notes.join(' '),
              url: outputUrl,
            },
          });
          successes += 1;
          activeWorking = false;
        } catch (error) {
          if (
            cancelledRef.current ||
            error instanceof AudioCancelledError ||
            error?.name === 'AudioCancelledError'
          ) {
            cancelled = true;
            break;
          }
          failures += 1;
          activeWorking = false;
          updateItem(item.id, {
            status: 'error',
            statusText: 'Failed',
            progress: 0,
            output: null,
            error: error?.message || 'The conversion failed.',
          });
        }

        finished += 1;
        if (aliveRef.current) setProgress({ done: finished, total: targets.length });
      }

      if (cancelled) {
        if (activeId && activeWorking) {
          updateItem(activeId, {
            status: 'ready',
            statusText: 'Waiting',
            progress: 0,
            error: null,
            output: null,
          });
        }
        if (aliveRef.current) {
          setSummary('Conversion cancelled. Files that were not converted are still waiting.');
        }
      } else if (!aliveRef.current) {
        return;
      } else if (successes === 0) {
        setSummary('No files were converted. Check the error next to each file and try again.');
      } else if (failures > 0) {
        setSummary(
          `Converted ${successes} of ${targets.length} files. ${failures} ${
            failures === 1 ? 'file' : 'files'
          } failed; the reason is next to each file.`,
        );
      } else {
        setSummary(`Converted ${successes} ${successes === 1 ? 'file' : 'files'}.`);
      }
    } catch (error) {
      if (!aliveRef.current) return;
      if (
        cancelledRef.current ||
        error instanceof AudioCancelledError ||
        error?.name === 'AudioCancelledError'
      ) {
        setSummary('Conversion cancelled. The audio engine will load again when you retry.');
      } else {
        setLoadError(
          error?.message ||
            'The audio engine could not load. Check your connection and try again.',
        );
        setSummary('The audio engine did not start. Nothing was converted.');
      }
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setCancelling(false);
        setEngineLoading(false);
        setLoadProgress(0);
        setProgress(null);
      }
      activeId = null;
      activeWorking = false;
    }
  };

  const cancelConversion = () => {
    if (!busy || cancelling) return;
    cancelledRef.current = true;
    setCancelling(true);
    terminateAudioEngine();
  };

  const downloadOne = (item) => {
    if (!item.output?.blob) return;
    downloadBlob(item.output.blob, item.output.name);
  };

  const downloadAll = async () => {
    if (outputs.length === 0 || zipping) return;
    setZipping(true);
    try {
      const blob = await createZip(
        outputs.map((item) => ({ name: item.output.name, blob: item.output.blob })),
      );
      downloadBlob(blob, 'reformat-audio.zip');
      notify(`ZIP with ${outputs.length} audio files downloaded.`, 'success');
    } catch {
      notify('The ZIP could not be created. Try again, or download files individually.', 'error');
    } finally {
      if (aliveRef.current) setZipping(false);
    }
  };

  const liveMessage = checking
    ? 'Checking files…'
    : cancelling
      ? 'Cancelling…'
      : engineLoading
        ? 'Loading the audio engine. This happens once and is then cached.'
        : busy && progress
          ? `Converting ${Math.min(progress.done + 1, progress.total)} of ${progress.total} files…`
          : summary ||
            (items.length
              ? `${items.length} ${items.length === 1 ? 'file' : 'files'} in this batch, ${convertible.length} ready.`
              : '');

  return (
    <>
      <PageHeader
        title="Audio"
        description="Convert audio files and extract the audio track from video. Lossless formats keep the original quality; compressed formats make smaller files."
      />
      <DropZone
        title="Drop audio or video here"
        description={`${AUDIO_INPUT_FORMATS}. Extract audio from video: the picture is dropped. Up to ${limits.maxFiles} files, ${fileLimit} MB each, ${totalLimit} MB total.`}
        accept={AUDIO_ACCEPT}
        disabled={checking || busy}
        onFiles={addFiles}
      />

      {items.length > 0 ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={busy || checking}
          >
            Clear all
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <AudioQueue
            items={items}
            onRemove={removeItem}
            onDownload={downloadOne}
            removeDisabled={busy}
          />

          <SettingsReveal show>
            <AudioSettings
              settings={settings}
              onChange={changeSettings}
              formats={formats ?? AUDIO_OUTPUT_FORMATS}
              disabled={busy}
              settingsError={settingsError}
              sourceLossless={sourceLossless}
              sameFormat={sameFormat}
            />
          </SettingsReveal>

          <div className="mt-6 border-t border-line pt-4">
            {engineLoading ? (
              <div className="mb-3 max-w-[420px]">
                <p className="text-[12px] text-ink-2" role="status">
                  Loading the audio engine. This happens once and is then cached.
                </p>
                {loadProgress > 0 ? (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full bg-info transition-[width] duration-200"
                      style={{ width: `${loadProgress}%` }}
                      aria-hidden="true"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {loadError ? (
              <div className="mb-3 border-l-2 border-l-err pl-3" role="alert">
                <p className="text-[12px] leading-5 text-err">{loadError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={convertAll}
                  disabled={busy || checking}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
                {liveMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {outputs.length > 0 ? (
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={outputs.length === 1 ? () => downloadOne(outputs[0]) : downloadAll}
                    disabled={busy || zipping}
                  >
                    <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                    {zipping
                      ? 'Preparing ZIP…'
                      : outputs.length === 1
                        ? 'Download'
                        : 'Download all as ZIP'}
                  </Button>
                ) : null}
                {busy ? (
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={cancelConversion}
                    disabled={cancelling}
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel'}
                  </Button>
                ) : null}
                <Button
                  size="md"
                  variant="primary"
                  onClick={convertAll}
                  disabled={
                    busy ||
                    checking ||
                    Boolean(settingsError) ||
                    convertible.length === 0
                  }
                  title={settingsError || undefined}
                >
                  {busy
                    ? 'Converting…'
                    : convertible.length === 0
                      ? 'Convert all'
                      : `Convert ${convertible.length} ${convertible.length === 1 ? 'file' : 'files'}`}
                </Button>
              </div>
            </div>

            {dirty && outputs.length > 0 && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                Settings changed. Convert again to replace the current results.
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-[12px] leading-5 text-ink-2">
            Video files produce audio-only output. Lossless formats can be much larger than the
            source. Converting a compressed file to another compressed format adds another lossy
            step; a lossless output preserves the quality that is already there.
          </p>

        </>
      ) : null}
    </>
  );
}
