# Reformat

A small, browser-based file converter for students. Convert phone photos, build PDFs from
images, merge and split PDFs, export PDF pages as images, and compress PDFs. Files are processed
on the device and are never uploaded.

## Tools

- **Images** - JPG, PNG, WebP, GIF (first frame), BMP, SVG and HEIC/HEIF to JPG, PNG or WebP.
  Quality, resize, rotate, JPG background colour, target file size, batch conversion and ZIP
  download.
- **Images to PDF** - combine images into one PDF with A4, Letter or fit-to-image pages,
  orientation, margins, contain/fill, and three quality modes. Original quality embeds JPG and PNG
  bytes directly.
- **Merge PDF** - combine up to 50 PDFs in a chosen order.
- **Split PDF** - select pages visually or type a range such as `1-3, 5, 8-10`.
- **PDF to images** - export every page as PNG or JPG at 72, 150 or 300 DPI, packed into a ZIP.
- **Compress PDF** - rebuild pages as compressed JPG images at Screen, Balanced or Print quality.

Text, links, forms and bookmarks are flattened by Compress PDF, so text is no longer selectable.
The original file is never modified.

## Limits

- 50 files per batch
- 40 MB per file
- 300 MB per batch
- PDF tools accept one file, except Merge PDF

Encrypted PDFs must be unlocked before use. File types are checked by their bytes, not just the
extension. An unsupported or damaged file is reported without failing the other files. The
40 MB and 300 MB checks use the browser's reported file size.

## Privacy

Everything runs in the browser. There is no server-side conversion, no account, no analytics, no
cookies and no third-party scripts. Converted images are re-encoded, which removes EXIF metadata.
Images to PDF in Original mode embeds JPG/PNG data directly, so metadata already inside those
files can remain. Compress PDF creates new page images, so original text structure and metadata are
not copied into the result. See the in-app Privacy page for the same statement.

## Local development

Requires Node.js 20 or newer (tested with Node 22).

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Run the production build and preview locally with:

```bash
npm run build
npm run preview
```

## Deploy to Vercel

The repository is ready for Vercel's Vite preset. `vercel.json` defines the SPA fallback,
immutable caching for hashed `/assets/*` files, and security headers including a content security
policy that allows self-hosted workers, blob workers, blob/data images and WebAssembly. The CSP
also allows `'unsafe-eval'` because the bundled HEIC decoder needs it; the app loads no third-party
or user-provided scripts.

1. Import the GitHub repository into Vercel.
2. Keep the framework preset as **Vite** (or accept the settings from `vercel.json`).
3. Build command: `npm run build`; output directory: `dist`.
4. Deploy. No environment variables or server functions are needed.

Alternatively, with the Vercel CLI:

```bash
npx vercel --prod
```

The PDF.js standard fonts, character maps and WebAssembly files are checked into `public/pdfjs`
so rendering does not depend on a CDN.

## Architecture

- React 19 + Vite 8 + Tailwind CSS v4.
- Route-level code splitting. PDF.js, pdf-lib, fflate and heic2any are loaded only by the tools
  that need them.
- All image and PDF work runs in Web Workers. The image pool processes files in parallel; the PDF
  pool serializes page rendering to cap memory.
- PDF.js runs inside a custom worker with `OffscreenCanvas`; PDF.js assets are self-hosted under
  `/pdfjs/`.
- PDF merge and split use pdf-lib; compression and PDF export render pages with PDF.js and rebuild
  the output with pdf-lib.
- Object URLs are revoked when files are removed or a tool unmounts. Page renders are capped by a
  16384 px canvas dimension and a 64 megapixel output limit.
- No API routes and no server-side processing.

## Supported browsers

Use a current version of Chrome, Edge, Firefox or Safari. Image conversion needs module workers,
`OffscreenCanvas` and `createImageBitmap`. PDF page rendering and compression also need
`OffscreenCanvas.convertToBlob`; older browsers show an unsupported-feature message and disable the
action. HEIC decoding depends on browser support through the bundled decoder.

## Project layout

```text
public/pdfjs/             self-hosted PDF.js fonts, cmaps and wasm
src/components/           shared UI, drop zone, file queue and settings
src/lib/                  file validation, image/PDF helpers and downloads
src/routes/               one route per tool plus Privacy
src/workers/              image worker, PDF worker and worker pool
vercel.json               SPA fallback, cache and security headers
```
