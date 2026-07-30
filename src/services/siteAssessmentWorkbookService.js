import * as XLSX from 'xlsx';
import {
  commercialRows,
  equipmentRows,
  manpowerRows,
  mpdMatrix,
  normalizeExportInput,
  safeWorkbookFilename,
  surveyReportRows,
} from './siteAssessmentWorkbookMapping.js';

const TEMPLATE_PATH = '/templates/Survey Report Format (1).xlsx';
const dateCell = (value) => {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : value;
};

function cellAddress(row, col) { return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 }); }

function cloneStyle(style) {
  if (!style || typeof style !== 'object') return style;
  return JSON.parse(JSON.stringify(style));
}

function copyStyle(ws, sourceRow, targetRow, startCol = 1, endCol = 11) {
  for (let col = startCol; col <= endCol; col += 1) {
    const source = ws[cellAddress(sourceRow, col)];
    if (!source?.s) continue;
    const targetAddress = cellAddress(targetRow, col);
    ws[targetAddress] = { ...(ws[targetAddress] || {}), s: cloneStyle(source.s) };
  }
  if (ws['!rows']?.[sourceRow - 1]) ws['!rows'][targetRow - 1] = { ...ws['!rows'][sourceRow - 1] };
}

function shiftRows(ws, startRow, count) {
  if (!count) return;
  const cells = Object.keys(ws).filter((key) => !key.startsWith('!'));
  cells.sort((left, right) => XLSX.utils.decode_cell(right).r - XLSX.utils.decode_cell(left).r);
  cells.forEach((key) => {
    const decoded = XLSX.utils.decode_cell(key);
    if (decoded.r + 1 < startRow) return;
    const next = XLSX.utils.encode_cell({ r: decoded.r + count, c: decoded.c });
    ws[next] = ws[key];
    delete ws[key];
  });
  if (Array.isArray(ws['!rows'])) {
    for (let index = ws['!rows'].length - 1; index >= startRow - 1; index -= 1) {
      ws['!rows'][index + count] = ws['!rows'][index];
    }
    for (let index = startRow - 1; index < startRow - 1 + count; index += 1) ws['!rows'][index] = undefined;
  }
  ws['!merges'] = (ws['!merges'] || []).map((merge) => {
    const next = { s: { ...merge.s }, e: { ...merge.e } };
    if (next.s.r + 1 >= startRow) { next.s.r += count; next.e.r += count; }
    else if (next.e.r + 1 >= startRow) next.e.r += count;
    return next;
  });
}

function setCell(ws, row, col, value, { styleFrom, format, wrap = false } = {}) {
  const address = cellAddress(row, col);
  const existing = ws[address] || {};
  const style = cloneStyle(existing.s || (styleFrom ? ws[cellAddress(styleFrom.row, styleFrom.col)]?.s : undefined));
  const cell = { ...existing, v: value };
  if (value instanceof Date) cell.t = 'd';
  else if (typeof value === 'number') cell.t = 'n';
  else cell.t = 's';
  if (format) cell.z = format;
  if (style || wrap) cell.s = { ...(style || {}), ...(wrap ? { alignment: { ...(style?.alignment || {}), wrapText: true, vertical: 'top' } } : {}) };
  ws[address] = cell;
}

function setFormula(ws, row, col, formula, options = {}) {
  const address = cellAddress(row, col);
  const existing = ws[address] || {};
  ws[address] = { ...existing, t: 'n', f: formula, v: 0, ...(options.style ? { s: cloneStyle(options.style) } : {}) };
}

function clearRows(ws, startRow, endRow, startCol, endCol) {
  for (let row = startRow; row <= endRow; row += 1) for (let col = startCol; col <= endCol; col += 1) {
    const address = cellAddress(row, col);
    if (ws[address]) {
      const style = ws[address].s;
      ws[address] = style ? { s: style } : {};
    }
  }
}

function writeSurveyReport(ws, input) {
  const rows = surveyReportRows(input);
  const header = rows.header;
  const headerValues = [[3, header.date, true], [4, header.clientName], [5, header.address], [6, header.contact], [7, header.phone], [8, header.surveyor], [9, header.location]];
  headerValues.forEach(([row, value, isDate]) => setCell(ws, row, 3, isDate ? dateCell(value) : value, { styleFrom: { row, col: 3 }, format: isDate ? 'dd-mmm-yyyy' : undefined, wrap: true }));
  setCell(ws, 10, 4, header.industry, { styleFrom: { row: 10, col: 4 }, wrap: true });
  setCell(ws, 10, 6, header.zone, { styleFrom: { row: 10, col: 6 }, wrap: true });
  rows.facility.forEach(([row, value, applicability]) => {
    if (row >= 20 && row <= 39) {
      setCell(ws, row, 3, applicability, { styleFrom: { row, col: 3 }, wrap: true });
    }
    setCell(ws, row, 4, value, { styleFrom: { row, col: 4 }, format: typeof value === 'number' ? '#,##0.00' : undefined, wrap: true });
  });

  const currentEquipment = equipmentRows(input.resources.current_equipment);
  const currentManpower = manpowerRows(input.resources.current_manpower);
  const suggestedEquipment = equipmentRows(input.resources.suggested_equipment);
  const suggestedManpower = manpowerRows(input.resources.suggested_manpower);
  const currentCount = Math.max(currentEquipment.length, currentManpower.length, 1);
  const currentCapacity = 4;
  const currentExtra = Math.max(0, currentCount - currentCapacity);
  if (currentExtra) shiftRows(ws, 47, currentExtra);
  const suggestedHeaderRow = 47 + currentExtra;
  const suggestedStart = suggestedHeaderRow + 2;
  const suggestedCount = Math.max(suggestedEquipment.length, suggestedManpower.length, 1);
  const suggestedCapacity = 8;
  const suggestedExtra = Math.max(0, suggestedCount - suggestedCapacity);
  if (suggestedExtra) shiftRows(ws, suggestedStart + suggestedCapacity, suggestedExtra);
  const currentStart = 43;
  const currentRows = Math.max(currentCount, currentCapacity);
  clearRows(ws, currentStart, currentStart + currentRows - 1, 2, 6);
  for (let index = 0; index < currentCount; index += 1) {
    const row = currentStart + index;
    const equipment = currentEquipment[index];
    const manpower = currentManpower[index];
    setCell(ws, row, 2, equipment?.description || (index === 0 ? 'N/A' : ''), { styleFrom: { row: 43, col: 2 }, wrap: true });
    setCell(ws, row, 3, equipment?.quantity ?? (index === 0 ? 0 : ''), { styleFrom: { row: 43, col: 3 }, format: '0' });
    setCell(ws, row, 4, manpower?.designation || (index === 0 ? 'N/A' : ''), { styleFrom: { row: 43, col: 4 }, wrap: true });
    setCell(ws, row, 5, manpower?.headCount ?? (index === 0 ? 0 : ''), { styleFrom: { row: 43, col: 5 }, format: '0' });
    setCell(ws, row, 6, manpower?.salary ?? (index === 0 ? 0 : ''), { styleFrom: { row: 43, col: 6 }, format: '₹#,##0.00' });
  }
  for (let row = currentStart + 1; row < currentStart + currentCount; row += 1) copyStyle(ws, 43, row, 2, 6);
  for (let row = currentStart + currentCount; row < suggestedHeaderRow; row += 1) clearRows(ws, row, row, 2, 6);
  setCell(ws, suggestedHeaderRow + 1, 2, 'Description', { styleFrom: { row: 48, col: 2 } });
  setCell(ws, suggestedHeaderRow + 1, 3, 'Quantity', { styleFrom: { row: 48, col: 3 } });
  setCell(ws, suggestedHeaderRow + 1, 4, 'Designation', { styleFrom: { row: 48, col: 4 } });
  setCell(ws, suggestedHeaderRow + 1, 5, 'Head Count', { styleFrom: { row: 48, col: 5 } });
  setCell(ws, suggestedHeaderRow + 1, 6, 'Monthly Take home Salary', { styleFrom: { row: 48, col: 6 } });
  clearRows(ws, suggestedStart, suggestedStart + Math.max(suggestedCount, suggestedCapacity) - 1, 2, 6);
  for (let index = 0; index < suggestedCount; index += 1) {
    const row = suggestedStart + index;
    const equipment = suggestedEquipment[index];
    const manpower = suggestedManpower[index];
    setCell(ws, row, 2, equipment?.description || (index === 0 ? 'N/A' : ''), { styleFrom: { row: 49, col: 2 }, wrap: true });
    setCell(ws, row, 3, equipment?.quantity ?? (index === 0 ? 0 : ''), { styleFrom: { row: 49, col: 3 }, format: '0' });
    setCell(ws, row, 4, manpower?.designation || (index === 0 ? 'No proposed manpower deployment available' : ''), { styleFrom: { row: 49, col: 4 }, wrap: true });
    setCell(ws, row, 5, manpower?.headCount ?? (index === 0 ? 0 : ''), { styleFrom: { row: 49, col: 5 }, format: '0' });
    setCell(ws, row, 6, manpower?.salary ?? (index === 0 ? 0 : ''), { styleFrom: { row: 49, col: 6 }, format: '₹#,##0.00' });
  }
  for (let row = suggestedStart + 1; row < suggestedStart + suggestedCount; row += 1) copyStyle(ws, suggestedStart, row, 2, 6);
  ws['!ref'] = `A1:F${Math.max(56 + currentExtra + suggestedExtra, suggestedStart + suggestedCount)}`;
}

function writeMpd(ws, input) {
  const matrix = mpdMatrix(input.resources.suggested_manpower);
  const titleMerges = (ws['!merges'] || []).filter((merge) => merge.s.r < 2);
  ws['!merges'] = titleMerges;
  clearRows(ws, 3, Math.max(10, (ws['!ref'] || 'A1:K10').split(':')[1] ? XLSX.utils.decode_cell((ws['!ref'] || 'A1:K10').split(':')[1]).r + 1 : 10), 1, 30);
  if (!matrix.groups.length) {
    setCell(ws, 5, 2, 'No proposed manpower deployment available', { styleFrom: { row: 5, col: 2 }, wrap: true });
    ws['!merges'] = [...titleMerges, { s: { r: 4, c: 1 }, e: { r: 4, c: 8 } }];
    ws['!ref'] = 'A1:K6';
    return;
  }
  setCell(ws, 3, 1, 'S. No', { styleFrom: { row: 3, col: 1 } });
  setCell(ws, 3, 2, 'Location', { styleFrom: { row: 3, col: 2 } });
  let column = 3;
  const columns = [];
  matrix.groups.forEach((group) => {
    const start = column;
    group.shifts.forEach((shift) => { columns.push({ designation: group.designation, shift, column }); column += 1; });
    ws['!merges'].push({ s: { r: 2, c: start - 1 }, e: { r: 2, c: column - 2 } });
    setCell(ws, 3, start, group.designation, { styleFrom: { row: 3, col: 3 }, wrap: true });
  });
  ws['!merges'].push({ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } });
  matrix.groups.forEach((group) => group.shifts.forEach((shift, index) => setCell(ws, 4, columns.find((columnInfo) => columnInfo.designation === group.designation && columnInfo.shift === shift).column, shift, { styleFrom: { row: 4, col: 3 }, wrap: true })));
  const dataStart = 5;
  matrix.values.forEach((item, index) => {
    const row = dataStart + index;
    setCell(ws, row, 1, index + 1, { styleFrom: { row: 5, col: 1 }, format: '0' });
    setCell(ws, row, 2, item.location, { styleFrom: { row: 5, col: 2 }, wrap: true });
    columns.forEach((columnInfo) => setCell(ws, row, columnInfo.column, item.cells[`${columnInfo.designation}|||${columnInfo.shift}`] || 0, { styleFrom: { row: 5, col: 3 }, format: '0' }));
    setCell(ws, row, column + 1, item.remarks, { styleFrom: { row: 5, col: 11 }, wrap: true });
  });
  const totalRow = dataStart + matrix.values.length;
  setCell(ws, totalRow, 1, 'Total', { styleFrom: { row: 9, col: 1 } });
  columns.forEach((columnInfo) => setFormula(ws, totalRow, columnInfo.column, `SUM(${cellAddress(dataStart, columnInfo.column)}:${cellAddress(totalRow - 1, columnInfo.column)})`, { style: ws[cellAddress(9, 3)]?.s }));
  setCell(ws, totalRow, column + 1, 'Overall head count', { styleFrom: { row: 9, col: 11 }, wrap: true });
  setFormula(ws, totalRow, column + 2, `SUM(${cellAddress(totalRow, 3)}:${cellAddress(totalRow, column)})`, { style: ws[cellAddress(9, 3)]?.s });
  const subtotalRow = totalRow + 1;
  setCell(ws, subtotalRow, 1, 'Designation subtotals', { styleFrom: { row: 10, col: 1 }, wrap: true });
  matrix.groups.forEach((group) => {
    const groupColumns = columns.filter((item) => item.designation === group.designation);
    setFormula(ws, subtotalRow, groupColumns[0].column, `SUM(${groupColumns.map((item) => cellAddress(totalRow, item.column)).join(',')})`, { style: ws[cellAddress(10, 3)]?.s });
  });
  ws['!cols'] = [{ wch: 7 }, { wch: 24 }, ...columns.map(() => ({ wch: 18 })), { wch: 30 }];
  ws['!ref'] = `A1:${XLSX.utils.encode_col(column + 1)}${subtotalRow}`;
}

function writeCommercial(ws, input) {
  commercialRows(input).forEach(([number, value]) => {
    const row = number + 3;
    const numeric = typeof value === 'number';
    setCell(ws, row, 5, value, { styleFrom: { row: 4, col: 5 }, format: numeric ? '#,##0.00' : undefined, wrap: true });
    const lines = String(value ?? '').split('\n').length + Math.ceil(String(value ?? '').length / 70);
    ws['!rows'][row - 1] = { ...(ws['!rows'][row - 1] || {}), hpt: Math.min(120, Math.max(15.6, lines * 15.6)) };
  });
  ws['!ref'] = 'A1:G28';
}

export function buildSurveyAssessmentWorkbook(input, { templateBuffer } = {}) {
  if (!templateBuffer) throw new Error('A survey workbook template is required.');
  const workbook = XLSX.read(templateBuffer, { type: 'array', cellStyles: true, cellFormula: true });
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(['Survey Report', 'MPD', 'Commercial Input'])) throw new Error('Survey workbook template must contain the expected sheets.');
  const normalized = normalizeExportInput(input);
  writeSurveyReport(workbook.Sheets['Survey Report'], normalized);
  writeMpd(workbook.Sheets.MPD, normalized);
  writeCommercial(workbook.Sheets['Commercial Input'], normalized);
  return workbook;
}

export async function downloadSiteAssessmentWorkbook(input) {
  const response = await fetch(TEMPLATE_PATH);
  if (!response.ok) throw new Error('Survey workbook template is unavailable.');
  const templateBuffer = await response.arrayBuffer();
  const workbook = buildSurveyAssessmentWorkbook(input, { templateBuffer });
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const filename = safeWorkbookFilename({ clientName: input?.lead?.company || input?.lead?.client_name || input?.normalizedSurvey?.client_site?.client_name, assessmentId: input?.assessment?.id, date: input?.normalizedSurvey?.client_site?.survey_date });
  const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return { filename, workbook };
}

export { TEMPLATE_PATH };
