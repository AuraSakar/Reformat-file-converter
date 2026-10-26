# Build Brief: Student File Converter (Vercel-hosted)

You are a senior front-end engineer. Build and deploy a file converter web app for engineering students at my college. Read this whole brief before writing code. Work in the phases listed at the end, and commit to Git after each phase works.

## 1. What this is

A small, fast, practical tool that my classmates will use for everyday tasks:

- Turning phone photos and scanned pages into a single PDF for assignment and lab-record submission.
- Merging and splitting PDFs.
- Shrinking images and PDFs to fit college portal and form upload limits.
- Converting HEIC (iPhone) photos to JPG.
- Converting SVG diagrams (circuit and CAD exports) to PNG.

It is NOT a CloudConvert clone. Do not build a broad platform. Do the following well and nothing else.

## 2. Scope

### In scope (v1)

**Image converter**
- Input: JPG, PNG, WebP, GIF (first frame only), BMP, SVG, HEIC/HEIF.
- Output: JPG, PNG, WebP.
- Options: quality slider (JPG/WebP), resize (by max width/height or percentage), rotate in 90-degree steps, background color for transparency when going to JPG (default white).
- "Target file size" mode: user enters a limit such as 200 KB or 1 MB, and the app searches for the highest quality that fits (binary search on quality, then downscale if still too big). This is a headline feature because portals have upload limits.
- Batch conversion, individual downloads, and "Download all as ZIP".

**Images to PDF**
- Multiple images into one PDF.
- Drag to reorder, rotate and remove individual images before building.
- Page size: A4, Letter, or fit-to-image. Orientation: auto, portrait, landscape. Margin: none, small, normal. Fit: contain or fill.
- Quality modes, labeled honestly:
  1. Original: embed JPEG and PNG bytes directly with pdf-lib, with no re-encoding.
  2. Balanced: downscale to about 150 DPI at page size and re-encode as JPEG at 0.8.
  3. Small: about 100 DPI, JPEG 0.65.
- Other formats (WebP, HEIC, BMP, SVG, GIF) are converted to PNG or JPEG first, then embedded.

**PDF tools**
- Merge PDFs (reorderable list).
- Split / extract pages by range (e.g. `1-3, 5, 8-10`) with a page thumbnail picker.
- PDF to images (PNG or JPG, selectable DPI, ZIP output).
- Compress PDF: rasterize pages with pdf.js and rebuild with pdf-lib. State clearly in the UI that this flattens text into images. Make it a clearly labeled option, not a default.

### Out of scope (do not build)
TIFF, AVIF output, ICO, DOCX/XLSX/PPTX conversion, audio, video, accounts, database, payments, analytics dashboards, any "AI" feature. If a feature is not listed above, do not add it.

## 3. Architecture: browser-first, no heavy backend

This is the main performance and cost decision. Do all conversion in the user's browser.

- Vercel hosts static files only. No upload, no server round trip, no cold starts, no request-size limits. This is the fastest option for users and costs nothing to run.
- Do NOT create `/api` routes, and do not use `sharp`. They are unnecessary for this scope and would add upload latency and Vercel limits. If you believe something truly cannot be done in the browser, stop and tell me why before adding any server code.
- Run all heavy work in **Web Workers** so the UI never freezes. Use a small worker pool (`Math.min(navigator.hardwareConcurrency - 1, 4)`) and process files in parallel with a queue.
- Use `createImageBitmap` + `OffscreenCanvas` inside workers where supported, with a main-thread canvas fallback. Feature-detect `canvas.convertToBlob` / `toBlob` for `image/webp` and fall back gracefully with a clear message.
- Libraries (install only these):
  - `react`, `vite`, `tailwindcss` + `@tailwindcss/vite` (Tailwind v4 setup, follow the current docs)
  - `pdf-lib` for building, merging, and splitting PDFs
  - `pdfjs-dist` for rendering PDF pages to images and thumbnails (worker configured for Vite)
  - `fflate` or `jszip` for ZIP output (prefer `fflate`, it is smaller and faster)
  - `heic2any` (or `heic-decode`) for HEIC, **lazy-loaded** only when a HEIC file is added
  - `@dnd-kit/core` + `@dnd-kit/sortable` for reordering
  - `react-router-dom` for routes
  - Self-hosted fonts via `@fontsource` packages
- **Performance requirements:**
  - Route-level code splitting. The initial JS bundle for the home route must stay under ~150 KB gzipped. `pdfjs-dist`, `heic2any` and `pdf-lib` load only when their tool opens.
  - Revoke every object URL (`URL.revokeObjectURL`) when no longer needed. Free `ImageBitmap`s with `.close()`.
  - Generate small thumbnails for previews instead of rendering full-size images.
  - Process files one at a time per worker to cap memory. Phones may have 3 to 4 GB RAM.
  - Handle 30 photos of 12 MP each without crashing a mid-range phone. Downscale early.
- **Limits** (enforce in UI with clear messages): max 50 files per batch, max 40 MB per file, max 300 MB total. Make these constants in one config file.
- **Validate by file signature (magic bytes)**, not just extension. Reject unsupported or corrupt files per-file without failing the whole batch.
- Honor EXIF orientation. Phone photos must not come out rotated.
- Strip metadata by default on image output (privacy), and say so in the UI. Do not add a metadata-preserve option.
- Output filenames: keep the original base name, change the extension, and de-duplicate with `-1`, `-2`. Never use raw user filenames in ZIP paths unsanitized.

### Vercel config
- Framework preset: Vite. Add `vercel.json` only for what is needed:
  - SPA fallback rewrite to `index.html`
  - `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`
  - Basic security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a sensible `Content-Security-Policy` that allows self-hosted scripts, workers (`worker-src 'self' blob:`), and `blob:`/`data:` images.
- Confirm that production build output works with workers and the pdf.js worker file.

### Privacy statement (must be accurate)
Because everything runs in the browser, say plainly: "Files are processed on your device and are not uploaded." Only claim this if it is true in the final build. Add a short Privacy page with the same statement. No cookies, no trackers, no third-party scripts, no CDN fonts.

## 4. UI design system (strict)

The interface must look like it was designed by a person with taste, not generated. Reject standard AI-generated design defaults. Follow these rules exactly.

### 4.1 Color and theming
- **No purple or violet gradients.** No glow effects, no glowing borders, no neon radial gradients, no glassmorphism or backdrop blur used to fill an empty layout.
- Use a neutral palette: warm off-white background, near-black ink, mid-gray secondary text, light gray hairline dividers. Primary buttons are solid ink (near-black) with white text.
- **Accent color is for meaning only.** Colored borders, fills or text may indicate status (success, error, warning, in-progress) or semantic category. Never use color as decoration.
- Suggested tokens (adjust if needed, but keep the restraint). Define them as CSS variables in the Tailwind theme:
  - `--bg: #FAF9F6`, `--surface: #FFFFFF`, `--ink: #16181D`, `--ink-2: #5B6068`, `--line: #E3E1DB`
  - `--ok: #1F7A4D`, `--warn: #9A6700`, `--err: #B42318`, `--info: #1D5FA8`
- Dark mode via `prefers-color-scheme` is optional. If built, use neutral warm grays (no blue-black neon, no purple tint) and the same status colors adjusted for contrast. Meet WCAG AA contrast everywhere.

### 4.2 Typography
- **Do not use Inter.** Do not use Roboto or Poppins either.
- Use **IBM Plex Sans** for UI text and **IBM Plex Mono** for file sizes, dimensions, page ranges and numeric values. This suits an engineering audience. Self-host through `@fontsource`.
- Compact, intentional scale. Base body 14px, secondary 12-13px, section headings 15-16px, page title at most 20px. No giant hero headings. Use weight (400/500/600) and spacing for hierarchy, not size.
- Line length and spacing should feel tight and tool-like, not marketing-like.

### 4.3 Layout and elements
- **No marketing landing page.** The home route is the tool itself: a slim top bar with the product name (plain text wordmark, no logo icon) and tool navigation as text tabs (Images, Images to PDF, Merge PDF, Split PDF, PDF to images, Compress PDF). The active tool is visible immediately with its drop zone.
- **No generic AI-tell icons**: no sparkles, stars, diamonds, magic wands, rockets, shields, or lightning bolts. No icon above headings. No decorative icon rows. Use text labels wherever possible. Where an icon genuinely helps (remove, drag handle, download, rotate), use a small, consistent stroke icon set (`lucide-react` is acceptable, 16px, 1.5 stroke) and always pair it with an accessible label.
- **No emojis** anywhere in the UI, including buttons, empty states, toasts and errors.
- **Strip card slop.** Do not wrap every section in a rounded box. No nested cards. No heavy or soft drop shadows. Separate regions with whitespace and 1px hairline dividers. Use at most one bordered container (the drop zone, dashed 1px border) plus table-like rows for the file list. Border radius: 4 to 6px max.
- File queue is a dense table-like list: thumbnail (40px), name, type, size (mono), status, output size (mono), actions. Show real data only.
- Settings sit in a plain side column (desktop) or below the list (mobile), as labeled form controls with clear grouping. No decorative panels.
- **Responsive rules:** every container uses explicit padding, gap and alignment. Do not hardcode brittle pixel heights or widths. Use flex/grid with `min-w-0`, `fill`/`hug` behavior, and `max-w` on text blocks. Must work at 360px width with no horizontal scroll. Touch targets at least 40px high on mobile.
- Motion: minimal. Only functional transitions (progress, list reorder, 120-160ms). No parallax, no animated gradients, no floating blobs.

### 4.4 Content and assets
- **No stock photos, no corporate illustrations, no placeholder "Trusted by" logos, no fake metrics or testimonials, no "10M files converted" counters.** Show only real state.
- Empty states are plain text that explains what to do and which formats are accepted, e.g. "Drop JPG, PNG, WebP, HEIC, BMP, GIF or SVG files here, or choose files. Up to 50 files, 40 MB each."
- Microcopy: direct, specific, calm. Say "Converted 12 files, 3.4 MB saved" and not "Magic complete!". Error messages say what happened and what to do next ("photo-3.heic could not be read. The file may be damaged. Remove it and try again.").
- Be honest about trade-offs inline: JPG has no transparency (background color is applied), "Original quality" PDF mode does not recompress, "Compress PDF" turns text into images.

### 4.5 States to design properly
Empty, files added, converting (per-file progress), done (before/after sizes), partial failure, total failure, unsupported browser feature, over-limit, offline. Keyboard-accessible everywhere with visible focus rings (2px ink outline), proper labels, `aria-live` for status changes, drag-and-drop with a keyboard alternative for reordering.

## 5. Suggested structure

```text
file-converter/
├── public/
├── src/
│   ├── components/        # DropZone, FileList, FileRow, SettingsPanel, ReorderList, Toast
│   ├── routes/            # ImageConverter, ImagesToPdf, MergePdf, SplitPdf, PdfToImages, CompressPdf, Privacy
│   ├── lib/
│   │   ├── config.js      # limits, supported types
│   │   ├── sniff.js       # magic-byte file type detection
│   │   ├── imageConvert.js
│   │   ├── targetSize.js  # quality search for "fit under N KB"
│   │   ├── pdfBuild.js
│   │   ├── pdfRender.js
│   │   ├── zip.js
│   │   └── download.js
│   ├── workers/           # imageWorker.js, pdfWorker.js, pool.js
│   ├── hooks/
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css          # Tailwind import + design tokens
├── vercel.json
└── README.md
```

No `api/` folder.

## 6. Engineering quality bar

- Plain JavaScript (JSX) is fine. If you prefer TypeScript, use it consistently.
- Keep components small and readable. I am a student and will maintain this, so add short comments where the logic is non-obvious (EXIF handling, quality search, DPI math).
- Handle every error path. A bad file must never crash the app or block other files.
- No `console.log` left in production code.
- Run `npm run build` and fix all warnings before declaring a phase done.
- Test with: a 12 MP phone JPG with EXIF rotation, an iPhone HEIC, a transparent PNG to JPG, a 30-photo batch, a corrupt file renamed to `.jpg`, a 100-page PDF, and a file over the size limit. Report results.
- Add a README with setup, build, deploy steps and the list of supported formats.

## 7. Phases (commit after each)

1. **Shell and design system:** Vite + Tailwind v4 setup, tokens, fonts, top bar with tool tabs, routes, DropZone, FileList with real (mocked-by-actual-file) data, all states styled. No fake data in the final UI.
2. **Image converter:** sniffing, worker pool, JPG/PNG/WebP output, quality, resize, rotate, EXIF, HEIC lazy load, SVG to PNG, target-size mode, per-file download, ZIP.
3. **Images to PDF:** reorder/rotate/remove, page options, three quality modes, preview of page layout, single PDF download.
4. **PDF tools:** merge, split with thumbnails, PDF to images, compress PDF.
5. **Hardening and deploy:** limits, error states, accessibility pass, bundle-size check, `vercel.json`, push to GitHub, deploy on Vercel, test the production URL on a real phone, write README and Privacy page.

At the end of each phase, give me a short summary: what works, what you tested, what is not done. Do not start the next phase until the current one builds cleanly.

## 8. Final acceptance checklist

- [ ] No purple, glow, glassmorphism, emoji, sparkle-style icons, stock art, or fake metrics anywhere
- [ ] Not using Inter; Plex Sans/Mono self-hosted
- [ ] Accent colors appear only for status
- [ ] No nested cards or heavy shadows
- [ ] Works at 360px width, keyboard accessible, AA contrast
- [ ] All conversion runs in Web Workers; UI never freezes on a 30-photo batch
- [ ] Home bundle under about 150 KB gzipped; heavy libs lazy-loaded
- [ ] Phone photos keep correct orientation
- [ ] Target-size mode reliably gets files under the requested limit or explains why it cannot
- [ ] Files are never uploaded; privacy text matches reality
- [ ] Deployed on Vercel and tested on a phone
