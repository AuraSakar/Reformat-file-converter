import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { SettingsGroup, SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { PDF_ACCEPT } from '../lib/config';
import {
  COMPRESS_PRESETS,
  DEFAULT_COMPRESS_SETTINGS,
  presetFor,
  targetBytesForCompress,
  validateCompressSettings,
} from '../lib/compressOptions';
import { downloadBlob } from '../lib/download';
import { browserSupportsPdfRendering } from '../lib/imageSupport';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount, formatSavings } from '../lib/format';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

const METHODS = [
  {
    value: 'keep',
    label: 'Keep text',
    short: 'Text stays selectable',
    hint: 'Large images are replaced only when a smaller version can be made. Text, links and page structure stay in place.',
  },
  {
    value: 'raster',
    label: 'Maximum compression',
    short: 'Text becomes images',
    hint: 'Every page becomes a JPEG. Text becomes part of the picture and is no longer selectable or searchable.',
  },
];

function CompressSettings({ settings, onChange, disabled, settingsError }) {
  const id = useId();
  const targetValueId = `${id}-target-value`;
  const targetUnitId = `${id}-target-unit`;
  const preset = presetFor(settings.preset);
  const method = METHODS.find((entry) => entry.value === settings.strategy) ?? METHODS[0];

  return (
    <SettingsPanel title="Compression">
      <SettingsGroup title="Method">
        <div role="radiogroup" aria-label="Compression method" className="grid grid-cols-2 gap-1">
          {METHODS.map((entry) => (
            <label key={entry.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-method`}
                value={entry.value}
                checked={settings.strategy === entry.value}
                disabled={disabled}
                onChange={() => onChange({ strategy: entry.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-11">
                <span>{entry.label}</span>
                <span className="text-[10px] font-normal text-ink-2">{entry.short}</span>
              </span>
            </label>
          ))}
        </div>
        <p className={`text-[12px] leading-5 ${settings.strategy === 'raster' ? 'text-warn' : 'text-ink-2'}`}>
          {method.hint}
        </p>
        {settings.strategy === 'raster' ? (
          <label className="flex min-h-10 cursor-pointer items-start gap-2 text-[12px] text-ink sm:min-h-8">
            <input
              type="checkbox"
              checked={settings.grayscale}
              disabled={disabled}
              onChange={(event) => onChange({ grayscale: event.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-ink"
            />
            <span>
              Convert pages to grayscale
              <span className="block text-[11px] leading-4 text-ink-2">
                Removes color. Helps with text, diagrams and line art.
              </span>
            </span>
          </label>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Strength">
        <div role="radiogroup" aria-label="Compression strength" className="grid grid-cols-3 gap-1">
          {COMPRESS_PRESETS.map((entry) => (
            <label key={entry.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-preset`}
                value={entry.value}
                checked={settings.preset === entry.value}
                disabled={disabled}
                onChange={() => onChange({ preset: entry.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-11">
                <span>{entry.label}</span>
                <span className="mono text-[10px] font-normal text-ink-2">
                  {entry.dpi} DPI · {Math.round(entry.quality * 100)}%
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">{preset.hint}</p>
      </SettingsGroup>

      <SettingsGroup title="Target file size">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.targetEnabled}
            disabled={disabled}
            onChange={(event) => onChange({ targetEnabled: event.target.checked })}
            className="size-4 accent-ink"
          />
          Fit under a limit
        </label>
        {settings.targetEnabled ? (
          <>
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor={targetValueId}>
                Target size
              </label>
              <input
                id={targetValueId}
                type="number"
                inputMode="decimal"
                min="1"
                step="any"
                value={settings.targetValue}
                disabled={disabled}
                onChange={(event) => onChange({ targetValue: event.target.value })}
                className="control control-sm w-24"
              />
              <label className="sr-only" htmlFor={targetUnitId}>
                Target size unit
              </label>
              <select
                id={targetUnitId}
                value={settings.targetUnit}
                disabled={disabled}
                onChange={(event) => onChange({ targetUnit: event.target.value })}
                className="control control-sm w-20"
              >
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </select>
            </div>
            <p className="text-[12px] leading-4 text-ink-2">
              Tries stronger settings automatically. If the limit cannot be reached, the smallest
              result is shown instead.
            </p>
          </>
        ) : (
          <p className="text-[12px] leading-4 text-ink-2">
            Optional. Use this when a portal has a maximum upload size.
          </p>
        )}
      </SettingsGroup>

      <div className="py-4">
        <p className="text-[12px] leading-5 text-ink-2">
          A smaller result is never larger than the original. Everything is processed on this
          device.
        </p>
        {settingsError ? (
          <p className="mt-2 text-[12px] leading-4 text-err" role="alert">
            {settingsError}
          </p>
        ) : null}
      </div>
    </SettingsPanel>
  );
}

export default function CompressPdf() {
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_COMPRESS_SETTINGS);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsPdfRendering());
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const tokenRef = useRef(0);
  const { notify } = useToast();

  const readied = Boolean(item?.status === 'ready' || item?.status === 'done');
  const settingsError = useMemo(() => validateCompressSettings(settings), [settings]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      tokenRef.current += 1;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const invalidateOutput = useCallback(() => {
    setSummary('');
    if (output) setDirty(true);
  }, [output]);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    setItem(null);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
    setPreparing(false);
  }, []);

  const addFile = useCallback(
    async (files) => {
      if (addingRef.current || busy || preparing) return;
      addingRef.current = true;
      try {
        const file = files?.[0];
        if (!file) return;

        const { accepted, rejected } = checkBatchLimits([file], []);
        if (rejected.length) {
          rejected.forEach(({ reason }) => notify(reason, 'error'));
          return;
        }
        if (!accepted.length) return;

        const info = await sniffFile(file);
        if (!info.isPdf) {
          notify('Choose a PDF file for this tool.', 'error');
          return;
        }

        reset();
        const token = tokenRef.current + 1;
        tokenRef.current = token;
        const nextItem = {
          id: makeId(),
          file,
          name: file.name,
          size: file.size,
          kind: 'pdf',
          typeLabel: 'PDF',
          pdf: true,
          pages: null,
          detail: '',
          status: 'working',
          statusText: 'Checking',
          error: null,
        };
        setItem(nextItem);
        setPreparing(true);

        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = await getPool().run('inspect', { bytes }, { priority: 2 });
          if (!aliveRef.current || tokenRef.current !== token) return;
          if (!result?.pages) throw new Error('This PDF has no pages.');
          setItem((current) =>
            current
              ? {
                  ...current,
                  pages: result.pages,
                  detail: formatCount(result.pages, 'page'),
                  status: 'ready',
                  statusText: 'Ready',
                }
              : current,
          );
        } catch (error) {
          if (!aliveRef.current || tokenRef.current !== token) return;
          setItem((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  statusText: 'Failed',
                  error: error?.message || 'This PDF could not be read.',
                }
              : current,
          );
        } finally {
          if (aliveRef.current && tokenRef.current === token) setPreparing(false);
        }
      } finally {
        addingRef.current = false;
      }
    },
    [busy, getPool, notify, preparing, reset],
  );

  const removeItem = () => {
    if (busy || preparing) {
      notify('Wait for compression to finish before removing the PDF.', 'warning');
      return;
    }
    reset();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateOutput();
  };

  const compress = async () => {
    if (busy || preparing || !readied) return;
    if (settingsError) {
      notify(settingsError, 'error');
      return;
    }
    const pages = item.pages || 0;
    if (!pages) {
      notify('This PDF has no pages.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    setProgress({ label: 'Analyzing PDF', done: 0, total: pages });
    setItem((current) =>
      current ? { ...current, status: 'working', statusText: 'Compressing' } : current,
    );

    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      if (!aliveRef.current) return;
      const base = baseNameOf(item.name);
      const result = await getPool().run(
        'compress',
        {
          bytes,
          options: {
            strategy: settings.strategy,
            preset: settings.preset,
            grayscale: settings.grayscale,
            targetBytes: targetBytesForCompress(settings),
            title: `${base} compressed`,
          },
        },
        {
          priority: 2,
          onProgress: (value) => {
            if (aliveRef.current) setProgress(value);
          },
        },
      );
      if (!aliveRef.current) return;

      setOutput({
        blob: result.blob,
        name: `${base}-compressed.pdf`,
        size: result.after,
        before: result.before,
        after: result.after,
        pages: result.pages,
        strategy: result.strategy,
        presetLabel: result.preset,
        analysis: result.analysis,
        unchanged: result.unchanged,
        reencodedImages: result.reencodedImages,
        targetBytes: result.targetBytes,
        targetMet: result.targetMet,
        attempts: result.attempts,
        clamped: result.clamped,
      });
      setDirty(false);

      if (result.unchanged) {
        const targetText =
          result.targetBytes && result.targetMet
            ? ` It already fits under the ${formatBytes(result.targetBytes)} target.`
            : '';
        setSummary(
          `This PDF is already well optimized. No smaller version could be made. It stays at ${formatBytes(
            result.before,
          )}.${targetText}`,
        );
      } else {
        const saved = formatSavings(result.before, result.after);
        const strategyText =
          result.strategy === 'raster'
            ? 'Pages were rebuilt as images'
            : 'Text and vectors were kept';
        const imageText =
          result.strategy === 'keep' && result.reencodedImages === 0
            ? ' No image needed re-encoding, so unused data was removed.'
            : '';
        const targetText =
          result.targetBytes && result.targetMet
            ? ` It meets the ${formatBytes(result.targetBytes)} target.`
            : '';
        setSummary(
          `${strategyText}. ${formatBytes(result.before)} to ${formatBytes(result.after)}${
            saved ? `, ${saved.percent}% smaller` : ''
          }.${imageText}${targetText}`,
        );
      }

      setItem((current) =>
        current
          ? {
              ...current,
              status: 'done',
              statusText: result.unchanged ? 'Already optimized' : 'Compressed',
            }
          : current,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDF could not be compressed. Try again or use another file.');
      notify(error?.message || 'The PDF could not be compressed.', 'error');
      setItem((current) =>
        current ? { ...current, status: 'ready', statusText: 'Ready' } : current,
      );
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const savings = output && !output.unchanged ? formatSavings(output.before, output.after) : null;
  const liveMessage = preparing
    ? 'Checking PDF…'
    : busy && progress
      ? progress.label || 'Compressing PDF…'
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be read. Remove it and try another file.'
          : item
            ? `${formatCount(item.pages || 0, 'page')} ready.`
            : '');

  return (
    <>
      <PageHeader
        title="Compress PDF"
        description="Shrink large images while keeping text selectable, or rebuild pages for maximum compression."
      />
      <DropZone
        title="Drop a PDF here"
        description="PDF files only. One file at a time, up to 40 MB. Your original is never changed."
        accept={PDF_ACCEPT}
        multiple={false}
        disabled={busy || preparing || !workersSupported}
        onFiles={addFile}
        buttonLabel="Choose PDF"
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF processing. Use a current version of
          Chrome, Edge, Firefox or Safari to compress PDFs.
        </p>
      ) : null}

      {item ? (
        <>
          <FileQueue
            items={[item]}
            onRemove={removeItem}
            removeDisabled={busy || preparing}
            showOutput={false}
          />

          <SettingsReveal show>
            <CompressSettings
              settings={settings}
              onChange={changeSettings}
              disabled={busy || preparing || !workersSupported}
              settingsError={settingsError}
            />
          </SettingsReveal>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
                {liveMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {output ? (
                  <>
                    <Button
                      size="md"
                      variant={dirty ? 'primary' : 'secondary'}
                      onClick={compress}
                      disabled={busy || preparing || !workersSupported || !readied}
                    >
                      {busy ? 'Compressing…' : 'Compress again'}
                    </Button>
                    {!output.unchanged ? (
                      <Button
                        size="md"
                        variant={dirty ? 'secondary' : 'primary'}
                        onClick={() => downloadBlob(output.blob, output.name)}
                        disabled={busy}
                      >
                        <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                        Download PDF
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button
                    size="md"
                    onClick={compress}
                    disabled={
                      busy ||
                      preparing ||
                      !workersSupported ||
                      !readied ||
                      Boolean(settingsError)
                    }
                    title={settingsError || undefined}
                  >
                    {busy ? 'Compressing…' : 'Compress PDF'}
                  </Button>
                )}
              </div>
            </div>

            {busy && progress?.total ? (
              <div className="mt-2" aria-hidden="true">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-ink transition-[width] duration-150"
                    style={{
                      width: `${Math.max(4, ((progress.done || 0) / progress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {output && !busy && !output.unchanged ? (
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
                {formatCount(output.pages, 'page')} · {output.name}
                {savings ? ` · ${savings.percent}% smaller` : ''}
              </p>
            ) : null}

            {output && !busy && output.targetBytes && !output.targetMet ? (
              <p className="mt-2 text-[12px] leading-5 text-warn">
                The target size was not reached after {formatCount(output.attempts, 'pass', 'passes')}.
                {output.unchanged
                  ? ' The original is already the smallest result.'
                  : ' The smallest smaller result is offered above.'}
              </p>
            ) : null}

            {dirty && output && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                The compression settings changed. Compress again to update the PDF.
              </p>
            ) : null}

            {output?.clamped && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                Some very large pages were capped by the browser canvas limit.
              </p>
            ) : null}
          </div>

          <div className="mt-5 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>
              The original file is unchanged. If no smaller file can be made, you get the original
              back untouched. Everything happens on this device.
            </p>
          </div>
        </>
      ) : null}
    </>
  );
}
