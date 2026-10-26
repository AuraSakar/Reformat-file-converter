import { useId } from 'react';
import {
  AUDIO_OUTPUT_FORMATS,
  AUDIO_PRESETS,
  audioFormatChangePatch,
  audioQualityNote,
  customRangeFor,
  qualityValueLabel,
  sampleRateOptionsFor,
} from '../lib/audioFormats';
import { Field, SettingsGroup, SettingsPanel } from './SettingsPanel';

export function AudioSettings({
  settings,
  onChange,
  formats = AUDIO_OUTPUT_FORMATS,
  disabled = false,
  settingsError,
  sourceLossless = null,
  sameFormat = false,
}) {
  const id = useId();
  const output = formats.find((format) => format.id === settings.format) ?? formats[0];
  const range = customRangeFor(output?.id);
  const rateOptions = sampleRateOptionsFor(output);
  const presets = output?.lossless
    ? AUDIO_PRESETS.filter((preset) => preset.id === 'lossless')
    : AUDIO_PRESETS.filter((preset) => preset.id !== 'lossless');
  const presetId = `${id}-preset`;
  const customId = `${id}-custom`;
  const sampleRateId = `${id}-sample-rate`;
  const channelsId = `${id}-channels`;
  const bitDepthId = `${id}-bit-depth`;
  const tagsHintId = `${id}-tags-hint`;

  if (!output) return null;

  const set = (patch) => onChange(patch);
  const chooseFormat = (next) => onChange(audioFormatChangePatch(settings, next));

  return (
    <SettingsPanel title="Audio settings">
      <SettingsGroup title="Output">
        <div role="radiogroup" aria-label="Output format" className="grid grid-cols-2 gap-1">
          {formats.map((format) => (
            <label key={format.id} className="min-w-0">
              <input
                type="radio"
                name={`${id}-format`}
                value={format.id}
                checked={settings.format === format.id}
                disabled={disabled}
                onChange={() => chooseFormat(format)}
                className="peer sr-only"
              />
              <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-9">
                {format.label}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-ink-2">Quality</span>
            <span className="mono text-[12px] text-ink-2">
              {qualityValueLabel(settings, output)}
            </span>
          </div>
          <div role="radiogroup" aria-label="Quality preset" className="grid grid-cols-2 gap-1">
            {presets.map((preset) => (
              <label key={preset.id} className="min-w-0">
                <input
                  id={preset.id === 'custom' ? customId : undefined}
                  type="radio"
                  name={presetId}
                  value={preset.id}
                  checked={settings.preset === preset.id}
                  disabled={disabled}
                  onChange={() => set({ preset: preset.id })}
                  className="peer sr-only"
                />
                <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-9">
                  {preset.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {!output.lossless && settings.preset === 'custom' && range ? (
          <div className="mt-1">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label className="text-[12px] font-medium text-ink-2" htmlFor={`${id}-custom-value`}>
                {range.label}
              </label>
              <span className="mono text-[12px] text-ink-2">
                {settings.customValue}
                {range.unit ? ` ${range.unit}` : ''}
              </span>
            </div>
            <input
              id={`${id}-custom-value`}
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={settings.customValue}
              disabled={disabled}
              onChange={(event) => set({ customValue: Number(event.target.value) })}
              className="h-10 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 sm:h-8"
            />
          </div>
        ) : null}

        <p className="mt-3 text-[12px] leading-4 text-ink-2" aria-live="polite">
          {audioQualityNote(settings, output, sourceLossless, sameFormat)}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Audio">
        {rateOptions.length > 1 ? (
          <Field label="Sample rate" htmlFor={sampleRateId}>
            <select
              id={sampleRateId}
              value={settings.sampleRate}
              disabled={disabled}
              onChange={(event) => set({ sampleRate: event.target.value })}
              className="control"
            >
              {rateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field
          label="Channels"
          htmlFor={channelsId}
          hint="Downmixing to mono or stereo cannot be undone."
        >
          <select
            id={channelsId}
            value={settings.channels}
            disabled={disabled}
            onChange={(event) => set({ channels: event.target.value })}
            className="control"
          >
            <option value="keep">Keep original</option>
            <option value="stereo">Stereo</option>
            <option value="mono">Mono</option>
          </select>
        </Field>

        {output.bitDepths.length > 0 ? (
          <Field
            label="Bit depth"
            htmlFor={bitDepthId}
            hint="Keeps the source depth for lossless input and uses 16-bit for compressed input."
          >
            <select
              id={bitDepthId}
              value={settings.bitDepth}
              disabled={disabled}
              onChange={(event) => set({ bitDepth: event.target.value })}
              className="control"
            >
              <option value="auto">Keep original</option>
              <option value="16">16-bit</option>
              <option value="24">24-bit</option>
            </select>
          </Field>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Metadata" className="sm:col-span-2">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.keepTags}
            disabled={disabled}
            aria-describedby={tagsHintId}
            onChange={(event) => set({ keepTags: event.target.checked })}
            className="size-4 accent-ink"
          />
          Keep tags and cover art when possible
        </label>
        <p id={tagsHintId} className="text-[12px] leading-4 text-ink-2">
          {output.supportsCover
            ? 'Text tags are copied when the source and output support them. Cover art is attempted and the file still saves without it if the format refuses it.'
            : `${output.label} can keep text tags but not cover art.`}
        </p>
      </SettingsGroup>

      <div className="py-4 sm:col-span-2">
        {settingsError ? (
          <p className="text-[12px] leading-4 text-err" role="alert">
            {settingsError}
          </p>
        ) : (
          <p className="text-[12px] leading-5 text-ink-2">
            Conversion happens on this device. Lossless output avoids another lossy step;
            compressed output cannot restore detail already missing from the source.
          </p>
        )}
      </div>
    </SettingsPanel>
  );
}
