import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { SaxesParser } from 'saxes';
import XLSX from 'xlsx';
import { ATTENDANCE_MAX_FILE_BYTES } from '../shared/retailAttendance.js';

// Only the streaming attendance preview uses these budgets. The legacy whole-book
// parser retains its 60 MiB / 50,000-row limits; no large XML DOM/grid is built here.
export const XLSX_LIMITS = Object.freeze({ entries: 2000, worksheetBytes: 160 * 1024 * 1024,
  expandedBytes: 192 * 1024 * 1024, metadataBytes: 24 * 1024 * 1024,
  sharedStringsBytes: 16 * 1024 * 1024, partBytes: 2 * 1024 * 1024,
  ratio: 200, rows: 100000, columns: 101, cells: 3000000,
  textBytes: 64 * 1024 * 1024, sourceBytes: 48 * 1024 * 1024, cellCharacters: 32767, milliseconds: 60000 });
export const XLSX_ERROR_CODES = new Set(['FILE_TOO_LARGE', 'INVALID_XLSX', 'UNSAFE_XLSX', 'XLSX_RESOURCE_LIMIT', 'PARSE_FAILURE']);
const fail = (code, message, statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const invalid = () => fail('INVALID_XLSX', 'The file is not a valid, intact .xlsx workbook.');
const resource = () => fail('XLSX_RESOURCE_LIMIT', 'The workbook exceeds safe attendance processing limits. Split it into smaller date ranges.');
const unsafe = () => fail('UNSAFE_XLSX', 'Encrypted workbooks, macros, external links and unsafe XML are not supported.');
const attr = (tag, name) => Object.values(tag.attributes).find(a => a.local === name)?.value || '';
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
const crcUpdate = (crc, bytes) => { for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ crc >>> 8; return crc >>> 0; };

export function inspectAttendanceZip(bytes, filename) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || !/\.xlsx$/i.test(filename) || filename.length > 200) invalid();
  if (bytes.length > ATTENDANCE_MAX_FILE_BYTES) fail('FILE_TOO_LARGE', 'Select a non-empty .xlsx file, maximum 15 MB.', 413);
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) invalid();
  const count = bytes.readUInt16LE(end + 10), directory = bytes.readUInt32LE(end + 16);
  if (!count || count !== bytes.readUInt16LE(end + 8)) invalid();
  if (count > XLSX_LIMITS.entries) resource();
  if (directory + bytes.readUInt32LE(end + 12) !== end) invalid();
  let offset = directory, expanded = 0, metadata = 0;
  const parts = new Map(), occupied = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + length + extra + comment > end || !length || length > 512 || bytes.readUInt16LE(offset + 34)) invalid();
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + length), name = nameBytes.toString('utf8');
    if (flags & 0x41 || /vbaProject|externalLinks|activeX/i.test(name) || /(^|\/)\.\.(\/|$)|\\|\x00|^\/|^[A-Za-z]:/.test(name)) unsafe();
    if (parts.has(name.toLowerCase()) || ![0, 8].includes(method) || [size, compressed, local].includes(0xffffffff)) invalid();
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
    const limit = worksheet ? XLSX_LIMITS.worksheetBytes : name === 'xl/sharedStrings.xml' ? XLSX_LIMITS.sharedStringsBytes : XLSX_LIMITS.partBytes;
    expanded += size; if (!worksheet) metadata += size;
    if (size > limit || expanded > XLSX_LIMITS.expandedBytes || metadata > XLSX_LIMITS.metadataBytes || size / Math.max(1, compressed) > XLSX_LIMITS.ratio) resource();
    if (local + 30 > directory || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
    const localLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localLength + localExtra;
    if (start + compressed > directory || localLength !== length || !bytes.subarray(local + 30, local + 30 + localLength).equals(nameBytes)) invalid();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size || bytes.readUInt32LE(local + 14) !== bytes.readUInt32LE(offset + 16))) invalid();
    if (method === 0 && compressed !== size) invalid();
    occupied.push([local, start + compressed]);
    parts.set(name.toLowerCase(), { name, size, compressed, start, method, crc: bytes.readUInt32LE(offset + 16), worksheet });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) invalid();
  occupied.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < occupied.length; i++) if (occupied[i][0] < occupied[i - 1][1]) invalid();
  for (const required of ['[content_types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels']) if (!parts.has(required)) invalid();
  return { parts, expanded };
}

// The byte/CRC and XML lexical guards run before the SAX parser sees each chunk.
// Neither an inflated worksheet buffer nor a full workbook object is retained.
async function xmlPart(bytes, part, budget, callbacks = {}) {
  const isXml = /\.(xml|rels)$/i.test(part.name);
  const source = Readable.from([bytes.subarray(part.start, part.start + part.compressed)]);
  const stream = part.method === 8 ? source.pipe(createInflateRaw({ chunkSize: 16384 })) : source;
  const decoder = new StringDecoder('utf8');
  const parser = new SaxesParser({ xmlns: true });
  let actual = 0, crc = 0xffffffff, run = 0, prefix = '', tail = '', depth = 0;
  let mode = 'text', quote = '', tokenPrefix = '', previous = '', beforePrevious = '';
  parser.on('doctype', unsafe);
  parser.on('error', invalid);
  parser.on('opentag', tag => {
    if (++depth > 64) resource();
    if (tag.local === 'Relationship' && (attr(tag, 'TargetMode').trim().toLowerCase() === 'external' || /vbaProject|activeX|oleObject/i.test(attr(tag, 'Type')))) unsafe();
    if (tag.local === 'externalReference') unsafe();
    // Some legitimate writers declare an unused macro-capable .bin default.
    // Refuse it only when a matching part exists; actual macro overrides always fail.
    if ((tag.local === 'Override' || tag.local === 'Default' && budget.extensions.has(attr(tag, 'Extension').toLowerCase())) && /macroEnabled|vbaProject|activeX/i.test(attr(tag, 'ContentType'))) unsafe();
    callbacks.open?.(tag);
  });
  parser.on('closetag', tag => { callbacks.close?.(tag); depth--; });
  parser.on('text', text => callbacks.text?.(text));
  parser.on('cdata', text => callbacks.text?.(text));
  const feed = text => {
    if (/<!DOCTYPE|<!ENTITY/i.test(tail + text)) unsafe();
    tail = text.slice(-32);
    // Cap individual XML tokens before the parser can accumulate a huge value/attribute.
    for (const c of text) {
      if (mode === 'cdata' || mode === 'comment') {
        if (c === '>' && previous === (mode === 'cdata' ? ']' : '-') && beforePrevious === previous) { mode = 'text'; run = 0; }
        else if (++run > (mode === 'cdata' ? 524288 : 65536)) resource();
      } else if (mode === 'tag') {
        if (tokenPrefix.length < 9) tokenPrefix += c;
        if (tokenPrefix === '<![CDATA[') { mode = 'cdata'; run = 0; }
        else if (tokenPrefix === '<!--') { mode = 'comment'; run = 0; }
        else {
          if (quote) { if (c === quote) quote = ''; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === '>') { mode = 'text'; run = 0; }
          if (++run > 65536) resource();
        }
      } else if (c === '<') { mode = 'tag'; tokenPrefix = '<'; quote = ''; run = 1; }
      else if (++run > 524288) resource();
      beforePrevious = previous; previous = c;
    }
    parser.write(text);
  };
  try {
    for await (const chunk of stream) {
      actual += chunk.length; budget.expanded += chunk.length;
      if (actual > part.size) invalid();
      if (budget.expanded > XLSX_LIMITS.expandedBytes || Date.now() - budget.started > XLSX_LIMITS.milliseconds) resource();
      crc = crcUpdate(crc, chunk);
      if (isXml) {
        if (!prefix) { prefix = chunk.subarray(0, 3).toString('hex'); if (/^(fffe|feff)/.test(prefix)) invalid(); }
        feed(decoder.write(chunk));
      }
    }
    if (isXml) { feed(decoder.end()); parser.close(); }
    if (actual !== part.size || ((crc ^ 0xffffffff) >>> 0) !== part.crc) invalid();
  } catch (error) {
    if (XLSX_ERROR_CODES.has(error.code)) throw error;
    invalid();
  } finally { stream.destroy(); source.destroy(); }
}

export async function parseAttendanceWorkbookStreaming(bytes, filename, columns) {
  const archive = inspectAttendanceZip(bytes, filename), budget = { started: Date.now(), expanded: 0,
    extensions: new Set([...archive.parts.values()].map(p => path.posix.extname(p.name).slice(1).toLowerCase())) };
  const done = new Set(), get = name => archive.parts.get(name.toLowerCase());
  const read = async (name, callbacks) => { const part = get(name); if (!part) invalid(); await xmlPart(bytes, part, budget, callbacks); done.add(name.toLowerCase()); };
  const shared = [], formats = new Map(), styles = [], relationships = new Map(), sheets = [];
  let date1904 = false, insideCellXfs = false;
  await read('[Content_Types].xml');
  await read('_rels/.rels');
  await read('xl/_rels/workbook.xml.rels', { open(tag) {
    if (tag.local !== 'Relationship') return;
    const target = attr(tag, 'Target');
    if (/^[a-z]+:|\\|\x00/i.test(target)) unsafe();
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target);
    if (!resolved.startsWith('xl/') || resolved.includes('../')) unsafe();
    relationships.set(attr(tag, 'Id'), resolved);
  } });
  await read('xl/workbook.xml', { open(tag) {
    if (tag.local === 'workbookPr') date1904 = ['1', 'true'].includes(attr(tag, 'date1904'));
    if (tag.local === 'sheet') {
      if (sheets.length >= 32) resource();
      const target = relationships.get(attr(tag, 'id'));
      if (!target || !get(target)?.worksheet) invalid();
      sheets.push({ name: attr(tag, 'name'), target });
    }
  } });
  if (get('xl/styles.xml')) await read('xl/styles.xml', {
    open(tag) {
      if (tag.local === 'cellXfs') insideCellXfs = true;
      if (tag.local === 'numFmt') { if (formats.size >= 512 || attr(tag, 'formatCode').length > 512) resource(); formats.set(Number(attr(tag, 'numFmtId')), attr(tag, 'formatCode')); }
      if (tag.local === 'xf' && insideCellXfs) { if (styles.length >= 4096) resource(); styles.push(Number(attr(tag, 'numFmtId'))); }
    }, close(tag) { if (tag.local === 'cellXfs') insideCellXfs = false; },
  });
  if (get('xl/sharedStrings.xml')) {
    let text = '', collecting = false, inText = false, phonetic = false;
    await read('xl/sharedStrings.xml', {
      open(tag) { if (tag.local === 'si') { collecting = true; text = ''; } if (tag.local === 'rPh') phonetic = true; if (tag.local === 't') inText = true; },
      text(value) { if (collecting && inText && !phonetic) { text += value; if (text.length > XLSX_LIMITS.cellCharacters) resource(); } },
      close(tag) { if (tag.local === 't') inText = false; if (tag.local === 'rPh') phonetic = false; if (tag.local === 'si') { if (shared.length >= 250000) resource(); shared.push(text); collecting = false; } },
    });
  }
  let cells = 0, retainedCells = 0, textBytes = 0, sourceBytes = 0, selected = null, internBytes = 0;
  // Monthly exports repeat names, sites and dates thousands of times. Reuse only
  // bounded short strings; never retain another worksheet/grid or an unlimited cache.
  const interned = new Map();
  const intern = value => {
    if (typeof value !== 'string' || value.length > 256) return value;
    const prior = interned.get(value); if (prior !== undefined) return prior;
    if (interned.size < 100000 && internBytes + value.length * 2 <= 8 * 1024 * 1024) {
      interned.set(value, value); internBytes += value.length * 2;
    }
    return value;
  };
  const decodeText = value => value.includes('_x') ? value.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : value;
  for (const sheet of sheets) {
    let rowNumber = 0, lastRow = 0, width = 0, values, formulas, formulaAttributes, cell, capture = '', headers, indexes, phonetic = false;
    const rows = [];
    await read(sheet.target, {
      open(tag) {
        if (tag.local === 'dimension') {
          try { const d = XLSX.utils.decode_range(attr(tag, 'ref')); if (d.e.c >= XLSX_LIMITS.columns || d.e.r > XLSX_LIMITS.rows) resource(); width = d.e.c + 1; }
          catch (error) { if (XLSX_ERROR_CODES.has(error.code)) throw error; invalid(); }
        }
        if (tag.local === 'row') {
          rowNumber = Number(attr(tag, 'r')); if (!Number.isSafeInteger(rowNumber) || rowNumber <= lastRow) invalid();
          if (rowNumber > XLSX_LIMITS.rows + 1) resource(); lastRow = rowNumber; values = []; formulas = {}; formulaAttributes = {};
        }
        if (tag.local === 'c') {
          if (!values || ++cells > XLSX_LIMITS.cells) resource();
          const ref = attr(tag, 'r'), match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref); if (!match || Number(match[2]) !== rowNumber) invalid();
          let col = 0; for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
          if (col > XLSX_LIMITS.columns) resource(); if (Object.hasOwn(values, col - 1)) invalid();
          cell = { col: col - 1, type: attr(tag, 't'), style: Number(attr(tag, 's') || 0), value: '', formula: null };
        }
        if (tag.local === 'rPh') phonetic = true;
        if (cell && ['v', 't', 'f'].includes(tag.local) && !phonetic) {
          capture = tag.local;
          if (capture === 'f') { cell.formula = ''; cell.formulaAttributes = Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value])); }
        }
      },
      text(value) {
        if (!cell || !capture || phonetic) return;
        if (capture === 'f') cell.formula += value; else cell.value += value;
        if (cell.value.length > XLSX_LIMITS.cellCharacters || (cell.formula?.length || 0) > XLSX_LIMITS.cellCharacters) resource();
      },
      close(tag) {
        if (tag.local === 'rPh') phonetic = false;
        if (['v', 't', 'f'].includes(tag.local)) capture = '';
        if (tag.local === 'c' && cell) {
          let value = cell.value;
          if (cell.type === 's') { const i = Number(value); if (!Number.isInteger(i) || i < 0 || i >= shared.length) invalid(); value = shared[i]; }
          else if (cell.type === 'b') value = value === '1';
          else if (cell.type === 'd') { const d = Date.parse(value); if (!Number.isFinite(d)) invalid(); value = (d - Date.UTC(1899, 11, 30)) / 86400000 - (date1904 ? 1462 : 0); }
          else if (!cell.type || cell.type === 'n') { if (value !== '') { value = Number(value); if (!Number.isFinite(value)) invalid(); } }
          textBytes += typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 8;
          if (textBytes > XLSX_LIMITS.textBytes) resource();
          values[cell.col] = intern(typeof value === 'string' ? decodeText(value) : value);
          if (cell.formula !== null) formulas[cell.col] = cell.formula;
          if (cell.formulaAttributes && Object.keys(cell.formulaAttributes).length) formulaAttributes[cell.col] = cell.formulaAttributes;
          // Numeric identity formatting matches the existing parser, without formatting raw source evidence.
          if (indexes && ['employee_code', 'store_code'].some(k => indexes[k] === cell.col) && typeof value === 'number') {
            const id = styles[cell.style] || 0, z = formats.get(id) || XLSX.SSF.get_table()[id] || 'General';
            cell.formatted = XLSX.utils.format_cell({ t: 'n', v: value, z });
          }
          if (cell.formatted !== undefined) values.identityFormats = { ...values.identityFormats, [cell.col]: cell.formatted };
          cell = null;
        }
        if (tag.local === 'row' && values) {
          width = Math.max(width, values.length);
          const raw = Array.from({ length: width }, (_, i) => values[i] ?? '');
          if (rowNumber === 1) {
            headers = raw;
            if (Object.values(columns).every(h => headers.filter(v => String(v).trim() === h).length === 1)) {
              if (selected) fail('INVALID_XLSX', 'Exactly one worksheet must contain the required attendance headers.');
              indexes = Object.fromEntries(Object.entries(columns).map(([k, h]) => [k, headers.findIndex(v => String(v).trim() === h)]));
            }
          } else if (indexes && (raw.some(v => v !== '') || Object.keys(formulas).length)) {
            retainedCells += raw.length;
            if (retainedCells > XLSX_LIMITS.cells) resource();
            const row = { source_row: rowNumber, raw_cells: raw, raw_formulas: formulas };
            if (Object.keys(formulaAttributes).length) row.raw_formula_attributes = formulaAttributes;
            for (const [key, col] of Object.entries(indexes)) {
              if (Object.hasOwn(formulas, col)) fail('INVALID_XLSX', 'Formulas are not allowed in mandatory attendance fields.');
              row[key] = values.identityFormats?.[col] ?? raw[col];
              if (key === 'attendance_date' && typeof row[key] === 'number') {
                const date = XLSX.SSF.parse_date_code(row[key], { date1904 });
                row[key] = date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : '';
              }
            }
            // Count one short-lived row serialization, not another whole-workbook JSON copy.
            sourceBytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
            if (sourceBytes > XLSX_LIMITS.sourceBytes) resource();
            rows.push(row);
          }
          values = null;
        }
      },
    });
    if (indexes) {
      // A legal worksheet may omit <dimension>; match the old rectangular source
      // evidence without allowing sparse far-right cells to allocate an unbounded grid.
      while (headers.length < width) headers.push('');
      for (const row of rows) if (row.raw_cells.length < width) {
        const previous = row.raw_cells.length, extra = width - previous;
        retainedCells += extra; sourceBytes += extra * 3;
        if (retainedCells > XLSX_LIMITS.cells || sourceBytes > XLSX_LIMITS.sourceBytes) resource();
        row.raw_cells.length = width; row.raw_cells.fill('', previous);
      }
      selected = { sheet: sheet.name, headers, rows };
    }
  }
  // Verify unused XML parts too: hidden relationships/DTDs must not bypass protection.
  for (const [key, part] of archive.parts) if (!done.has(key)) {
    if (!/\.(xml|rels)$/i.test(part.name) && !/^(xl\/media\/[^/]+\.(png|jpe?g|gif|webp|emf|wmf)|docProps\/thumbnail\.(png|jpe?g)|xl\/printerSettings\/[^/]+\.bin)$/i.test(part.name)) unsafe();
    await read(part.name);
  }
  if (!selected) fail('INVALID_XLSX', 'Exactly one worksheet must contain EP No, EP Name, Site Code, Att. Date, Att. Status and Class.');
  return selected;
}

let previewActive = false;
export function acquireAttendancePreviewSlot() {
  if (previewActive) fail('XLSX_RESOURCE_LIMIT', 'Another attendance preview is processing. Retry after it finishes.', 429);
  previewActive = true;
  return () => { previewActive = false; };
}
