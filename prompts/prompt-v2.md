# Update Brief v2: Reformat (existing app)

The app **Reformat** is already built and live at https://reformat-file-converter.vercel.app (React + Vite + Tailwind v4, browser-only processing in Web Workers, hosted on Vercel). **Do not rewrite it from scratch.** Modify the existing codebase. Read the current code first, then make the changes below in the order given. Commit after each numbered task and make sure `npm run build` passes.

All rules from the original brief still apply unless this document overrides them: browser-only processing, no `/api` routes, no uploads, lazy-loaded heavy libraries, no purple/glow/glassmorphism, no emojis, no AI-tell icons, no stock art, no fake metrics, no nested cards or heavy shadows, accent colors only for status, accessible and responsive down to 360px.

## Task 1. Navigation: only two top-level tabs

Replace the six top tabs with exactly **two**: **Images** and **PDF**.

- The tab bar sits in the header, left side under or beside the wordmark; the theme switch (Task 8) sits at the far right.
- Selecting **Images** opens the image converter (current behavior).
- Selecting **PDF** opens the PDF workspace. Only then, a secondary row of text tabs appears directly below the main tab bar, containing the PDF tools:
  1. Images to PDF
  2. Text to PDF
  3. Merge
  4. Split / Extract
  5. Organize pages (reorder, rotate, delete)
  6. PDF to Images
  7. Compress
- The secondary row must not appear on the Images tab. On mobile it scrolls horizontally without a visible scrollbar clutter, with the active item kept in view.
- Use real routes: `/images` and `/pdf/<tool>` (for example `/pdf/merge`). `/` redirects to `/images`. `/pdf` redirects to `/pdf/images-to-pdf`. Keep the SPA fallback in `vercel.json` so refreshes and deep links work.
- Active states are shown with an underline or weight change in ink color, not with colored fills.

## Task 2. Title / wordmark

- Change the wordmark "Reformat" to a distinctive editorial serif. Use **Instrument Serif** (self-hosted via `@fontsource/instrument-serif`). If it does not look right, use **Fraunces** instead (variable, `@fontsource-variable/fraunces`).
- Increase the size to about **30px on desktop and 26px on mobile**, normal weight, slightly tight letter-spacing (-0.01em). This intentionally overrides the earlier "title at most 20px" rule for the wordmark only. Everything else keeps the compact scale.
- Keep it as plain text with no logo icon. Keep IBM Plex Sans for the UI and IBM Plex Mono for numbers.
- Add a one-line descriptor under or beside it in small secondary text (for example "Convert images and PDFs on your device"), only if it fits cleanly on mobile.

## Task 3. Layout: single centered column, settings below the drop zone

Remove the right-hand settings panel completely. New layout, used by the Images tool and every PDF tool:

1. Centered column, `max-w` about 880px, with explicit horizontal padding and vertical gaps.
2. **Drop zone / file selection area** at the top.
3. **Settings appear only after at least one file has been added.** Before that, nothing but the drop zone and a short formats hint is shown. When files exist, render in this order, all in the same centered column:
   - File list
   - **Conversion settings, directly below the file list/selection area** (not at the side)
   - Action bar with the primary Convert / Build button and results
4. Settings are a plain labeled form (a 2-column grid on desktop, 1 column on mobile), separated by whitespace and hairline dividers. No card, no shadow.
5. When all files are removed or the user presses Clear, the settings disappear again.
6. Use smooth but minimal reveal (max 160ms fade or height transition, respecting `prefers-reduced-motion`).

## Task 4. Download buttons: make the per-file download obvious

Current problem: the per-file download is a tiny icon that is hard to find.

- Per-file download becomes a **proper labeled button reading "Download"**, with a small download icon on the left, **the same height, font size, padding and style as the "Download ZIP" button**. Minimum height 40px (36px on desktop is acceptable if both buttons match exactly).
- In each finished row, place this button at the right end of the row. Put the file size and the status to its left.
- In the results action bar, place **"Download all as ZIP"** and the other primary action side by side with identical sizing, so the two download actions clearly belong together. If there is only one converted file, hide the ZIP button and show just "Download".
- Create a shared `Button` component with `size` and `variant` props (primary = solid ink, secondary = outlined hairline). Both download buttons use the same size prop so they cannot drift apart.
- Remove icon-only download controls everywhere. Icon-only buttons are still fine for remove and rotate, but they need a visible focus ring and a 36px minimum hit area.

## Task 5. More formats

Keep everything in the browser. Add support through lazy-loaded codecs, loaded only when the user picks that format. Always feature-detect and show a clear message when something is not supported on the user's browser.

### Image converter

- **Input:** JPG/JPEG, PNG, WebP, AVIF, GIF (first frame), BMP, SVG, ICO, HEIC/HEIF, TIFF (decode only, via `utif2`).
- **Output:** JPG, PNG, WebP, AVIF, GIF (static, first frame), BMP, ICO.
  - Use `@jsquash` WASM encoders (`@jsquash/jpeg` MozJPEG, `@jsquash/webp`, `@jsquash/avif`, `@jsquash/png`) for better compression than canvas where it helps, or canvas encoders where they are supported and good enough. AVIF encoding must be lazy-loaded because the WASM is large.
  - ICO: build the ICO container in code with PNG payloads. Provide a size picker (16, 32, 48, 64, 128, 256) with multi-select; output one ICO containing the chosen sizes.
  - BMP: write a 24-bit (or 32-bit with alpha) BMP encoder in a small helper.
  - GIF output: static single frame only. State that animation is not preserved.
- Keep the existing options (quality, resize, rotate, background color for transparency, target-file-size mode). Quality slider only shows for formats that use it (JPG, WebP, AVIF). Show a short inline note when a format loses something (transparency with JPG/BMP, animation with GIF).
- Update the drop zone hint and the accepted file types. Keep sniffing by magic bytes for all new formats.

### PDF making

- **Images to PDF:** accept all image input formats above; convert unsupported-by-PDF formats (WebP, AVIF, HEIC, BMP, GIF, SVG, TIFF, ICO) to PNG or JPEG first, then embed. Keep the three quality modes, page size (A4, A3, Letter, Legal, fit-to-image), orientation, margins, fit mode, reorder and rotate.
- **Text to PDF (new):** accept `.txt`, `.md` (rendered as plain text, not Markdown), `.csv`, and common source files (`.c`, `.cpp`, `.h`, `.java`, `.py`, `.js`, `.json`, `.m`, `.v`, `.vhd`, `.asm`). Options: monospace or sans font, font size, line numbers on/off, page size, margins, wrap long lines. Embed **IBM Plex Mono** and **IBM Plex Sans** with `@pdf-lib/fontkit` so characters render properly; replace unsupported glyphs with a visible fallback character instead of crashing.
- **Merge:** keep, add reorder and remove, show page counts.
- **Split / Extract:** keep range input and thumbnails. Add "split every N pages" and "extract selected pages into one file" modes. Output as separate files in a ZIP or a single PDF as chosen.
- **Organize pages (new):** open one PDF, show page thumbnails in a grid, allow reorder (drag), rotate 90 degrees, delete, and then save as a new PDF.
- **PDF to Images:** output PNG, JPG or WebP, DPI choice (72, 150, 200, 300), page range, ZIP output.
- **Compress:** see Task 6.

### Out of scope (still)
Office documents (DOCX, XLSX, PPTX) to PDF and back, OCR, audio, video, password protect/unlock, and any server-side processing. Show these nowhere in the UI. If the user asks "why no Word to PDF", the README may explain that it needs a server-side engine.

## Task 6. Fix: Compress PDF made a 3 MB file into 9 MB

A compressed file must **never** be larger than the input. Find the real cause first (likely the rasterize path rendering at a high pdf.js scale and/or encoding pages as PNG or high-quality JPEG), reproduce it with a 3 MB PDF, then fix it properly.

Implement compression as a pipeline with safe fallbacks:

1. **Analyze** the PDF with pdf.js / pdf-lib: page count, whether pages are mostly images (scanned) or mostly text/vector.
2. **Strategy A, keep text (default).** With pdf-lib, walk the image XObjects. For each large image, decode it, downscale so its effective resolution on the page is at most the target DPI, re-encode as JPEG at the target quality, and replace it **only if the new bytes are smaller**. Then save with `useObjectStreams: true` and strip metadata and unused objects. Text and vectors stay selectable.
3. **Strategy B, rasterize (opt-in, labeled "Maximum compression, text becomes images").** Render each page with pdf.js at a scale computed from the target DPI (for example `dpi / 72`, never a fixed high scale), encode as **JPEG (not PNG)** at the target quality, and rebuild the PDF by embedding the JPEG bytes directly. For pages that are nearly pure black-and-white line drawings, allow a lower-color JPEG or grayscale option.
4. **Presets:** Light (about 150 DPI, JPEG 0.8), Balanced (about 120 DPI, 0.7), Strong (about 90 DPI, 0.55). Also offer an optional "Target size" in KB or MB that searches the preset parameters until the result fits or reports it cannot.
5. **Safety net (mandatory):** after compressing, compare sizes. If the result is not smaller than the original, **return the original unchanged** and show a message such as "This PDF is already well optimized. No smaller version could be made." Never offer a bigger file as the result.
6. Show before and after sizes, percent saved, and which strategy was used. Process pages one at a time inside a worker, free canvases and bitmaps after each page, and show per-page progress.
7. Test with: a 3 MB scanned PDF (expect a clear reduction), a text-only PDF (expect a small reduction or the "already optimized" message), a 100-page PDF (no crash, no UI freeze), and a PDF that is already small. Report the before and after sizes in your phase summary.

## Task 7. Color themes

Two themes, driven by CSS variables in the Tailwind theme, used everywhere (no hard-coded colors in components).

**Light theme** (light/nearly white surfaces, dark buttons):
- `--bg: #FAF9F6`, `--surface: #FFFFFF`, `--ink: #16181D`, `--ink-2: #5B6068`, `--line: #E3E1DB`
- Primary button: black or very dark grey background (`--btn-bg: #16181D`, hover `#2A2D33`), white text.
- Secondary button: transparent with a 1px `--line` border, ink text.

**Dark theme** (the reverse: dark surfaces, light buttons):
- `--bg: #111214`, `--surface: #17191C`, `--ink: #ECEBE7`, `--ink-2: #9A9EA6`, `--line: #2A2D32`
- Primary button: light grey or white background (`--btn-bg: #ECEBE7`, hover `#FFFFFF`), near-black text.
- Secondary button: transparent with a 1px `--line` border, light ink text.

Rules for both:
- Neutral greys only. No blue-black neon, no purple tint, no gradients.
- Status colors (success, warning, error, info) keep their meaning and are re-tuned per theme to stay AA-contrast on the background.
- Focus ring: 2px ink-colored outline with 2px offset in both themes.
- Dashed drop zone border uses `--line`, and on drag-over switches to `--ink`.
- Make sure every component, SVG icon (`currentColor`), form control, slider, scrollbar (`color-scheme`), and the PDF thumbnails area looks right in both themes. Do a visual pass of every tool in both themes.
- Update `<meta name="theme-color">` to match the active theme.

## Task 8. Theme switch with remembered preference

- Add a small theme toggle button in the **top-right corner** of the header. Use a Sun/Moon icon from `lucide-react` (16 to 18px) with `aria-label="Switch to dark theme"` / `"Switch to light theme"` and `aria-pressed` handling. No emojis. Hit area at least 36px.
- Behavior:
  - On first visit, follow `prefers-color-scheme`.
  - When the user toggles, store the choice in `localStorage` under the key `reformat-theme` with values `light` or `dark`. Wrap all storage access in `try/catch` so private mode does not break the app.
  - On later visits, use the stored choice over the system setting.
  - **No flash of the wrong theme:** add a tiny inline script in `index.html` `<head>` that reads the stored value (or the system preference) and sets `data-theme` on `<html>` before first paint. Make the CSP in `vercel.json` allow this inline script via a hash, or move it to a small same-origin file loaded synchronously in the head.
  - Apply the theme through `data-theme="light|dark"` on `<html>` and set `color-scheme` accordingly.
  - Keep theme in sync across tabs with the `storage` event.
- Transitions between themes: none, or a very short color transition at most, disabled for `prefers-reduced-motion`.

## Task 9. Verification and deploy

1. Test every tool in both themes, at 360px and at 1280px width, with keyboard only and with a screen reader label check.
2. Confirm settings never appear before files are added, and never at the side.
3. Confirm the per-file Download button and "Download all as ZIP" are visually identical in size.
4. Re-run the bundle-size check: the home route initial JS must stay under about 150 KB gzipped, with all new codecs (AVIF, TIFF, fontkit, jSquash) lazy-loaded.
5. Update the `README.md` format list and the in-app drop zone hints so they match the formats that actually work. Update the Privacy page only if processing behavior changed (it should not have).
6. Push to GitHub so Vercel redeploys, then test the production URL on a real phone.

## Final acceptance checklist

- [ ] Header has only two main tabs (Images, PDF); PDF sub-tools appear only after choosing PDF
- [ ] No right-side panel; settings appear only after files are added, centered below the file area
- [ ] Per-file "Download" button is clearly visible and matches the ZIP button's size and style
- [ ] Wordmark uses a serif display font at about 30px (26px mobile)
- [ ] Expanded formats work (see Task 5), with lazy loading and graceful fallbacks
- [ ] Compress PDF never returns a larger file; 3 MB test file now compresses smaller
- [ ] Light theme: nearly white background with dark buttons; dark theme: dark background with light buttons
- [ ] Theme toggle at top right, preference remembered, no flash on load
- [ ] No purple, glow, emoji, AI-tell icons, nested cards, heavy shadows, or fake metrics
- [ ] Builds clean, deployed on Vercel, tested on a phone

At the end of each task, give me a short summary of what changed, what you tested, and anything not done. Do not start the next task until the current one builds cleanly.
