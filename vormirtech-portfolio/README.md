# Company Portfolio (print)

`Vormir-Tech-Solutions-Portfolio.pdf` — a 7-page A4 company portfolio, ready to
print, email or hand over.

| | |
|---|---|
| Page size | A4 (210 × 297 mm), portrait |
| Pages | 7 |
| Colour | Dark cosmic covers (pages 1 and 7); ink-friendly white interior (2–6) |
| Text | Fully selectable and searchable — not a scan |
| Fonts | Cormorant and Montserrat, embedded |
| File | ~1 MB, linearized for fast web view |

## Printing it

Print at **100% / Actual size** — do not use "Fit to page", which will scale the
margins. Any A4 printer handles it. There are no bleeds, so nothing is lost on a
borderless-incapable printer.

If you want to save toner, print pages 2–6 only; those are the white interior
pages. Pages 1 and 7 are the covers and are the only heavy-ink pages.

## Regenerating it

`portfolio.html` is the source. It pulls the logo, the animation frames and the
project mockups from `../vormirtech-website/assets/`, so keep the two folders
side by side. Edit the HTML, then re-render with headless Chromium:

```bash
npx playwright screenshot --help   # (any Chromium works)
```

Or with a short Playwright script:

```js
const { chromium } = require('playwright');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file:///absolute/path/to/portfolio.html', { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: 'Vormir-Tech-Solutions-Portfolio.pdf', format: 'A4',
              printBackground: true, preferCSSPageSize: true,
              margin: { top: '0', right: '0', bottom: '0', left: '0' } });
await b.close();
```

`printBackground: true` and `preferCSSPageSize: true` both matter — without them
the covers print white and the page size drifts.

## Editing the content

Text is plain HTML. The design tokens (colours, fonts) are CSS custom properties
in the `<style>` block at the top. Two notes:

- Cormorant defaults to oldstyle figures, so any element showing large numbers
  needs `font-variant-numeric: lining-nums`.
- Each `.page` is a fixed-height flex column. Adding copy to a full page will
  overflow it silently, since the page clips. After editing, check that content
  height still fits — the covers aside, no page should scroll.

## Before sending it out

The statistics on page 2 (7+ clients, 6 service lines, 2 flagship products,
100% in-house) and the "in daily operational use" status lines on pages 4 and 5
came from the project brief. Confirm they are current before the portfolio goes
to a prospect.
