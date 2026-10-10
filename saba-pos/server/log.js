/**
 * Logging.
 *
 * One line per event, levelled, with the time first so `grep` and `tail -f`
 * are useful. No dependency, no log rotation: a POS writes a handful of lines
 * per service, and whoever runs it redirects to a file or lets systemd handle
 * the journal.
 */

import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Read at call time, not at import. The level can be set after this module
 * is first loaded — by `configure()`, or by the tests starting a quiet
 * server — and a threshold frozen at import would ignore all of it.
 */
const threshold = () => LEVELS[config.logLevel] ?? LEVELS.info;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function emit(level, message, meta) {
  if (LEVELS[level] > threshold()) return;
  const tail = meta && Object.keys(meta).length
    ? ' ' + Object.entries(meta)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    : '';
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${message}${tail}`;
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
};

export default log;
