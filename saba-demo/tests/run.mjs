/**
 * A test runner in fifty lines, because this project has no dependencies and
 * is not about to acquire one to run its own tests.
 *
 *   node tests/run.mjs
 */

const suites = [];
let failures = 0;
let assertions = 0;

export function test(name, fn) {
  suites.push({ name, fn });
}

function assert(ok, message) {
  assertions += 1;
  if (!ok) throw new Error(message);
}

const show = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

const t = {
  equal(actual, expected, message) {
    assert(
      Object.is(actual, expected),
      message ? `${message} — expected ${show(expected)}, got ${show(actual)}`
        : `expected ${show(expected)}, got ${show(actual)}`
    );
  },
  deepEqual(actual, expected, message) {
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      message ? `${message} — expected ${show(expected)}, got ${show(actual)}`
        : `expected ${show(expected)}, got ${show(actual)}`
    );
  },
  ok(value, message) {
    assert(!!value, message || `expected a truthy value, got ${show(value)}`);
  },
  notOk(value, message) {
    assert(!value, message || `expected a falsy value, got ${show(value)}`);
  },
  throws(fn, message) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    assert(threw, message || 'expected this to throw');
  },
};

export async function run(files) {
  for (const file of files) await import(file);

  const started = Date.now();
  for (const suite of suites) {
    try {
      await suite.fn(t);
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${suite.name}\n`);
    } catch (error) {
      failures += 1;
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${suite.name}\n    ${error.message}\n`);
    }
  }

  const ms = Date.now() - started;
  process.stdout.write(
    `\n  ${suites.length - failures}/${suites.length} passed`
    + ` · ${assertions} assertions · ${ms}ms\n\n`
  );
  process.exit(failures ? 1 : 0);
}

/*
 * There is deliberately no self-executing block here. Every test file imports
 * `test` from this module, so running this file directly would make it import
 * a module that is still importing it — a circular graph whose top-level await
 * never settles. `all.mjs` is the entry point instead.
 */
