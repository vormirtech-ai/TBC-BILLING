/**
 * Just enough Markdown.
 *
 * The three documents this renders are ours and use a known subset:
 * headings, paragraphs, lists, tables, fenced code, rules, and inline
 * emphasis, code and links. A hundred lines covers it, which is a better
 * trade for this project than a dependency — the whole product has none, and
 * the website that sells it should not be the thing that breaks the claim.
 *
 * It escapes first and inserts tags afterwards, so a stray `<` in a document
 * cannot become markup.
 */

const escape = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** Inline: code first, so emphasis inside backticks is left alone. */
function inline(text) {
  const code = [];
  let out = escape(text).replace(/`([^`]+)`/g, (_, body) => {
    code.push(body);
    return `\u0000${code.length - 1}\u0000`;
  });

  out = out
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      `<a href="${href.replace(/\.md(#|$)/, '.html$1')}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[Number(i)]}</code>`);
}

const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function markdownToHtml(source) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;

  const paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flush();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) { flush(); i += 1; continue; }

    if (/^(-{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr />'); i += 1; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // A table: a header row, a divider of dashes, then the body.
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] || '')) {
      flush();
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|')) body.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>'
        + head.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table>'
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const tag = bullet ? 'ul' : 'ol';
      const items = [];
      while (i < lines.length) {
        const item = bullet
          ? /^\s*[-*]\s+(.*)$/.exec(lines[i])
          : /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (item) { items.push(item[1]); i += 1; continue; }
        // A wrapped continuation line belongs to the item above it.
        if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flush();
  return out.join('\n');
}

/** The first heading, for the page title. */
export const titleOf = (source) =>
  (/^#\s+(.*)$/m.exec(source)?.[1] || 'Saba').replace(/[*`]/g, '');
