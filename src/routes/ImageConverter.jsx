import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { ImageSettings } from '../components/ImageSettings';
import { Button } from '../components/Button';
import { useToast } from '../components/Toasts';
import { IMAGE_ACCEPT, INPUT_FORMATS } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId, uniqueName } from '../lib/files';
import { formatBytes } from '../lib/format';
import {
  DEFAULT_IMAGE_SETTINGS,
  outputFormatFor,
  validateImageSettings,
  workerOptionsFor,
} from '../lib/imageOptions';
import { browserSupportsImageWorkers, supportsWebpEncode } from '../lib/imageSupport';
import { prepareImageSource } from '../lib/prepareImage';
import { sniffFile } from '../lib/sniff';
import { createImagePool } from '../workers/pool';
import { createZip } from '../lib/zip';

export default function ImageConverter() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_IMAGE_SETTINGS);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [webpSupported, setWebpSupported] = useState(null);
  const [workersSupported] = useState(() => browserSupportsImageWorkers());

  const poolRef = useRef(null);
  const preparedRef = useRef(new Map());
  const thumbUrlsRef = useRef(new Map());
  const objectUrlsRef = useRef(new Set());
  const removedIdsRef = useRef(new Set());
  const addingRef = useRef(false);
  const aliveRef = useRef(true);
  const { notify } = useToast();

  const settingsError = useMemo(() => validateImageSettings(settings), [settings]);
  const convertible = items.filter((item) => item.convertible);
  const outputs = items.filter((item) => item.output);
  const readyCount = convertible.length;

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    supportsWebpEncode().then((supported) => {
      if (cancelled || !aliveRef.current) return;
      setWebpSupported(supported);
      if (!supported) {
        setSettings((current) =>
          current.format === 'image/webp' ? { ...current, format: 'image/jpeg' } : current,
        );
      }
    });

    return () => {
      cancelled = true;
      aliveRef.current = false;
      poolRef.current?.destroy();
      poolRef.current = null;
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
      thumbUrlsRef.current.clear();
      preparedRef.current.clear();
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createImagePool();
    return poolRef.current;
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

  const attachThumb = useCallback((id, url) => {
    if (removedIdsRef.current.has(id)) {
      URL.revokeObjectURL(url);
      return;
    }
    const previous = thumbUrlsRef.current.get(id);
    if (previous) {
      URL.revokeObjectURL(previous);
      objectUrlsRef.current.delete(previous);
    }
    thumbUrlsRef.current.set(id, url);
    objectUrlsRef.current.add(url);
    updateItem(id, { thumbUrl: url });
  }, [updateItem]);

  const makeThumbnailFrom = useCallback(
    async (id, source, kind, orientation) => {
      if (removedIdsRef.current.has(id) || thumbUrlsRef.current.has(id)) return;
      try {
        const result = await getPool().run(
          'thumbnail',
          { source, kind, orientation },
          { priority: 0 },
        );
        if (aliveRef.current && !removedIdsRef.current.has(id)) {
          attachThumb(id, URL.createObjectURL(result.blob));
        }
      } catch {
        // A missing thumbnail is cosmetic; conversion errors are reported separately.
      }
    },
    [attachThumb, getPool],
  );

  const prepareSource = useCallback(
    (item) => {
      const cached = preparedRef.current.get(item.id);
      if (cached) return cached;

      const promise = prepareImageSource(item.file, item.kind);

      preparedRef.current.set(item.id, promise);
      promise.catch(() => preparedRef.current.delete(item.id));
      return promise;
    },
    [],
  );

  const addFiles = useCallback(
    async (files) => {
      if (addingRef.current || busy) return;
      addingRef.current = true;
      const { accepted, rejected } = checkBatchLimits(files, items);
      rejected.forEach(({ reason }) => notify(reason, 'error'));
      if (accepted.length === 0) {
        addingRef.current = false;
        return;
      }

      setChecking(true);
      try {
        const sniffed = await Promise.all(
          accepted.map(async (file) => ({ file, info: await sniffFile(file) })),
        );
        const additions = [];

        for (const { file, info } of sniffed) {
          const isImage = Boolean(info.isImage);
          let error = null;
          if (!isImage) {
            error =
              info.kind === 'pdf'
                ? 'This is a PDF. Use one of the PDF tools instead.'
                : info.message || 'This file type is not supported here.';
          }

          let thumbUrl = null;
          if (isImage && info.kind === 'svg') {
            thumbUrl = URL.createObjectURL(file);
            objectUrlsRef.current.add(thumbUrl);
          }

          const item = {
            id: makeId(),
            file,
            name: file.name,
            size: file.size,
            kind: info.kind,
            typeLabel: info.label,
            convertible: isImage,
            status: isImage ? 'ready' : 'error',
            error,
            thumbUrl,
          };
          if (thumbUrl) thumbUrlsRef.current.set(item.id, thumbUrl);
          additions.push(item);
        }

        if (!aliveRef.current) return;
        setItems((current) => [...current, ...additions]);
        setSummary('');
        setDirty(false);

        for (const item of additions) {
          if (item.convertible && item.kind !== 'heic' && item.kind !== 'svg') {
            makeThumbnailFrom(item.id, item.file, item.kind, 1);
          }
        }
      } finally {
        addingRef.current = false;
        if (aliveRef.current) setChecking(false);
      }
    },
    [busy, items, notify, makeThumbnailFrom],
  );

  const removeItem = (item) => {
    if (busy) {
      notify('Wait for the current batch to finish before removing files.', 'warning');
      return;
    }
    removedIdsRef.current.add(item.id);
    preparedRef.current.delete(item.id);
    const thumbUrl = thumbUrlsRef.current.get(item.id) ?? item.thumbUrl;
    if (thumbUrl) {
      URL.revokeObjectURL(thumbUrl);
      objectUrlsRef.current.delete(thumbUrl);
      thumbUrlsRef.current.delete(item.id);
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setSummary('');
    setDirty(false);
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    if (items.some((item) => item.output)) setDirty(true);
  };

  const outputNote = (result, targetBytes) => {
    const dimensions = `${result.width} × ${result.height}`;
    const quality =
      result.quality === null || result.quality === undefined
        ? ''
        : ` · quality ${Math.round(result.quality * 100)}%`;
    const target = targetBytes ? ' · fitted to target' : '';
    return `${dimensions}${quality}${target}`;
  };

  const convertOne = async (item, pool, options, outputName) => {
    updateItem(item.id, {
      status: 'working',
      statusText:
        item.kind === 'heic'
          ? 'Decoding HEIC'
          : item.kind === 'svg'
            ? 'Rasterizing SVG'
            : 'Preparing file',
      error: null,
      output: null,
    });

    try {
      const prepared = await prepareSource(item);
      updateItem(item.id, { statusText: 'Converting' });
      let lastLabel = '';
      const result = await pool.run(
        'convert',
        {
          source: prepared.blob,
          kind: prepared.kind,
          orientation: prepared.orientation,
          options,
        },
        {
          priority: 2,
          onProgress: (value) => {
            if (value?.label && value.label !== lastLabel) {
              lastLabel = value.label;
              updateItem(item.id, { statusText: value.label });
            }
          },
        },
      );

      const output = {
        blob: result.blob,
        name: outputName,
        size: result.blob.size,
        note: outputNote(result, options.targetBytes),
      };
      updateItem(item.id, {
        status: 'done',
        statusText: 'Done',
        error: null,
        output,
      });

      if (item.kind === 'heic') {
        makeThumbnailFrom(item.id, prepared.blob, prepared.kind, 1);
      }

      return { ok: true, inputSize: item.size, outputSize: result.blob.size };
    } catch (error) {
      const detail = error?.message || 'The conversion failed.';
      updateItem(item.id, {
        status: 'error',
        statusText: 'Failed',
        error: detail,
        output: null,
      });
      return { ok: false, inputSize: item.size, outputSize: 0 };
    }
  };

  const convertAll = async () => {
    if (busy || checking) return;
    if (settingsError) {
      notify(settingsError, 'error');
      return;
    }
    if (!workersSupported) {
      notify('This browser cannot run conversions in the background. Use a current browser.', 'error');
      return;
    }
    const targets = items.filter((item) => item.convertible);
    if (targets.length === 0) {
      notify('Add at least one supported image before converting.', 'warning');
      return;
    }

    const format = outputFormatFor(settings);
    const options = workerOptionsFor(settings);
    const usedNames = new Set();
    const outputNames = new Map();
    for (const item of targets) {
      outputNames.set(item.id, uniqueName(baseNameOf(item.name), format.extension, usedNames));
    }

    const pool = getPool();
    setBusy(true);
    setSummary('');
    setDirty(false);
    setProgress({ done: 0, total: targets.length });
    setItems((current) =>
      current.map((item) =>
        item.convertible
          ? {
              ...item,
              status: 'working',
              statusText: 'Queued',
              error: null,
              output: null,
            }
          : item,
      ),
    );

    let finished = 0;
    const bump = () => {
      finished += 1;
      if (aliveRef.current) setProgress({ done: finished, total: targets.length });
    };

    const results = await Promise.all(
      targets.map(async (item) => {
        const result = await convertOne(item, pool, options, outputNames.get(item.id));
        bump();
        return result;
      }),
    );

    if (!aliveRef.current) return;

    const successes = results.filter((result) => result.ok);
    const failures = results.length - successes.length;
    const saved = Math.max(
      0,
      successes.reduce((sum, result) => sum + result.inputSize, 0) -
        successes.reduce((sum, result) => sum + result.outputSize, 0),
    );

    if (successes.length === 0) {
      setSummary('No files were converted. Check the errors next to each file and try again.');
    } else {
      const savedText = saved > 0 ? `, ${formatBytes(saved)} smaller in total` : '';
      const failedText = failures
        ? ` ${failures} ${failures === 1 ? 'file' : 'files'} failed; the reason is next to the file.`
        : '';
      const convertedText =
        failures === 0
          ? `Converted ${successes.length} ${successes.length === 1 ? 'file' : 'files'}`
          : `Converted ${successes.length} of ${targets.length} files`;
      setSummary(`${convertedText}${savedText}.${failedText}`);
    }
    setBusy(false);
    setProgress(null);
  };

  const downloadOne = (item) => {
    if (!item.output) return;
    downloadBlob(item.output.blob, item.output.name);
  };

  const downloadAll = async () => {
    if (outputs.length === 0 || zipping) return;
    setZipping(true);
    try {
      const blob = await createZip(
        outputs.map((item) => ({ name: item.output.name, blob: item.output.blob })),
      );
      downloadBlob(blob, 'reformat-images.zip');
      notify(`ZIP with ${outputs.length} images downloaded.`, 'success');
    } catch {
      notify('The ZIP could not be created. Try again, or download files individually.', 'error');
    } finally {
      if (aliveRef.current) setZipping(false);
    }
  };

  const liveMessage = checking
    ? 'Checking files…'
    : busy && progress
      ? `Converting ${progress.done} of ${progress.total} files…`
      : summary ||
        (items.length
          ? `${items.length} ${items.length === 1 ? 'file' : 'files'} in this batch, ${readyCount} ready.`
          : '');

  return (
    <>
      <PageHeader
        title="Images"
        description="Convert phone photos and scans to JPG, PNG or WebP. Set a target file size for upload limits."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <DropZone
            title="Drop images here"
            description={`${INPUT_FORMATS}. Up to 50 files, 40 MB each, 300 MB total. First frame is used for GIF.`}
            accept={IMAGE_ACCEPT}
            disabled={checking || busy}
            onFiles={addFiles}
          />

          {!workersSupported ? (
            <p className="mt-3 text-[12px] leading-5 text-err">
              This browser does not support background image processing. Use a current version of
              Chrome, Edge, Firefox or Safari to convert files.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
              {liveMessage}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {outputs.length > 0 ? (
                <Button
                  variant="secondary"
                  onClick={downloadAll}
                  disabled={busy || zipping}
                >
                  {zipping ? 'Preparing ZIP…' : `Download ${outputs.length} as ZIP`}
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={convertAll}
                disabled={busy || checking || !workersSupported || Boolean(settingsError) || readyCount === 0}
                title={settingsError || undefined}
              >
                {busy
                  ? 'Converting…'
                  : readyCount === 0
                    ? 'Convert all'
                    : `Convert ${readyCount} ${readyCount === 1 ? 'file' : 'files'}`}
              </Button>
            </div>
          </div>

          {dirty && outputs.length > 0 && !busy ? (
            <p className="mt-1 text-[12px] text-warn">
              Settings changed. Convert again to replace the current results.
            </p>
          ) : null}

          <FileQueue
            items={items}
            onRemove={removeItem}
            onDownload={downloadOne}
            removeDisabled={busy}
          />

          {items.length > 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-2">
              JPG has no transparency, so transparent areas are filled with the chosen background.
              Converted images are re-encoded and have their metadata removed.
            </p>
          ) : null}
        </div>

        <ImageSettings
          settings={settings}
          onChange={changeSettings}
          disabled={busy}
          supportsWebp={webpSupported !== false}
          settingsError={settingsError}
        />
      </div>
    </>
  );
}
