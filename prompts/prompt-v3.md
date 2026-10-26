# Update Brief v3: Credits footer for Reformat

Reformat is already built and live (React + Vite + Tailwind v4, deployed on Vercel). **Do not rewrite anything.** Make only the change described here, keep every earlier rule (theme variables, light/dark themes, no emojis, no purple or glow, no heavy shadows, accessible, responsive down to 360px, no third-party scripts), and make sure `npm run build` passes before you finish.

## Goal

Add a small credits footer at the bottom of every page (Images, all PDF tools, Privacy). It shows who built the app and four icon links to the creator's profiles.

## 1. Footer content

- Credit line: **"Designed and built by AuraSakar"**
  - Render "AuraSakar" in the serif display font used for the wordmark (Instrument Serif or Fraunces, whichever the project uses), slightly larger than the surrounding text. The rest of the line is IBM Plex Sans, 13px, secondary ink color.
  - Optional small second line in secondary ink: "Free for students. Files never leave your device." Only keep this line if it matches the actual privacy behavior of the app.
- Below or beside the credit line (stacked and centered on mobile, side by side on desktop), show **four icon links in a single row, in this order**: GitHub, LinkedIn, WhatsApp, Instagram.

## 2. Links (exact targets)

| Icon | Accessible label | href |
|---|---|---|
| GitHub | "GitHub repository" | `https://github.com/AuraSakar/Reformat-file-converter` |
| LinkedIn | "LinkedIn profile" | `https://www.linkedin.com/in/sakar-tolnure-b1b75b41a` |
| WhatsApp | "Message on WhatsApp" | `https://wa.me/918329135108` |
| Instagram | "Instagram profile" | `https://www.instagram.com/_sakar.t` |

Notes:
- The GitHub URL is the repo link without the `.git` suffix, so it opens the repository page.
- The LinkedIn URL needs the `https://` prefix, otherwise the browser treats it as a relative path.
- WhatsApp `wa.me` links use the number with country code and **no plus sign**.
- The Instagram URL is cleaned of tracking parameters. It still opens the same profile.
- Put all four URLs in one small constants file (for example `src/lib/links.js`) so they are easy to change later.
- Every link uses `target="_blank"` and `rel="noopener noreferrer"`.

## 3. Icon design rules

- Use **inline SVG components** (one small React component per icon in `src/components/icons/`). Use the simple monochrome brand glyphs (paths from the Simple Icons set are fine). Do not use `lucide-react` for these, because recent versions removed brand icons, and do not load icons from a CDN or an image file.
- Icons are **single-color and follow the site theme, not the brand colors**. Use `fill="currentColor"`. No green WhatsApp, no blue LinkedIn, no Instagram gradient, no colored hover states.
- Default color: the secondary ink variable (`--ink-2`). On hover and keyboard focus: primary ink (`--ink`). Works in both light and dark themes automatically through the existing CSS variables.
- Size: 20px glyph inside a 40px by 40px hit area, centered, 8px gap between icons. Optional 1px `--line` border with 6px radius on each icon button, to match the secondary button style. No shadows, no background fills, no glow.
- Add a visible focus ring (2px ink outline, 2px offset) like the rest of the app.
- Accessibility: each link has the `aria-label` from the table above, and the SVG itself is `aria-hidden="true"` and `focusable="false"`. Add a `title` attribute with the same text so desktop users get a tooltip.
- No emojis.

## 4. Layout

- Create a `Footer` component and render it once in the app layout, after the page content, on every route.
- Make the page layout a flex column with `min-h-screen` so the footer sits at the bottom of the viewport on short pages and below the content on long pages. It is **not** fixed or sticky and must never overlap the tool.
- Separate it from the content with a 1px `--line` top border and generous vertical padding (about 24px top and bottom). Same max width and horizontal padding as the main content column.
- Desktop: credit text on the left, icons on the right, vertically centered. Mobile (360px): stacked and centered, no horizontal scroll, touch targets at least 40px.
- Use `<footer>` and a `<nav aria-label="Creator links">` around the icon row.

## 5. Verification

1. Check the footer in both light and dark themes, at 360px and 1280px widths, on every route. The icons must look right in both themes and use no colors outside the theme palette.
2. Click each link and confirm it opens the correct destination in a new tab: the GitHub repo page, the LinkedIn profile, a WhatsApp chat with +91 83291 35108, and the Instagram profile `_sakar.t`.
3. Tab through the footer with the keyboard and confirm the focus ring and order (GitHub, LinkedIn, WhatsApp, Instagram).
4. Confirm the CSP in `vercel.json` is unaffected (links are plain navigation, no new scripts or image sources are needed) and the bundle size has not noticeably changed.
5. Commit with a clear message, push so Vercel redeploys, and check the live URL on a phone.

## Acceptance checklist

- [ ] Footer visible on every page with the text "Designed and built by AuraSakar"
- [ ] Four icons in one row in the order GitHub, LinkedIn, WhatsApp, Instagram
- [ ] All four open the exact destinations above in a new tab
- [ ] Icons are single-color using theme variables, in both light and dark themes
- [ ] No brand colors, no emojis, no shadows, no third-party assets
- [ ] Keyboard accessible with labels, works at 360px width
- [ ] Builds clean and deployed

When finished, give me a short summary of what changed and what you tested.
