/**
 * QR code generation — no dependencies, no network.
 *
 * Table QR codes have to be produced on the spot, printed, stuck to a table and
 * then scanned by whatever phone a customer happens to own. That rules out a
 * CDN library (the counter is often offline) and rules out an image API (the
 * table token would leave the cafe). So this is a self-contained encoder for QR
 * Model 2 in byte mode: Reed-Solomon error correction, all eight data masks
 * scored the way the specification says, versions 1 to 40.
 *
 * Output is an SVG element — vector, so a table card prints crisply at any size
 * — plus a PNG helper for downloads.
 */

/* ------------------------------------------------------------- tables --- */

/** Error-correction levels. The number is the level's bit pattern in the format info. */
export const ECC = {
  LOW: { id: 'L', formatBits: 1 },
  MEDIUM: { id: 'M', formatBits: 0 },
  QUARTILE: { id: 'Q', formatBits: 3 },
  HIGH: { id: 'H', formatBits: 2 },
};

/** Error-correction codewords per block, indexed [level][version]. */
const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Number of error-correction blocks, indexed [level][version]. */
const ECC_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/* ------------------------------------------------- capacity arithmetic --- */

/**
 * Modules available for data and error correction, before the format and
 * version information is reserved. Derived rather than tabulated: the finder,
 * timing and alignment patterns are all a known function of the version.
 */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function totalCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}

/** Data codewords left once error correction has taken its share. */
function dataCodewords(version, level) {
  return (
    totalCodewords(version) -
    ECC_CODEWORDS_PER_BLOCK[level.id][version] * ECC_BLOCKS[level.id][version]
  );
}

/** Byte mode uses an 8-bit length for small versions and 16-bit from 10 up. */
function characterCountBits(version) {
  return version < 10 ? 8 : 16;
}

/* --------------------------------------------------- Galois field maths --- */

/** Multiply in GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function fieldMultiply(a, b) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> i) & 1) * a;
  }
  return result & 0xff;
}

/** Coefficients of the divisor polynomial for `degree` error-correction codewords. */
function reedSolomonDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;

  // The divisor is (x - r^0)(x - r^1)…(x - r^(degree-1)), multiplied out one
  // root at a time.
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = fieldMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = fieldMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) {
      result[i] ^= fieldMultiply(divisor[i], factor);
    }
  }
  return result;
}

/* ------------------------------------------------------------ encoding --- */

function toUtf8Bytes(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  append(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

/** Smallest version that fits the payload at the requested correction level. */
function chooseVersion(byteLength, level, minVersion, maxVersion) {
  for (let version = minVersion; version <= maxVersion; version++) {
    const capacityBits = dataCodewords(version, level) * 8;
    const neededBits = 4 + characterCountBits(version) + byteLength * 8;
    if (neededBits <= capacityBits) return version;
  }
  return null;
}

/** Payload bits, terminated, byte-aligned and padded out to the version's capacity. */
function buildDataCodewords(bytes, version, level) {
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4); // byte mode
  buffer.append(bytes.length, characterCountBits(version));
  for (const byte of bytes) buffer.append(byte, 8);

  const capacityBits = dataCodewords(version, level) * 8;
  buffer.append(0, Math.min(4, capacityBits - buffer.length)); // terminator
  buffer.append(0, (8 - (buffer.length % 8)) % 8); // pad to a whole byte

  // Alternating pad bytes, as the specification prescribes.
  for (let pad = 0xec; buffer.length < capacityBits; pad ^= 0xec ^ 0x11) {
    buffer.append(pad, 8);
  }

  const codewords = new Uint8Array(buffer.length / 8);
  buffer.bits.forEach((bit, index) => {
    codewords[index >>> 3] |= bit << (7 - (index & 7));
  });
  return codewords;
}

/**
 * Split the data into blocks, compute each block's error correction, then
 * interleave. Interleaving is what makes a QR code survive a coffee ring: a
 * blot destroys a few codewords from every block rather than all of one.
 */
function addErrorCorrection(data, version, level) {
  const blockCount = ECC_BLOCKS[level.id][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level.id][version];
  const raw = totalCodewords(version);

  const shortBlockCount = blockCount - (raw % blockCount);
  const shortBlockLength = Math.floor(raw / blockCount) - eccLength;
  const divisor = reedSolomonDivisor(eccLength);

  const blocks = [];
  for (let i = 0, offset = 0; i < blockCount; i++) {
    const length = shortBlockLength + (i < shortBlockCount ? 0 : 1);
    const dataPart = data.subarray(offset, offset + length);
    offset += length;
    blocks.push({ data: dataPart, ecc: reedSolomonRemainder(dataPart, divisor) });
  }

  const result = new Uint8Array(raw);
  let cursor = 0;
  for (let i = 0; i <= shortBlockLength; i++) {
    for (const block of blocks) {
      // The one longer block contributes an extra data codeword at the end.
      if (i < block.data.length) result[cursor++] = block.data[i];
    }
  }
  for (let i = 0; i < eccLength; i++) {
    for (const block of blocks) result[cursor++] = block.ecc[i];
  }
  return result;
}

/* -------------------------------------------------------------- matrix --- */

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;

  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

class Matrix {
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark) {
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  }

  /** True where a module exists and is dark. Out of bounds counts as light. */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    return this.modules[y][x];
  }
}

function drawFinder(matrix, centreX, centreY) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const x = centreX + dx;
      const y = centreY + dy;
      if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) continue;
      // Rings at distance 0-2 and 4 are dark; distance 3 is the light ring, and
      // the outermost band is the separator.
      matrix.set(x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(matrix, centreX, centreY) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      matrix.set(centreX + dx, centreY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFunctionPatterns(matrix) {
  const { size } = matrix;

  // Timing patterns run between the finders.
  for (let i = 0; i < size; i++) {
    matrix.set(6, i, i % 2 === 0);
    matrix.set(i, 6, i % 2 === 0);
  }

  drawFinder(matrix, 3, 3);
  drawFinder(matrix, size - 4, 3);
  drawFinder(matrix, 3, size - 4);

  const positions = alignmentPositions(matrix.version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      // The three corners already carry finder patterns.
      const isCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!isCorner) drawAlignment(matrix, positions[i], positions[j]);
    }
  }

  // Reserve the format-information strips; the real bits go in after masking.
  // Index 6 is skipped in both: that module belongs to the timing pattern, which
  // runs straight through the strip and must keep its own value.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      matrix.set(8, i, false);
      matrix.set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    matrix.set(size - 1 - i, 8, false);
    matrix.set(8, size - 1 - i, false);
  }

  if (matrix.version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.set(a, b, false);
      matrix.set(b, a, false);
    }
  }
}

function drawFormatBits(matrix, level, mask) {
  const data = (level.formatBits << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
  const bit = (index) => ((bits >>> index) & 1) === 1;

  const { size } = matrix;

  // Copy one, around the top-left finder.
  for (let i = 0; i <= 5; i++) matrix.set(8, i, bit(i));
  matrix.set(8, 7, bit(6));
  matrix.set(8, 8, bit(7));
  matrix.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) matrix.set(14 - i, 8, bit(i));

  // Copy two, split between the other two finders.
  for (let i = 0; i < 8; i++) matrix.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) matrix.set(8, size - 15 + i, bit(i));
  matrix.set(8, size - 8, true); // the module that is always dark
}

function drawVersionBits(matrix) {
  if (matrix.version < 7) return;
  let remainder = matrix.version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (matrix.version << 12) | remainder;

  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = matrix.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    matrix.set(a, b, bit);
    matrix.set(b, a, bit);
  }
}

/** Zigzag the codewords upwards and downwards through the free modules. */
function drawCodewords(matrix, codewords) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing pattern
    for (let vertical = 0; vertical < matrix.size; vertical++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? matrix.size - 1 - vertical : vertical;
        if (matrix.reserved[y][x] || bitIndex >= totalBits) continue;
        matrix.modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex++;
      }
    }
  }
}

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

/** Applying a mask twice restores the original, which is how masks are compared. */
function applyMask(matrix, mask) {
  const rule = MASK_RULES[mask];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.reserved[y][x] && rule(x, y)) matrix.modules[y][x] = !matrix.modules[y][x];
    }
  }
}

/**
 * The two sequences from the specification: a 1:1:3:1:1 finder-shaped run with
 * four light modules on one side of it. A scanner hunting for real finder
 * patterns can lock onto these, so each one found is penalised heavily.
 */
const FINDER_LOOKALIKES = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

function finderLikeCount(line) {
  let count = 0;
  for (let i = 0; i + 11 <= line.length; i++) {
    for (const pattern of FINDER_LOOKALIKES) {
      let matches = true;
      for (let j = 0; j < 11; j++) {
        if (line[i + j] !== pattern[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        count++;
        break;
      }
    }
  }
  return count;
}

function penaltyScore(matrix) {
  const { size } = matrix;
  let score = 0;

  const scoreLine = (line) => {
    let runLength = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) {
        runLength++;
        continue;
      }
      // Rule 1: long runs of one colour.
      if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
      runLength = 1;
    }
    // Rule 3: finder-pattern lookalikes.
    score += finderLikeCount(line) * PENALTY_N3;
  };

  for (let y = 0; y < size; y++) scoreLine(matrix.modules[y]);
  for (let x = 0; x < size; x++) scoreLine(matrix.modules.map((row) => row[x]));

  // Rule 2: solid 2x2 blocks.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = matrix.modules[y][x];
      if (
        value === matrix.modules[y][x + 1] &&
        value === matrix.modules[y + 1][x] &&
        value === matrix.modules[y + 1][x + 1]
      ) {
        score += PENALTY_N2;
      }
    }
  }

  // Rule 4: drift away from an even balance of dark and light, counted in
  // whole five-percent steps.
  let dark = 0;
  for (const row of matrix.modules) for (const value of row) if (value) dark++;
  const darkPercent = (dark / (size * size)) * 100;
  score += Math.floor(Math.abs(darkPercent - 50) / 5) * PENALTY_N4;

  return score;
}

/* ---------------------------------------------------------------- API --- */

/**
 * Encode text as a QR code.
 *
 * @param {string} text
 * @param {{ecc?:object, minVersion?:number, maxVersion?:number, mask?:number}} [options]
 * @returns {{size:number, modules:boolean[][], version:number, mask:number, ecc:string}}
 */
export function encodeQr(text, options = {}) {
  const {
    ecc: level = ECC.MEDIUM,
    minVersion = 1,
    maxVersion = 40,
    mask: forcedMask = null,
  } = options;

  const bytes = toUtf8Bytes(text);
  const version = chooseVersion(bytes.length, level, minVersion, maxVersion);
  if (version === null) {
    throw new Error('That text is too long to fit in a QR code.');
  }

  const codewords = addErrorCorrection(buildDataCodewords(bytes, version, level), version, level);

  const matrix = new Matrix(version);
  drawFunctionPatterns(matrix);
  drawVersionBits(matrix);
  drawCodewords(matrix, codewords);

  // Try every mask and keep the one a scanner will read most reliably.
  let bestMask = forcedMask;
  if (bestMask === null) {
    let bestScore = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(matrix, candidate);
      drawFormatBits(matrix, level, candidate);
      const score = penaltyScore(matrix);
      if (score < bestScore) {
        bestScore = score;
        bestMask = candidate;
      }
      applyMask(matrix, candidate); // undo
    }
  }

  applyMask(matrix, bestMask);
  drawFormatBits(matrix, level, bestMask);

  return {
    size: matrix.size,
    modules: matrix.modules,
    version,
    mask: bestMask,
    ecc: level.id,
  };
}

/**
 * Draw a QR code as an SVG element.
 *
 * The whole code is a single `path`, so a table card stays a couple of
 * kilobytes and prints as vector art at any size.
 *
 * @param {string} text
 * @param {{size?:number, margin?:number, dark?:string, light?:string, title?:string, ecc?:object}} [options]
 */
export function renderQrSvg(text, options = {}) {
  const {
    size = 240,
    margin = 4,
    dark = '#241b16',
    light = '#ffffff',
    title = 'QR code',
    ecc = ECC.MEDIUM,
  } = options;

  const code = encodeQr(text, { ecc });
  const extent = code.size + margin * 2;

  let path = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.modules[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('xmlns', svgNamespace);
  svg.setAttribute('viewBox', `0 0 ${extent} ${extent}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  // Modules are whole units in the viewBox; crisp edges stop scanners hunting.
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(svgNamespace, 'rect');
  background.setAttribute('width', String(extent));
  background.setAttribute('height', String(extent));
  background.setAttribute('fill', light);
  svg.appendChild(background);

  const modules = document.createElementNS(svgNamespace, 'path');
  modules.setAttribute('d', path);
  modules.setAttribute('fill', dark);
  svg.appendChild(modules);

  return svg;
}

/** The same code as a standalone SVG string, for downloads and print sheets. */
export function qrSvgMarkup(text, options = {}) {
  const svg = renderQrSvg(text, options);
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Rasterise a QR code to a PNG data URL.
 *
 * Drawn module by module rather than by scaling an image, so every module lands
 * on a whole pixel and the result stays scannable at small sizes.
 */
export function qrPngDataUrl(text, options = {}) {
  const { scale = 8, margin = 4, dark = '#241b16', light = '#ffffff', ecc = ECC.MEDIUM } = options;

  const code = encodeQr(text, { ecc });
  const extent = (code.size + margin * 2) * scale;

  const canvas = document.createElement('canvas');
  canvas.width = extent;
  canvas.height = extent;

  const context = canvas.getContext('2d');
  context.fillStyle = light;
  context.fillRect(0, 0, extent, extent);
  context.fillStyle = dark;

  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.modules[y][x]) {
        context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
  }

  return canvas.toDataURL('image/png');
}
