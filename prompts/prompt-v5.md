# Update Brief v5: Audio converter

Reformat is already built and live (React + Vite + Tailwind v4, deployed on Vercel, all processing in the browser). **Do not rewrite anything.** Add a new **Audio** section as described here. Keep every earlier rule: browser-only processing with no uploads and no `/api` routes, light and dark theme variables, no emojis, no purple or glow, no nested cards or heavy shadows, accent colors only for status, accessible, responsive down to 360px, heavy libraries lazy-loaded. Make sure `npm run build` passes before you finish.

## Goal

Let users convert audio files between popular formats **on their own device**, with no loss or the minimum possible loss of quality, and with honest guidance about what each format can and cannot preserve.

## 1. Navigation

- Add a third main tab named **Audio**. Final main tabs, in order: **Images**, **Audio**, **PDF**. The PDF sub-tool row still appears only on the PDF tab. Audio has no sub-tabs.
- Route: `/audio`. Keep the SPA fallback in `vercel.json` so refresh and deep links work.
- Same layout as the other tools: one centered column (max width about 880px), drop zone at the top, then the file list, then **settings directly below the file list and only after at least one file is added**, then the action area. No right-side panel.

## 2. Engine: FFmpeg compiled to WebAssembly

Use **ffmpeg.wasm** (`@ffmpeg/ffmpeg` and `@ffmpeg/util`, with the matching `@ffmpeg/core` package, 0.12.x line). It handles nearly every audio format and runs fully offline in the browser. Check the current official docs and package versions before coding, because the API changed between versions.

Requirements:
- **Single-threaded core only.** Do not use the multi-threaded core, because it needs `SharedArrayBuffer` and cross-origin isolation headers (COOP/COEP) that add risk for no real benefit at this scale.
- **Self-host the core files** (`ffmpeg-core.js` and `ffmpeg-core.wasm`) under the site's own origin (for example copy them from `node_modules/@ffmpeg/core/dist/esm` into `public/ffmpeg/` using a small `postinstall` or prebuild script, so they are not committed twice). **No CDN loading.** The privacy promise depends on this.
- **Lazy-load:** the Audio route code loads only when the tab is opened, and the FFmpeg core (about 30 MB raw, much smaller compressed) is downloaded only when the user starts the first conversion. Show clear loading text with progress: "Loading the audio engine. This happens once and is then cached." Never download it on the home page. The home route must stay under about 150 KB gzipped JS.
- Cache headers in `vercel.json` for `/ffmpeg/*`: `public, max-age=31536000, immutable`. Confirm the `.wasm` file is served with the `application/wasm` MIME type and is compressed (gzip or brotli) in production.
- Update the CSP minimally and test it: allow `'wasm-unsafe-eval'` in `script-src` (not `'unsafe-eval'`), `worker-src 'self' blob:`, `connect-src 'self' blob:`, `media-src 'self' blob:`. Do not add any external domains.
- Vite config: exclude `@ffmpeg/ffmpeg` and `@ffmpeg/util` from `optimizeDeps` and make sure the worker file is bundled and works in the production build, not only in `npm run dev`.
- Run **one FFmpeg instance and process files sequentially** (a queue), to keep memory under control. After each job, delete input and output files from the FFmpeg virtual filesystem to free memory.
- **Cancel button:** terminating the worker and recreating the instance on the next run is acceptable. Cancelling must leave the app usable.
- If WebAssembly is unavailable or the engine fails to load, show a clear error with a retry button. Do not leave the UI hanging.

## 3. Formats

Input (detect by magic bytes where practical, fall back to extension, and let FFmpeg be the final judge): MP3, WAV, FLAC, AAC, M4A (AAC and ALAC), OGG (Vorbis), Opus, WMA, AIFF, AMR (phone voice recordings), and 3GP. Also accept **audio from video files** (MP4, MKV, WebM, MOV): drop the video stream and keep the audio. Label this "Extract audio from video" in the hint text.

Output:

| Output | Type | Notes |
|---|---|---|
| WAV | Lossless, uncompressed | PCM 16-bit or 24-bit |
| FLAC | Lossless, compressed | Compression level 5 default |
| M4A (ALAC) | Lossless, compressed | Apple Lossless, if the encoder is available in the core build |
| MP3 | Lossy | libmp3lame, VBR or constant bitrate |
| M4A (AAC) | Lossy | FFmpeg's native `aac` encoder |
| OGG (Vorbis) | Lossy | libvorbis, quality scale |
| Opus | Lossy | libopus, bitrate |

Verify which encoders the shipped core actually includes (for example by running `-encoders` through the instance and reading the log) and **remove any output format that is not available** instead of showing a broken option. Do not add AIFF, WMA, or AC3 output.

## 4. Settings (shown below the file list after files are added)

Use a plain labeled form on a 2-column grid (1 column on mobile). Controls:

1. **Output format** (select).
2. **Quality preset** (segmented control, text only):
   - **Lossless**: only offered for WAV, FLAC and ALAC. No quality is lost compared with the decoded source.
   - **Highest quality**: MP3 VBR V0 (about 245 kbps), AAC 256 kbps, Vorbis quality 8, Opus 192 kbps.
   - **Balanced**: MP3 192 kbps, AAC 160 kbps, Vorbis quality 5, Opus 128 kbps.
   - **Small size**: MP3 128 kbps, AAC 96 kbps, Vorbis quality 3, Opus 64 kbps.
   - **Custom**: reveals a bitrate select (or quality slider for Vorbis) with the valid range for that codec.
   - Default preset: **Lossless** for lossless outputs, **Highest quality** for lossy outputs.
3. **Sample rate:** default **Keep original** (no resampling). Optional 44.1 kHz, 48 kHz, 96 kHz (lossless formats only).
4. **Channels:** default **Keep original**. Optional Mono, Stereo.
5. **Bit depth** (WAV and FLAC only): default **Keep original** (use the source depth, and for lossy sources use 16-bit), optional 16-bit or 24-bit.
6. **Keep tags and cover art** (checkbox, default on): copy title, artist, album, track, and embedded cover art where the target format supports it. If copying the cover art fails for a format, retry without it and show a small non-blocking note.
7. Show a short plain-language note under the settings that changes with the choice, for example:
   - Lossy source to lossless target: "Converting to a lossless format keeps the audio exactly as it is now, but it cannot restore detail that the lossy source already lost. The file will be larger."
   - Lossy source to a different lossy target: "Converting between lossy formats loses a little more quality each time. Use the original file if you have it, and choose the Highest quality preset."
   - Lossless source to lossy target: "Some detail is removed to make the file smaller."
   - Same source and target format: "The file is already in this format. Converting re-encodes it and may reduce quality." (Allow it, but warn.)
   - Sample rate or channel change: "Changing the sample rate or channels alters the audio data."

Defaults must never resample or downmix unless the user asks.

## 5. File list and results

- Each row: file name, detected type, size (IBM Plex Mono), duration when available (read it from the media element's metadata or from FFmpeg's log, show a dash if unknown), status, output size, and actions.
- Per-file progress from FFmpeg's `progress` event, with a determinate bar in ink color (status colors only for success and error). Show elapsed state in text: "Waiting", "Converting 42%", "Done", "Failed".
- Finished rows show an output **Preview** control using a native `<audio controls>` element (set `color-scheme` so it matches the theme) and a labeled **Download** button. The Download button is the shared `Button` component at the same size and style as "Download all as ZIP". If there is only one output, hide the ZIP button.
- Failed files show a specific message and do not block the rest of the batch.
- Output names: original base name plus the new extension, de-duplicated with `-1`, `-2`, sanitized for ZIP paths.
- Clear and Remove behave like the other tools. Revoke every object URL when it is no longer needed.

## 6. Limits and safety

- Put limits in `src/lib/config.js`: max 20 files per batch, max 200 MB per file and 600 MB total on desktop. On small devices (touch devices or `navigator.deviceMemory` of 4 or less), use 80 MB per file and 200 MB total. Show a clear message when a limit is hit, explaining the limit and suggesting a smaller file.
- FFmpeg.wasm has a memory ceiling (about 2 GB). Catch out-of-memory failures and show: "This file is too large for the browser to convert. Try a shorter file."
- Treat all input as untrusted. Never use the original file name inside FFmpeg command arguments. Write inputs under generated names like `in-<id>.<ext>` and build arguments from fixed, validated option values only (no string concatenation from user text).
- Keep the privacy statement true: audio is processed on the device, nothing is uploaded, and the audio engine is served from this site. Update the Privacy page to mention audio. Add an attribution line in the README and the Privacy page: "Audio conversion uses FFmpeg (LGPL), compiled to WebAssembly."

## 7. UI details

- Drop zone hint, plain text: "Drop audio files here, or choose files. MP3, WAV, FLAC, M4A, AAC, OGG, Opus, WMA, AIFF, AMR. Video files (MP4, MKV, WebM, MOV) work too and give you the audio."
- Match the existing design system exactly (tokens, fonts, hairline dividers, compact type, both themes). Do not add waveforms, equalizer graphics, headphone icons, or decorative visuals. Text first; the only icons are the small functional ones used elsewhere.
- Loading state for the engine, and an "offline" friendly message if the first-time engine download fails.
- Respect `prefers-reduced-motion`. Add `aria-live` status updates for progress and completion.

## 8. Verification (report results)

1. Convert and compare: 5-minute MP3 to FLAC; FLAC to MP3 at the Highest quality preset; WAV to M4A (AAC); M4A to OGG; Opus to WAV; an iPhone voice memo (M4A) to MP3; a short MP4 to MP3 (audio extraction); an AMR file to WAV.
2. **Lossless integrity test:** WAV to FLAC and back to WAV, then compare the PCM data (hash) with the original. They must match exactly. Do this once for 16-bit and once for 24-bit.
3. Confirm that duration, sample rate and channel count are unchanged with default settings, and that tags and cover art survive MP3 to M4A.
4. Test a corrupt file renamed to `.mp3`, a file over the limit, cancelling mid-conversion, and a batch of 10 files with one bad file.
5. Check both themes, 360px and 1280px, keyboard only, and the production build on a real phone.
6. Check the Network tab in production: no external requests, the engine files come from this origin with long cache headers, and the home route bundle is still under about 150 KB gzipped.
7. Remove any output format that failed testing and tell me which.

## Acceptance checklist

- [ ] Header shows Images, Audio, PDF; Audio has its own route and no sub-tabs
- [ ] FFmpeg core is self-hosted, lazy-loaded, single-threaded, and cached; no CDN
- [ ] Output formats offered: WAV, FLAC, ALAC if available, MP3, AAC, OGG Vorbis, Opus
- [ ] Lossless preset exists for lossless outputs; defaults never resample or downmix
- [ ] Settings appear below the file list only after files are added, never at the side
- [ ] Honest quality notes for lossy and lossless combinations
- [ ] Per-file progress, cancel, preview, labeled Download button matching the ZIP button
- [ ] WAV to FLAC to WAV round trip is bit-identical
- [ ] Limits, error handling, and memory cleanup in place; privacy and attribution text updated
- [ ] Works in light and dark themes, at 360px, with keyboard; builds clean and is deployed

When finished, give me a short summary of what changed, which formats work, and what you tested.
