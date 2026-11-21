/**
 * The kitchen printer.
 *
 * Two things matter and they pull against each other: the docket has to
 * reach the paper, and the printer has to be incapable of holding up a
 * service. A printer out of paper on a Saturday night is an ordinary event,
 * and the till must not care.
 *
 * The fake printer here is a plain TCP server, which is exactly what a
 * thermal printer on port 9100 is.
 */

import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../run.mjs';
import { nextPort } from '../port.mjs';

import { renderKot, WIDTH } from '../../server/printer/escpos.js';
import { send, describe, testPage } from '../../server/printer/index.js';

/** A thermal printer is a socket that accepts bytes. */
async function fakePrinter() {
  const received = [];
  const server = createServer((socket) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => { received.push(Buffer.concat(chunks)); socket.end(); });
  });
  const port = nextPort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    target: `127.0.0.1:${port}`,
    received,
    async stop() {
      await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    },
  };
}

const KOT = { station: 'HOT', code: 'KOT-0007', course: 'MAIN', firedAt: Date.now() };
const ORDER = { tableLabel: '6', covers: 4, captainName: 'Alina Rahman', notes: '' };
const LINES = [{
  qty: 2, name: 'Lamb Ouzi', portion: 'HALF', seat: 3,
  modifiers: [{ label: 'Medium rare' }], notes: 'No nuts, allergy',
}];

/* --------------------------------------------------------- the paper --- */

test('a docket carries what the cook needs, in ASCII a printer can set', async (t) => {
  const bytes = renderKot(KOT, LINES, ORDER);
  const text = bytes.toString('ascii');

  t.ok(text.includes('HOT'), 'the station');
  t.ok(text.includes('TABLE 6'), 'the table, large');
  t.ok(text.includes('2 x Lamb Ouzi'), 'the quantity and the dish');
  t.ok(text.includes('(HALF)'), 'and that it is a half plate');
  t.ok(text.includes('seat 3'), 'the seat');
  t.ok(text.includes('Medium rare'), 'the modifier');
  t.ok(text.includes('No nuts, allergy'), 'and the allergy note');

  // ESC/POS has no Unicode. A curly quote or a rupee sign would print as
  // rubbish, so they are folded before they ever reach the paper.
  const fancy = renderKot(KOT, [{
    qty: 1, name: 'Chef’s ₹500 Special — café', modifiers: [], notes: '',
  }], ORDER).toString('ascii');
  t.ok(fancy.includes("Chef's"), 'a curly apostrophe becomes a plain one');
  t.ok(fancy.includes('Rs 500'), 'and a rupee sign becomes Rs');
  t.notOk(/[\u0080-￿]/.test(fancy), 'nothing outside ASCII survives');

  t.ok(bytes[0] === 0x1b && bytes[1] === 0x40, 'it starts by resetting the printer');
  t.ok(bytes.includes(Buffer.from([0x1d, 0x56])), 'and ends by cutting the paper');
});

/**
 * The arguments to an ESC/POS command are ordinary printable bytes — `!`,
 * `a`, `E` — so stripping control characters alone leaves them behind and
 * makes every line look longer than it is. The commands this formatter
 * emits are removed whole.
 */
const justTheText = (bytes) => bytes.toString('ascii')
  .replace(/\x1b@/g, '')                 // init
  .replace(/\x1b[aEd]./gs, '')           // align, bold, feed
  .replace(/\x1d!./gs, '')               // character size
  .replace(/\x1dVB\x00/g, '');           // cut

test('a long dish name wraps instead of running off the paper', async (t) => {
  const long = 'Slow braised lamb shoulder with preserved lemon, pomegranate and '
    + 'toasted almond, for the table';
  const text = justTheText(
    renderKot(KOT, [{ qty: 1, name: long, modifiers: [], notes: long }], ORDER)
  );

  const lines = text.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    t.ok(line.length <= WIDTH['80mm'],
      `"${line.slice(0, 60)}" is ${line.length} characters, paper holds ${WIDTH['80mm']}`);
  }

  // Wrapped, not truncated: the words are all still there, even though the
  // wrap may have put a newline in the middle of the phrase.
  const flowed = text.replace(/\s+/g, ' ');
  t.ok(flowed.includes('for the table'), 'the end of the note survives the wrap');
  t.ok(flowed.includes('Slow braised lamb shoulder'), 'and so does the start');
  t.ok(flowed.split('toasted almond').length - 1 >= 2,
    'the dish and the note both printed in full');

  // Narrow paper wraps harder.
  const narrow = justTheText(
    renderKot(KOT, [{ qty: 1, name: long, modifiers: [], notes: long }], ORDER,
      { paper: '58mm' })
  );
  for (const line of narrow.split('\n').filter((l) => l.trim())) {
    t.ok(line.length <= WIDTH['58mm'],
      `58mm: "${line.slice(0, 40)}" is ${line.length}, paper holds ${WIDTH['58mm']}`);
  }
});

/* ------------------------------------------------------- the printer --- */

test('a docket reaches a network printer', async (t) => {
  const printer = await fakePrinter();
  try {
    const result = await send(printer.target, renderKot(KOT, LINES, ORDER));
    t.ok(result.ok, `it printed — ${result.error || ''}`);
    t.equal(printer.received.length, 1, 'the printer got one docket');
    t.ok(printer.received[0].toString('ascii').includes('TABLE 6'), 'and it is the right one');
  } finally {
    await printer.stop();
  }
});

test('a USB printer is a file, and is written as one', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'saba-lp-'));
  const device = join(dir, 'lp0');
  try {
    const result = await send(device, renderKot(KOT, LINES, ORDER));
    t.ok(result.ok, `it printed — ${result.error || ''}`);
    t.ok(readFileSync(device).toString('ascii').includes('TABLE 6'), 'the bytes arrived');

    t.equal(describe(device).kind, 'device', 'a path is a device');
    t.equal(describe('192.168.1.50:9100').kind, 'network', 'host:port is a network printer');
    t.equal(describe('').configured, false, 'and nothing is nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a printer that is off does not throw, it reports', async (t) => {
  // Nothing is listening on this port.
  const result = await send(`127.0.0.1:${nextPort()}`, Buffer.from('x'));
  t.notOk(result.ok, 'it failed');
  t.ok(result.error, `and said why: ${result.error}`);

  const missing = await send('/does/not/exist/lp0', Buffer.from('x'));
  t.notOk(missing.ok, 'a device that is not there fails too');
  t.ok(missing.error, 'with a reason');

  const none = await send('', Buffer.from('x'));
  t.equal(none.error, 'no printer configured', 'and no printer is not an error worth raising');
});

test('a test page can be sent without a service', async (t) => {
  const printer = await fakePrinter();
  try {
    const result = await testPage(printer.target);
    t.ok(result.ok, 'the test page went');
    t.ok(printer.received[0].toString('ascii').includes('TEST PAGE'), 'and says what it is');
  } finally {
    await printer.stop();
  }
});
