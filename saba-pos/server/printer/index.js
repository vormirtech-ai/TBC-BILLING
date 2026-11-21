/**
 * Getting the docket onto paper.
 *
 * Two kinds of kitchen printer, one code path. A network printer is a socket
 * on port 9100 — that is all "raw printing" has ever meant. A USB thermal
 * printer on Linux appears as a device file, and printing to it is writing
 * bytes to that file. So the setting is just a target: `192.168.1.50:9100`
 * or `/dev/usb/lp0`, and this works out which it is.
 *
 * The rule that outranks everything here: printing must never hold up
 * service. A printer that is switched off, out of paper or unplugged is an
 * ordinary Tuesday, and the kitchen screen has the docket regardless. So
 * nothing in this file is awaited by the code that fires a course, and a
 * failure is logged once and dropped.
 */

import { createConnection } from 'node:net';
import { writeFile } from 'node:fs/promises';

import { log } from '../log.js';

/** Long enough for a slow printer, short enough not to pile up. */
const TIMEOUT = 5000;

/** Remember what we last said about each target, so a dead printer logs once. */
const complained = new Map();

const isNetwork = (target) => /^[^/\\][^\s]*:\d+$/.test(target);

/**
 * Send bytes to a printer.
 *
 * @returns {Promise<{ok: boolean, error?: string}>} never rejects
 */
export async function send(target, bytes) {
  if (!target) return { ok: false, error: 'no printer configured' };

  try {
    if (isNetwork(target)) await toSocket(target, bytes);
    else await writeFile(target, bytes);

    if (complained.get(target)) {
      log.info('kitchen printer is back', { printer: target });
      complained.delete(target);
    }
    return { ok: true };
  } catch (error) {
    // Once per outage, not once per docket: a busy service with an unplugged
    // printer would otherwise write a hundred identical lines to the journal.
    if (!complained.get(target)) {
      log.warn('kitchen printer did not answer', {
        printer: target,
        error: error.message,
        note: 'the docket is on the kitchen screen; service is unaffected',
      });
      complained.set(target, true);
    }
    return { ok: false, error: error.message };
  }
}

function toSocket(target, bytes) {
  const index = target.lastIndexOf(':');
  const host = target.slice(0, index);
  const port = Number(target.slice(index + 1));

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;

    const done = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(TIMEOUT, () => done(new Error('the printer did not answer in time')));
    socket.on('error', done);
    socket.on('connect', () => socket.write(bytes, () => socket.end()));
    // `end` fires once the printer has taken the bytes and closed its side.
    socket.on('close', () => done(null));
  });
}

/** Does the target look like something we could print to? */
export function describe(target) {
  if (!target) return { configured: false, kind: null };
  return {
    configured: true,
    kind: isNetwork(target) ? 'network' : 'device',
    target,
  };
}

/** Send a short page, so somebody can check the printer without a service. */
export async function testPage(target, paper = '80mm') {
  const { renderKot } = await import('./escpos.js');
  const bytes = renderKot(
    { station: 'TEST PAGE', code: 'Saba', course: 'If you can read this,', firedAt: Date.now() },
    [{ qty: 1, name: 'the printer is set up correctly', modifiers: [], notes: '' }],
    { tableLabel: '-', covers: 0, captainName: '', notes: '' },
    { paper }
  );
  return send(target, bytes);
}
