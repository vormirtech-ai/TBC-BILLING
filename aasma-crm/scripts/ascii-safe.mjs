/**
 * Rewrites U+FFFD in the built JavaScript as the equivalent � escape.
 *
 * ExcelJS bundles Node's string_decoder polyfill, which returns the replacement
 * character literally, and the XML parser lists it as the end of a character
 * range. Both are legitimate source, but a raw U+FFFD in a file is
 * indistinguishable from a decoding failure, so some hosts and publishers
 * reject it. The escape is the same value to JavaScript — inside string
 * literals, template literals and regular expressions alike — and leaves the
 * emitted bundles pure ASCII-safe on that one point.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'docs';

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let changed = 0;
for (const path of walk(root)) {
  if (!/\.(js|css)$/.test(path)) continue;
  const source = readFileSync(path, 'utf8');
  if (!source.includes('�')) continue;
  const count = source.split('�').length - 1;
  writeFileSync(path, source.replaceAll('�', '\\ufffd'), 'utf8');
  console.log(`[ascii-safe] escaped ${count} replacement character(s) in ${path}`);
  changed += 1;
}

if (changed === 0) console.log('[ascii-safe] nothing to escape');
