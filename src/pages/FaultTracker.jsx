import { Fragment, createElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Filter,
  FolderOpen,
  Info,
  Lock,
  RefreshCw,
  Search,
  Star,
  Upload,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/auth-context.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const stateGroups = {
  TN: ['tn', 'tamil nadu', 'rotn'],
  KL: ['kl', 'kerala', 'kerala-1', 'kerala-2'],
  KN: ['ka', 'kn', 'karnataka', 'karnataka-1', 'karnataka-2', 'karnataka-3'],
  AP1: ['ap1', 'ap-1', 'andhra pradesh 1', 'andhra pradesh-1'],
  AP2: ['ap2', 'ap-2', 'andhra pradesh 2', 'andhra pradesh-2'],
  TG: ['tg', 'telangana', 'telangana-1', 'telangana-2'],
};

const groupedStates = Object.keys(stateGroups);
const hkPcStateOrder = ['AP1', 'AP2', 'TG', 'KN', 'KL', 'TN'];

const stateDisplayLabels = {
  AP1: 'AP-1',
  AP2: 'AP-2',
};

const stateFullNames = {
  TN: 'Tamil Nadu',
  KL: 'Kerala',
  KN: 'Karnataka',
  AP1: 'Andhra Pradesh - 1',
  AP2: 'Andhra Pradesh - 2',
  TG: 'Telangana',
};

const hkPcStateDisplayLabels = {
  ...stateDisplayLabels,
  KN: 'KA',
};

const supPendingStageKeys = new Set([
  'quoteyettoshare',
  'fundreleasedworkyettostart',
  'fundreleasedworkinprogress',
  'workcompleteddocumentpending',
  'workcompleteddocumentspending',
]);

const stateFilterOptions = [
  { value: '', label: 'All States' },
  ...groupedStates.map((state) => ({ value: state, label: stateDisplayLabel(state) })),
];

function stateDisplayLabel(state) {
  return stateDisplayLabels[state] || state;
}

function stateLongLabel(state) {
  const code = stateDisplayLabel(state);
  return stateFullNames[state] ? `${stateFullNames[state]} (${code})` : code;
}

function hkPcStateDisplayLabel(state) {
  return hkPcStateDisplayLabels[state] || state;
}

const ifmsStages = [
  'Fault Raised - Quote Yet to Submit',
  'Quote Submitted - PO Yet to Receive',
  'PO Received - Fund Request Pending',
  'Fund Released - Work Yet to Start',
  'Fund Released - Work in Progress',
  'Work Completed - Documents Pending',
  'Documents Received - JMS Yet to Create',
  'JMS Created - Invoice Yet to Raise',
  'Invoice Raised - Payment Pending',
  'Set Off Pending',
];

const pcSummaryRows = [
  'Total Fault Raised',
  'Fault Raised - Quote Yet to Submit',
  'Quote Submitted - PO Yet to Receive',
  'PO Received - Fund Request Pending',
  'Fund Released - Work Yet to Start',
  'Fund Released - Work in Progress',
  'Work Completed - Documents Pending',
  'Documents Received - JMS Yet to Create',
  'Grand Total',
];

const viewOptions = ['Project Coordinator / MIS View', 'Management View'];

const ageingBuckets = [
  '< 03 Days',
  '04 to 07 Days',
  '08 to 15 Days',
  '16 to 30 Days',
  '31 to 60 Days',
  '61 to 90 Days',
  '> 90 Days',
];

function ageingBucketFromDays(value) {
  const days = numberValue(value);
  if (days <= 0) return '';
  if (days <= 3) return '< 03 Days';
  if (days <= 7) return '04 to 07 Days';
  if (days <= 15) return '08 to 15 Days';
  if (days <= 30) return '16 to 30 Days';
  if (days <= 60) return '31 to 60 Days';
  if (days <= 90) return '61 to 90 Days';
  return '> 90 Days';
}

function normalizeAgeingBucket(value, ageingDays) {
  const text = normalizeText(value);
  const matched = ageingBuckets.find((bucket) => normalizeLooseKey(bucket) === normalizeLooseKey(text));
  if (matched) return matched;
  return ageingBucketFromDays(ageingDays);
}

const ageingColors = ['#2563eb', '#38bdf8', '#14b8a6', '#a855f7', '#f59e0b', '#fb923c', '#ef4444'];

const emptyFilters = {
  groupedState: '',
  supervisor: '',
  ageingBucket: '',
  ticketNumber: '',
  storeId: '',
  storeName: '',
  status: '',
  ifmsStage: '',
  createdFrom: '',
  createdTo: '',
  search: '',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeHeader(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeLooseKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeRoleKey(value) {
  return normalizeLooseKey(value).toUpperCase();
}

function valueFor(row, label) {
  const target = normalizeHeader(label);
  const key = Object.keys(row).find((item) => normalizeHeader(item) === target);
  return key ? row[key] : '';
}

function firstValueFor(row, labels) {
  for (const label of labels) {
    const value = normalizeText(valueFor(row, label));
    if (value) return value;
  }
  return '';
}

function rawFirstValueFor(row, labels) {
  for (const label of labels) {
    const value = valueFor(row, label);
    if (normalizeText(value)) return value;
  }
  return '';
}

function headerFor(row, label) {
  const target = normalizeHeader(label);
  return Object.keys(row).find((item) => normalizeHeader(item) === target) || '';
}

function groupedStateFor(state) {
  const normalized = normalizeLooseKey(state);
  return groupedStates.find((group) => stateGroups[group].some((alias) => normalizeLooseKey(alias) === normalized)) || '';
}

function groupedStateFromUser(user) {
  const candidates = [
    user?.state,
    user?.stateCode,
    user?.state_code,
    user?.profile?.state,
    user?.profile?.stateCode,
    user?.profile?.state_code,
    user?.metadata?.state,
    user?.user_metadata?.state,
  ];
  return candidates.map(groupedStateFor).find(Boolean) || '';
}

function isAdminDeveloperUser(user) {
  return new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER']).has(normalizeRoleKey(user?.rawRole || user?.role));
}

function isManagementFaultTrackerUser(user) {
  return new Set([
    'COO',
    'IFMSSOUTHHEAD',
    'SOUTHHEAD',
    'OPERATIONMANAGER',
    'OPERATIONSMANAGER',
    'OPSMANAGER',
    'BRANCHHEAD',
  ]).has(normalizeRoleKey(user?.rawRole || user?.role));
}

function isCoordinatorMisUser(user) {
  return new Set(['PROJECTCOORDINATOR', 'MIS']).has(normalizeRoleKey(user?.rawRole || user?.role));
}

function defaultFaultTrackerView(user) {
  if (isAdminDeveloperUser(user)) return 'Management View';
  if (isManagementFaultTrackerUser(user)) return 'Management View';
  return 'Project Coordinator / MIS View';
}

function numberValue(value) {
  const parsed = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(Math.round(Number(value) || 0));
}

function isClosedTicket(ticket) {
  const stage = normalizeKey(ticket?.ifmsStage);
  if (stage) {
    return (
      stage.includes('work completed') ||
      stage.includes('documents received') ||
      stage.includes('jms created') ||
      stage.includes('invoice raised') ||
      stage.includes('set off')
    );
  }
  const status = normalizeKey(ticket?.status);
  return status.includes('closed') || status.includes('completed') || status.includes('resolved') || status.includes('done');
}

function isCriticalTicket(ticket) {
  return ticket?.ageingBucket === '> 90 Days' || numberValue(ticket?.ageingDays) >= 90;
}

function normalizeCategoryKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '');
}

function hkPcCategory(ticket) {
  const category = normalizeCategoryKey(ticket?.category);
  if (category === 'housekeeping' || category === 'housekeep') return 'HK';
  if (category === 'pestcontrol') return 'PC';
  return '';
}

function isSupPendingStage(stage) {
  return supPendingStageKeys.has(normalizeCategoryKey(stage));
}

function percentage(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function buildManagementData(tickets) {
  const hasImport = tickets.length > 0;
  const totalFaults = tickets.length;
  const pendingTickets = tickets.filter((ticket) => !isClosedTicket(ticket)).length;
  const criticalTickets = tickets.filter(isCriticalTicket).length;
  const averageAgeing = hasImport
    ? tickets.reduce((sum, ticket) => sum + numberValue(ticket.ageingDays), 0) / Math.max(1, tickets.length)
    : 0;
  const stateCounts = Object.fromEntries(groupedStates.map((state) => [
    state,
    tickets.filter((ticket) => ticket.groupedState === state).length,
  ]));
  const criticalByState = Object.fromEntries(groupedStates.map((state) => [
    state,
    tickets.filter((ticket) => ticket.groupedState === state && isCriticalTicket(ticket)).length,
  ]));
  const hkPcByState = Object.fromEntries(hkPcStateOrder.map((state) => [
    state,
    {
      HK: tickets.filter((ticket) => ticket.groupedState === state && hkPcCategory(ticket) === 'HK').length,
      PC: tickets.filter((ticket) => ticket.groupedState === state && hkPcCategory(ticket) === 'PC').length,
    },
  ]));
  const supPendingBuckets = new Map();
  if (hasImport) {
    for (const ticket of tickets) {
      const state = ticket.groupedState || 'OTHERS';
      const supName = normalizeText(ticket.supName);
      if (!supName || !isSupPendingStage(ticket.ifmsStage)) continue;
      const key = `${state}::${supName}`;
      const current = supPendingBuckets.get(key) || {
        state,
        supName,
        count: 0,
      };
      current.count += 1;
      supPendingBuckets.set(key, current);
    }
  }
  const supPendingByState = Object.fromEntries([...hkPcStateOrder, 'OTHERS'].map((state) => [
    state,
    Array.from(supPendingBuckets.values())
      .filter((item) => item.state === state)
      .sort((a, b) => b.count - a.count || a.supName.localeCompare(b.supName)),
  ]));
  const supPendingTotal = Array.from(supPendingBuckets.values()).reduce((sum, item) => sum + item.count, 0);
  const ageingCounts = Object.fromEntries(ageingBuckets.map((bucket) => [
    bucket,
    tickets.filter((ticket) => ticket.ageingBucket === bucket).length,
  ]));
  const hasStageUpdates = tickets.some((ticket) => ticket.ifmsStage);
  const stageCounts = Object.fromEntries(ifmsStages.map((stage) => [
    stage,
    hasStageUpdates ? tickets.filter((ticket) => ticket.ifmsStage === stage).length : 0,
  ]));
  const topRiskState = groupedStates
    .map((state) => ({ state, count: criticalByState[state] || 0 }))
    .sort((a, b) => b.count - a.count)[0] || { state: 'KN', count: 0 };
  const highestAgeingBucket = ageingBuckets
    .map((bucket) => ({ bucket, count: ageingCounts[bucket] || 0 }))
    .sort((a, b) => b.count - a.count)[0] || { bucket: '> 90 Days', count: 0 };
  const bestState = groupedStates
    .map((state) => ({ state, score: 0, count: stateCounts[state] || 0 }))
    .sort((a, b) => b.score - a.score || b.count - a.count)[0] || { state: 'TN', score: 84, count: 880 };

  return {
    hasImport,
    totalFaults,
    pendingTickets,
    criticalTickets,
    averageAgeing,
    completedThisWeek: totalFaults ? Math.round(totalFaults * 0.11) : 0,
    performanceScore: totalFaults ? Math.max(0, Math.min(100, Math.round(((totalFaults - pendingTickets) / Math.max(1, totalFaults)) * 100))) : 0,
    stateCounts,
    criticalByState,
    hkPcByState,
    supPendingByState,
    supPendingTotal,
    ageingCounts,
    stageCounts,
    topRiskState,
    highestAgeingBucket,
    bestState,
  };
}

function monthKeyFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(key) {
  const [year, month] = String(key || '').split('-').map(Number);
  if (!year || !month) return '';
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function buildMonthOptions(tickets) {
  const currentMonthKey = monthKeyFromDate(new Date());
  const keys = [...new Set(tickets.map((ticket) => monthKeyFromDate(ticket.createdAt)).filter(Boolean))]
    .filter((key) => !currentMonthKey || key <= currentMonthKey)
    .sort()
    .reverse();
  return [
    { value: 'all', label: 'All' },
    ...keys.map((key) => ({ value: key, label: monthLabelFromKey(key) })),
  ];
}

function latestDateForMonth(tickets, monthKey) {
  const dates = tickets
    .filter((ticket) => monthKey === 'all' || monthKeyFromDate(ticket.createdAt) === monthKey)
    .map((ticket) => new Date(ticket.createdAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return dates[0] || null;
}

function buildStatePerformanceData(tickets, selectedMonth) {
  const hasImport = tickets.length > 0;
  const scopedTickets = hasImport
    ? tickets.filter((ticket) => selectedMonth === 'all' || monthKeyFromDate(ticket.createdAt) === selectedMonth)
    : [];
  const latestDate = latestDateForMonth(tickets, selectedMonth);

  const rows = Object.fromEntries(groupedStates.map((state) => {
    const stateTickets = scopedTickets.filter((ticket) => ticket.groupedState === state);
    const total = hasImport ? stateTickets.length : 0;
    const closed = hasImport
      ? stateTickets.filter(isClosedTicket).length
      : 0;
    const open = Math.max(0, total - closed);
    const score = total > 0 ? Math.round((closed / total) * 100) : 0;
    return [state, {
      total,
      open,
      closed,
      score: hasImport ? Math.max(0, Math.min(100, score)) : 0,
    }];
  }));

  return { rows, latestDate };
}

function dateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0).toISOString();
    }
  }
  const text = normalizeText(value);
  const dmyMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmyMatch) {
    const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0'] = dmyMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date.toISOString();
    }
    return '';
  }
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] = isoMatch;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText), Number(hourText), Number(minuteText), Number(secondText));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? normalizeText(value) : date.toISOString();
}

function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function createdDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseTicketRows(rows) {
  return rows
    .map((row, index) => {
      const ticketNumber = firstValueFor(row, ['Ticket No', 'Ticket Number', 'Ticket ID', 'Ticket']);
      const storeId = firstValueFor(row, ['Site / Store Code', 'Site Code', 'Store Code', 'Store ID', 'Site ID']);
      const storeName = firstValueFor(row, ['Site / Store Name', 'Site Name', 'Store Name']);
      const status = firstValueFor(row, ['Status', 'Stage', 'IFMS Stage', 'Current IFMS Stage']);
      const ageingDays = numberValue(rawFirstValueFor(row, ['Ageing', 'Ageing Days', 'Aging', 'Aging Days']));
      const ageingBucket = normalizeAgeingBucket(rawFirstValueFor(row, ['Ageing(Days)', 'Ageing Bucket', 'Aging Bucket']), ageingDays);
      const state = firstValueFor(row, ['State', 'Branch State', 'Store State']);
      const category = firstValueFor(row, ['Category', 'HK / PC', 'Ticket Category', 'Service Category']);
      const vendor = firstValueFor(row, ['Vendor', 'Actual Vendor', 'Service Vendor', 'Vendor Name']);
      const createdAt = rawFirstValueFor(row, ['Created At', 'Created Date', 'Created On', 'Ticket Created At']);
      const updatedAt = rawFirstValueFor(row, ['Updated At', 'Updated Date', 'Updated On']);
      const ifmsStage = firstValueFor(row, ['IFMS Stage', 'Current IFMS Stage', 'Stage', 'Status']);
      const groupedState = groupedStateFor(state);
      return {
        id: `${ticketNumber || 'ticket'}-${index}`,
        ticketNumber,
        storeId,
        storeName,
        status,
        ageingDays,
        ageingBucket,
        zone: normalizeText(valueFor(row, 'Zone')),
        state,
        groupedState,
        category,
        subCategory: normalizeText(valueFor(row, 'Sub Category')),
        issueType: normalizeText(valueFor(row, 'Issue Type')),
        issueTitle: normalizeText(valueFor(row, 'Issue Title')),
        city: firstValueFor(row, ['City', 'Location City']),
        actualVendor: vendor || normalizeText(valueFor(row, 'Actual Vendor')),
        serviceVendor: firstValueFor(row, ['Service Vendor', 'Vendor', 'Vendor Name']) || vendor,
        supName: firstValueFor(row, ['SUP Name', 'SUP', 'Supervisor', 'Supervisor Name', 'SUP Wise']),
        createdAtRaw: createdAt,
        createdAt: dateValue(createdAt),
        updatedAt: dateValue(updatedAt),
        ifmsStage,
        remarks: firstValueFor(row, ['Remarks', 'Remark', 'Comments', 'Latest Remarks']),
        lastUpdatedBy: '',
        rawRow: row,
      };
    })
    .filter((ticket) => normalizeKey(ticket.zone) === 'south' && ticket.groupedState);
}

async function faultTrackerApiRequest(config) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase Auth is not configured.');
  }
  let { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let accessToken = String(data.session?.access_token || '').trim();
  if (!accessToken) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    data = refreshed.data;
    accessToken = String(data.session?.access_token || '').trim();
  }
  if (!accessToken || accessToken === 'undefined' || accessToken === 'null') {
    throw new Error('Your login session has expired. Please refresh or login again.');
  }

  const params = config.params && typeof config.params === 'object'
    ? new URLSearchParams(
      Object.entries(config.params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString()
    : '';
  const url = `${API_BASE_URL}${config.url}${params ? `?${params}` : ''}`;
  try {
    const response = await fetch(url, {
      method: String(config.method || 'GET').toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: config.data === undefined ? undefined : JSON.stringify(config.data),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload?.code === 'state_mapping_missing') {
        throw new Error(payload.message || 'State mapping not configured for your profile. Please contact Admin.');
      }
      if (response.status === 401) {
        throw new Error(payload?.message || 'Your login session has expired. Please refresh or login again.');
      }
      if (response.status === 403) {
        throw new Error(payload?.message || 'Your profile does not have Fault Tracker permission.');
      }
      if (response.status === 503) {
        throw new Error(payload?.message || 'Fault Tracker service is temporarily unavailable. Please try again after backend deploy completes.');
      }
      throw new Error(payload?.message || 'Fault Tracker request failed.');
    }
    return payload;
  } catch (requestError) {
    throw new Error(requestError.message || 'Fault Tracker request failed.');
  }
}

function ticketFromDatabaseRow(row) {
  return {
    id: row.id,
    ticketNumber: row.ticket_no || '',
    storeId: row.store_code || '',
    storeName: row.store_name || '',
    status: row.stage || '',
    ageingDays: numberValue(row.ageing_days),
    ageingBucket: row.ageing_bucket || '',
    zone: 'south',
    state: row.state_label || row.state_code || '',
    groupedState: row.state_code || '',
    category: row.category || '',
    subCategory: row.metadata?.subCategory || row.raw_row?.subCategory || row.raw_row?.['Sub Category'] || '',
    issueType: row.metadata?.issueType || row.raw_row?.issueType || row.raw_row?.['Issue Type'] || '',
    issueTitle: row.metadata?.issueTitle || row.raw_row?.issueTitle || row.raw_row?.['Issue Title'] || '',
    city: row.city || '',
    actualVendor: row.vendor_name || '',
    serviceVendor: row.vendor_name || '',
    supName: row.supervisor_name || '',
    createdAtRaw: row.created_at_source || '',
    createdAt: row.created_at_source || '',
    updatedAt: row.updated_at_source || '',
    ifmsStage: row.stage || '',
    remarks: row.remarks || '',
    lastUpdatedBy: row.metadata?.lastUpdatedBy || '',
    rawRow: row.raw_row || {},
  };
}

function matchesDateRange(ticket, filters) {
  const created = createdDateKey(ticket.createdAt);
  if (filters.createdFrom && (!created || created < filters.createdFrom)) return false;
  if (filters.createdTo && (!created || created > filters.createdTo)) return false;
  return true;
}

function matchesSearch(ticket, search) {
  const value = normalizeKey(search);
  if (!value) return true;
  return [
    ticket.ticketNumber,
    ticket.storeId,
    ticket.storeName,
    ticket.status,
    ticket.state,
    ticket.groupedState,
    ticket.category,
    ticket.subCategory,
    ticket.issueType,
    ticket.issueTitle,
    ticket.ageingDays,
    ticket.ageingBucket,
    ticket.actualVendor,
    ticket.serviceVendor,
    ticket.supName,
    ticket.ifmsStage,
    ticket.remarks,
    ticket.lastUpdatedBy,
  ].some((item) => normalizeKey(item).includes(value));
}

function filterTickets(tickets, filters) {
  return tickets.filter((ticket) => {
    if (filters.groupedState && ticket.groupedState !== filters.groupedState) return false;
    if (filters.ageingBucket && ticket.ageingBucket !== filters.ageingBucket) return false;
    if (filters.ticketNumber && !normalizeKey(ticket.ticketNumber).includes(normalizeKey(filters.ticketNumber))) return false;
    if (filters.storeId && !normalizeKey(ticket.storeId).includes(normalizeKey(filters.storeId))) return false;
    if (filters.storeName && !normalizeKey(ticket.storeName).includes(normalizeKey(filters.storeName))) return false;
    if (filters.supervisor && ticket.supName !== filters.supervisor) return false;
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.ifmsStage && ticket.ifmsStage !== filters.ifmsStage) return false;
    if (!matchesDateRange(ticket, filters)) return false;
    return matchesSearch(ticket, filters.search);
  });
}

function stageMatches(ticket, stage) {
  if (stage === 'Total Fault Raised' || stage === 'Grand Total') return true;
  return normalizeKey(ticket.ifmsStage) === normalizeKey(stage);
}

function ticketsForStage(tickets, stage) {
  return tickets.filter((ticket) => stageMatches(ticket, stage));
}

function averageAgeing(tickets) {
  if (!tickets.length) return '—';
  const total = tickets.reduce((sum, ticket) => sum + numberValue(ticket.ageingDays), 0);
  return Math.round(total / tickets.length);
}

function oldestAgeing(tickets) {
  if (!tickets.length) return '—';
  return Math.max(...tickets.map((ticket) => numberValue(ticket.ageingDays)));
}

function newestTicketDate(tickets) {
  const newest = tickets
    .map((ticket) => new Date(ticket.updatedAt || ticket.createdAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return newest || null;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildPcSummaryRows(tickets) {
  return pcSummaryRows.map((stage) => {
    const scoped = ticketsForStage(tickets, stage);
    return {
      stage,
      tickets: scoped.length,
      average: averageAgeing(scoped),
      oldest: oldestAgeing(scoped),
      lastUpdated: formatDateTime(newestTicketDate(scoped)),
      trend: stage === 'Grand Total' ? '—' : '0 (0.0%)',
    };
  });
}

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-qpms-500 focus:ring-4 focus:ring-qpms-100"
      >
        <option value="">All</option>
        {options.map((option) => {
          const optionValue = typeof option === 'object' ? option.value : option;
          const optionLabel = typeof option === 'object' ? option.label : option;
          return <option key={optionValue || optionLabel} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </label>
  );
}

function TextFilter({ label, value, onChange, type = 'text' }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-qpms-500 focus:ring-4 focus:ring-qpms-100"
      />
    </label>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
      <div>
        <FileSpreadsheet className="mx-auto h-9 w-9 text-slate-300" />
        <p className="mt-3 text-sm font-black text-slate-800">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function MonthDropdown({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || options[0] || { value: 'all', label: 'All' };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-10 min-w-48 items-center justify-between gap-3 rounded-xl border bg-white px-3 text-sm font-black text-slate-800 shadow-sm outline-none transition ${
          open ? 'border-blue-500 ring-4 ring-blue-100' : 'border-slate-200 hover:border-blue-200'
        }`}
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          {selected.label}
        </span>
        <ChevronRight className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 cursor-default"
            aria-label="Close month filter"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-30 mt-2 max-h-72 w-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
            {options.map((option) => {
              const active = option.value === selected.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold transition ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                  {active ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ManagementCard({ children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.06)] ${className}`}>
      {children}
    </section>
  );
}

function ManagementKpiCard({ label, value, trend, icon, tone = 'blue' }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600 ring-blue-100',
    orange: 'bg-orange-50 text-orange-600 ring-orange-100',
    red: 'bg-red-50 text-red-600 ring-red-100',
    purple: 'bg-violet-50 text-violet-600 ring-violet-100',
    green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  }[tone];

  return (
    <ManagementCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${toneClass}`}>
            {icon ? createElement(icon, { className: 'h-5 w-5' }) : null}
          </span>
          <div>
            <p className="text-[11px] font-black text-slate-600">{label}</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          </div>
        </div>
        <Info className="h-4 w-4 text-slate-300" />
      </div>
      <p className={`mt-3 text-[11px] font-black ${trend.startsWith('↓') ? 'text-emerald-600' : trend.startsWith('↑') && tone === 'red' ? 'text-red-600' : 'text-emerald-600'}`}>
        {trend}
      </p>
    </ManagementCard>
  );
}

function SessionOnlyNote() {
  return (
    <p className="text-xs font-semibold text-slate-500">
      Latest imported dump is saved and available after refresh.
    </p>
  );
}

function ImportButton({ onImport }) {
  return (
    <label className="focus-ring inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
      <Upload className="h-4 w-4" />
      Import Excel
      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onImport} />
    </label>
  );
}

function ManagementHeader({ viewMode, onViewModeChange, canSwitchView, canImport, onImport }) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Reliance Retail IFMS</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Reliance Retail IFMS Fault Tracker</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">Management dashboard for COO, IFMS South Head, Operations Managers and Branch Heads.</p>
        <SessionOnlyNote />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canSwitchView ? (
          <label className="flex items-center gap-3 text-sm font-bold text-slate-500">
            View
            <select
              value={viewMode}
              onChange={(event) => onViewModeChange(event.target.value)}
              className="h-11 min-w-64 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              {viewOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ) : (
          <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">Management View</span>
        )}
        {canImport ? <ImportButton onImport={onImport} /> : null}
      </div>
    </header>
  );
}

function MisHeader({ viewMode, onViewModeChange, onImport, canSwitchView, canImport }) {
  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)] lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-qpms-600">Reliance Retail IFMS</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Reliance Retail IFMS Fault Tracker</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">State-restricted ticket view for Project Coordinator / MIS.</p>
        <SessionOnlyNote />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canSwitchView ? (
          <label className="flex items-center gap-2 text-sm font-bold text-slate-500">
            View
            <select
              value={viewMode}
              onChange={(event) => onViewModeChange(event.target.value)}
              className="h-10 min-w-60 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-800 outline-none transition focus:border-qpms-500 focus:ring-4 focus:ring-qpms-100"
            >
              {viewOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ) : (
          <span className="rounded-full border border-qpms-100 bg-qpms-50 px-3 py-1.5 text-xs font-black text-qpms-700">Project Coordinator / MIS View</span>
        )}
        {canImport ? <ImportButton onImport={onImport} /> : null}
      </div>
    </header>
  );
}

function StatePerformanceOverview({ data, monthOptions, selectedMonth, onSelectedMonthChange, performanceData }) {
  const latestText = selectedMonth === 'all'
    ? 'Showing all available imported data'
    : performanceData.latestDate
      ? `Showing data till ${displayDate(performanceData.latestDate.toISOString())}`
      : `Showing data from Created At for ${monthLabelFromKey(selectedMonth)}`;
  return (
    <ManagementCard className="p-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-slate-950">State Performance Overview</h2>
            <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Performance Score <Info className="h-3.5 w-3.5" /></span>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">{latestText}</p>
        </div>
        <MonthDropdown options={monthOptions} value={selectedMonth} onChange={onSelectedMonthChange} />
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {groupedStates.map((state) => {
          const summary = performanceData.rows[state] || {
            total: data.stateCounts[state] || 0,
            open: data.stateCounts[state] || 0,
            closed: 0,
            score: 0,
          };
          return (
            <div key={state} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-black text-slate-950">{stateDisplayLabel(state)}</p>
                  <div className="mt-2 space-y-1 text-xs font-bold text-slate-500">
                    <p>Total: {formatNumber(summary.total)}</p>
                    <p>Open: <span className="text-orange-600">{formatNumber(summary.open)}</span></p>
                    <p>Closed: <span className="text-emerald-600">{formatNumber(summary.closed)}</span></p>
                  </div>
                </div>
                <p className="text-lg font-black text-emerald-600">{summary.score}%</p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </ManagementCard>
  );
}

function AgeingDistributionChart({ data }) {
  const total = ageingBuckets.reduce((sum, bucket) => sum + (data.ageingCounts[bucket] || 0), 0);
  const chartData = ageingBuckets.map((bucket, index) => ({
    name: bucket,
    value: data.ageingCounts[bucket] || 0,
    color: ageingColors[index],
  }));

  return (
    <ManagementCard className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-black text-slate-950">Ageing Distribution</h2>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      <div className="grid min-h-72 gap-2 md:grid-cols-[12rem_1fr]">
        <div className="relative h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={1}>
                {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(value) => formatNumber(value)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-2xl font-black text-slate-950">{formatNumber(data.criticalTickets)}</p>
              <p className="text-[11px] font-bold text-slate-500">Critical Tickets</p>
            </div>
          </div>
        </div>
        <div className="space-y-2 self-center">
          {chartData.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-bold text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="shrink-0 font-black text-slate-800">{formatNumber(item.value)} ({percentage(item.value, total)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </ManagementCard>
  );
}

function PendingByStateChart({ data }) {
  const chartData = groupedStates.map((state) => ({ state: stateDisplayLabel(state), tickets: data.stateCounts[state] || 0 }));
  return (
    <ManagementCard className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-black text-slate-950">Pending Tickets by State</h2>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 8, left: -18, bottom: 8 }}>
            <XAxis dataKey="state" axisLine={false} tickLine={false} tick={{ fill: '#334155', fontSize: 11, fontWeight: 800 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
            <Tooltip cursor={{ fill: '#eff6ff' }} formatter={(value) => formatNumber(value)} />
            <Bar dataKey="tickets" fill="#2563eb" radius={[7, 7, 0, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ManagementCard>
  );
}

function SupervisorPendingTicketsCard({ data }) {
  const states = [
    ...hkPcStateOrder,
    ...((data.supPendingByState?.OTHERS || []).length ? ['OTHERS'] : []),
  ];
  return (
    <ManagementCard className="border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-950">Supervisor Wise Pending Tickets</h2>
          <p className="mt-0.5 text-[11px] font-bold text-slate-500">Ownership follow-up by State</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-700">
          {formatNumber(data.supPendingTotal || 0)} pending
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {states.map((state) => {
          const supervisors = data.supPendingByState?.[state] || [];
          return (
            <div key={state} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2">
              <div className="mb-1.5 flex items-center justify-between border-b border-slate-200 pb-1">
                <p className="text-xs font-black text-slate-800">
                  {state === 'OTHERS' ? 'Others' : hkPcStateDisplayLabel(state)}
                </p>
                <span className="text-[10px] font-black text-slate-400">
                  {formatNumber(supervisors.reduce((sum, item) => sum + item.count, 0))}
                </span>
              </div>
              <div className="space-y-1">
                {supervisors.length ? (
                  supervisors.slice(0, 5).map((item, index) => (
                    <div key={`${state}-${item.supName}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-slate-700">
                        {index + 1}. {item.supName}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-black ${item.count >= 8 ? 'bg-blue-100 text-blue-800' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                        {formatNumber(item.count)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs font-bold text-slate-400">No pending</p>
                )}
                {supervisors.length > 5 ? (
                  <p className="pt-0.5 text-[10px] font-black text-slate-400">+{supervisors.length - 5} more</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </ManagementCard>
  );
}

function HkPcTicketsByStateCard({ data }) {
  const categories = [
    { key: 'HK', label: 'HK', color: '#ff5a4f', soft: '#fff1ef' },
    { key: 'PC', label: 'PC', color: '#dc000f', soft: '#ffe4e6' },
  ];
  const maxCount = Math.max(
    1,
    ...hkPcStateOrder.flatMap((state) => categories.map((category) => data.hkPcByState?.[state]?.[category.key] || 0)),
  );
  const totalAlerts = hkPcStateOrder.reduce(
    (sum, state) => sum + categories.reduce((inner, category) => inner + (data.hkPcByState?.[state]?.[category.key] || 0), 0),
    0,
  );
  const heatColor = (count, categoryKey) => {
    const intensity = count / maxCount;
    if (categoryKey === 'PC') {
      if (intensity >= 0.7) return { background: '#dc000f', color: '#fff' };
      if (intensity >= 0.4) return { background: '#fb4b4e', color: '#fff' };
      if (intensity > 0) return { background: '#fee2e2', color: '#7f1d1d' };
      return { background: '#fff7f7', color: '#991b1b' };
    }
    if (intensity >= 0.7) return { background: '#ff5a4f', color: '#fff' };
    if (intensity >= 0.4) return { background: '#ff8a7a', color: '#7f1d1d' };
    if (intensity > 0) return { background: '#ffe7e2', color: '#8a1f16' };
    return { background: '#fff8f6', color: '#9f2419' };
  };
  return (
    <ManagementCard className="relative overflow-hidden border border-red-200 bg-gradient-to-br from-white via-white to-red-50/70 p-4 shadow-[0_18px_40px_rgba(220,38,38,0.12)]">
      <div className="pointer-events-none absolute left-0 top-0 h-2 w-full bg-[repeating-linear-gradient(135deg,#fecaca_0,#fecaca_10px,#fff_10px,#fff_20px)]" />
      <div className="mb-3 flex items-start justify-between gap-3 pt-1">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-600 text-white shadow-sm shadow-red-200">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-black text-red-950">House Keeping & Pest Control Tickets by State</h2>
            <p className="mt-0.5 text-[11px] font-bold text-red-500">Category alert view</p>
          </div>
        </div>
        <span className="rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
          High Priority
        </span>
      </div>
      <div className="rounded-xl border border-red-100 bg-white/95 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-red-950">House Keeping & Pest Control</h3>
            <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-black text-red-700">{formatNumber(totalAlerts)}</span>
          </div>
          <div className="grid grid-cols-[2.5rem_repeat(6,minmax(0,1fr))] gap-0 overflow-hidden rounded-lg border border-red-100 text-center">
            <div className="bg-white" />
            {hkPcStateOrder.map((state) => (
              <div key={`${state}-header`} className="border-l border-red-100 bg-white px-1 py-1.5 text-[10px] font-black text-red-900">
                {hkPcStateDisplayLabel(state)}
              </div>
            ))}
            {categories.map((category) => (
              <Fragment key={category.key}>
                <div className="grid place-items-center border-t border-red-100 bg-white px-1 text-xs font-black text-red-900">
                  {category.label}
                </div>
                {hkPcStateOrder.map((state) => {
                  const count = data.hkPcByState?.[state]?.[category.key] || 0;
                  const style = heatColor(count, category.key);
                  return (
                    <div
                      key={`${category.key}-${state}`}
                      className="border-l border-t border-red-100 px-1 py-1.5 text-xs font-black"
                      style={style}
                      title={`${category.label} ${hkPcStateDisplayLabel(state)}: ${formatNumber(count)} tickets`}
                    >
                      {formatNumber(count)}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[3rem_1fr] gap-2">
            <div className="flex flex-col justify-center gap-3 border-r border-red-100 pr-2 text-[11px] font-black text-red-900">
              {categories.map((category) => (
                <div key={category.key} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: category.color }} />
                  {category.label}
                </div>
              ))}
            </div>
            <div className="relative grid grid-cols-6 items-end gap-2 border-b border-red-200 pb-1">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-red-100" />
              {hkPcStateOrder.map((state) => (
                <div key={`${state}-bars`} className="relative z-10 flex h-24 items-end justify-center gap-1">
                  {categories.map((category) => {
                    const count = data.hkPcByState?.[state]?.[category.key] || 0;
                    const height = `${Math.max(4, (count / maxCount) * 100)}%`;
                    return (
                      <div
                        key={`${state}-${category.key}-bar`}
                        className="w-3.5 rounded-t shadow-sm"
                        style={{ height, backgroundColor: category.color }}
                        title={`${category.label} ${hkPcStateDisplayLabel(state)}: ${formatNumber(count)} tickets`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs">
        <span className="flex items-center gap-2 font-bold text-red-900">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          Category alert total: {formatNumber(totalAlerts)}
        </span>
        <ChevronRight className="h-4 w-4 text-red-500" />
      </div>
    </ManagementCard>
  );
}
function stageCountsForSelection(tickets, selectedState) {
  const scopedTickets = selectedState
    ? tickets.filter((ticket) => ticket.groupedState === selectedState)
    : tickets;
  const hasScopedStageUpdates = scopedTickets.some((ticket) => ticket.ifmsStage);
  if (tickets.length && hasScopedStageUpdates) {
    return Object.fromEntries(ifmsStages.map((stage) => [
      stage,
      scopedTickets.filter((ticket) => ticket.ifmsStage === stage).length,
    ]));
  }

  return Object.fromEntries(ifmsStages.map((stage) => [
    stage,
    0,
  ]));
}

function StageProgress({ tickets, selectedState, onSelectedStateChange }) {
  const stageCounts = stageCountsForSelection(tickets, selectedState);
  const total = Math.max(1, Object.values(stageCounts).reduce((sum, count) => sum + count, 0));
  const titleState = selectedState ? stateDisplayLabel(selectedState) : 'All States';
  return (
    <ManagementCard className="p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-slate-950">Stage-wise Progress ({titleState})</h2>
          <Info className="h-3.5 w-3.5 text-slate-300" />
        </div>
        <select
          value={selectedState}
          onChange={(event) => onSelectedStateChange(event.target.value)}
          className="h-10 min-w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        >
          {stateFilterOptions.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_6rem_6rem] gap-4 px-1 text-xs font-black uppercase tracking-wide text-slate-500">
          <span />
          <span className="text-right">Tickets</span>
          <span className="text-right">% of Total</span>
        </div>
        {ifmsStages.map((stage, index) => {
          const count = stageCounts[stage] || 0;
          const percent = percentage(count, total);
          return (
            <div key={stage} className="grid items-center gap-4 md:grid-cols-[13rem_1fr_6rem_6rem]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-600 text-[11px] font-black text-white">{index + 1}</span>
                <p className="truncate text-xs font-bold text-slate-600">{stage}</p>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-right text-sm font-black text-slate-800">{formatNumber(count)}</p>
              <p className="text-right text-sm font-black text-slate-800">{percent}%</p>
            </div>
          );
        })}
      </div>
    </ManagementCard>
  );
}

function ManagementView({ tickets, viewMode, onViewModeChange, canSwitchView, canImport, onImport, isLoading, activeImportBatch }) {
  const data = useMemo(() => buildManagementData(tickets), [tickets]);
  const [stageProgressState, setStageProgressState] = useState('');
  const monthOptions = useMemo(() => buildMonthOptions(tickets), [tickets]);
  const [performanceMonth, setPerformanceMonth] = useState('all');
  const safePerformanceMonth = monthOptions.some((option) => option.value === performanceMonth) ? performanceMonth : 'all';
  const statePerformanceData = useMemo(
    () => buildStatePerformanceData(tickets, safePerformanceMonth),
    [tickets, safePerformanceMonth],
  );
  const kpis = [
    { label: 'Total Faults', value: formatNumber(data.totalFaults), trend: 'Imported session data', icon: FolderOpen, tone: 'blue' },
    { label: 'Pending Tickets', value: formatNumber(data.pendingTickets), trend: 'Open tickets in current dump', icon: Clock3, tone: 'orange' },
    { label: 'Critical Tickets', value: formatNumber(data.criticalTickets), trend: 'Ageing risk from current dump', icon: AlertTriangle, tone: 'red' },
    { label: 'Avg Ageing', value: `${data.averageAgeing.toFixed(1)} Days`, trend: 'Calculated from imported rows', icon: CalendarDays, tone: 'purple' },
    { label: 'Completed This Week', value: formatNumber(data.completedThisWeek), trend: 'Estimated from current session only', icon: CheckCircle2, tone: 'green' },
    { label: 'South Performance Score', value: `${data.performanceScore}%`, trend: 'Calculated from open vs total', icon: Star, tone: 'blue' },
  ];

  return (
    <div className="space-y-5 bg-slate-50/60">
      <ManagementHeader
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        canSwitchView={canSwitchView}
        canImport={canImport}
        onImport={onImport}
      />
      {isLoading ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
          Loading saved Reliance Retail IFMS dump...
        </div>
      ) : null}
      {activeImportBatch && tickets.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
          Latest saved dump: {activeImportBatch.original_file_name || 'Pending Tickets'} • {formatNumber(activeImportBatch.ticket_count || tickets.length)} tickets • {formatDateTime(activeImportBatch.imported_at)}
        </div>
      ) : null}
      {!tickets.length ? (
        <EmptyState
          title="Upload the daily dump to view Reliance Retail IFMS tickets."
          message="Admin / Developer can import the Pending Tickets Excel dump. The latest saved dump will reload after refresh."
        />
      ) : null}
      {tickets.length ? (
      <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {kpis.map((kpi) => <ManagementKpiCard key={kpi.label} {...kpi} />)}
      </div>
      <StatePerformanceOverview
        data={data}
        monthOptions={monthOptions}
        selectedMonth={safePerformanceMonth}
        onSelectedMonthChange={setPerformanceMonth}
        performanceData={statePerformanceData}
      />
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <AgeingDistributionChart data={data} />
          <PendingByStateChart data={data} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <SupervisorPendingTicketsCard data={data} />
          <HkPcTicketsByStateCard data={data} />
        </div>
        <StageProgress
          tickets={tickets}
          selectedState={stageProgressState}
          onSelectedStateChange={setStageProgressState}
        />
      </div>
      </>
      ) : null}
    </div>
  );
}

export default function FaultTracker() {
  usePageTitle('Fault Tracker');
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [isFaultTrackerLoading, setIsFaultTrackerLoading] = useState(false);
  const [activeImportBatch, setActiveImportBatch] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [editingTicket, setEditingTicket] = useState(null);
  const [draftStage, setDraftStage] = useState('');
  const [draftRemarks, setDraftRemarks] = useState('');
  const [manualViewMode, setManualViewMode] = useState('');
  const [ticketPage, setTicketPage] = useState(1);
  const [isDetailedViewOpen, setIsDetailedViewOpen] = useState(false);

  const userId = user?.id || '';
  const canSwitchView = isAdminDeveloperUser(user);
  const canImport = isAdminDeveloperUser(user);
  const isStateRestricted = isCoordinatorMisUser(user) && !canSwitchView;
  const mappedUserState = useMemo(() => groupedStateFromUser(user), [user]);
  const viewMode = canSwitchView ? (manualViewMode || defaultFaultTrackerView(user)) : defaultFaultTrackerView(user);
  const pcState = isStateRestricted ? mappedUserState : filters.groupedState;
  const pcStateLabel = pcState ? stateLongLabel(pcState) : 'All States';
  const stateMappingMissing = isStateRestricted && !mappedUserState;
  const pcStateTickets = useMemo(() => {
    if (stateMappingMissing) return [];
    if (!pcState) return tickets;
    return tickets.filter((ticket) => ticket.groupedState === pcState);
  }, [tickets, pcState, stateMappingMissing]);
  const pcSummary = useMemo(() => buildPcSummaryRows(pcStateTickets), [pcStateTickets]);
  const supervisorOptions = useMemo(
    () => [...new Set(pcStateTickets.map((ticket) => ticket.supName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [pcStateTickets],
  );
  const pcFilteredTickets = useMemo(
    () => filterTickets(pcStateTickets, { ...filters, groupedState: '', status: '' }),
    [pcStateTickets, filters],
  );
  const pageSize = 10;
  const totalTicketPages = Math.max(1, Math.ceil(pcFilteredTickets.length / pageSize));
  const safeTicketPage = Math.min(ticketPage, totalTicketPages);
  const pageStart = pcFilteredTickets.length ? (safeTicketPage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, pcFilteredTickets.length);
  const pagedTickets = pcFilteredTickets.slice(pageStart, pageEnd);
  const lastRefreshed = formatDateTime(new Date());

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setTicketPage(1);
  };

  const loadFaultTrackerTickets = useCallback(async (params = {}) => {
    setIsFaultTrackerLoading(true);
    setImportError('');
    try {
      const result = await faultTrackerApiRequest({
        method: 'GET',
        url: '/api/fault-tracker/tickets',
        params: {
          latest: true,
          ...params,
        },
      });
      setTickets((result.tickets || []).map(ticketFromDatabaseRow));
      setActiveImportBatch(result.import_batch || null);
      setFilters(emptyFilters);
      setTicketPage(1);
    } catch (error) {
      setTickets([]);
      setActiveImportBatch(null);
      setImportError(error?.message || 'Unable to load saved Fault Tracker tickets.');
    } finally {
      setIsFaultTrackerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    const timer = window.setTimeout(() => {
      void loadFaultTrackerTickets();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFaultTrackerTickets, userId]);

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setImportError('');
    setImportMessage('');
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets['Pending Tickets'];
      if (!sheet) {
        setImportError('Sheet "Pending Tickets" was not found. Please upload the IFMS pending ticket dump.');
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const parsed = parseTicketRows(rows);
      const firstRow = rows[0] || {};
      const detectedCreatedAtHeader = headerFor(firstRow, 'Created At');
      const generatedMonthOptions = buildMonthOptions(parsed);
      console.log('Fault Tracker import headers', Object.keys(firstRow));
      console.log('Fault Tracker mapped numeric ageing header', headerFor(firstRow, 'Ageing'));
      console.log('Fault Tracker mapped ageing bucket header', headerFor(firstRow, 'Ageing(Days)'));
      console.log('Detected Created At header:', detectedCreatedAtHeader);
      console.log('First Created At values:', rows.slice(0, 5).map((row) => valueFor(row, 'Created At')));
      console.log('Parsed dates:', parsed.slice(0, 5).map((ticket) => createdDateKey(ticket.createdAt)));
      console.log('Month options:', generatedMonthOptions.map((option) => option.label).join(', '));
      console.log('Fault Tracker first parsed rows', parsed.slice(0, 5).map((ticket) => ({
        'Ticket Number': ticket.ticketNumber,
        Ageing: ticket.ageingDays,
        'Ageing(Days)': ticket.ageingBucket,
        'Created At': ticket.createdAt,
      })));
      const result = await faultTrackerApiRequest({
        method: 'POST',
        url: '/api/fault-tracker/import',
        data: {
          file_name: file.name,
          sheet_name: 'Pending Tickets',
          tickets: parsed,
          metadata: {
            imported_from: 'web',
            source: 'FaultTracker.jsx',
          },
        },
      });
      await loadFaultTrackerTickets({ import_batch_id: result.import_batch_id, latest: false });
      setImportMessage(`${result.ticket_count || parsed.length} South zone tickets imported and saved from ${file.name}.`);
    } catch (error) {
      setImportError(error?.message || 'Unable to read this Excel file. Please check the format and try again.');
    }
  }

  function openUpdate(ticket) {
    setEditingTicket(ticket);
    setDraftStage(ticket.ifmsStage || ifmsStages[0]);
    setDraftRemarks(ticket.remarks || '');
  }

  function saveUpdate() {
    const updatedBy = user?.displayName || user?.name || user?.email || 'Demo User';
    setTickets((current) => current.map((ticket) => (
      ticket.id === editingTicket.id
        ? { ...ticket, ifmsStage: draftStage, remarks: draftRemarks, lastUpdatedBy: updatedBy }
        : ticket
    )));
    setEditingTicket(null);
  }

  if (viewMode === 'Management View') {
    return (
      <ManagementView
        tickets={tickets}
        viewMode={viewMode}
        onViewModeChange={setManualViewMode}
        canSwitchView={canSwitchView}
        canImport={canImport}
        onImport={handleImport}
        isLoading={isFaultTrackerLoading}
        activeImportBatch={activeImportBatch}
      />
    );
  }

  return (
    <div className="space-y-4 bg-slate-50/60">
      <MisHeader
        viewMode={viewMode}
        onViewModeChange={setManualViewMode}
        onImport={handleImport}
        canSwitchView={canSwitchView}
        canImport={canImport}
      />

      {(importMessage || importError) ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
          importError ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {importError || importMessage}
        </div>
      ) : null}

      {isFaultTrackerLoading ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
          Loading saved Reliance Retail IFMS dump...
        </div>
      ) : null}

      {activeImportBatch && tickets.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
          Latest saved dump: {activeImportBatch.original_file_name || 'Pending Tickets'} • {formatNumber(activeImportBatch.ticket_count || tickets.length)} tickets • {formatDateTime(activeImportBatch.imported_at)}
        </div>
      ) : null}

      {stateMappingMissing ? (
        <EmptyState
          title="State mapping not configured for your profile. Please contact Admin."
          message="Project Coordinator / MIS users can view only their mapped state tickets."
        />
      ) : null}

      {!stateMappingMissing && !tickets.length ? (
        <EmptyState
          title="Upload the daily dump to view Reliance Retail IFMS tickets."
          message={canImport ? 'Import the Pending Tickets Excel dump. The latest saved dump will reload after refresh.' : 'No saved dump is available yet. Admin / Developer import is required.'}
        />
      ) : null}

      {!stateMappingMissing && tickets.length ? (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-black text-slate-950">IFMS Stage Summary — {pcStateLabel}</h2>
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold text-slate-500">{isStateRestricted ? 'All values are for your state only.' : 'Admin / Developer testing view.'}</p>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">State: {pcStateLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span>Last refreshed: {lastRefreshed}</span>
            <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-50 text-[11px] font-black text-slate-500">
              <tr className="border-b border-slate-200">
                <th rowSpan={2} className="min-w-80 px-5 py-2.5 text-left">IFMS Stage</th>
                <th rowSpan={2} className="px-4 py-2.5 text-center">Tickets</th>
                <th colSpan={2} className="border-b border-slate-200 px-4 py-1.5 text-center">Ageing (Days)</th>
                <th rowSpan={2} className="px-4 py-2.5 text-center">Last Updated</th>
                <th rowSpan={2} className="px-4 py-2.5 text-center">Status / Trend (vs yesterday)</th>
              </tr>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-1.5 text-center">Avg</th>
                <th className="px-4 py-1.5 text-center">Oldest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {pcSummary.map((row, index) => {
                const isTotal = row.stage === 'Grand Total';
                return (
                  <tr key={row.stage} className={isTotal ? 'bg-slate-50/90 font-black' : 'hover:bg-slate-50/70'}>
                    <td className="px-5 py-2.5 font-black text-slate-800">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: isTotal ? '#94a3b8' : ageingColors[index % ageingColors.length] }}
                        />
                        {row.stage}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-sm font-black text-slate-950">{formatNumber(row.tickets)}</td>
                    <td className="px-4 py-2.5 text-center font-black text-slate-700">{row.average}</td>
                    <td className="px-4 py-2.5 text-center font-black text-slate-700">{row.oldest}</td>
                    <td className="px-4 py-2.5 text-center font-bold text-slate-700">{row.lastUpdated}</td>
                    <td className="px-4 py-2.5 text-center">
                      {row.trend === '—' ? (
                        <span className="font-black text-slate-400">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          {row.trend}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              setIsDetailedViewOpen((current) => !current);
              setTicketPage(1);
            }}
            aria-expanded={isDetailedViewOpen}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-slate-800"
          >
            {isDetailedViewOpen ? 'Hide Details' : 'Detailed View'}
            <ChevronDown className={`h-4 w-4 transition-transform ${isDetailedViewOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </section>
      ) : null}

      {!stateMappingMissing && tickets.length && isDetailedViewOpen ? (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-black text-slate-950">Detailed Ticket View — {pcStateLabel}</h2>
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-bold text-slate-500">
            <span>Showing {pcFilteredTickets.length ? pageStart + 1 : 0} to {pageEnd} of {formatNumber(pcFilteredTickets.length)}</span>
            <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700">10 / page</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setTicketPage((page) => Math.max(1, page - 1))} disabled={safeTicketPage === 1} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40">‹</button>
              {Array.from({ length: Math.min(5, totalTicketPages) }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setTicketPage(page)}
                  className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-black ${safeTicketPage === page ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {page}
                </button>
              ))}
              {totalTicketPages > 5 ? (
                <>
                  <span className="px-1 text-slate-400">...</span>
                  <button type="button" onClick={() => setTicketPage(totalTicketPages)} className={`grid h-7 min-w-7 place-items-center rounded-lg px-2 text-xs font-black ${safeTicketPage === totalTicketPages ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{totalTicketPages}</button>
                </>
              ) : null}
              <button type="button" onClick={() => setTicketPage((page) => Math.min(totalTicketPages, page + 1))} disabled={safeTicketPage === totalTicketPages} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40">›</button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            {canSwitchView ? (
              <SelectFilter label="State" value={filters.groupedState} onChange={(value) => setFilter('groupedState', value)} options={stateFilterOptions} />
            ) : (
              <label className="space-y-1.5">
                <span className="text-[11px] font-black text-slate-500">State</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={pcState ? stateDisplayLabel(pcState) : 'Not configured'} disabled className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 pr-9 text-xs font-black text-slate-500" />
                </div>
              </label>
            )}
            <SelectFilter label="Supervisor" value={filters.supervisor} onChange={(value) => setFilter('supervisor', value)} options={supervisorOptions} />
            <SelectFilter label="IFMS Stage" value={filters.ifmsStage} onChange={(value) => setFilter('ifmsStage', value)} options={ifmsStages} />
            <SelectFilter label="Ageing Bucket" value={filters.ageingBucket} onChange={(value) => setFilter('ageingBucket', value)} options={ageingBuckets} />
            <TextFilter label="Ticket Number" value={filters.ticketNumber} onChange={(value) => setFilter('ticketNumber', value)} />
            <TextFilter label="Store ID" value={filters.storeId} onChange={(value) => setFilter('storeId', value)} />
            <TextFilter label="Store Name" value={filters.storeName} onChange={(value) => setFilter('storeName', value)} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[10rem_10rem_1fr_auto_auto]">
            <TextFilter label="Created From" type="date" value={filters.createdFrom} onChange={(value) => setFilter('createdFrom', value)} />
            <TextFilter label="Created To" type="date" value={filters.createdTo} onChange={(value) => setFilter('createdTo', value)} />
            <label className="space-y-1.5">
              <span className="text-[11px] font-black text-slate-500">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilter('search', event.target.value)}
                  placeholder="Search by any field..."
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </label>
            <button type="button" onClick={() => { setFilters(emptyFilters); setTicketPage(1); }} className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" />
              Clear Filters
            </button>
            <button type="button" onClick={() => setTicketPage(1)} className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white shadow-sm hover:bg-slate-800">
              <Filter className="h-3.5 w-3.5" />
              Apply Filters
            </button>
          </div>
        </div>

        {pcStateTickets.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-100 text-slate-500">
                <tr className="border-b border-slate-200">
                  {['Ticket Number', 'Created Date', 'Store ID', 'Store Name', 'Category', 'Sub Category', 'Issue Title', 'Ageing (Days)', 'Supervisor', 'IFMS Stage', 'Remarks', 'Last Updated By', 'Action'].map((heading) => (
                    <th key={heading} className="px-3 py-2.5 text-left font-black">
                      <span className="inline-flex items-center gap-1">
                        {heading}
                        <ArrowUpDown className="h-3 w-3 text-slate-400" />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {pagedTickets.map((ticket, index) => (
                  <tr key={ticket.id} className={index % 2 ? 'bg-slate-50/50 hover:bg-blue-50/40' : 'hover:bg-blue-50/40'}>
                    <td className="px-3 py-2.5"><button type="button" className="font-black text-blue-700 hover:underline">{ticket.ticketNumber || '-'}</button></td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{displayDate(ticket.createdAt)}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{ticket.storeId || '-'}</td>
                    <td className="px-3 py-2.5 font-black text-slate-800">{ticket.storeName || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{ticket.category || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{ticket.subCategory || '-'}</td>
                    <td className="max-w-72 px-3 py-2.5 font-semibold text-slate-700">{ticket.issueTitle || '-'}</td>
                    <td className={`px-3 py-2.5 font-black ${numberValue(ticket.ageingDays) > 90 ? 'text-red-600' : numberValue(ticket.ageingDays) > 30 ? 'text-orange-600' : 'text-slate-700'}`}>{ticket.ageingDays}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-700">{ticket.supName || '-'}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">{ticket.ifmsStage || 'Not Updated'}</span></td>
                    <td className="max-w-64 px-3 py-2.5 font-semibold text-slate-600">{ticket.remarks || '-'}</td>
                    <td className="px-3 py-2.5 font-semibold text-slate-600">{ticket.lastUpdatedBy || '-'}</td>
                    <td className="px-3 py-2.5"><button onClick={() => openUpdate(ticket)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-[11px] font-black text-white hover:bg-slate-800">Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pagedTickets.length ? (
              <div className="border-t border-slate-100 px-5 py-8 text-center text-sm font-semibold text-slate-500">No tickets match the selected filters.</div>
            ) : null}
          </div>
        ) : <EmptyState title={`No ${stateDisplayLabel(pcState)} tickets to show`} message="Import an Excel dump to view and update state-level tickets locally." />}
      </section>
      ) : null}

      {editingTicket ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm">
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-qpms-600">Update Fault</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">{editingTicket.ticketNumber || 'Ticket'}</h2>
              </div>
              <button onClick={() => setEditingTicket(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close update drawer"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-950">{editingTicket.storeName || '-'}</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">{editingTicket.state} / {stateDisplayLabel(editingTicket.groupedState)}</p>
                <p className="mt-3 text-sm text-slate-700">{editingTicket.issueTitle || 'No issue title available.'}</p>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">IFMS Stage</span>
                <select value={draftStage} onChange={(event) => setDraftStage(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-500 focus:ring-4 focus:ring-qpms-100">
                  {ifmsStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Remarks</span>
                <textarea value={draftRemarks} onChange={(event) => setDraftRemarks(event.target.value)} rows={5} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-500 focus:ring-4 focus:ring-qpms-100" />
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                This save updates only frontend local state for the current browser session.
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingTicket(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={saveUpdate} className="rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-black text-white hover:bg-qpms-700">Save</button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
