import { useId, useRef, useState } from 'react';
import { Button } from './Button';

export function DropZone({
  title,
  description,
  accept,
  multiple = true,
  onFiles,
  disabled = false,
  buttonLabel = 'Choose files',
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const descriptionId = useId();

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0 || disabled) return;
    onFiles(Array.from(fileList));
  };

  return (
    <div
      className={`rounded-[6px] border border-dashed p-4 transition-colors duration-150 sm:p-5 ${
        dragActive ? 'border-ink bg-[#f5f2ec]' : 'border-line-strong bg-transparent'
      } ${disabled ? 'opacity-60' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        handleFiles(event.dataTransfer?.files);
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">{title}</p>
          <p id={descriptionId} className="mt-0.5 max-w-[62ch] text-[12px] leading-5 text-ink-2">
            {description}
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
            {buttonLabel}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            aria-label={buttonLabel}
            aria-describedby={descriptionId}
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
