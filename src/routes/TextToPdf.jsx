import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { Field, SettingsGroup, SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { TEXT_ACCEPT, TEXT_MAX_CHARS } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { browserSupportsWorker } from '../lib/imageSupport';
import { PDF_MARGINS, PDF_PAGE_SIZES } from '../lib/pdfOptions';
import { readTextFile, textExtensionOf } from '../lib/textFile';
import { createPdfPool } from '../workers/pool';

const PAGE_SIZES = PDF_PAGE_SIZES.filter((size) => size.value !== 'match');
const TEXT_MARGINS = PDF_MARGINS.filter((margin) => margin.value !== 'none');
const DEFAULT_SETTINGS = Object.freeze({
  font: 'mono',
  fontSize: 11,
  lineNumbers: false,
  pageSize: 'a4',
  margin: 'normal',
  wrap: true,
});
const MODE_KEY = 'reformat-text-mode';
const COUNT_DELAY = 200;
const MODES = Object.freeze([
  { value: 'upload', label: 'Upload files' },
  { value: 'paste', label: 'Paste text' },
]);
const numberFormat = new Intl.NumberFormat('en-US');

function validateSettings(settings) {
  if (!['mono', 'sans'].includes(settings.font)) return 'Choose a font.';
  const size = Number(settings.fontSize);
  if (!Number.isFinite(size) || size < 7 || size > 24) {
    return 'Choose a font size from 7 to 24 pt.';
  }
  if (!PAGE_SIZES.some((page) => page.value === settings.pageSize)) {
    return 'Choose a page size.';
  }
  if (!TEXT_MARGINS.some((margin) => margin.value === settings.margin)) {
    return 'Choose a margin.';
  }
  return null;
}

function initialMode() {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (MODES.some((mode) => mode.value === saved)) return saved;
  } catch {
    return 'upload';
  }
  return 'upload';
}

function safePasteName(value) {
  const cleaned = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .replace(/\.pdf$/i, '')
    .slice(0, 80)
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return cleaned || 'pasted-text';
}

function countText(text) {
  const characters = text.length;
  const lines = characters === 0 ? 0 : text.replace(/\r\n?/g, '\n').split('\n').length;
  return { characters, lines };
}

function pasteCount(value, singular, plural = `${singular}s`) {
  return `${numberFormat.format(value)} ${value === 1 ? singular : plural}`;
}

function ModeTabs({ mode, onChange, disabled }) {
  const tabRefs = useRef([]);

  const choose = (index) => {
    const next = MODES[index];
    if (!next) return;
    onChange(next.value);
    window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };

  const handleKeyDown = (event, index) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % MODES.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + MODES.length) % MODES.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = MODES.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Input method"
      aria-orientation="horizontal"
      className="mb-5 flex gap-6 border-b border-line"
    >
      {MODES.map((item, index) => {
        const selected = mode === item.value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`text-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`text-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`-mb-px inline-flex min-h-10 items-center border-b-2 px-0.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function TextSettings({ settings, onChange, disabled, settingsError }) {
  const id = useId();
  const sizeId = `${id}-size`;
  const pageId = `${id}-page`;
  const marginId = `${id}-margin`;

  return (
    <SettingsPanel title="Text settings">
      <SettingsGroup title="Font">
        <div role="radiogroup" aria-label="Font" className="grid grid-cols-2 gap-1">
          {[
            { value: 'mono', label: 'IBM Plex Mono', hint: 'Code and tables' },
            { value: 'sans', label: 'IBM Plex Sans', hint: 'Prose and notes' },
          ].map((font) => (
            <label key={font.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-font`}
                value={font.value}
                checked={settings.font === font.value}
                disabled={disabled}
                onChange={() => onChange({ font: font.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-10">
                <span>{font.label}</span>
                <span className="text-[10px] font-normal text-ink-2">{font.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Font size" htmlFor={sizeId} hint="Measured in points.">
          <div className="relative w-28">
            <input
              id={sizeId}
              type="number"
              inputMode="numeric"
              min="7"
              max="24"
              step="1"
              value={settings.fontSize}
              disabled={disabled}
              onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
              className="control control-sm pr-8 font-mono"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-2">
              pt
            </span>
          </div>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Page size" htmlFor={pageId}>
            <select
              id={pageId}
              value={settings.pageSize}
              disabled={disabled}
              onChange={(event) => onChange({ pageSize: event.target.value })}
              className="control"
            >
              {PAGE_SIZES.map((page) => (
                <option key={page.value} value={page.value}>
                  {page.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Margins" htmlFor={marginId}>
            <select
              id={marginId}
              value={settings.margin}
              disabled={disabled}
              onChange={(event) => onChange({ margin: event.target.value })}
              className="control"
            >
              {TEXT_MARGINS.map((margin) => (
                <option key={margin.value} value={margin.value}>
                  {margin.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.lineNumbers}
            disabled={disabled}
            onChange={(event) => onChange({ lineNumbers: event.target.checked })}
            className="size-4 accent-ink"
          />
          Show line numbers
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.wrap}
            disabled={disabled}
            onChange={(event) => onChange({ wrap: event.target.checked })}
            className="size-4 accent-ink"
          />
          Wrap long lines
        </label>
        <p className="text-[12px] leading-4 text-ink-2">
          With wrapping off, lines are cut off with a visible … marker. Tabs become four spaces.
          Unsupported glyphs become a visible ?. A form feed starts a new page.
        </p>
      </SettingsGroup>

      <div className="py-4">
        <p className="text-[12px] leading-5 text-ink-2">
          Markdown and CSV are added as plain text, without formatting.
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

export default function TextToPdf() {
  const [mode, setMode] = useState(initialMode);
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsWorker());
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [pasteName, setPasteName] = useState('pasted-text');
  const [pasteStats, setPasteStats] = useState({
    characters: 0,
    lines: 0,
    pages: 0,
    replaced: 0,
  });
  const [clipboardMessage, setClipboardMessage] = useState('');
  const [clearPending, setClearPending] = useState(false);

  const poolRef = useRef(null);
  const textRef = useRef('');
  const textLoadedRef = useRef(false);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const tokenRef = useRef(0);
  const measureRef = useRef(0);
  const pastedRef = useRef(pastedText);
  const textareaRef = useRef(null);
  const { notify } = useToast();
  const pasteId = useId();
  const textareaId = `${pasteId}-text`;
  const nameId = `${pasteId}-name`;
  const limitId = `${pasteId}-limit`;
  const metaId = `${pasteId}-meta`;

  const settingsError = useMemo(() => validateSettings(settings), [settings]);
  const readied = Boolean(item?.status === 'ready' || item?.status === 'done');
  const pastedEmpty = pastedText.trim().length === 0;
  const overLimit = pastedText.length > TEXT_MAX_CHARS;
  const safeName = safePasteName(pasteName);
  const canReadClipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
  const showSettings = mode === 'upload' ? Boolean(item) : !pastedEmpty;
  const canCreate =
    mode === 'upload'
      ? readied
      : !pastedEmpty && !overLimit && Boolean(safeName);

  useEffect(() => {
    pastedRef.current = pastedText;
  }, [pastedText]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      return;
    }
  }, [mode]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      tokenRef.current += 1;
      measureRef.current += 1;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const resizePasteEditor = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const maxHeight = Math.max(240, Math.round(window.innerHeight * 0.6));
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 240), maxHeight)}px`;
  }, []);

  useEffect(() => {
    if (mode !== 'paste') return;
    const frame = window.requestAnimationFrame(resizePasteEditor);
    return () => window.cancelAnimationFrame(frame);
  }, [mode, pastedText, resizePasteEditor]);

  useEffect(() => {
    if (mode !== 'paste') return;
    const onResize = () => resizePasteEditor();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode, resizePasteEditor]);

  useEffect(() => {
    const sequence = ++measureRef.current;
    if (mode !== 'paste') return undefined;

    const timer = window.setTimeout(async () => {
      const counts = countText(pastedText);
      if (pastedEmpty) {
        setPasteStats({ ...counts, pages: 0, replaced: 0 });
        return;
      }
      if (overLimit || !workersSupported) {
        setPasteStats({ ...counts, pages: null, replaced: 0 });
        return;
      }

      setPasteStats({ ...counts, pages: null, replaced: 0 });
      try {
        const result = await getPool().run('measure-text-pdf', {
          text: pastedText,
          options: settings,
        });
        if (aliveRef.current && measureRef.current === sequence) {
          setPasteStats({
            ...counts,
            pages: result.pages,
            replaced: result.replaced,
          });
        }
      } catch {
        if (aliveRef.current && measureRef.current === sequence) {
          setPasteStats({ ...counts, pages: null, replaced: 0 });
        }
      }
    }, COUNT_DELAY);

    return () => window.clearTimeout(timer);
  }, [mode, pastedText, pastedEmpty, overLimit, settings, workersSupported, getPool]);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    textRef.current = '';
    textLoadedRef.current = false;
    setItem(null);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
    setPreparing(false);
  }, []);

  const invalidateOutput = useCallback(() => {
    setSummary('');
    if (output) setDirty(true);
  }, [output]);

  const selectMode = (next) => {
    if (busy || preparing || next === mode) return;
    setMode(next);
    setClipboardMessage('');
    setClearPending(false);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
  };

  const updatePastedText = useCallback(
    (next) => {
      setPastedText(next);
      setClearPending(false);
      setClipboardMessage('');
      setSummary('');
      if (!next.trim()) {
        setOutput(null);
        setDirty(false);
      } else if (output) {
        setDirty(true);
      }
    },
    [output],
  );

  const changePasteName = (value) => {
    setPasteName(value);
    invalidateOutput();
  };

  const confirmClear = () => {
    if (busy) return;
    updatePastedText('');
    setClearPending(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const requestClear = () => {
    if (busy) return;
    if (pastedText.length === 0) {
      setClearPending(false);
      return;
    }
    setClearPending(true);
  };

  const readClipboard = async () => {
    if (busy || !canReadClipboard) return;
    setClipboardMessage('');
    try {
      const clipboard = await navigator.clipboard.readText();
      if (!aliveRef.current) return;
      const current = pastedRef.current;
      const node = textareaRef.current;
      const start = Math.min(current.length, Math.max(0, node?.selectionStart ?? current.length));
      const end = Math.min(
        current.length,
        Math.max(start, node?.selectionEnd ?? current.length),
      );
      const next = `${current.slice(0, start)}${clipboard}${current.slice(end)}`;
      updatePastedText(next);
      const caret = start + clipboard.length;
      window.requestAnimationFrame(() => {
        const field = textareaRef.current;
        if (!field) return;
        field.focus();
        field.setSelectionRange(caret, caret);
      });
    } catch {
      if (aliveRef.current) {
        setClipboardMessage('Clipboard access was blocked. Paste with Ctrl+V instead.');
      }
    }
  };

  const addFile = useCallback(
    async (files) => {
      if (addingRef.current || busy || preparing) return;
      addingRef.current = true;
      try {
        const file = files?.[0];
        if (!file) return;

        const extension = textExtensionOf(file.name);
        if (!extension) {
          notify(
            'Choose a text, Markdown, CSV or source file (.txt, .md, .csv, .c, .py, .js, .json and similar).',
            'error',
          );
          return;
        }

        const { accepted, rejected } = checkBatchLimits([file], []);
        if (rejected.length) {
          rejected.forEach(({ reason }) => notify(reason, 'error'));
          return;
        }
        if (!accepted.length) return;

        reset();
        const token = tokenRef.current + 1;
        tokenRef.current = token;
        const nextItem = {
          id: makeId(),
          file,
          name: file.name,
          size: file.size,
          kind: 'text',
          typeLabel: extension.toUpperCase(),
          detail: '',
          status: 'working',
          statusText: 'Reading',
          error: null,
        };
        setItem(nextItem);
        setPreparing(true);

        try {
          const text = await readTextFile(file);
          if (!aliveRef.current || tokenRef.current !== token) return;
          textRef.current = text;
          textLoadedRef.current = true;
          const lines = text.length === 0 ? 1 : text.split(/\r\n?|\n/).length;
          setItem((current) =>
            current
              ? {
                  ...current,
                  lines,
                  detail: formatCount(lines, 'line'),
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
                  error: error?.message || 'This text file could not be read.',
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
    [busy, notify, preparing, reset],
  );

  const removeItem = () => {
    if (busy || preparing) {
      notify('Wait for the PDF to finish before removing the file.', 'warning');
      return;
    }
    reset();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateOutput();
  };

  const createPdf = async () => {
    if (busy || preparing || !workersSupported || !canCreate || settingsError) {
      if (settingsError) notify(settingsError, 'error');
      if (overLimit) notify(`Pasted text must be ${numberFormat.format(TEXT_MAX_CHARS)} characters or fewer.`, 'error');
      return;
    }
    if (mode === 'upload' && !textLoadedRef.current) {
      notify('The text file needs to be loaded again. Remove it and add it once more.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    setProgress({ label: 'Preparing text' });
    if (mode === 'upload') {
      setItem((current) =>
        current ? { ...current, status: 'working', statusText: 'Creating PDF' } : current,
      );
    }

    try {
      const isUpload = mode === 'upload';
      const source = isUpload ? textRef.current : pastedText;
      const title = isUpload ? baseNameOf(item.name) : safeName;
      const result = await getPool().run(
        'text-to-pdf',
        {
          text: source,
          options: settings,
          title,
        },
        {
          priority: 2,
          onProgress: (value) => {
            if (aliveRef.current) setProgress(value);
          },
        },
      );
      if (!aliveRef.current) return;

      const blob = new Blob([result.bytes], { type: 'application/pdf' });
      const name = `${title}.pdf`;
      setOutput({ blob, name, size: blob.size, pages: result.pages });
      setDirty(false);
      setSummary(
        `Created ${formatCount(result.pages, 'page')}.${
          result.replaced
            ? ` ${formatCount(result.replaced, 'unsupported character')} ${
                result.replaced === 1 ? 'was' : 'were'
              } shown as ?.`
            : ''
        }`,
      );
      if (isUpload) {
        setItem((current) =>
          current ? { ...current, status: 'done', statusText: 'Created' } : current,
        );
      }
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDF could not be created. Check the text and try again.');
      notify(error?.message || 'The PDF could not be created.', 'error');
      if (mode === 'upload') {
        setItem((current) =>
          current ? { ...current, status: 'ready', statusText: 'Ready' } : current,
        );
      }
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const liveMessage = preparing
    ? 'Reading text…'
    : busy && progress
      ? `${progress.label || 'Creating PDF'}…`
      : summary ||
        (mode === 'upload' && item?.status === 'error'
          ? 'This text file could not be read. Remove it and try another file.'
          : mode === 'paste' && pastedEmpty
            ? ''
            : mode === 'upload' && item
              ? `${formatCount(item.lines || 0, 'line')} ready.`
              : mode === 'paste' && !pastedEmpty
                ? 'Ready to create a PDF.'
                : '');

  const statsPageText =
    pasteStats.pages === null ? '— pages' : pasteCount(pasteStats.pages, 'page');

  return (
    <>
      <PageHeader
        title="Text to PDF"
        description="Upload text or source files, or paste text directly. Either becomes a clean, paginated PDF with embedded fonts."
      />

      <ModeTabs mode={mode} onChange={selectMode} disabled={busy || preparing} />

      <div
        id="text-panel-upload"
        role="tabpanel"
        aria-labelledby="text-tab-upload"
        hidden={mode !== 'upload'}
      >
        <DropZone
          title="Drop a text or source file here"
          description="TXT, MD, CSV, C, C++, Java, Python, JavaScript, JSON, MATLAB, Verilog, VHDL or assembly. One file, up to 40 MB."
          accept={TEXT_ACCEPT}
          multiple={false}
          disabled={busy || preparing || !workersSupported}
          onFiles={addFile}
          buttonLabel="Choose text file"
        />

        {item ? (
          <div className="mt-4">
            <FileQueue
              items={[item]}
              onRemove={removeItem}
              removeDisabled={busy || preparing}
              showOutput={false}
            />
          </div>
        ) : null}
      </div>

      <div
        id="text-panel-paste"
        role="tabpanel"
        aria-labelledby="text-tab-paste"
        hidden={mode !== 'paste'}
      >
        <Field label="Text content" htmlFor={textareaId}>
          <textarea
            ref={textareaRef}
            id={textareaId}
            value={pastedText}
            onChange={(event) => updatePastedText(event.target.value)}
            placeholder="Paste or type your text or code here."
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-describedby={`${metaId}${overLimit ? ` ${limitId}` : ''}`}
            aria-invalid={overLimit}
            className="block w-full resize-y overflow-y-auto whitespace-pre rounded-[6px] border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-5 text-ink transition-colors duration-150 placeholder:text-ink-2 focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              minHeight: '240px',
              maxHeight: '60vh',
              tabSize: 4,
              overflowX: 'auto',
            }}
          />
        </Field>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p id={metaId} className="min-w-0 font-mono text-[12px] text-ink-2">
            {pasteCount(pasteStats.characters, 'character')}
            <span aria-hidden="true"> · </span>
            {pasteCount(pasteStats.lines, 'line')}
            <span aria-hidden="true"> · </span>
            {statsPageText}
          </p>

          <div className="flex flex-wrap items-center gap-1">
            {clearPending ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[12px] text-ink-2">Clear text?</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={confirmClear}
                  disabled={busy}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setClearPending(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={requestClear}
                disabled={busy || pastedText.length === 0}
              >
                Clear
              </Button>
            )}
            {canReadClipboard ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={readClipboard}
                disabled={busy}
              >
                Paste from clipboard
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 w-full sm:max-w-[280px]">
          <Field
            label="File name"
            htmlFor={nameId}
            hint={`Optional. Saved as ${safeName}.pdf.`}
          >
            <input
              id={nameId}
              type="text"
              value={pasteName}
              onChange={(event) => changePasteName(event.target.value)}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
              className="control"
            />
          </Field>
        </div>

        {overLimit ? (
          <p id={limitId} className="mt-3 text-[12px] leading-4 text-err" role="alert">
            Pasted text is too long. Use {numberFormat.format(TEXT_MAX_CHARS)} characters or fewer.
          </p>
        ) : pastedEmpty ? (
          <p className="mt-3 text-[12px] leading-4 text-ink-2">
            Enter some text to enable conversion.
          </p>
        ) : null}

        {clipboardMessage ? (
          <p className="mt-2 text-[12px] leading-4 text-warn" role="status">
            {clipboardMessage}
          </p>
        ) : null}

        {pasteStats.replaced > 0 && !overLimit ? (
          <p className="mt-2 text-[12px] leading-4 text-ink-2" role="status">
            {pasteCount(pasteStats.replaced, 'unsupported character')} will be shown as ?.
          </p>
        ) : null}
      </div>

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF creation. Use a current version of Chrome,
          Edge, Firefox or Safari.
        </p>
      ) : null}

      {showSettings ? (
        <SettingsReveal show>
          <TextSettings
            settings={settings}
            onChange={changeSettings}
            disabled={busy || preparing}
            settingsError={settingsError}
          />
        </SettingsReveal>
      ) : null}

      {mode === 'upload' && !item ? null : (
        <div className="mt-6 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
              {liveMessage}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="md"
                variant={output ? (dirty ? 'primary' : 'secondary') : 'primary'}
                onClick={createPdf}
                disabled={
                  busy ||
                  preparing ||
                  !workersSupported ||
                  !canCreate ||
                  Boolean(settingsError)
                }
                title={settingsError || (overLimit ? 'Pasted text is too long.' : undefined)}
              >
                {busy ? 'Creating PDF…' : output ? 'Create again' : 'Create PDF'}
              </Button>
              {output ? (
                <Button
                  size="md"
                  variant={dirty ? 'secondary' : 'primary'}
                  onClick={() => downloadBlob(output.blob, output.name)}
                  disabled={busy || dirty}
                >
                  <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                  Download
                </Button>
              ) : null}
            </div>
          </div>

          {output && !busy ? (
            <p className="mt-2 text-[12px] text-ink-2">
              <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
              {formatCount(output.pages, 'page')} · {output.name}
            </p>
          ) : null}

          {dirty && output && !busy ? (
            <p className="mt-2 text-[12px] text-warn">
              Input or settings changed. Create the PDF again to replace the current download.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
        <p>
          IBM Plex Mono and IBM Plex Sans are embedded in the PDF. Markdown is treated as plain
          text. Everything happens on this device.
        </p>
      </div>
    </>
  );
}
