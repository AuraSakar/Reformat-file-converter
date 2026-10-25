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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Download, GripVertical, X } from 'lucide-react';
import { IconButton } from './Button';
import { formatBytes } from '../lib/format';

const STATUS_TEXT = {
  ready: 'Ready',
  working: 'Working',
  done: 'Done',
  error: 'Failed',
};

const STATUS_COLOR = {
  ready: 'text-ink-2',
  working: 'text-info',
  done: 'text-ok',
  error: 'text-err',
};

function Status({ item }) {
  const status = item.status in STATUS_TEXT ? item.status : 'ready';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${STATUS_COLOR[status]}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="truncate" title={item.statusText || STATUS_TEXT[status]}>
        {item.statusText || STATUS_TEXT[status]}
      </span>
    </span>
  );
}

function Thumb({ item }) {
  return (
    <div className="size-10 overflow-hidden rounded-[4px] border border-line bg-surface">
      {item.thumbUrl ? (
        <img
          src={item.thumbUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="flex size-full items-center justify-center font-mono text-[9px] uppercase text-ink-2">
          {item.typeLabel || 'file'}
        </span>
      )}
    </div>
  );
}

function RowContent({ item, onRemove, onDownload, renderActions, removeDisabled }) {
  const status = item.status in STATUS_TEXT ? item.status : 'ready';
  const showDownload = Boolean(onDownload) && status === 'done' && item.output?.blob;
  const outputSize = item.output?.size ? formatBytes(item.output.size) : '';

  return (
    <>
      <Thumb item={item} />

      <div className="min-w-0 self-center">
        <p className="truncate text-[13px] font-medium text-ink" title={item.name}>
          {item.name}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-ink-2 md:hidden">
          <span className={STATUS_COLOR[status]}>{item.statusText || STATUS_TEXT[status]}</span>
          <span aria-hidden="true"> · </span>
          <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
          {outputSize ? (
            <>
              <span aria-hidden="true"> → </span>
              <span className="font-mono tabular-nums text-ok">{outputSize}</span>
            </>
          ) : null}
        </p>
        {item.error ? (
          <p className="mt-1 max-w-[70ch] text-[12px] leading-4 text-err">{item.error}</p>
        ) : null}
      </div>

      <div className="hidden self-center text-[12px] text-ink-2 md:block">{item.typeLabel}</div>
      <div className="mono hidden self-center text-right text-[12px] text-ink-2 md:block">
        {formatBytes(item.size)}
      </div>
      <div className="hidden min-w-0 self-center md:flex">
        <Status item={item} />
      </div>
      <div
        className="mono hidden self-center text-right text-[12px] text-ink-2 md:block"
        title={item.output?.note || ''}
      >
        {outputSize || ''}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-0.5 self-center">
        {renderActions ? renderActions(item) : null}
        {showDownload ? (
          <IconButton label={`Download ${item.output.name}`} onClick={() => onDownload(item)}>
            <Download size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        ) : null}
        {onRemove ? (
          <IconButton
            label={`Remove ${item.name}`}
            tone="danger"
            onClick={() => onRemove(item)}
            disabled={removeDisabled || item.status === 'working'}
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </>
  );
}

function SortableFileRow({ item, gridClass, onRemove, onDownload, renderActions, removeDisabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${gridClass} border-b border-line py-2.5 transition-colors duration-150 hover:bg-black/[0.015] ${
        isDragging ? 'relative z-10 bg-surface opacity-70' : ''
      }`}
    >
      <div className="flex items-center justify-center self-center">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="inline-flex size-8 cursor-grab items-center justify-center rounded-[4px] text-ink-2 hover:bg-black/[0.04] hover:text-ink active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          aria-label={`Reorder ${item.name}. Press Space, then use the arrow keys.`}
          title="Drag to reorder, or press Space and use arrow keys"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <RowContent
        item={item}
        onRemove={onRemove}
        onDownload={onDownload}
        renderActions={renderActions}
        removeDisabled={removeDisabled}
      />
    </li>
  );
}

function PlainFileRow({ item, gridClass, onRemove, onDownload, renderActions, removeDisabled }) {
  return (
    <li
      className={`${gridClass} border-b border-line py-2.5 transition-colors duration-150 hover:bg-black/[0.015]`}
    >
      <RowContent
        item={item}
        onRemove={onRemove}
        onDownload={onDownload}
        renderActions={renderActions}
        removeDisabled={removeDisabled}
      />
    </li>
  );
}

export function FileQueue({
  items,
  onRemove,
  onDownload,
  onReorder,
  reorderable = false,
  renderActions,
  removeDisabled = false,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (items.length === 0) return null;

  const gridClass = reorderable
    ? 'grid grid-cols-[30px_40px_minmax(0,1fr)_auto] items-start gap-x-2 md:grid-cols-[30px_40px_minmax(0,1fr)_58px_78px_112px_78px_auto] md:gap-x-3'
    : 'grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-x-2 md:grid-cols-[40px_minmax(0,1fr)_58px_78px_112px_78px_auto] md:gap-x-3';

  const header = (
    <div
      className={`${gridClass} border-y border-line py-1.5 text-[11px] font-medium text-ink-2`}
      aria-hidden="true"
    >
      {reorderable ? <div /> : null}
      <div />
      <div>File</div>
      <div className="hidden md:block">Type</div>
      <div className="hidden text-right md:block">Size</div>
      <div className="hidden md:block">Status</div>
      <div className="hidden text-right md:block">Output</div>
      <div />
    </div>
  );

  if (!reorderable) {
    return (
      <div>
        <div className="hidden md:block">{header}</div>
        <ul className="border-t border-line md:border-t-0">
          {items.map((item) => (
            <PlainFileRow
              key={item.id}
              item={item}
              gridClass={gridClass}
              onRemove={onRemove}
              onDownload={onDownload}
              renderActions={renderActions}
              removeDisabled={removeDisabled}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const ids = items.map((item) => item.id);
        const oldIndex = ids.indexOf(active.id);
        const newIndex = ids.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        onReorder?.(arrayMove(ids, oldIndex, newIndex));
      }}
    >
      <div>
        <div className="hidden md:block">{header}</div>
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="border-t border-line md:border-t-0">
            {items.map((item) => (
              <SortableFileRow
                key={item.id}
                item={item}
                gridClass={gridClass}
                onRemove={onRemove}
                onDownload={onDownload}
                renderActions={renderActions}
                removeDisabled={removeDisabled}
              />
            ))}
          </ul>
        </SortableContext>
      </div>
    </DndContext>
  );
}
