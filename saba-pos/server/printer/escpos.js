/**
 * A kitchen docket, as bytes a thermal printer understands.
 *
 * ESC/POS is the language almost every 58mm and 80mm receipt printer speaks,
 * and it is mostly plain text with a handful of control codes. That makes
 * this a formatter, not a driver: no dependency, no vendor SDK, nothing to
 * install on the till.
 *
 * Laid out for a cook reading it at arm's length over a hot pass: the table
 * number is the biggest thing on the paper, the dish names are double
 * height, and anything the kitchen must not miss — an allergy, a half
 * plate, a note — is on its own line rather than trailing off the end of
 * another one.
 */

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: [ESC, 0x40],
  /** 0 normal, 1 double height, 2 double width, 3 both. */
  size: (n) => [GS, 0x21, n],
  bold: (on) => [ESC, 0x45, on ? 1 : 0],
  align: (n) => [ESC, 0x61, n],            // 0 left, 1 centre, 2 right
  feed: (n) => [ESC, 0x64, n],
  cut: [GS, 0x56, 0x42, 0x00],             // partial cut, feeding first
};

/** Characters across the paper. 48 at 80mm, 32 at 58mm, in the usual font. */
export const WIDTH = { '80mm': 48, '58mm': 32 };

const SIZE = { normal: 0x00, tall: 0x01, wide: 0x10, big: 0x11 };

/**
 * ESC/POS is a byte protocol with no notion of Unicode. A docket carrying a
 * curly quote or a rupee sign prints as mojibake on most printers, so the
 * few characters this application actually produces are folded to ASCII
 * rather than left to chance.
 */
const ASCII = {
  '’': "'", '‘': "'", '“': '"', '”': '"',
  '—': '-', '–': '-', '…': '...', ' ': ' ',
  '×': 'x', '₹': 'Rs ', '·': '-',
};

const ascii = (text) => String(text ?? '')
  .replace(/[’‘“”—–… ×₹·]/g,
    (c) => ASCII[c])
  .replace(/[^\x20-\x7e\n]/g, '');

/** Builds one docket. Bytes out; nothing here knows what a socket is. */
class Docket {
  constructor(width) {
    this.width = width;
    this.parts = [Buffer.from(CMD.init)];
  }

  raw(bytes) { this.parts.push(Buffer.from(bytes)); return this; }

  text(line = '', { size = 'normal', bold = false, align = 0 } = {}) {
    this.raw(CMD.align(align));
    this.raw(CMD.size(SIZE[size]));
    if (bold) this.raw(CMD.bold(true));
    this.parts.push(Buffer.from(`${ascii(line)}\n`, 'ascii'));
    if (bold) this.raw(CMD.bold(false));
    this.raw(CMD.size(SIZE.normal));
    this.raw(CMD.align(0));
    return this;
  }

  rule(char = '-') { return this.text(char.repeat(this.width)); }

  /** Left and right on one line, which is how a quantity meets a dish. */
  columns(left, right) {
    const l = ascii(left);
    const r = ascii(right);
    const gap = Math.max(1, this.width - l.length - r.length);
    return this.text(l + ' '.repeat(gap) + r);
  }

  /** A long dish name wrapped rather than cut off at the edge of the paper. */
  wrapped(text, indent = 0, size = 'normal') {
    const room = this.width - indent;
    // A word longer than the paper (a URL, a run of hyphens) would otherwise
    // loop forever below; break it.
    const words = ascii(text).split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of words) {
      while (word.length > room) {
        if (line) { this.text(' '.repeat(indent) + line, { size }); line = ''; }
        this.text(' '.repeat(indent) + word.slice(0, room), { size });
        word = word.slice(room);
      }
      if (line && `${line} ${word}`.length > room) {
        this.text(' '.repeat(indent) + line, { size });
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) this.text(' '.repeat(indent) + line, { size });
    return this;
  }

  end() {
    this.raw(CMD.feed(3));
    this.raw(CMD.cut);
    return Buffer.concat(this.parts);
  }
}

/**
 * One kitchen docket for one station.
 *
 * @param {object} kot      the docket, from the order document
 * @param {object[]} lines  the lines on it
 * @param {object} order    the order it belongs to
 * @param {object} [opts]
 * @param {string} [opts.paper] '80mm' or '58mm'
 * @param {boolean} [opts.reprint] mark it as a second copy
 */
export function renderKot(kot, lines, order, { paper = '80mm', reprint = false } = {}) {
  const d = new Docket(WIDTH[paper] || WIDTH['80mm']);

  if (reprint) d.text('*** REPRINT ***', { align: 1, bold: true });

  d.text(kot.station, { size: 'big', bold: true, align: 1 });
  d.text(`TABLE ${order.tableLabel}`, { size: 'big', bold: true, align: 1 });
  d.rule('=');

  d.columns(kot.code, new Date(kot.firedAt || Date.now()).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  }));
  d.columns(kot.course || '', `${order.covers} covers`);
  if (order.captainName) d.text(order.captainName);
  d.rule();

  for (const line of lines) {
    // Quantity and dish at double height: this is the bit being read while
    // somebody is holding a pan. Wrapped, because a printer silently clips
    // anything past the edge of the paper and the cook never learns what
    // the rest of the dish was.
    d.wrapped(
      `${line.qty} x ${ascii(line.name)}${line.portion === 'HALF' ? ' (HALF)' : ''}`,
      0, 'tall'
    );

    if (line.seat) d.text(`   seat ${line.seat}`);
    for (const modifier of line.modifiers || []) d.text(`   + ${ascii(modifier.label)}`);
    if (line.notes) d.wrapped(`** ${line.notes}`, 3);
  }

  if (order.notes) {
    d.rule();
    d.wrapped(`TABLE NOTE: ${order.notes}`, 0, 'normal');
  }

  d.rule('=');
  return d.end();
}
