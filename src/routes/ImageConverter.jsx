import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { IMAGE_ACCEPT, INPUT_FORMATS } from '../lib/config';
import { checkBatchLimits, makeId } from '../lib/files';
import { sniffFile } from '../lib/sniff';

export default function ImageConverter() {
  const [items, setItems] = useState([]);
  const [checking, setChecking] = useState(false);
  const urls = useRef(new Set());
  const { notify } = useToast();

  useEffect(() => {
    const created = urls.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  const addFiles = useCallback(
    async (files) => {
      const { accepted, rejected } = checkBatchLimits(files, items);
      rejected.forEach(({ reason }) => notify(reason, 'error'));
      if (accepted.length === 0) return;

      setChecking(true);
      const additions = [];
      for (const file of accepted) {
        const sniffed = await sniffFile(file);
        let thumbUrl = null;
        if (sniffed.isImage && sniffed.kind !== 'heic') {
          thumbUrl = URL.createObjectURL(file);
          urls.current.add(thumbUrl);
        }
        additions.push({
          id: makeId(),
          file,
          name: file.name,
          size: file.size,
          typeLabel: sniffed.label,
          kind: sniffed.kind,
          status: sniffed.kind === 'unsupported' ? 'error' : 'ready',
          error: sniffed.message,
          thumbUrl,
        });
      }
      setChecking(false);
      setItems((current) => [...current, ...additions]);
    },
    [items, notify],
  );

  const removeItem = (item) => {
    if (item.thumbUrl) {
      URL.revokeObjectURL(item.thumbUrl);
      urls.current.delete(item.thumbUrl);
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };

  const readyCount = items.filter((item) => item.status === 'ready').length;

  return (
    <>
      <PageHeader
        title="Images"
        description="Convert phone photos and scans to JPG, PNG or WebP. Set a target file size for upload limits."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10">
        <div className="min-w-0">
          <DropZone
            title="Drop images here"
            description={`${INPUT_FORMATS}. Up to 50 files, 40 MB each. Output JPG, PNG or WebP.`}
            accept={IMAGE_ACCEPT}
            disabled={checking}
            onFiles={addFiles}
          />
          <div className="mt-3 flex min-h-5 items-center justify-between gap-3 text-[12px] text-ink-2" aria-live="polite">
            <p>
              {items.length > 0
                ? `${items.length} ${items.length === 1 ? 'file' : 'files'} in this batch${readyCount !== items.length ? `, ${readyCount} ready` : ''}.`
                : ''}
            </p>
          </div>
          <FileQueue items={items} onRemove={removeItem} />
        </div>

        <SettingsPanel title="Conversion settings">
          <p className="py-4 text-[12px] leading-5 text-ink-2">
            Output format, quality, resize, rotation and target-size controls are wired to the
            conversion engine in the next build phase.
          </p>
        </SettingsPanel>
      </div>
    </>
  );
}
