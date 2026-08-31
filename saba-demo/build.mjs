/**
 * Builds the single-file demo.
 *
 *   node build.mjs
 *   -> Saba-Demo.html
 *
 * WHY THIS EXISTS
 * The app is written as two dozen small ES modules because that is how it
 * should be maintained. But a browser opening a page straight from a folder —
 * which is exactly what a client does with a demo on a USB stick — will not
 * fetch sibling modules over file://. So this produces one HTML file with the
 * stylesheets, the artwork and every module inside it, which opens by
 * double-clicking on any machine, with no server and no install.
 *
 * HOW IT WORKS
 * The modules are not concatenated and they are not rewritten into some other
 * module format. Each one is embedded as its own source string, and at load
 * time each becomes a Blob URL, in dependency order, with its import
 * specifiers pointing at the URLs of the modules it needs. The browser then
 * loads real ES modules with real module scope — so the code that runs from
 * the single file is the same code, with the same semantics, as the code that
 * runs from src/.
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'src/main.js';
/**
 * The single file sits at the root of the package rather than in a dist/
 * folder. Whoever is handed this zip should see one obviously openable thing
 * next to the README, not have to go looking in a build directory.
 */
const OUT = 'Saba-Demo.html';

/**
 * The placeholder a rewritten import points at until the loader swaps in a
 * real Blob URL. It is shaped like a URL scheme that could never appear in
 * this source by accident.
 */
const SLOT = (i) => `saba-module:${i}`;

const read = (p) => readFile(resolve(ROOT, p), 'utf8');
const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

/* ------------------------------------------------------- module graph --- */

/**
 * Matches the specifier of a static import or a re-export.
 *
 * The source in src/ deliberately sticks to one import style — no dynamic
 * import(), no import assertions, every specifier a relative path ending in
 * .js — so this narrow pattern is sufficient and, more importantly, cannot
 * silently mangle something it did not understand. `checkUnsupported` below
 * fails the build rather than let anything slip past it.
 */
const SPECIFIER = /(\bimport\s[\s\S]*?\sfrom\s*|\bexport\s[\s\S]*?\sfrom\s*|\bimport\s*)(['"])(\.[^'"]+)\2/g;

function checkUnsupported(path, code) {
  if (/\bimport\s*\(/.test(code)) {
    throw new Error(`${path}: dynamic import() is not supported by this build`);
  }
  const bare = code.match(/\bfrom\s*['"][^.'"][^'"]*['"]/g);
  if (bare) {
    throw new Error(`${path}: bare specifier ${bare[0]} — this app has no dependencies`);
  }
}

/** Walk the graph from the entry point, depth first, deepest module first. */
async function collect(entry) {
  const modules = new Map(); // path -> source
  const order = [];
  const visiting = new Set();

  async function visit(path, from) {
    if (modules.has(path)) return;
    if (visiting.has(path)) throw new Error(`circular import: ${from} -> ${path}`);
    visiting.add(path);

    let code;
    try {
      code = await read(path);
    } catch {
      throw new Error(`${from} imports ${path}, which does not exist`);
    }
    checkUnsupported(path, code);

    for (const match of code.matchAll(SPECIFIER)) {
      await visit(posix.normalize(posix.join(posix.dirname(path), match[3])), path);
    }

    visiting.delete(path);
    modules.set(path, code);
    order.push(path);
  }

  await visit(entry, '(entry)');
  return { modules, order };
}

/* -------------------------------------------------------------- build --- */

async function build() {
  const started = Date.now();

  /* --- artwork, as data URIs --- */
  const logo = dataUri(await readFile(resolve(ROOT, 'assets/saba-logo.svg')), 'image/svg+xml');
  const watermark = dataUri(await readFile(resolve(ROOT, 'assets/saba-watermark.svg')), 'image/svg+xml');
  const favicon = dataUri(await readFile(resolve(ROOT, 'assets/favicon.svg')), 'image/svg+xml');

  /* --- stylesheets --- */
  let css = `${await read('styles/app.css')}\n${await read('styles/print.css')}`;
  css = css.replace(/url\(['"]?\.\.\/assets\/saba-watermark\.svg['"]?\)/g, `url("${watermark}")`);
  if (css.includes('../assets/')) {
    throw new Error('a stylesheet still points at a file on disk');
  }

  /* --- modules --- */
  const { modules, order } = await collect(ENTRY);
  const index = new Map(order.map((path, i) => [path, i]));

  const sources = order.map((path) => {
    let code = modules.get(path);

    // Point every import at the slot its module will occupy at load time.
    code = code.replace(SPECIFIER, (match, head, quote, spec) => {
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (!index.has(target)) throw new Error(`unresolved import ${spec} in ${path}`);
      return `${head}${quote}${SLOT(index.get(target))}${quote}`;
    });

    // The artwork is referenced by path from config.js; inline it.
    code = code.split('assets/saba-logo.svg').join(logo);
    code = code.split('assets/saba-watermark.svg').join(watermark);

    return code;
  });

  const entryIndex = index.get(ENTRY);

  /* --- page --- */
  const shell = await read('index.html');
  const title = shell.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || 'Saba';
  const description = shell.match(/name="description" content="([^"]*)"/)?.[1] || '';

  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    '    <meta name="color-scheme" content="light" />',
    '    <meta name="theme-color" content="#5e1219" />',
    `    <meta name="description" content="${description}" />`,
    `    <title>${title}</title>`,
    `    <link rel="icon" href="${favicon}" type="image/svg+xml" />`,
    '',
    '    <!--',
    '      Saba - Fine Dining Billing & KOT.',
    '',
    '      Single-file demonstration build. Everything this page needs is inside',
    '      it: no server, no network requests, no web fonts, no analytics, no',
    '      dependencies. Open it by double-clicking, from a folder or a USB',
    '      stick, online or off.',
    '',
    '      The readable source is in the src/ folder alongside this file. This',
    '      build is generated from it by build.mjs and is not edited by hand.',
    '    -->',
    '    <style>',
    css,
    '    </style>',
    '  </head>',
    '',
    '  <body>',
    '    <div id="boot" class="boot">',
    '      <div class="boot__inner">',
    `        <img class="boot__logo" src="${logo}" alt="Saba" />`,
    '        <p class="boot__text">Opening the terminal&hellip;</p>',
    '      </div>',
    '    </div>',
    '',
    '    <div id="printArea" class="printarea" aria-hidden="true"></div>',
    '',
    '    <noscript>',
    '      <div class="boot__inner">',
    '        <p class="boot__text">This terminal needs JavaScript switched on to run.</p>',
    '      </div>',
    '    </noscript>',
    '',
    '    <script>',
    '      /*',
    '       * Module loader.',
    '       *',
    '       * Each module below becomes a Blob URL, in dependency order, with its',
    '       * import specifiers rewritten to the URLs of the modules it needs. The',
    '       * browser then loads genuine ES modules - real module scope, real live',
    '       * bindings - so this file behaves exactly like the multi-file source it',
    '       * was built from.',
    '       */',
    '      (function () {',
    `        var SOURCES = ${JSON.stringify(sources)};`,
    `        var PATHS = ${JSON.stringify(order)};`,
    '        var urls = [];',
    '',
    '        function fail(message, detail) {',
    '          var boot = document.getElementById("boot");',
    '          if (!boot) return;',
    '          boot.innerHTML =',
    '            \'<div class="boot__inner">\' +',
    `            '<img class="boot__logo" src="${logo}" alt="">' +`,
    '            \'<h1 class="boot__title">The terminal cannot start</h1>\' +',
    '            \'<p class="boot__text">\' + message + \'</p>\' +',
    '            (detail ? \'<p class="boot__detail">\' + detail + \'</p>\' : \'\');',
    '        }',
    '',
    '        try {',
    '          for (var i = 0; i < SOURCES.length; i += 1) {',
    '            var code = SOURCES[i].replace(/saba-module:(\\d+)/g, function (_, n) {',
    '              return urls[Number(n)];',
    '            });',
    '            urls[i] = URL.createObjectURL(',
    '              new Blob([code], { type: "text/javascript" })',
    '            );',
    '          }',
    '        } catch (error) {',
    '          fail("This browser would not assemble the application.", error.message);',
    '          return;',
    '        }',
    '',
    '        var script = document.createElement("script");',
    '        script.type = "module";',
    `        script.src = urls[${entryIndex}];`,
    '        script.onerror = function () {',
    '          fail(',
    '            "This browser blocked the application from starting. Chrome, Edge, " +',
    '            "Firefox and Safari all run this file; a very old browser will not."',
    '          );',
    '        };',
    '        document.head.appendChild(script);',
    '      })();',
    '    </script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  await writeFile(resolve(ROOT, OUT), page, 'utf8');

  const { size } = await stat(resolve(ROOT, OUT));
  process.stdout.write(
    '\n  Saba single-file build\n'
    + `  ${order.length} modules · ${(css.length / 1024).toFixed(0)} KB css · `
    + `${(size / 1024).toFixed(0)} KB total\n`
    + `  -> ${OUT}  (${Date.now() - started}ms)\n\n`
  );
}

build().catch((error) => {
  process.stderr.write(`\n  Build failed: ${error.message}\n\n`);
  process.exit(1);
});
