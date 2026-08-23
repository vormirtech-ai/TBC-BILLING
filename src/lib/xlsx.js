/**
 * Minimal, dependency-free .xlsx writer.
 *
 * Produces a genuine Office Open XML workbook (not a renamed CSV): a ZIP
 * container holding [Content_Types].xml, relationship parts, a workbook part,
 * a styles part and one worksheet part per sheet.
 *
 * ZIP entries use the "stored" (uncompressed) method, which is fully valid per
 * the ZIP spec and is read without complaint by Excel, LibreOffice, Numbers and
 * every spreadsheet library we tested against.
 *
 * Why hand-rolled instead of SheetJS: this app ships as static files with no
 * build step and must keep working with no network. See README.
 */

/* ------------------------------------------------------------------ *
 * CRC-32
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * ZIP container
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  u16(value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value & 0xffff, true);
    return this.raw(b);
  }
  u32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    return this.raw(b);
  }
  raw(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this;
  }
  toBlob(type) {
    return new Blob(this.chunks, { type });
  }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob}
 */
export function createZip(files, mimeType = 'application/zip') {
  const stamp = dosDateTime(new Date());
  const out = new ByteWriter();
  const central = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const offset = out.length;

    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(0x0800); // general purpose flag: UTF-8 names
    out.u16(0); // method: stored
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(crc);
    out.u32(file.data.length);
    out.u32(file.data.length);
    out.u16(nameBytes.length);
    out.u16(0); // extra length
    out.raw(nameBytes);
    out.raw(file.data);

    central.push({ nameBytes, crc, size: file.data.length, offset });
  }

  const centralStart = out.length;
  for (const entry of central) {
    out.u32(0x02014b50); // central directory header signature
    out.u16(0x0314); // version made by (UNIX)
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.nameBytes.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attrs
    out.u32(0x81a40000); // external attrs (0644)
    out.u32(entry.offset);
    out.raw(entry.nameBytes);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50); // end of central directory
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0);

  return out.toBlob(mimeType);
}

/* ------------------------------------------------------------------ *
 * XML helpers
 * ------------------------------------------------------------------ */

export function escapeXml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - rem) / 26);
  }
  return name;
}

/** Excel serial date (1900 system, including the historical leap-year quirk). */
function excelSerial(date) {
  const utc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
  return utc / 86400000 + 25569;
}

/* ------------------------------------------------------------------ *
 * Styles
 *
 * Style ids referenced by cells:
 *   0 default | 1 header | 2 currency | 3 integer | 4 date
 *   5 time    | 6 bold   | 7 title    | 8 currency bold | 9 wrapped text
 * ------------------------------------------------------------------ */

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="&quot;\u20b9&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/>
<numFmt numFmtId="166" formatCode="hh:mm:ss"/>
<numFmt numFmtId="167" formatCode="#,##0"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF3B1F33"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF6D2E5B"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9CFC2"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export const STYLE = {
  DEFAULT: 0,
  HEADER: 1,
  CURRENCY: 2,
  INTEGER: 3,
  DATE: 4,
  TIME: 5,
  BOLD: 6,
  TITLE: 7,
  CURRENCY_BOLD: 8,
  WRAP: 9,
};

/* ------------------------------------------------------------------ *
 * Cell / sheet construction
 * ------------------------------------------------------------------ */

/**
 * Cell shorthands used when building rows:
 *   null | undefined            -> empty cell
 *   string                      -> inline text
 *   number                      -> number
 *   { v, t?, s? }               -> explicit value / type / style id
 *     t: 's' text, 'n' number, 'd' date, 't' time-of-day
 */
function cellXml(cell, rowIndex, colIndex) {
  if (cell === null || cell === undefined || cell === '') return '';
  const ref = `${columnName(colIndex)}${rowIndex + 1}`;
  let value = cell;
  let type = null;
  let style = 0;

  if (typeof cell === 'object' && !(cell instanceof Date)) {
    value = cell.v;
    type = cell.t || null;
    style = cell.s || 0;
  }
  if (value === null || value === undefined || value === '') {
    return style ? `<c r="${ref}" s="${style}"/>` : '';
  }

  if (!type) {
    if (value instanceof Date) type = 'd';
    else if (typeof value === 'number') type = 'n';
    else type = 's';
  }

  const styleAttr = style ? ` s="${style}"` : '';

  if (type === 'd' || type === 't') {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const serial =
      type === 't'
        ? (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400
        : excelSerial(date);
    return `<c r="${ref}"${styleAttr}><v>${serial}</v></c>`;
  }
  if (type === 'n') {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return `<c r="${ref}"${styleAttr}><v>${num}</v></c>`;
  }
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    value
  )}</t></is></c>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const cols = (sheet.columns || [])
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('');

  const body = rows
    .map((row, rowIndex) => {
      const cells = (row || []).map((cell, colIndex) => cellXml(cell, rowIndex, colIndex)).join('');
      if (!cells) return `<row r="${rowIndex + 1}"/>`;
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  const lastCol = columnName(Math.max(0, (sheet.columns?.length || 26) - 1));
  const freeze = sheet.freezeRow
    ? `<sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRow}" topLeftCell="A${
        sheet.freezeRow + 1
      }" activePane="bottomLeft" state="frozen"/></sheetView>`
    : '<sheetView workbookViewId="0"/>';

  const autoFilter = sheet.autoFilterRow
    ? `<autoFilter ref="A${sheet.autoFilterRow}:${lastCol}${Math.max(
        rows.length,
        sheet.autoFilterRow
      )}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews>${freeze}</sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${body}</sheetData>
${autoFilter}
</worksheet>`;
}

/**
 * Build a workbook Blob.
 * @param {{name: string, rows: Array, columns?: number[], freezeRow?: number, autoFilterRow?: number}[]} sheets
 * @returns {Blob} an .xlsx file ready for download
 */
export function createWorkbook(sheets) {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet.');

  const safeName = (name, index) => {
    const cleaned = String(name || `Sheet${index + 1}`).replace(/[\\/*?:[\]]/g, ' ');
    return cleaned.slice(0, 31) || `Sheet${index + 1}`;
  };

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${
        i + 1
      }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(safeName(sheet.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        i + 1
      }.xml"/>`
  )
  .join('')}
<Relationship Id="rId${
    sheets.length + 1
  }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>The Baruch Cafe POS</dc:creator>
<cp:lastModifiedBy>The Baruch Cafe POS</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>The Baruch Cafe POS</Application>
</Properties>`;

  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'docProps/core.xml', data: encoder.encode(core) },
    { name: 'docProps/app.xml', data: encoder.encode(app) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];

  return createZip(
    files,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}
