import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  buildConsolidatedTravelClaimReport,
} from './operationsSummaryService.js';

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const UNICODE_FONT_CANDIDATES = [
  'C:/Windows/Fonts/Nirmala.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];

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

function dateTimeLabel(value) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function consolidatedTravelClaimPdfFilename(filters = {}) {
  const from = text(filters.date_from).replaceAll('-', '_') || 'from';
  const to = text(filters.date_to).replaceAll('-', '_') || 'to';
  return `QPMS_Consolidated_Travel_Claims_${from}_to_${to}.pdf`;
}

function registerUnicodeFont(doc) {
  const fontPath = UNICODE_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!fontPath) return 'Helvetica';
  try {
    doc.registerFont('ReportUnicode', fontPath);
    return 'ReportUnicode';
  } catch (error) {
    console.warn('[Travel Claim PDF] Unicode font registration failed', {
      fontPath,
      message: error?.message || String(error),
    });
    return 'Helvetica';
  }
}

function drawFooter(doc, fontName) {
  const page = doc.bufferedPageRange().start + doc.bufferedPageRange().count;
  doc.font(fontName).fontSize(8).fillColor('#64748b');
  doc.text(
    `Page ${page}`,
    doc.page.margins.left,
    doc.page.height - 34,
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

function drawTableHeader(doc, columns, x, y, fontName) {
  const height = 34;
  doc.save();
  doc.roundedRect(x, y, columns.reduce((sum, column) => sum + column.width, 0), height, 4)
    .fill('#0f4c81');
  doc.font(fontName).fontSize(8.5).fillColor('#ffffff');
  let currentX = x;
  for (const column of columns) {
    doc.text(column.label, currentX + 4, y + 7, {
      width: column.width - 8,
      align: column.align || 'left',
      lineGap: 1,
    });
    currentX += column.width;
  }
  doc.restore();
  return y + height;
}

function rowHeight(doc, columns, row, fontName) {
  doc.font(fontName).fontSize(8);
  return Math.max(24, ...columns.map((column) => {
    const raw = column.key === 'serial' ? row.serial : row[column.key];
    const value = column.format ? column.format(raw) : text(raw);
    return doc.heightOfString(value, { width: column.width - 8, lineGap: 1 }) + 12;
  }));
}

function drawTableRow(doc, columns, row, x, y, height, fontName, shaded = false, bold = false) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  doc.save();
  doc.rect(x, y, width, height).fill(shaded ? '#f8fafc' : '#ffffff');
  doc.strokeColor('#e2e8f0').lineWidth(0.5).rect(x, y, width, height).stroke();
  doc.font(fontName).fontSize(8).fillColor('#0f172a');
  if (bold) doc.fontSize(8.5);
  let currentX = x;
  for (const column of columns) {
    const raw = column.key === 'serial' ? row.serial : row[column.key];
    const value = column.format ? column.format(raw) : text(raw);
    doc.text(value, currentX + 4, y + 6, {
      width: column.width - 8,
      align: column.align || 'left',
      lineGap: 1,
    });
    currentX += column.width;
  }
  doc.restore();
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

    const fontName = registerUnicodeFont(doc);
    const columns = columnHeaders();
    const tableX = doc.page.margins.left;
    const tableBottom = doc.page.height - doc.page.margins.bottom - 24;
    let y = doc.page.margins.top;

    doc.font(fontName).fontSize(15).fillColor('#0f4c81').text('QPMS', tableX, y);
    doc.font(fontName).fontSize(18).fillColor('#0f172a')
      .text('Consolidated Employee Travel Claim Report', tableX, y + 22);
    doc.font(fontName).fontSize(9).fillColor('#334155');
    const filters = dataset.applied_filters || {};
    const headerLines = [
      `Report Period: ${dateLabel(filters.date_from)} to ${dateLabel(filters.date_to)}`,
      `State: ${filters.state || 'All States'}    Business: ${filters.business || 'All Business'}    Status: ${filters.status || 'All Status'}`,
      `Generated By: ${dataset.generated_by?.name || 'Authenticated user'}    Generated At: ${dateTimeLabel(dataset.generated_at)}`,
      `Claim Statuses Included: ${(dataset.claim_statuses_included || []).join(', ')}`,
    ];
    doc.text(headerLines.join('\n'), tableX, y + 48, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      lineGap: 2,
    });
    y += 110;
    y = drawTableHeader(doc, columns, tableX, y, fontName);

    dataset.rows.forEach((item, index) => {
      const row = { ...item, serial: index + 1 };
      const height = rowHeight(doc, columns, row, fontName);
      if (y + height > tableBottom) {
        drawFooter(doc, fontName);
        doc.addPage();
        y = doc.page.margins.top;
        y = drawTableHeader(doc, columns, tableX, y, fontName);
      }
      drawTableRow(doc, columns, row, tableX, y, height, fontName, index % 2 === 1);
      y += height;
    });

    const totalRow = {
      serial: '',
      employee_code: `Total Employees: ${dataset.totals.employee_count}`,
      employee_name: 'Grand Total',
      total_km_travelled: dataset.totals.total_km_travelled,
      distance_reimbursement: dataset.totals.distance_reimbursement,
      other_transport_mode_amount: dataset.totals.other_transport_mode_amount,
      parking_amount: dataset.totals.parking_amount,
      total_claim: dataset.totals.total_claim,
    };
    const totalHeight = Math.max(28, rowHeight(doc, columns, totalRow, fontName));
    if (y + totalHeight > tableBottom) {
      drawFooter(doc, fontName);
      doc.addPage();
      y = doc.page.margins.top;
      y = drawTableHeader(doc, columns, tableX, y, fontName);
    }
    drawTableRow(doc, columns, totalRow, tableX, y, totalHeight, fontName, true, true);
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
