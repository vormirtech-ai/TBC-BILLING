/**
 * QR encoder tests.
 *
 * The interesting property of a QR code is not "it produced a matrix" — it is
 * "a scanner gets the original text back". So rather than compare against
 * stored bitmaps, this file contains a small independent DECODER: it reads the
 * format information out of the finished matrix, removes the mask, walks the
 * zigzag, de-interleaves the blocks and parses the byte-mode segment. If the
 * text survives that round trip, the encoder placed every module where the
 * specification says it should be.
 *
 * The encoder was additionally checked module-for-module against an
 * independent implementation across versions 1-33 and all four correction
 * levels while it was written; this file is what keeps it honest from here on.
 */

import { encodeQr, ECC } from '../src/lib/qrcode.js';

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}${detail ? `\n  ${detail}` : ''}`);
  }
}

function eq(name, got, want) {
  check(name, got === want, `got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
}

/* ------------------------------------------------------------ decoder --- */

const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const ECC_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const MASK_RULES = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const LEVEL_BY_FORMAT_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

/** Rebuild the map of modules that carry structure rather than data. */
function functionModuleMap(version) {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) reserved[y][x] = true;
  };

  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(positions[i] + dx, positions[j] + dy);
    }
  }
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      mark(8, i);
      mark(i, 8);
    }
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }
  return reserved;
}

/** Read the 15-bit format string back out of the top-left strips. */
function readFormat(modules) {
  let bits = 0;
  const read = (x, y) => (modules[y][x] ? 1 : 0);
  for (let i = 0; i <= 5; i++) bits |= read(8, i) << i;
  bits |= read(8, 7) << 6;
  bits |= read(8, 8) << 7;
  bits |= read(7, 8) << 8;
  for (let i = 9; i < 15; i++) bits |= read(14 - i, 8) << i;

  const unmasked = bits ^ 0x5412;
  const data = unmasked >>> 10;
  return { level: LEVEL_BY_FORMAT_BITS[data >>> 3], mask: data & 0b111 };
}

/** Walk the zigzag and pull the codewords back out. */
function readCodewords(modules, version, mask) {
  const size = version * 4 + 17;
  const reserved = functionModuleMap(version);
  const rule = MASK_RULES[mask];
  const bits = [];

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x]) continue;
        const value = modules[y][x] !== rule(x, y); // remove the mask
        bits.push(value ? 1 : 0);
      }
    }
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  return bytes;
}

/** Undo the block interleaving and drop the error-correction codewords. */
function deinterleave(codewords, version, level) {
  const blockCount = ECC_BLOCKS[level][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlockCount = blockCount - (raw % blockCount);
  const shortBlockLength = Math.floor(raw / blockCount) - eccLength;

  const lengths = [];
  for (let i = 0; i < blockCount; i++) {
    lengths.push(shortBlockLength + (i < shortBlockCount ? 0 : 1));
  }

  const blocks = lengths.map(() => []);
  let cursor = 0;
  for (let i = 0; i <= shortBlockLength; i++) {
    for (let b = 0; b < blockCount; b++) {
      if (i < lengths[b]) blocks[b].push(codewords[cursor++]);
    }
  }
  return blocks.flat();
}

/** Parse a single byte-mode segment. */
function readByteSegment(data, version) {
  const bits = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);

  let cursor = 0;
  const take = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | bits[cursor++];
    return value;
  };

  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`expected byte mode, read ${mode}`);
  const length = take(version < 10 ? 8 : 16);

  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Full round trip: matrix in, original text out. */
function decodeQr(code) {
  const format = readFormat(code.modules);
  const codewords = readCodewords(code.modules, code.version, format.mask);
  const data = deinterleave(codewords, code.version, format.level);
  return { text: readByteSegment(data, code.version), ...format };
}

/* ------------------------------------------------------- round trips --- */

const LEVELS = [
  ['L', ECC.LOW],
  ['M', ECC.MEDIUM],
  ['Q', ECC.QUARTILE],
  ['H', ECC.HIGH],
];

const SAMPLES = [
  'HELLO',
  'x',
  'https://vormirtech-ai.github.io/tbc-billing/#/order?t=T1-9f3ac2',
  'https://the-baruch-cafe.example.github.io/tbc/#/order?t=tbl_k29fj3a8s7d1x',
  'TBC1|3|a1:2,b7:1,c9:4|9f3a',
  'Table 12 · Rooftop — ₹1,240.50 · café ☕',
  'a'.repeat(120),
  'Ω≈ç√∫˜µ≤≥÷ multibyte payload with émojis ☕→ and punctuation!@#$%^&*()',
  JSON.stringify({ v: 1, table: 7, lines: [{ i: 'itm_a1b2', q: 2 }, { i: 'itm_c3d4', q: 1 }] }),
];

for (const [name, level] of LEVELS) {
  for (const sample of SAMPLES) {
    const code = encodeQr(sample, { ecc: level });
    let decoded;
    try {
      decoded = decodeQr(code);
    } catch (error) {
      check(`round trip ${name} ${sample.slice(0, 18)}`, false, String(error.message));
      continue;
    }
    check(
      `round trip ${name} len=${sample.length} v${code.version}`,
      decoded.text === sample,
      `got  ${JSON.stringify(decoded.text.slice(0, 60))}\n  want ${JSON.stringify(sample.slice(0, 60))}`
    );
    eq(`format level ${name} len=${sample.length}`, decoded.level, name);
    eq(`format mask ${name} len=${sample.length}`, decoded.mask, code.mask);
  }
}

// Every mask must produce a readable symbol, not just the one that scores best.
for (let mask = 0; mask < 8; mask++) {
  const text = 'https://example.github.io/tbc-billing/#/order?t=tbl_9f3ac2';
  const code = encodeQr(text, { ecc: ECC.MEDIUM, mask });
  eq(`forced mask ${mask} round trip`, decodeQr(code).text, text);
  eq(`forced mask ${mask} recorded`, code.mask, mask);
}

/* --------------------------------------------------- structure checks --- */

// 'TBC' is 3 bytes, which fits the smallest symbol; 'The Baruch Cafe' is 15
// bytes and needs the next one up at this correction level.
const code = encodeQr('TBC', { ecc: ECC.MEDIUM });
eq('version 1 chosen for a 3-byte payload', code.version, 1);
eq('version 1 is 21 modules', code.size, 21);
eq('matrix is square', code.modules.length, code.size);
eq('row width matches size', code.modules[0].length, code.size);
eq('15 bytes needs version 2 at level M', encodeQr('The Baruch Cafe', { ecc: ECC.MEDIUM }).version, 2);

// Finder patterns: dark core, light ring, dark ring, in all three corners.
for (const [cx, cy] of [[3, 3], [code.size - 4, 3], [3, code.size - 4]]) {
  let ok = true;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (code.modules[cy + dy][cx + dx] !== (distance !== 2)) ok = false;
    }
  }
  check(`finder pattern at ${cx},${cy}`, ok);
}

// Timing patterns alternate, and the module below the top-left format strip is
// always dark.
let timingOk = true;
for (let i = 8; i < code.size - 8; i++) {
  if (code.modules[6][i] !== (i % 2 === 0)) timingOk = false;
  if (code.modules[i][6] !== (i % 2 === 0)) timingOk = false;
}
check('timing patterns alternate through the format strips', timingOk);
check('the always-dark module is dark', code.modules[code.size - 8][8] === true);

// Versions step up as the payload grows, and stay inside the format.
const growth = [10, 30, 60, 120, 300, 700].map((n) => encodeQr('a'.repeat(n), { ecc: ECC.MEDIUM }).version);
check(
  'version increases with payload size',
  growth.every((version, index) => index === 0 || version >= growth[index - 1]),
  JSON.stringify(growth)
);
check('versions stay within 1-40', growth.every((version) => version >= 1 && version <= 40));

let threw = false;
try {
  encodeQr('a'.repeat(5000), { ecc: ECC.HIGH });
} catch {
  threw = true;
}
check('over-long payload is rejected with an error', threw);

// A table link at the size actually used on a printed card.
const tableCode = encodeQr('https://example.github.io/tbc-billing/#/order?t=tbl_k29fj3a8', {
  ecc: ECC.MEDIUM,
});
check('a table link fits in a small version', tableCode.version <= 6, `version ${tableCode.version}`);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
