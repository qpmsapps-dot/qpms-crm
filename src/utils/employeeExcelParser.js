import * as XLSX from 'xlsx';

const headerAliases = {
  employeeCode: ['employee code', 'emp code', 'employee id', 'emp id', 'code'],
  employeeName: ['employee name', 'name', 'emp name', 'full name'],
  email: ['email', 'contact email', 'company email', 'official email'],
  designation: ['designation', 'role', 'job title'],
  department: ['department', 'dept'],
  business: ['business', 'unit', 'vertical'],
  managerCode: ['manager code', 'reporting manager code', 'reports to code', 'manager employee code'],
  managerName: ['manager name', 'reporting manager', 'reports to'],
};

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function mapHeaders(headers) {
  const normalized = headers.map(normalizeHeader);
  const result = {};
  Object.entries(headerAliases).forEach(([field, aliases]) => {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[field] = headers[index];
  });
  return result;
}

function completenessScore(employee) {
  return Object.values(employee).filter((value) => normalizeText(value)).length;
}

export async function parseEmployeeExcel(file) {
  if (!file) throw new Error('Choose an Excel file to import.');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Unsupported file type. Upload an .xlsx, .xls, or .csv file.');

  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    throw new Error('Invalid Excel file. Please check the workbook and try again.');
  }

  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) throw new Error('Missing worksheet. The workbook does not contain any sheets.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Missing worksheet. The first sheet could not be read.');

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) throw new Error('Empty workbook. Add employee rows before importing.');

  const headers = Object.keys(rows[0] || {});
  const headerMap = mapHeaders(headers);
  if (!headerMap.employeeCode && !headerMap.employeeName) {
    throw new Error('Missing expected headers. Include Employee Code and Employee Name columns.');
  }

  const warnings = [];
  const invalidRows = [];
  const byCode = new Map();
  let emptyRows = 0;
  let missingEmployeeCodes = 0;
  let missingEmails = 0;
  let missingManagers = 0;

  rows.forEach((row, index) => {
    const values = Object.values(row).map(normalizeText);
    if (!values.some(Boolean)) {
      emptyRows += 1;
      return;
    }

    const employee = {
      employeeCode: normalizeText(row[headerMap.employeeCode]).toUpperCase(),
      employeeName: normalizeText(row[headerMap.employeeName]),
      email: normalizeText(row[headerMap.email]).toLowerCase(),
      designation: normalizeText(row[headerMap.designation]),
      department: normalizeText(row[headerMap.department]),
      business: normalizeText(row[headerMap.business]),
      managerCode: normalizeText(row[headerMap.managerCode]).toUpperCase(),
      managerName: normalizeText(row[headerMap.managerName]),
      role: normalizeText(row[headerMap.designation]) || 'Employee',
      accountStatus: 'Import Only',
      passwordStatus: 'Password Change Pending',
      mobileAccess: false,
      loginMethod: normalizeText(row[headerMap.email]) ? 'Email' : 'Employee Code',
      sourceRow: index + 2,
    };

    if (!employee.employeeCode) {
      missingEmployeeCodes += 1;
      invalidRows.push({ row: employee.sourceRow, issue: 'Missing employee code' });
      return;
    }
    if (!employee.email) missingEmails += 1;
    if (!employee.managerCode && employee.employeeCode !== 'QPMSTN15789') missingManagers += 1;

    if (byCode.has(employee.employeeCode)) {
      const current = byCode.get(employee.employeeCode);
      warnings.push({ row: employee.sourceRow, employeeCode: employee.employeeCode, issue: 'Duplicate employee code consolidated' });
      if (completenessScore(employee) > completenessScore(current)) byCode.set(employee.employeeCode, employee);
      return;
    }

    byCode.set(employee.employeeCode, employee);
  });

  return {
    employees: Array.from(byCode.values()),
    review: {
      totalRows: rows.length - emptyRows,
      uniqueEmployees: byCode.size,
      duplicateEmployeeCodes: warnings.length,
      missingEmployeeCodes,
      missingEmails,
      missingManagers,
      invalidRows: invalidRows.length,
      warnings,
      errors: invalidRows,
      sheetName,
    },
  };
}
