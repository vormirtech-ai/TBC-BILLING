#!/usr/bin/env node
/**
 * Build the published site.
 *
 *   node tools/build-site.mjs [outDir]
 *
 * Two things come out of it: a page about Saba, and the application itself
 * running against a till that lives in the visitor's browser.
 *
 * There is no bundler and no transform. The demonstration is the same `app/`
 * directory a restaurant's till serves, copied as it is, with one extra
 * entry point (`src/demo.js`) that stands the in-tab till up before booting.
 * If the two could drift, the demonstration would be worthless; they cannot,
 * because there is only one of them.
 */

import {
  cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { markdownToHtml, titleOf } from './markdown.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'site'));

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const write = (rel, text) => {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const { version } = JSON.parse(read('package.json'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ----------------------------------------------------- the application --- */

cpSync(join(ROOT, 'app'), join(OUT, 'demo'), { recursive: true });

// The demonstration differs from a till in exactly one line: which module
// boots. Everything else on the page is the shipped file.
const page = read('app', 'index.html')
  .replace('<script type="module" src="src/main.js"></script>',
    '<script type="module" src="src/demo.js"></script>')
  .replace('<title>Saba · Fine Dining Billing &amp; KOT</title>',
    '<title>Saba · live demonstration</title>')
  .replace('<meta name="description" content="Saba — billing and kitchen order management for fine dining." />',
    '<meta name="description" content="A live demonstration of Saba — billing and '
    + 'kitchen order management for fine dining. Runs entirely in your browser." />')
  // A demonstration is not a terminal, so it is not installable as one: the
  // manifest would offer to add a fake restaurant to somebody's home screen.
  .replace('    <link rel="manifest" href="manifest.webmanifest" />\n', '');

write('demo/index.html', page);
rmSync(join(OUT, 'demo', 'manifest.webmanifest'), { force: true });

/* ------------------------------------------------------------ the page --- */

const feature = (title, text) =>
  `<article class="card"><h3>${title}</h3><p>${text}</p></article>`;

const fact = (title, text) => `<div><dt>${title}</dt><dd>${text}</dd></div>`;


write('index.html', landing(version));
write('.nojekyll', '');
write('robots.txt', 'User-agent: *\nAllow: /\n');

cpSync(join(ROOT, 'app', 'assets'), join(OUT, 'assets'), { recursive: true });

// The documentation, rendered. Served as .md it would arrive as a wall of
// plain text or a download, which is a poor advertisement for a product whose
// documentation is one of the things being sold.
for (const name of ['DEPLOYMENT', 'OPERATIONS', 'CLOUD-SYNC', 'HANDOVER']) {
  const source = read('docs', `${name}.md`);
  write(`docs/${name}.html`, document(titleOf(source), markdownToHtml(source)));
  write(`docs/${name}.md`, source);      // the original, for anyone who wants it
}
write('README.html', document('Saba Restaurant Suite', markdownToHtml(read('README.md'))));
if (existsSync(join(ROOT, 'LICENSE.txt'))) cpSync(join(ROOT, 'LICENSE.txt'), join(OUT, 'LICENSE.txt'));

process.stdout.write(`site built in ${OUT}\n`);

/* ------------------------------------------------------------ a page --- */

/** One shell for every rendered document, so the docs match the front page. */
function document(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title} · Saba</title>
    <link rel="icon" href="../assets/saba-icon.png" type="image/png" />
    <style>
${landingCss()}
      body { background: var(--paper); }
      .doc { max-width: 76ch; margin: 0 auto; padding: 28px 20px 72px; }
      .doc h1 { font-size: clamp(27px, 4.5vw, 38px); margin: 26px 0 8px; }
      .doc h2 { font-size: 24px; margin: 42px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); }
      .doc h3 { font-size: 18px; margin: 28px 0 6px; color: var(--navy); }
      .doc p, .doc li { color: var(--ink-2); }
      .doc li { margin: 4px 0; }
      .doc table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14.5px; }
      .doc th, .doc td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
      .doc th { color: var(--navy); font-family: var(--serif); }
      .doc pre { max-width: none; }
      .doc hr { border: none; border-top: 1px solid var(--line); margin: 34px 0; }
      /* A rule in the source followed by a section heading would draw twice. */
      .doc hr + h2 { border-top: none; padding-top: 0; margin-top: 10px; }
      .doc blockquote { margin: 0; padding-left: 16px; border-left: 3px solid var(--gold-light); color: var(--ink-3); }
      .crumb { display: inline-block; margin-bottom: 6px; font-size: 13px; color: var(--ink-3); text-decoration: none; }
      .crumb:hover { color: var(--navy); }
    </style>
  </head>
  <body>
    <article class="doc">
      <a class="crumb" href="../">← Saba</a>
${body}
    </article>
  </body>
</html>
`;
}

/* ------------------------------------------------------------- landing --- */

function landing(release) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#0C2340" />
    <title>Saba — billing and kitchen order management for fine dining</title>
    <meta name="description" content="An offline point of sale for fine dining: floor
      plan, kitchen order tickets, split bills, GST and the day-end close. Runs on the
      restaurant's own network, with no internet and no subscription." />
    <link rel="icon" href="assets/saba-icon.png" type="image/png" />
    <style>
${landingCss()}
    </style>
  </head>
  <body>
    <header class="hero">
      <img class="hero__mark" src="assets/saba-logo.png" alt="Saba Fine Dine" width="150" height="150" />
      <h1>Billing and kitchen order tickets<br />for a fine-dining restaurant.</h1>
      <p class="hero__lead">
        One small computer in the back office. Every screen in the building — the
        captain's tablet, the pass, the till, the manager's laptop — is a browser
        against it, all reading and writing the same tables. Unplug the internet
        and nothing changes.
      </p>
      <p class="hero__actions">
        <a class="btn btn--gold" href="demo/">Open the live demonstration</a>
        <a class="btn" href="docs/DEPLOYMENT.html">How it is installed</a>
      </p>
      <p class="hero__note">
        The demonstration runs entirely in your browser — nothing is installed and
        nothing is sent anywhere. Sign in as <b>Manager</b> with PIN <b>1379</b>.
      </p>
    </header>

    <main>
      <section class="band">
        <h2>What it does</h2>
        <div class="grid">
          ${feature('Floor', 'A live plan of every room. Seat, move, merge and transfer '
            + 'tables; covers, elapsed time and the running total on each.')}
          ${feature('Order', 'The carte by course, with modifiers, allergy notes and seat '
            + 'numbers. Fire a course and the kitchen has it before the tablet is down.')}
          ${feature('Kitchen', 'A ticket per course per station, timed, with whatever is '
            + 'running late brought to the front. Bump, recall, reprint.')}
          ${feature('Bills', 'Split by seat, by item or evenly. Part-pay across cash, card '
            + 'and UPI. Discount with a manager’s approval, void and comp with a reason '
            + 'that is kept.')}
          ${feature('Tax', 'Service charge and GST worked out per line in whole paise, with '
            + 'the rates set by the restaurant rather than by us.')}
          ${feature('Reports', 'Today as it happens, the Z report and cash-up at close, '
            + 'thirty days of history, and CSV exports for the accountant.')}
        </div>
      </section>

      <section class="band band--quiet">
        <h2>How it is built</h2>
        <dl class="facts">
          ${fact('No dependencies', 'Plain JavaScript against Node’s own standard '
            + 'library and SQLite. Nothing to <code>npm install</code>, nothing to compile '
            + 'on the till, nothing that goes stale.')}
          ${fact('No internet', 'It makes no outbound request of any kind — no telemetry, '
            + 'no update check, no licence call. It cannot stop working because something '
            + 'far away did.')}
          ${fact('The restaurant’s own data', 'One SQLite file on hardware the '
            + 'restaurant owns, in an open format, backed up nightly to a directory they '
            + 'can copy anywhere.')}
          ${fact('Four roles, enforced', 'Manager, captain, cashier and kitchen. The server '
            + 'checks every request — a captain’s tablet cannot read the day’s '
            + 'takings even if somebody types the address by hand.')}
        </dl>
      </section>

      <section class="band">
        <h2>Running it</h2>
        <p class="lede">On the restaurant’s own computer, with Node 22.5 or newer:</p>
        <pre><code>sudo ./install.sh</code></pre>
        <p class="lede">
          That installs it as a service that starts with the machine, puts the database
          in one directory, sets up a nightly backup, and prints the address to open on
          the tablets. Docker and a plain <code>node server/main.js</code> both work too,
          and none of the three needs this website.
        </p>
        <p class="lede">
          <a href="docs/DEPLOYMENT.html">Deployment</a> ·
          <a href="docs/OPERATIONS.html">Running it day to day</a> ·
          <a href="docs/CLOUD-SYNC.html">The optional cloud copy</a> ·
          <a href="docs/HANDOVER.html">Taking over the code</a>
        </p>
      </section>
    </main>

    <footer>
      <p>Saba Restaurant Suite ${release}. This page and the demonstration on it are
        static files; the product they describe is not hosted here and does not need
        to be.</p>
    </footer>
  </body>
</html>
`;
}

function landingCss() {
  return `
      :root {
        --navy: #0c2340; --navy-deep: #06182e; --gold: #9a6213;
        --gold-light: #c49a4a; --gold-tint: #f7f0e2;
        --ground: #f3f0e9; --paper: #fffefb; --ink: #1d2733;
        --ink-2: #4a5765; --ink-3: #78848f; --line: #e2ddd1;
        --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua',
          Georgia, 'Times New Roman', serif;
        --sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: var(--ground); color: var(--ink);
        font: 16px/1.65 var(--sans); -webkit-font-smoothing: antialiased;
      }
      h1, h2, h3 { font-family: var(--serif); font-weight: 600; line-height: 1.2; }
      a { color: var(--navy); }
      code {
        font: 13.5px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        background: var(--gold-tint); padding: 1px 5px; border-radius: 4px;
      }

      .hero {
        background: radial-gradient(90% 80% at 50% 0%, #143256 0%, var(--navy-deep) 55%, #04121f 100%);
        color: #e9eef5; text-align: center;
        padding: 56px 20px 60px;
      }
      .hero__mark {
        border-radius: 50%; filter: drop-shadow(0 16px 40px rgba(0, 0, 0, .45));
      }
      .hero h1 {
        margin: 26px auto 0; max-width: 20ch; font-size: clamp(27px, 5vw, 44px);
        color: #fff;
      }
      .hero__lead {
        margin: 18px auto 0; max-width: 56ch;
        color: rgba(233, 238, 245, .82); font-size: 16.5px;
      }
      .hero__actions { margin: 30px 0 0; display: flex; gap: 11px; justify-content: center; flex-wrap: wrap; }
      .hero__note { margin: 20px auto 0; max-width: 52ch; font-size: 13.5px; color: rgba(233, 238, 245, .6); }
      .hero__note b { color: var(--gold-light); }

      .btn {
        display: inline-block; padding: 12px 22px; border-radius: 999px;
        font-weight: 600; font-size: 15px; text-decoration: none;
        color: #e9eef5; border: 1px solid rgba(233, 238, 245, .3);
        transition: background .15s, border-color .15s, transform .12s;
      }
      .btn:hover { background: rgba(233, 238, 245, .1); border-color: var(--gold-light); }
      .btn:active { transform: scale(.98); }
      .btn--gold {
        background: var(--gold-light); border-color: var(--gold-light); color: var(--navy-deep);
      }
      .btn--gold:hover { background: #d4ab5d; border-color: #d4ab5d; }

      main { max-width: 1020px; margin: 0 auto; padding: 0 20px; }
      .band { padding: 56px 0 8px; }
      .band--quiet { border-top: 1px solid var(--line); }
      .band h2 { font-size: 27px; margin: 0 0 24px; }
      .lede { max-width: 66ch; color: var(--ink-2); }

      .grid {
        display: grid; gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(255px, 1fr));
      }
      .card {
        background: var(--paper); border: 1px solid var(--line);
        border-radius: 14px; padding: 20px 22px;
      }
      .card h3 {
        margin: 0 0 7px; font-size: 18px; color: var(--navy);
      }
      .card p { margin: 0; color: var(--ink-2); font-size: 14.5px; }

      .facts { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); margin: 0; }
      .facts dt { font-weight: 600; color: var(--navy); margin-bottom: 4px; }
      .facts dd { margin: 0; color: var(--ink-2); font-size: 14.5px; }

      pre {
        background: var(--navy-deep); color: #e9eef5; padding: 15px 18px;
        border-radius: 11px; overflow-x: auto; max-width: 44ch;
      }
      pre code { background: none; color: inherit; font-size: 14px; }

      footer {
        margin-top: 56px; padding: 26px 20px 40px;
        border-top: 1px solid var(--line); text-align: center;
      }
      footer p { margin: 0 auto; max-width: 60ch; font-size: 13px; color: var(--ink-3); }
  `;
}
