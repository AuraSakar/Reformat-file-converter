import { Download, X } from 'lucide-react';
import { Button, IconButton } from './Button';
import { formatBytes } from '../lib/format';
import { formatDuration } from '../lib/audioFormats';

const STATUS_TEXT = {
  ready: 'Waiting',
  working: 'Converting 0%',
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
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] ${STATUS_COLOR[status]}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="truncate" title={item.statusText || STATUS_TEXT[status]}>
        {item.statusText || STATUS_TEXT[status]}
      </span>
    </span>
  );
}

export function AudioQueue({ items, onRemove, onDownload, removeDisabled = false }) {
  if (items.length === 0) return null;

  return (
    <ul className="mt-4 border-t border-line">
      {items.map((item) => {
        const status = item.status in STATUS_TEXT ? item.status : 'ready';
        const outputSize = item.output?.size ? formatBytes(item.output.size) : '';
        const progress = Number.isFinite(item.progress) ? item.progress : 0;

        return (
          <li
            key={item.id}
            className="border-b border-line py-3 transition-colors duration-150 hover:bg-hover-subtle"
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink" title={item.name}>
                  {item.name}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-ink-2">
                  <span>{item.typeLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{formatDuration(item.duration)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{formatBytes(item.size)}</span>
                  {outputSize ? (
                    <>
                      <span aria-hidden="true">→</span>
                      <span className="mono text-ok">{outputSize}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  <Status item={item} />
                </div>

                {item.error ? (
                  <p className="mt-1 max-w-[70ch] text-[12px] leading-4 text-err">{item.error}</p>
                ) : item.output?.note ? (
                  <p className="mt-1 max-w-[70ch] text-[11px] leading-4 text-ink-2">
                    {item.output.note}
                  </p>
                ) : null}

                {status === 'working' ? (
                  <div
                    className="mt-2 h-1 w-full max-w-[360px] overflow-hidden rounded-full bg-surface-muted"
                    role="progressbar"
                    aria-label={`Converting ${item.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress)}
                  >
                    <div
                      className="h-full bg-info transition-[width] duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                ) : null}

                {item.output?.url ? (
                  <audio
                    className="mt-2 h-9 w-full max-w-[360px]"
                    controls
                    preload="metadata"
                    src={item.output.url}
                    aria-label={`Preview ${item.output.name}`}
                  />
                ) : item.previewable && item.previewUrl ? (
                  <audio
                    className="mt-2 h-9 w-full max-w-[360px]"
                    controls
                    preload="metadata"
                    src={item.previewUrl}
                    aria-label={`Preview ${item.name}`}
                  />
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {item.output?.blob ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => onDownload(item)}
                    aria-label={`Download ${item.output.name}`}
                  >
                    <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                ) : null}
                <IconButton
                  label={`Remove ${item.name}`}
                  tone="danger"
                  onClick={() => onRemove(item)}
                  disabled={removeDisabled || item.status === 'working'}
                >
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
