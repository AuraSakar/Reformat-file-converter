import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Download, RotateCw, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button, IconButton } from '../components/Button';
import { useToast } from '../components/Toasts';
import { PDF_ACCEPT } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { browserSupportsPdfRendering } from '../lib/imageSupport';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

function SortablePage({ page, position, disabled, onRotate, onDelete, canDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-[5px] border bg-surface ${
        isDragging ? 'z-10 opacity-60' : ''
      } border-line-strong`}
    >
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder page ${page.page}. Press Space, then use the arrow keys.`}
        className="relative block aspect-square w-full cursor-grab touch-none overflow-hidden bg-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      >
        <img
          src={page.url}
          alt=""
          className="size-full object-contain transition-transform duration-150"
          style={page.rotation ? { transform: `rotate(${page.rotation}deg)` } : undefined}
          loading="lazy"
          decoding="async"
        />
        <span className="mono absolute left-1.5 top-1.5 inline-flex min-w-5 items-center justify-center rounded-[3px] bg-ink px-1 py-0.5 text-[10px] leading-4 text-white">
          {position}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 border-t border-line px-1.5 py-0.5">
        <span className="min-w-0 text-[11px] text-ink-2">
          <span className="mono block truncate">P. {page.page}</span>
          {page.rotation ? (
            <span className="mono block text-[10px] text-ink-2">{page.rotation}°</span>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Rotate page ${page.page}`}
            onClick={() => onRotate(page.id)}
            disabled={disabled}
            className="sm:size-9"
          >
            <RotateCw size={15} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Delete page ${page.page}`}
            tone="danger"
            onClick={() => onDelete(page.id)}
            disabled={disabled || !canDelete}
            title={!canDelete ? 'Keep at least one page.' : undefined}
          >
            <Trash2 size={15} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

export default function OrganizePdf() {
  const [item, setItem] = useState(null);
  const [pages, setPages] = useState([]);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsPdfRendering());
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const bytesRef = useRef(null);
  const thumbUrlsRef = useRef(new Set());
  const tokenRef = useRef(0);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const { notify } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const readied = Boolean(item?.status === 'ready' || item?.status === 'done');

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      tokenRef.current += 1;
      poolRef.current?.destroy();
      poolRef.current = null;
      for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url);
      thumbUrlsRef.current.clear();
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url);
    thumbUrlsRef.current.clear();
    bytesRef.current = null;
    setItem(null);
    setPages([]);
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
        setItem({
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
          statusText: 'Opening',
          error: null,
        });
        setPreparing(true);
        setProgress({ label: 'Opening PDF' });

        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!aliveRef.current || tokenRef.current !== token) return;
          bytesRef.current = bytes;
          const result = await getPool().run(
            'split-prepare',
            { bytes },
            {
              priority: 2,
              onProgress: (value) => {
                if (aliveRef.current && tokenRef.current === token) setProgress(value);
              },
            },
          );
          if (!aliveRef.current || tokenRef.current !== token) return;

          const nextPages = result.thumbs.map((thumb) => {
            const url = URL.createObjectURL(thumb.blob);
            thumbUrlsRef.current.add(url);
            return {
              id: makeId(),
              page: thumb.page,
              rotation: 0,
              url,
            };
          });
          if (nextPages.length === 0) throw new Error('This PDF has no pages.');
          setPages(nextPages);
          setItem((current) =>
            current
              ? {
                  ...current,
                  pages: nextPages.length,
                  detail: formatCount(nextPages.length, 'page'),
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
                  error: error?.message || 'This PDF could not be opened.',
                }
              : current,
          );
        } finally {
          if (aliveRef.current && tokenRef.current === token) {
            setPreparing(false);
            setProgress(null);
          }
        }
      } finally {
        addingRef.current = false;
      }
    },
    [busy, getPool, notify, preparing, reset],
  );

  const removeItem = () => {
    if (busy || preparing) {
      notify('Wait for the PDF to finish before removing it.', 'warning');
      return;
    }
    reset();
  };

  const rotatePage = (id) => {
    if (busy || preparing) return;
    setPages((current) =>
      current.map((page) =>
        page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page,
      ),
    );
    invalidateOutput();
  };

  const deletePage = (id) => {
    if (busy || preparing) return;
    setPages((current) => {
      if (current.length <= 1) return current;
      return current.filter((page) => page.id !== id);
    });
    invalidateOutput();
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || busy || preparing) return;
    setPages((current) => {
      const oldIndex = current.findIndex((page) => page.id === active.id);
      const newIndex = current.findIndex((page) => page.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
    invalidateOutput();
  };

  const savePdf = async () => {
    if (busy || preparing || !readied || pages.length === 0) return;
    if (!bytesRef.current) {
      notify('The PDF needs to be loaded again. Remove it and add it once more.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    setProgress({ label: 'Saving PDF' });
    try {
      const base = baseNameOf(item.name);
      const result = await getPool().run(
        'organize',
        {
          bytes: new Uint8Array(bytesRef.current),
          order: pages.map((page) => ({ page: page.page, rotation: page.rotation })),
          title: `${base} organized`,
        },
        { priority: 2 },
      );
      if (!aliveRef.current) return;
      setOutput({
        blob: result.blob,
        name: `${base}-organized.pdf`,
        size: result.blob.size,
        pages: result.pages,
      });
      setSummary(`Saved a new PDF with ${formatCount(result.pages, 'page')}.`);
      setDirty(false);
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The organized PDF could not be saved. Try again.');
      notify(error?.message || 'The PDF could not be saved.', 'error');
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const liveMessage = preparing
    ? 'Rendering page previews…'
    : busy
      ? 'Saving PDF…'
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be opened. Remove it and try another file.'
          : pages.length > 0
            ? `${formatCount(pages.length, 'page')} ready. Drag a preview to reorder.`
            : '');

  return (
    <>
      <PageHeader
        title="Organize pages"
        description="Reorder, rotate and remove PDF pages, then save a new copy. The original file stays untouched."
      />
      <DropZone
        title="Drop a PDF here"
        description="PDF files only. One file at a time, up to 40 MB. Page previews load on this device."
        accept={PDF_ACCEPT}
        multiple={false}
        disabled={busy || preparing || !workersSupported}
        onFiles={addFile}
        buttonLabel="Choose PDF"
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF processing. Use a current version of
          Chrome, Edge, Firefox or Safari to organize PDFs.
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

          {pages.length > 0 ? (
            <section className="mt-5" aria-labelledby="organize-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="organize-heading" className="text-[15px] font-semibold text-ink">
                    Pages
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-2">
                    Drag a preview to reorder. Rotate or delete with the buttons below each page.
                  </p>
                </div>
                <p className="mono text-[12px] text-ink-2">{formatCount(pages.length, 'page')}</p>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={pages.map((page) => page.id)}
                  strategy={rectSortingStrategy}
                >
                  <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
                    {pages.map((page, index) => (
                      <SortablePage
                        key={page.id}
                        page={page}
                        position={index + 1}
                        disabled={busy || preparing}
                        canDelete={pages.length > 1}
                        onRotate={rotatePage}
                        onDelete={deletePage}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
          ) : null}

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
                      onClick={savePdf}
                      disabled={busy || preparing || pages.length === 0}
                    >
                      {busy ? 'Saving…' : 'Save again'}
                    </Button>
                    <Button
                      size="md"
                      variant={dirty ? 'secondary' : 'primary'}
                      onClick={() => downloadBlob(output.blob, output.name)}
                      disabled={busy}
                    >
                      <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                      Download
                    </Button>
                  </>
                ) : (
                  <Button
                    size="md"
                    onClick={savePdf}
                    disabled={
                      busy ||
                      preparing ||
                      !workersSupported ||
                      !readied ||
                      pages.length === 0
                    }
                  >
                    {busy ? 'Saving…' : 'Save PDF'}
                  </Button>
                )}
              </div>
            </div>

            {preparing && progress?.total ? (
              <div className="mt-2" aria-hidden="true">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-ink transition-[width] duration-150"
                    style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}

            {output && !busy ? (
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
                {formatCount(output.pages, 'page')} · {output.name}
              </p>
            ) : null}

            {dirty && output && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                Page order, rotation or count changed. Save again to update the download.
              </p>
            ) : null}
          </div>

          <div className="mt-5 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>
              The saved PDF keeps the pages you leave in the order shown. Everything happens on
              this device.
            </p>
          </div>
        </>
      ) : null}
    </>
  );
}
