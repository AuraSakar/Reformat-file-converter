# Update Brief v4: Paste text directly in "Text to PDF"

Reformat is already built and live (React + Vite + Tailwind v4, deployed on Vercel). **Do not rewrite anything.** Change only the Text to PDF tool (`/pdf/text-to-pdf`) as described here. Keep every earlier rule: browser-only processing, theme variables for light and dark, no emojis, no purple or glow, no nested cards or heavy shadows, accessible, responsive down to 360px. Make sure `npm run build` passes before you finish.

## Goal

Text to PDF currently accepts only uploaded files (`.txt`, `.c`, and other source files). Add a second way to provide content: **pasting or typing text directly**. Both options must be available, and everything else (options, output, download buttons) stays the same.

## 1. Input mode switch

At the top of the tool, in the centered column, add a two-option segmented control (text-style, matching the existing secondary tab look, no colored fills):

- **Upload files**
- **Paste text**

Behavior:
- Default is **Upload files** (current behavior unchanged).
- Switching modes must **not** discard the other mode's content. Keep the uploaded file list and the pasted text in state, so the user can switch back and forth safely.
- Remember the last used mode in `localStorage` under the key `reformat-text-mode` (wrap access in `try/catch`). Do not remember the pasted text itself.
- Use proper semantics: `role="tablist"` / `role="tab"` or a radio group, with an `aria-label` of "Input method", arrow-key navigation, and a visible focus ring.

## 2. Paste text mode

- Show a large, resizable `<textarea>` in place of the drop zone:
  - Minimum height about 240px, grows with content up to about 60vh, then scrolls. Resizable vertically only.
  - Monospace font (IBM Plex Mono), 13 to 14px, `tab-size: 4`, `white-space: pre`, no wrapping inside the editor (horizontal scroll), `spellcheck="false"`, `autocapitalize="off"`, `autocorrect="off"`.
  - Placeholder text (plain, no emoji): "Paste or type your text or code here."
  - Border: 1px `--line`, 6px radius, no shadow. On focus, the border switches to `--ink` together with the standard focus ring.
  - A visible label above it: "Text content".
- Small meta row under the textarea, in IBM Plex Mono, secondary ink: character count, line count, and approximate page count after layout (update after a short debounce, 200ms).
- Optional **File name** field (default "pasted-text", output becomes `pasted-text.pdf`). Sanitize it: strip path separators and characters like `\ / : * ? " < > |`, trim spaces and dots, max 80 characters, fall back to "pasted-text" if empty.
- Buttons beside the meta row: **Clear** (empties the textarea, with no confirm if empty, otherwise a simple inline "Clear text?" confirm) and **Paste from clipboard** (uses `navigator.clipboard.readText()` when available, handles permission denial gracefully with a message "Clipboard access was blocked. Paste with Ctrl+V instead.", and hides the button if the API is unavailable).
- Large pastes must not freeze the UI: do not re-render expensive previews on every keystroke; compute counts with the debounce above, and do the PDF layout inside the existing worker.
- Limit: treat pasted text with the same total size limit as uploads (use the existing constant in `src/lib/config.js`; if none exists for text, add `MAX_TEXT_CHARS = 2_000_000`). Show a clear inline error when exceeded and disable Convert.

## 3. Settings and action area

- As with all tools, the settings section appears **only once there is something to convert**: at least one uploaded file in Upload mode, or at least one non-whitespace character in Paste mode. It stays in the centered column directly below the input area (never in a side panel).
- The **same options** apply in both modes with no changes: font (mono or sans), font size, line numbers on/off, page size, margins, wrap long lines.
- The Convert button creates a PDF from the active mode's content only:
  - Upload mode: existing behavior (one PDF per file, or the existing batch behavior).
  - Paste mode: one PDF from the pasted text.
- Results use the existing result row and the existing buttons: a labeled **Download** button with the same size and style as "Download all as ZIP" (hide ZIP when there is only one output). Do not add new button styles.
- If the user changes the text or any option after converting, mark the previous result as outdated or clear it, so the downloaded PDF always matches what is on screen.

## 4. Edge cases to handle

- Windows line endings (`\r\n`) and old Mac (`\r`) are normalized to `\n`.
- Tabs are expanded to 4 spaces in the PDF.
- Very long lines wrap when "wrap long lines" is on, and are clipped with a visible truncation marker when it is off (existing behavior).
- Characters that the embedded fonts cannot render are replaced with a visible fallback character and never crash the build. Show a small non-blocking note when any were replaced.
- Empty or whitespace-only input keeps Convert disabled with a short helper line.
- Page breaks: also treat the form feed character (`\f`) as a page break.

## 5. Content and microcopy

- Update the Text to PDF hint to mention both ways, for example: "Upload text or source files, or paste text directly." Keep the accepted-extensions line for the upload mode.
- Keep the tone direct. No emojis.

## 6. Verification

1. In Paste mode, test: a short paragraph, 5,000 lines of code, text with tabs, Windows line endings, text with unsupported characters, and a paste larger than the limit. Open the generated PDFs and check line numbers, wrapping, and page count.
2. Switch back and forth between modes and confirm neither mode loses its content.
3. Reload the page and confirm the last used mode is remembered but the pasted text is not.
4. Check both light and dark themes, at 360px and 1280px widths, with keyboard only (switch, textarea, buttons, Convert, Download).
5. Confirm there is no new network request and no new third-party script, so the privacy statement stays accurate.
6. Run the build, check the bundle size has not noticeably changed, commit, push so Vercel redeploys, and test the live URL on a phone, including pasting from the phone clipboard.

## Acceptance checklist

- [ ] Text to PDF has two input options: Upload files and Paste text
- [ ] Paste mode has a monospace textarea, counts, optional file name, Clear and Paste from clipboard
- [ ] Switching modes keeps both contents; the last mode is remembered, pasted text is not
- [ ] Settings appear only when there is content and sit below the input area, not at the side
- [ ] All existing options, results, Download and ZIP buttons work the same in both modes
- [ ] Large pastes do not freeze the UI
- [ ] Works in light and dark themes, at 360px, with keyboard
- [ ] Builds clean and deployed

When finished, give me a short summary of what changed and what you tested.
