import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import {
  buildConsolidatedTravelClaimReport,
} from './operationsSummaryService.js';

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const SERVICE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_FROM_SERVICE = resolve(SERVICE_DIR, '..', '..');
const RUPEE_FONT_PATH = resolve(SERVICE_DIR, '..', 'assets', 'fonts', 'NotoSans-Regular.ttf');
const CWD_RUPEE_FONT_PATH = resolve(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf');
const UNICODE_FONT_CANDIDATES = [...new Set([
  RUPEE_FONT_PATH,
  CWD_RUPEE_FONT_PATH,
  resolve(REPO_ROOT_FROM_SERVICE, 'backend', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
])];
const RUPEE_FONT_NAME = 'ReportRupee';
const TABLE_HEADER_HEIGHT = 28;
const TABLE_FONT_SIZE = 7.25;
const TABLE_BOLD_FONT_SIZE = 7.75;
const TABLE_CELL_Y_PADDING = 4;
const TABLE_CELL_X_PADDING = 3;
const TABLE_LINE_GAP = 0.5;
const MIN_ROW_HEIGHT = 19;
const MIN_TOTAL_ROW_HEIGHT = 22;

console.info('[Travel Claim PDF] Rupee font startup lookup', {
  serviceDir: SERVICE_DIR,
  processCwd: process.cwd(),
  candidates: UNICODE_FONT_CANDIDATES.map((fontPath) => ({
    fontPath,
    exists: existsSync(fontPath),
  })),
});

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `\u20B9${number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function km(value) {
  return number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateLabel(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00+05:30`));
}

export function consolidatedTravelClaimPdfFilename(filters = {}) {
  const from = text(filters.date_from).replaceAll('-', '_') || 'from';
  const to = text(filters.date_to).replaceAll('-', '_') || 'to';
  return `QPMS_Consolidated_Travel_Claims_${from}_to_${to}.pdf`;
}

function registerUnicodeFont(doc) {
  const fontPath = UNICODE_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  console.info('[Travel Claim PDF] Rupee font generation lookup', {
    selectedFontPath: fontPath || null,
    candidates: UNICODE_FONT_CANDIDATES.map((candidate) => ({
      fontPath: candidate,
      exists: existsSync(candidate),
    })),
  });
  if (!fontPath) {
    const error = new Error('A Unicode PDF font with Indian rupee support was not found on the server.');
    error.code = 'TRAVEL_CLAIM_PDF_RUPEE_FONT_MISSING';
    error.checkedFontPaths = UNICODE_FONT_CANDIDATES;
    console.error('[Travel Claim PDF] Rupee font missing', {
      attemptedFontPaths: UNICODE_FONT_CANDIDATES,
    });
    throw error;
  }
  try {
    doc.registerFont(RUPEE_FONT_NAME, fontPath);
    return RUPEE_FONT_NAME;
  } catch (error) {
    error.message = `Unable to register rupee-capable PDF font at ${fontPath}: ${error.message}`;
    error.code = error.code || 'TRAVEL_CLAIM_PDF_RUPEE_FONT_REGISTER_FAILED';
    error.fontPath = fontPath;
    throw error;
  }
}

function isCurrencyColumn(column = {}) {
  return column.format === money;
}

function columnFontName(column, baseFontName, rupeeFontName) {
  return isCurrencyColumn(column) ? rupeeFontName : baseFontName;
}

function drawFooter(doc, fontName) {
  const page = doc.bufferedPageRange().start + doc.bufferedPageRange().count;
  doc.font(fontName).fontSize(8).fillColor('#64748b');
  doc.text(
    `Page ${page}`,
    doc.page.margins.left,
    doc.page.height - doc.page.margins.bottom - 12,
    { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right' },
  );
}

function columnHeaders() {
  return [
    { key: 'serial', label: 'S.No', width: 34, align: 'right' },
    { key: 'employee_code', label: 'Employee Code', width: 86 },
    { key: 'employee_name', label: 'Emp Name', width: 144 },
    { key: 'total_km_travelled', label: 'Total KM Travelled', width: 82, align: 'right', format: km },
    { key: 'distance_reimbursement', label: 'Distance Reimbursement', width: 98, align: 'right', format: money },
    { key: 'other_transport_mode_amount', label: 'Other Transport Mode Amount', width: 112, align: 'right', format: money },
    { key: 'parking_amount', label: 'Parking Amount', width: 82, align: 'right', format: money },
    { key: 'total_claim', label: 'Total Claim', width: 92, align: 'right', format: money },
  ];
}

function summaryColumnHeaders() {
  return [
    { key: 'serial', label: 'S.No', width: 34, align: 'right' },
    { key: 'state_label', label: 'State', width: 148 },
    { key: 'employee_count', label: 'Total Employees', width: 76, align: 'right' },
    { key: 'total_km_travelled', label: 'Total KM Travelled', width: 88, align: 'right', format: km },
    { key: 'distance_reimbursement', label: 'Distance Reimbursement', width: 108, align: 'right', format: money },
    { key: 'other_transport_mode_amount', label: 'Other Transport Mode Amount', width: 126, align: 'right', format: money },
    { key: 'parking_amount', label: 'Parking Amount', width: 88, align: 'right', format: money },
    { key: 'total_claim', label: 'Total Claim', width: 92, align: 'right', format: money },
  ];
}

function stateLabel(section = {}) {
  const name = text(section.state_name) || 'Unknown';
  const code = text(section.state_code);
  if (!code || code === name) return name;
  return `${name} (${code})`;
}

function drawTableHeader(doc, columns, x, y, fontName) {
  const height = TABLE_HEADER_HEIGHT;
  doc.save();
  doc.roundedRect(x, y, columns.reduce((sum, column) => sum + column.width, 0), height, 4)
    .fill('#0f4c81');
  doc.font(fontName).fontSize(8).fillColor('#ffffff');
  let currentX = x;
  for (const column of columns) {
    doc.text(column.label, currentX + TABLE_CELL_X_PADDING, y + 5, {
      width: column.width - (TABLE_CELL_X_PADDING * 2),
      align: column.align || 'left',
      lineGap: TABLE_LINE_GAP,
    });
    currentX += column.width;
  }
  doc.restore();
  return y + height;
}

function rowHeight(doc, columns, row, fontName) {
  doc.font(fontName).fontSize(TABLE_FONT_SIZE);
  return Math.max(MIN_ROW_HEIGHT, ...columns.map((column) => {
    const raw = column.key === 'serial' ? row.serial : row[column.key];
    const value = column.format ? column.format(raw) : text(raw);
    return doc.heightOfString(value, {
      width: column.width - (TABLE_CELL_X_PADDING * 2),
      lineGap: TABLE_LINE_GAP,
    }) + (TABLE_CELL_Y_PADDING * 2);
  }));
}

function drawTableRow(doc, columns, row, x, y, height, fontName, rupeeFontName, shaded = false, bold = false) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  doc.save();
  doc.rect(x, y, width, height).fill(shaded ? '#f8fafc' : '#ffffff');
  doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(x, y, width, height).stroke();
  let currentX = x;
  for (const column of columns) {
    const raw = column.key === 'serial' ? row.serial : row[column.key];
    const value = column.format ? column.format(raw) : text(raw);
    doc.font(columnFontName(column, fontName, rupeeFontName)).fontSize(bold ? TABLE_BOLD_FONT_SIZE : TABLE_FONT_SIZE).fillColor('#0f172a');
    doc.text(value, currentX + TABLE_CELL_X_PADDING, y + TABLE_CELL_Y_PADDING, {
      width: column.width - (TABLE_CELL_X_PADDING * 2),
      align: column.align || 'left',
      lineGap: TABLE_LINE_GAP,
    });
    currentX += column.width;
  }
  doc.restore();
}

function drawReportHeader(doc, dataset, fontName, y = doc.page.margins.top) {
  const x = doc.page.margins.left;
  doc.font(fontName).fontSize(12).fillColor('#0f4c81').text('QPMS', x, y);
  doc.font(fontName).fontSize(16).fillColor('#0f172a')
    .text('Consolidated Employee Travel Claim Report', x, y + 18);
  doc.font(fontName).fontSize(8.5).fillColor('#334155');
  const filters = dataset.applied_filters || {};
  const headerLines = [
    `Report Period: ${dateLabel(filters.date_from)} to ${dateLabel(filters.date_to)}`,
    `State: ${filters.state || 'All States'}    Business: ${filters.business || 'All Business'}    Status: ${filters.status || 'All Status'}`,
  ];
  doc.text(headerLines.join('\n'), x, y + 42, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    lineGap: 1,
  });
  return y + 72;
}

function drawStateTitle(doc, section, fontName, y, continued = false) {
  const x = doc.page.margins.left;
  doc.font(fontName).fontSize(13).fillColor('#0f172a')
    .text(`State: ${stateLabel(section)}${continued ? ' - Continued' : ''}`, x, y);
  doc.moveTo(x, y + 20)
    .lineTo(doc.page.width - doc.page.margins.right, y + 20)
    .strokeColor('#bfdbfe')
    .lineWidth(1)
    .stroke();
  return y + 30;
}

function tableTop(doc, dataset, section, columns, fontName, continued = false) {
  let y = continued ? doc.page.margins.top : drawReportHeader(doc, dataset, fontName);
  y = drawStateTitle(doc, section, fontName, y, continued);
  return drawTableHeader(doc, columns, doc.page.margins.left, y, fontName);
}

function remainingHeight(rowHeights, startIndex, totalHeight) {
  return rowHeights.slice(startIndex).reduce((sum, height) => sum + height, totalHeight);
}

function drawStateSection(doc, dataset, section, columns, fontName, rupeeFontName) {
  const tableX = doc.page.margins.left;
  const tableBottom = doc.page.height - doc.page.margins.bottom - 24;
  const totalRow = {
    serial: '',
    employee_code: `Total Employees: ${section.totals.employee_count}`,
    employee_name: 'State Total',
    total_km_travelled: section.totals.total_km_travelled,
    distance_reimbursement: section.totals.distance_reimbursement,
    other_transport_mode_amount: section.totals.other_transport_mode_amount,
    parking_amount: section.totals.parking_amount,
    total_claim: section.totals.total_claim,
  };
  const totalHeight = Math.max(MIN_TOTAL_ROW_HEIGHT, rowHeight(doc, columns, totalRow, fontName));
  const rows = section.rows.map((item, index) => ({ ...item, serial: index + 1 }));
  const rowHeights = rows.map((row) => rowHeight(doc, columns, row, fontName));
  let y = tableTop(doc, dataset, section, columns, fontName);
  const firstPageContentCapacity = tableBottom - y;
  let rowsOnPage = 0;

  rows.forEach((row, index) => {
    const height = rowHeights[index];
    const remainingWithTotal = remainingHeight(rowHeights, index, totalHeight);
    const canKeepFinalBlockTogether = remainingWithTotal <= firstPageContentCapacity;
    if (
      rowsOnPage > 0
      && canKeepFinalBlockTogether
      && y + remainingWithTotal > tableBottom
    ) {
      drawFooter(doc, fontName);
      doc.addPage();
      y = tableTop(doc, dataset, section, columns, fontName, true);
      rowsOnPage = 0;
    } else if (y + height > tableBottom) {
      drawFooter(doc, fontName);
      doc.addPage();
      y = tableTop(doc, dataset, section, columns, fontName, true);
      rowsOnPage = 0;
    }
    drawTableRow(doc, columns, row, tableX, y, height, fontName, rupeeFontName, index % 2 === 1);
    y += height;
    rowsOnPage += 1;
  });

  if (y + totalHeight > tableBottom) {
    drawFooter(doc, fontName);
    doc.addPage();
    y = tableTop(doc, dataset, section, columns, fontName, true);
  }
  drawTableRow(doc, columns, totalRow, tableX, y, totalHeight, fontName, rupeeFontName, true, true);
}

function drawAllStateSummary(doc, dataset, fontName, rupeeFontName) {
  const columns = summaryColumnHeaders();
  const tableX = doc.page.margins.left;
  const tableBottom = doc.page.height - doc.page.margins.bottom - 24;
  let y = drawReportHeader(doc, dataset, fontName);
  doc.font(fontName).fontSize(15).fillColor('#0f172a')
    .text('All-State Consolidated Summary', tableX, y);
  y += 30;
  y = drawTableHeader(doc, columns, tableX, y, fontName);

  dataset.state_sections.forEach((section, index) => {
    const row = {
      serial: index + 1,
      state_label: stateLabel(section),
      ...section.totals,
    };
    const height = rowHeight(doc, columns, row, fontName);
    if (y + height > tableBottom) {
      drawFooter(doc, fontName);
      doc.addPage();
      y = drawReportHeader(doc, dataset, fontName);
      doc.font(fontName).fontSize(15).fillColor('#0f172a')
        .text('All-State Consolidated Summary', tableX, y);
      y += 30;
      y = drawTableHeader(doc, columns, tableX, y, fontName);
    }
    drawTableRow(doc, columns, row, tableX, y, height, fontName, rupeeFontName, index % 2 === 1);
    y += height;
  });

  const grandTotal = {
    serial: '',
    state_label: 'Grand Total',
    ...dataset.totals,
  };
  const totalHeight = Math.max(28, rowHeight(doc, columns, grandTotal, fontName));
  if (y + totalHeight > tableBottom) {
    drawFooter(doc, fontName);
    doc.addPage();
    y = drawReportHeader(doc, dataset, fontName);
    doc.font(fontName).fontSize(15).fillColor('#0f172a')
      .text('All-State Consolidated Summary', tableX, y);
    y += 30;
    y = drawTableHeader(doc, columns, tableX, y, fontName);
  }
  drawTableRow(doc, columns, grandTotal, tableX, y, totalHeight, fontName, rupeeFontName, true, true);
}

function renderPdf(dataset) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      bufferPages: true,
      info: {
        Title: 'QPMS Consolidated Employee Travel Claim Report',
        Author: 'QPMS',
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rupeeFontName = registerUnicodeFont(doc);
    const fontName = rupeeFontName;
    const columns = columnHeaders();
    dataset.state_sections.forEach((section, index) => {
      if (index > 0) {
        drawFooter(doc, fontName);
        doc.addPage();
      }
      drawStateSection(doc, dataset, section, columns, fontName, rupeeFontName);
    });
    drawFooter(doc, fontName);
    doc.addPage();
    drawAllStateSummary(doc, dataset, fontName, rupeeFontName);
    drawFooter(doc, fontName);
    doc.end();
  });
}

export async function buildConsolidatedTravelClaimPdf(client, actor, query, today) {
  const dataset = await buildConsolidatedTravelClaimReport(client, actor, query, today);
  if (!dataset.rows.length) {
    const error = new Error('No employee travel claim data found for the selected filters.');
    error.statusCode = 404;
    error.code = 'NO_TRAVEL_CLAIM_DATA';
    error.dataset = dataset;
    throw error;
  }
  return {
    dataset,
    filename: consolidatedTravelClaimPdfFilename(dataset.applied_filters),
    buffer: await renderPdf(dataset),
  };
}
