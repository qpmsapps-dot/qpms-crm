import { useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  Bike,
  Building2,
  CircleGauge,
  ChevronRight,
  ClipboardList,
  Clock,
  Filter,
  FileSpreadsheet,
  LocateFixed,
  MapPin,
  MapPinned,
  Maximize2,
  Minimize2,
  Navigation2,
  RadioTower,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import L from "leaflet";
import {
  Marker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import * as XLSX from "xlsx";
import "leaflet/dist/leaflet.css";
import PageHeader from "../components/PageHeader.jsx";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const SOUTH_INDIA_CENTER = [13.0827, 80.2707];
const INDIA_TIME_ZONE = "Asia/Kolkata";
const RATE_PER_KM = 4;
const ROUTE_BREAK_MINUTES = 10;
const ROUTE_BREAK_KM = 5;

function toDateInputValue(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function indiaDateFromInput(value) {
  return new Date(`${value}T00:00:00+05:30`);
}

function startOfIndiaDayFromInput(value) {
  return new Date(`${value}T00:00:00+05:30`);
}

function endOfIndiaDayFromInput(value) {
  return new Date(`${value}T23:59:59.999+05:30`);
}

function monthStart(date) {
  const value = toDateInputValue(date);
  return `${value.slice(0, 7)}-01`;
}

function dateRangeForPreset(preset, customFrom, customTo) {
  const now = new Date();
  const todayInput = toDateInputValue(now);
  if (preset === "yesterday") {
    const yesterday = new Date(
      indiaDateFromInput(todayInput).getTime() - 86400000,
    );
    const value = toDateInputValue(yesterday);
    return {
      from: startOfIndiaDayFromInput(value),
      to: endOfIndiaDayFromInput(value),
      fromDate: value,
      toDate: value,
    };
  }
  if (preset === "last7") {
    const fromDate = toDateInputValue(
      new Date(indiaDateFromInput(todayInput).getTime() - 6 * 86400000),
    );
    return {
      from: startOfIndiaDayFromInput(fromDate),
      to: endOfIndiaDayFromInput(todayInput),
      fromDate,
      toDate: todayInput,
    };
  }
  if (preset === "month") {
    const fromDate = monthStart(now);
    return {
      from: startOfIndiaDayFromInput(fromDate),
      to: endOfIndiaDayFromInput(todayInput),
      fromDate,
      toDate: todayInput,
    };
  }
  if (preset === "custom") {
    const fromDate = customFrom || todayInput;
    const toDate = customTo || todayInput;
    return {
      from: startOfIndiaDayFromInput(fromDate),
      to: endOfIndiaDayFromInput(toDate),
      fromDate,
      toDate,
    };
  }
  return {
    from: startOfIndiaDayFromInput(todayInput),
    to: endOfIndiaDayFromInput(todayInput),
    fromDate: todayInput,
    toDate: todayInput,
  };
}

function formatDateForDb(value) {
  return value.toISOString();
}

function formatDateOnly(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function officerStatus(officer) {
  if (officer.status === "Offline")
    return { label: "Offline", tone: "text-rose-600", dot: "bg-rose-500" };
  if (officer.status === "Recent")
    return {
      label: "Recently Active",
      tone: "text-amber-600",
      dot: "bg-amber-500",
    };
  if (officer.battery < 20)
    return {
      label: "Low Battery",
      tone: "text-amber-600",
      dot: "bg-amber-500",
    };
  return { label: "Online", tone: "text-emerald-600", dot: "bg-emerald-500" };
}

function batteryState(officer) {
  if (officer.battery === null || officer.status === "Offline")
    return { tone: "text-slate-400", label: "--" };
  if (officer.battery < 20)
    return { tone: "text-rose-600", label: `${officer.battery}%` };
  if (officer.battery < 60)
    return { tone: "text-amber-600", label: `${officer.battery}%` };
  return { tone: "text-emerald-600", label: `${officer.battery}%` };
}

function markerTone(state, officers) {
  const isCritical =
    state.status === "Critical" ||
    officers.some((officer) => officer.status === "Offline");
  const needsAttention =
    state.status === "Warning" ||
    officers.some(
      (officer) =>
        officer.status !== "Active" ||
        (officer.battery !== null && officer.battery < 30),
    );
  if (isCritical) return "#ef4444";
  if (needsAttention) return "#f59e0b";
  return "#10b981";
}

function foMarkerColor(officer) {
  if (officer.status === "Offline") return "#ef4444";
  if (officer.status === "Recent") return "#f59e0b";
  if (officer.battery !== null && officer.battery < 20) return "#ef4444";
  if (officer.battery !== null && officer.battery < 60) return "#f59e0b";
  return "#10b981";
}

function foMarkerIcon(officer) {
  const color = foMarkerColor(officer);
  const isActive = officer.status === "Active";
  const rotation = Number(officer.heading || 0);
  return L.divIcon({
    className: "",
    html: `
      <div class="fo-bike-marker" style="--marker-color:${color};">
        ${isActive ? '<span class="fo-bike-pulse"></span>' : ""}
        <span class="fo-bike-core" style="transform: rotate(${rotation}deg);">
          <span class="fo-bike-glyph">&#128757;</span>
        </span>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -20],
  });
}

function clusterMarkerIcon(count, color) {
  return L.divIcon({
    className: "",
    html: `
      <div class="fo-cluster-marker" style="--marker-color:${color};">
        <span>${count}</span>
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -18],
  });
}

function siteMarkerIcon() {
  return L.divIcon({
    className: "",
    html: `
      <div class="fo-site-marker">
        <span></span>
      </div>
    `,
    iconSize: [26, 34],
    iconAnchor: [13, 30],
    popupAnchor: [0, -26],
  });
}

function formatTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latestBy(rows, key) {
  const grouped = new Map();
  rows.forEach((row) => {
    const id = normalizeFoKey(foIdFromRow(row));
    if (!id) return;
    const current = grouped.get(id);
    if (!current || new Date(row[key] || 0) > new Date(current[key] || 0)) {
      grouped.set(id, row);
    }
  });
  return grouped;
}

function foIdFromRow(row) {
  return String(row?.fo_user_id || row?.employee_code || "").trim();
}

function normalizeFoKey(value = "") {
  return String(value).trim().toUpperCase();
}

function profileKeys(row) {
  return [row?.employee_code, row?.username, row?.fo_user_id]
    .map(normalizeFoKey)
    .filter(Boolean);
}

function isRealFoProfile(profile) {
  const role = String(profile?.role || "")
    .trim()
    .toLowerCase();
  const status = String(profile?.status || "")
    .trim()
    .toLowerCase();
  const keys = profileKeys(profile);
  return (
    ["fo", "field officer"].includes(role) &&
    !["deleted", "disabled", "inactive", "blocked"].includes(status) &&
    keys.length > 0
  );
}

function isValidRoutePoint(log) {
  if (log?.is_mocked || log?.metadata?.mock === true) return false;
  const lat = Number(log?.latitude);
  const lng = Number(log?.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function distanceKmBetween(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(Number(b.latitude) - Number(a.latitude));
  const dLng = toRadians(Number(b.longitude) - Number(a.longitude));
  const lat1 = toRadians(Number(a.latitude));
  const lat2 = toRadians(Number(b.latitude));
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function routeSegmentsFromLogs(logs = []) {
  const ordered = logs
    .filter(isValidRoutePoint)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.captured_at || a.logged_at || 0) -
        new Date(b.captured_at || b.logged_at || 0),
    );
  const segments = [];
  let current = [];
  let previous = null;

  ordered.forEach((log) => {
    if (previous) {
      const gapMinutes =
        (new Date(log.captured_at || log.logged_at || 0) -
          new Date(previous.captured_at || previous.logged_at || 0)) /
        60000;
      const jumpKm = distanceKmBetween(previous, log);
      if (gapMinutes > ROUTE_BREAK_MINUTES || jumpKm > ROUTE_BREAK_KM) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }
    current.push([Number(log.latitude), Number(log.longitude)]);
    previous = log;
  });
  if (current.length > 1) segments.push(current);
  return segments;
}

function routeKmFromLogs(logs = []) {
  return routeSegmentsFromLogs(logs).reduce((sum, segment) => {
    let distance = 0;
    for (let index = 1; index < segment.length; index += 1) {
      distance += distanceKmBetween(
        { latitude: segment[index - 1][0], longitude: segment[index - 1][1] },
        { latitude: segment[index][0], longitude: segment[index][1] },
      );
    }
    return sum + distance;
  }, 0);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function liveStatusTimestamp(row) {
  return (
    row?.last_seen_at ||
    row?.last_seen ||
    row?.updated_at ||
    row?.logged_at ||
    row?.created_at
  );
}

function liveStatusFromRow(row, fallbackActive = false) {
  const statusText = String(row?.current_status || "").toLowerCase();
  if (
    row &&
    (row.is_online === true ||
      row.is_tracking === true ||
      statusText === "live" ||
      statusText === "active")
  )
    return "Active";
  const timestamp = liveStatusTimestamp(row);
  const ageMs = timestamp
    ? Date.now() - new Date(timestamp).getTime()
    : Number.POSITIVE_INFINITY;
  const ageMinutes = ageMs / 60000;
  if (row && ageMinutes <= 10) return "Recent";
  if (row) return "Offline";
  return fallbackActive ? "Recent" : "Offline";
}

function hasFiniteCoordinates(coordinates) {
  return (
    Array.isArray(coordinates) &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  );
}

function canShowOfficerMarker(officer) {
  return (
    ["Active", "Recent"].includes(officer.status) &&
    hasFiniteCoordinates(officer.coordinates)
  );
}

function batteryFromRow(...rows) {
  for (const row of rows) {
    const value =
      row?.battery_percentage ??
      row?.battery_level ??
      row?.battery ??
      row?.battery_percent ??
      row?.battery_start;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function latestLiveStatusByFo(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const id = normalizeFoKey(row?.fo_user_id);
    if (!id) return;
    const current = grouped.get(id);
    if (
      !current ||
      new Date(liveStatusTimestamp(row) || 0) >
        new Date(liveStatusTimestamp(current) || 0)
    ) {
      grouped.set(id, row);
    }
  });
  return grouped;
}

function profileByFoKey(rows = []) {
  const profilesByCode = new Map();
  rows.filter(isRealFoProfile).forEach((profile) => {
    profileKeys(profile).forEach((key) => {
      if (key) profilesByCode.set(key, profile);
    });
  });
  return profilesByCode;
}

function mergeLiveStatusRows(...groups) {
  const rowsByFo = new Map();
  groups.flat().forEach((row) => {
    const id = normalizeFoKey(row?.fo_user_id);
    if (!id || rowsByFo.has(id)) return;
    rowsByFo.set(id, row);
  });
  return Array.from(rowsByFo.values());
}

async function fetchPagedLiveStatusRows(baseQuery, pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await baseQuery.range(from, to);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchFoLiveStatusRows() {
  const activeBaseQuery = supabase
    .from("fo_live_status")
    .select("*")
    .or(
      "is_online.eq.true,is_tracking.eq.true,current_status.eq.live,current_status.eq.Active,current_status.eq.active",
    )
    .order("last_seen_at", { ascending: false })
    .order("updated_at", { ascending: false });
  const activeRows = await fetchPagedLiveStatusRows(activeBaseQuery);

  const { data: recentRows, error: recentError } = await supabase
    .from("fo_live_status")
    .select("*")
    .order("updated_at", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (recentError) throw recentError;

  console.debug("FO_ACTIVE_LIVE_ROWS_LOADED", activeRows.length);
  console.debug("FO_RECENT_LIVE_ROWS_LOADED", recentRows?.length || 0);
  return mergeLiveStatusRows(activeRows, recentRows || []);
}

function officerFromRows({ foId, profile, live, attendance, visits }) {
  const record = attendance || {};
  const foVisits = visits || [];
  const lat = numberOrNull(live?.latitude ?? live?.lat);
  const lng = numberOrNull(live?.longitude ?? live?.lng ?? live?.long);
  const coordinates = lat !== null && lng !== null ? [lat, lng] : null;
  const sourceTimestamp = liveStatusTimestamp(live) || record.login_time;
  const status = liveStatusFromRow(
    live,
    !record.logout_time &&
      String(record.status || "").toLowerCase() !== "completed",
  );
  const actualKm = Number(live?.route_km_today ?? record.actual_km ?? 0);
  const eligibleKm = Number(record.eligible_km ?? actualKm ?? 0);
  const petrolAmount = Number(record.petrol_amount ?? eligibleKm * RATE_PER_KM);
  const name =
    profile?.full_name ||
    profile?.display_name ||
    live?.display_name ||
    live?.username ||
    live?.fo_user_id ||
    foId;
  const state = profile?.state || live?.state || record.state || "Tamil Nadu";

  return {
    id: `live-${foId}`,
    foId,
    name,
    employeeCode: profile?.employee_code || live?.fo_user_id || foId,
    status,
    assignedSite:
      foVisits.find((visit) => !visit.checkout_time)?.store_name ||
      "No active store visit",
    branch: state,
    state,
    checkIn: formatTime(record.login_time),
    lastSeen: formatDateTime(sourceTimestamp),
    battery: batteryFromRow(live),
    action: live?.current_status || record.status || "Attendance captured",
    phone: "--",
    coordinates,
    heading: live?.heading ?? live?.bearing ?? null,
    speed: live?.speed ?? null,
    accuracy: live?.accuracy ?? null,
    actualKm,
    eligibleKm,
    ratePerKm: RATE_PER_KM,
    petrolAmount,
    routeKmToday: actualKm,
    siteCoordinates: null,
    siteMarkerName: "Assigned site",
    foLatitude: coordinates?.[0] ?? null,
    foLongitude: coordinates?.[1] ?? null,
    locationSourceTime: sourceTimestamp,
    attendance: record,
    tasks: [],
    visits: foVisits,
    logs: [],
    conveyance: null,
  };
}

function buildLiveFoData({ attendance, visits, liveStatus, profiles }) {
  const latestAttendance = latestBy(attendance, "login_time");
  const latestLiveStatus = latestLiveStatusByFo(liveStatus);
  const profilesByCode = profileByFoKey(profiles);
  const visitsByFo = visits.reduce((map, visit) => {
    const id = normalizeFoKey(foIdFromRow(visit));
    const list = map.get(id) || [];
    list.push(visit);
    map.set(id, list);
    return map;
  }, new Map());

  const officerIds = new Set([
    ...profilesByCode.keys(),
    ...latestLiveStatus.keys(),
  ]);
  return Array.from(officerIds).map((foId) =>
    officerFromRows({
      foId,
      profile: profilesByCode.get(foId),
      live: latestLiveStatus.get(foId),
      attendance: latestAttendance.get(foId),
      visits: visitsByFo.get(foId) || [],
    }),
  );
}

function officerFromLiveStatus(row, profilesByCode, existing = {}) {
  const foId = normalizeFoKey(
    row?.fo_user_id || existing.foId || existing.employeeCode,
  );
  if (!foId) return null;
  const profile = profilesByCode.get(foId);
  const lat = numberOrNull(row?.latitude ?? row?.lat);
  const lng = numberOrNull(row?.longitude ?? row?.lng ?? row?.long);
  const coordinates = lat !== null && lng !== null ? [lat, lng] : null;
  if (!coordinates && hasFiniteCoordinates(existing.coordinates)) {
    console.debug("FO_COORDINATES_CLEARED", foId);
  }
  const timestamp = liveStatusTimestamp(row) || existing.locationSourceTime;
  const status = liveStatusFromRow(row, existing.status === "Active");
  const battery = batteryFromRow(row);
  const actualKm = Number(
    row?.route_km_today ?? existing.actualKm ?? existing.routeKmToday ?? 0,
  );
  const eligibleKm = Number(existing.eligibleKm ?? actualKm ?? 0);
  const petrolAmount = Number(
    existing.petrolAmount ?? eligibleKm * RATE_PER_KM,
  );
  return {
    ...existing,
    id: existing.id || `live-${foId}`,
    foId,
    name:
      profile?.full_name ||
      profile?.display_name ||
      row?.display_name ||
      row?.username ||
      row?.fo_user_id ||
      existing.name ||
      foId,
    employeeCode:
      profile?.employee_code ||
      row?.fo_user_id ||
      existing.employeeCode ||
      foId,
    status,
    assignedSite: existing.assignedSite || "No active store visit",
    branch: profile?.state || row?.state || existing.state || "Tamil Nadu",
    state: profile?.state || row?.state || existing.state || "Tamil Nadu",
    lastSeen: formatDateTime(timestamp),
    battery: battery ?? existing.battery ?? null,
    action: row?.current_status || existing.action || "Attendance captured",
    coordinates,
    heading: row?.heading ?? row?.bearing ?? existing.heading ?? null,
    speed: row?.speed ?? existing.speed ?? null,
    accuracy: row?.accuracy ?? existing.accuracy ?? null,
    actualKm,
    eligibleKm,
    routeKmToday: actualKm,
    petrolAmount,
    foLatitude: coordinates?.[0] ?? null,
    foLongitude: coordinates?.[1] ?? null,
    locationSourceTime: timestamp,
    tasks: existing.tasks || [],
    visits: existing.visits || [],
    logs: existing.logs || [],
    conveyance: null,
  };
}

function mergeRealtimeOfficer(officers, liveRow, profileRows) {
  const profilesByCode = profileByFoKey(profileRows);
  const foId = normalizeFoKey(liveRow?.fo_user_id);
  const existingIndex = officers.findIndex(
    (officer) =>
      normalizeFoKey(officer.foId) === foId ||
      normalizeFoKey(officer.employeeCode) === foId,
  );
  const existing = existingIndex >= 0 ? officers[existingIndex] : {};
  const nextOfficer = officerFromLiveStatus(liveRow, profilesByCode, existing);
  if (!nextOfficer) return officers;
  if (existingIndex < 0) return [...officers, nextOfficer];
  const next = officers.slice();
  next[existingIndex] = nextOfficer;
  return next;
}

function MetricTile({ label, value, icon, tone = "blue", compact = false }) {
  const Icon = icon;
  const tones = {
    blue: "bg-qpms-50 text-qpms-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    purple: "bg-violet-50 text-violet-700",
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${compact ? "px-2.5 py-2.5" : "px-3.5 py-3"}`}
    >
      <div
        className={`flex items-center justify-between ${compact ? "gap-1.5" : "gap-3"}`}
      >
        <div>
          <p
            className={`${compact ? "text-[9px]" : "text-[11px]"} font-bold uppercase text-slate-500 dark:text-slate-400`}
          >
            {label}
          </p>
          <p
            className={`${compact ? "mt-1 text-xl" : "mt-1 text-2xl"} font-semibold leading-none text-slate-950 dark:text-white`}
          >
            {value}
          </p>
        </div>
        <span
          className={`rounded-xl ${compact ? "p-1.5" : "p-2.5"} ${tones[tone]}`}
        >
          <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </span>
      </div>
    </div>
  );
}

function FleetKpi({ label, value, icon, tone = "blue", hint }) {
  const Icon = icon;
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    purple: "bg-violet-50 text-violet-700",
    slate: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            {label}
          </p>
          <div className="mt-2 flex items-end gap-2">
            <p className="text-2xl font-black leading-none tracking-tight text-slate-950 dark:text-white">
              {value}
            </p>
            {hint ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {hint}
              </span>
            ) : null}
          </div>
        </div>
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tones[tone] || tones.blue}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked }) {
  return (
    <span
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </span>
  );
}

function ControlButton({ icon, label, onClick }) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-bold text-slate-700 shadow-sm transition hover:border-qpms-200 hover:bg-qpms-50/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
    >
      <Icon className="h-4 w-4 text-qpms-600" />
      {label}
    </button>
  );
}

function LegendItem({ color, label, helper, dashed = false, site = false }) {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
      {site ? (
        <Building2 className="h-4 w-4 text-blue-600" />
      ) : dashed ? (
        <span
          className="h-0.5 w-6 rounded-full border-t-2 border-dashed"
          style={{ borderColor: color }}
        />
      ) : (
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          <Bike className="h-3.5 w-3.5" />
        </span>
      )}
      <span>
        {label}
        {helper ? (
          <span className="ml-1 font-medium text-slate-400">{helper}</span>
        ) : null}
      </span>
    </div>
  );
}

function OfficerDirectoryRow({ officer, selected, onSelect }) {
  const status = officerStatus(officer);
  const battery = batteryState(officer);
  const routeKm = Number(officer.routeKmToday ?? 0);
  const isLive = status.label === "Online";
  const isRecent =
    status.label === "Recently Active" || status.label === "Low Battery";
  const statusText = isLive ? "Live" : isRecent ? "Recent" : "Offline";
  const statusClass = isLive
    ? "bg-emerald-50 text-emerald-700"
    : isRecent
      ? "bg-amber-50 text-amber-700"
      : "bg-rose-50 text-rose-700";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${selected ? "bg-qpms-50/70 dark:bg-qpms-500/10" : "bg-white dark:bg-slate-900"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white shadow-sm"
          style={{ backgroundColor: foMarkerColor(officer) }}
        >
          <Bike className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950 dark:text-white">
                {officer.name}
              </p>
              <p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                Employee ID: {officer.employeeCode || officer.foId}
              </p>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-[10px] font-black ${statusClass}`}
            >
              {statusText}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
            <span className={`inline-flex items-center gap-1 ${battery.tone}`}>
              <Battery className="h-3.5 w-3.5" />
              {battery.label}
            </span>
            <span className="inline-flex items-center gap-1">
              <CircleGauge className="h-3.5 w-3.5" />
              {officer.speed
                ? `${Math.round(Number(officer.speed))} km/h`
                : "0 km/h"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Route className="h-3.5 w-3.5" />
              {routeKm.toFixed(1)} km
            </span>
            <span>
              Eligible {Number(officer.eligibleKm || 0).toFixed(1)} km
            </span>
            <span>₹{Number(officer.petrolAmount || 0).toFixed(0)}</span>
          </div>
          <p className="mt-1 truncate text-xs font-medium text-slate-500">
            <MapPin className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
            {officer.branch || officer.state}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-400">
            {officer.lastSeen}
          </p>
        </div>
      </div>
    </button>
  );
}

function SelectedOfficerSummary({ officer, onClose }) {
  if (!officer) return null;
  const status = officerStatus(officer);
  const battery = batteryState(officer);
  const routeKm = Number(officer.actualKm ?? officer.routeKmToday ?? 0);
  const isLive = status.label === "Online";
  const isRecent =
    status.label === "Recently Active" || status.label === "Low Battery";
  const statusText = isLive ? "Live" : isRecent ? "Recent" : "Offline";
  const statusClass = isLive
    ? "bg-emerald-50 text-emerald-700"
    : isRecent
      ? "bg-amber-50 text-amber-700"
      : "bg-rose-50 text-rose-700";

  return (
    <div className="border-b border-slate-100 bg-qpms-50/70 p-4 dark:border-slate-800 dark:bg-qpms-500/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-qpms-700 dark:text-blue-300">
            Selected Officer
          </p>
          <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">
            {officer.name}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            {officer.employeeCode || officer.foId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-black ${statusClass}`}
          >
            {statusText}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid h-7 w-7 place-items-center rounded-lg bg-white text-sm font-black text-slate-500 shadow-sm hover:text-rose-600 dark:bg-slate-900"
            aria-label="Close selected officer"
          >
            x
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
        <span>Last seen</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {officer.lastSeen}
        </strong>
        <span>Battery</span>
        <strong className={`text-right ${battery.tone}`}>
          {battery.label}
        </strong>
      </div>
      <div className="mt-3 border-y border-slate-100 py-3 dark:border-slate-800">
        <p className="text-[11px] font-bold uppercase text-slate-400">
          Current Task
        </p>
        <p className="mt-1 truncate text-xs font-bold text-slate-800 dark:text-slate-100">
          <Building2 className="mr-1 inline h-3.5 w-3.5 text-qpms-600" />
          {officer.action || "Tracking active"}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
          {officer.assignedSite}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase text-slate-400">
            Actual KM
          </p>
          <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">
            {routeKm.toFixed(1)} km
          </p>
        </div>
        <span className="rounded-xl bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Route className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
        <span>Eligible KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {Number(officer.eligibleKm || 0).toFixed(1)} km
        </strong>
        <span>Sites Visited Today</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {officer.visits?.length || 0}
        </strong>
        <span>Petrol</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          ₹{Number(officer.petrolAmount || 0).toFixed(0)}
        </strong>
      </div>
    </div>
  );
}

function MapViewport({ pins, expanded, command }) {
  const map = useMap();

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [expanded, map]);

  useEffect(() => {
    if (!pins.length) {
      map.setView(SOUTH_INDIA_CENTER, 6);
      return;
    }
    if (command?.type === "recenter") {
      map.flyTo(pins[0].coordinates, 15, { duration: 0.55 });
      return;
    }
    if (pins.length === 1) {
      map.flyTo(pins[0].coordinates, 13, { duration: 0.45 });
      return;
    }
    map.fitBounds(
      pins.map((pin) => pin.coordinates),
      { padding: [44, 44], maxZoom: 13 },
    );
  }, [command, map, pins]);

  return null;
}

function MapBackgroundClose({ onClose }) {
  useMapEvents({
    click: () => onClose?.(),
  });
  return null;
}

function OperationsMap({
  pins,
  sitePins,
  routeLines,
  expanded,
  showSites,
  showRoutes,
  mapTheme,
  command,
  onSelectOfficer,
  onCloseSelection,
}) {
  const tileUrl =
    mapTheme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : mapTheme === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const attribution =
    mapTheme === "satellite"
      ? "Tiles &copy; Esri"
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  return (
    <MapContainer
      center={SOUTH_INDIA_CENTER}
      zoom={6}
      minZoom={5}
      scrollWheelZoom
      className={`h-full w-full ${mapTheme === "dark" ? "fo-map-dark" : "fo-map-light"}`}
      attributionControl
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      <MapViewport pins={pins} expanded={expanded} command={command} />
      <MapBackgroundClose onClose={onCloseSelection} />
      {showRoutes
        ? routeLines.map((route) => (
            <Polyline
              key={route.id}
              positions={route.positions}
              pathOptions={{
                color: route.color,
                weight: 4,
                opacity: 0.82,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          ))
        : null}
      {showSites
        ? sitePins.map((site) => (
            <Marker
              key={site.id}
              position={site.coordinates}
              icon={siteMarkerIcon()}
            >
              <Popup>
                <div className="min-w-[180px] text-slate-700">
                  <p className="text-sm font-bold text-slate-950">
                    {site.name}
                  </p>
                  <p className="text-xs text-slate-600">{site.state}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Destination/site marker
                  </p>
                </div>
              </Popup>
            </Marker>
          ))
        : null}
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          position={pin.coordinates}
          icon={
            pin.officers.length > 1
              ? clusterMarkerIcon(pin.officers.length, pin.color)
              : foMarkerIcon(pin.officers[0])
          }
          eventHandlers={{
            click: () => onSelectOfficer?.(pin.officers[0]?.id),
          }}
        >
          <Popup>
            <div className="min-w-[260px] space-y-2 text-slate-700">
              <p className="text-sm font-bold text-slate-950">
                {pin.state.state}
              </p>
              {pin.officers.map((officer) => (
                <div
                  key={officer.id}
                  className="border-b border-slate-100 pb-2 text-xs last:border-b-0"
                >
                  <p className="font-bold text-slate-900">
                    {officer.name}{" "}
                    <span className="font-medium text-slate-500">
                      | {officer.assignedSite}
                    </span>
                  </p>
                  <p className="text-slate-600">
                    Battery:{" "}
                    {officer.battery === null ? "--" : `${officer.battery}%`} |
                    Speed:{" "}
                    {officer.speed
                      ? `${Number(officer.speed).toFixed(1)} m/s`
                      : "--"}
                  </p>
                  <p className="text-slate-600">
                    Last seen: {officer.lastSeen}
                  </p>
                  <p className="text-slate-600">
                    Route KM:{" "}
                    {Number(
                      officer.actualKm ?? officer.routeKmToday ?? 0,
                    ).toFixed(1)}{" "}
                    km
                  </p>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span>Active FO</span>
                <strong>{pin.activeOfficers}</strong>
                <span>Offline FO</span>
                <strong>{pin.offlineOfficers}</strong>
                <span>Low battery</span>
                <strong>{pin.lowBattery}</strong>
                <span>Open tickets</span>
                <strong>{pin.state.tickets}</strong>
                <span>Visits today</span>
                <strong>{pin.state.visits}</strong>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function validReportPoint(log) {
  if (!isValidRoutePoint(log)) return false;
  return log.accuracy == null || Number(log.accuracy) <= 50;
}

function pointFromVisit(visit, phase, store) {
  if (phase === "checkout") {
    const lat = numberOrNull(
      visit.check_out_latitude ?? visit.checkout_latitude,
    );
    const lng = numberOrNull(
      visit.check_out_longitude ?? visit.checkout_longitude,
    );
    if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };
  }
  const lat = numberOrNull(
    visit.current_latitude ?? visit.check_in_latitude ?? store?.latitude,
  );
  const lng = numberOrNull(
    visit.current_longitude ?? visit.check_in_longitude ?? store?.longitude,
  );
  if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };
  return null;
}

function pointFromAttendanceStart(attendance) {
  const lat = numberOrNull(attendance?.start_latitude);
  const lng = numberOrNull(attendance?.start_longitude);
  return lat !== null && lng !== null
    ? { latitude: lat, longitude: lng }
    : null;
}

function minutesBetween(start, end) {
  if (!start || !end) return "";
  const value = Math.round((new Date(end) - new Date(start)) / 60000);
  return Number.isFinite(value) ? Math.max(0, value) : "";
}

function routeDistanceKmForWindow(logs, from, to) {
  if (!from || !to) return null;
  const windowLogs = logs.filter((log) => {
    const capturedAt = new Date(log.captured_at || log.logged_at || 0);
    return capturedAt >= new Date(from) && capturedAt <= new Date(to);
  });
  const goodLogs = windowLogs.filter(validReportPoint);
  const points =
    goodLogs.length >= 2 ? goodLogs : windowLogs.filter(isValidRoutePoint);
  if (points.length < 2) return null;
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += distanceKmBetween(points[index - 1], points[index]);
  }
  return distance;
}

function appendSheet(workbook, name, rows, headers) {
  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [], {
    header: headers,
    skipHeader: false,
  });
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

async function exportFoOperationsExcel({
  officers,
  selectedOfficer,
  from,
  to,
}) {
  if (!isSupabaseConfigured || !supabase) return;
  const exportOfficers = selectedOfficer ? [selectedOfficer] : officers;
  const officerIds = Array.from(
    new Set(
      exportOfficers
        .map((officer) => normalizeFoKey(officer.foId || officer.employeeCode))
        .filter(Boolean),
    ),
  );
  if (!officerIds.length) return;

  const fromIso = formatDateForDb(from);
  const toIso = formatDateForDb(to);
  const [attendanceRes, liveRes, logsRes, visitsRes] = await Promise.all([
    supabase
      .from("fo_attendance")
      .select("*")
      .gte("login_time", fromIso)
      .lte("login_time", toIso)
      .limit(5000),
    supabase.from("fo_live_status").select("*").limit(1000),
    supabase
      .from("fo_location_logs")
      .select("*")
      .gte("captured_at", fromIso)
      .lte("captured_at", toIso)
      .order("captured_at", { ascending: true })
      .limit(20000),
    supabase
      .from("fo_site_visits")
      .select("*")
      .gte("check_in_time", fromIso)
      .lte("check_in_time", toIso)
      .order("check_in_time", { ascending: true })
      .limit(10000),
  ]);
  const errors = [attendanceRes, liveRes, logsRes, visitsRes]
    .map((res) => res?.error)
    .filter(Boolean);
  if (errors.length) throw errors[0];

  const attendanceRows = (attendanceRes.data || []).filter((row) =>
    officerIds.includes(normalizeFoKey(row.fo_user_id || row.employee_code)),
  );
  const liveRows = (liveRes.data || []).filter((row) =>
    officerIds.includes(normalizeFoKey(row.fo_user_id)),
  );
  const logRows = (logsRes.data || []).filter((row) =>
    officerIds.includes(normalizeFoKey(row.fo_user_id || row.employee_code)),
  );
  const visitRows = (visitsRes.data || []).filter((row) =>
    officerIds.includes(normalizeFoKey(row.fo_user_id || row.employee_code)),
  );
  const storeIds = Array.from(
    new Set(visitRows.map((visit) => visit.store_id).filter(Boolean)),
  );
  let storesById = new Map();
  if (storeIds.length) {
    const { data: storesData, error: storesError } = await supabase
      .from("store_master")
      .select("*")
      .in("id", storeIds)
      .limit(10000);
    if (storesError) throw storesError;
    storesById = new Map((storesData || []).map((store) => [store.id, store]));
  }

  const workbook = XLSX.utils.book_new();
  const summaryRows = [];
  const visitDetailRows = [];
  const routePointRows = [];
  const exceptionRows = [];

  officerIds.forEach((foId) => {
    const officer =
      exportOfficers.find(
        (item) => normalizeFoKey(item.foId || item.employeeCode) === foId,
      ) || {};
    const foName = officer.name || foId;
    const attendances = attendanceRows.filter(
      (row) => normalizeFoKey(row.fo_user_id || row.employee_code) === foId,
    );
    const attendance =
      attendances
        .slice()
        .sort(
          (a, b) => new Date(b.login_time || 0) - new Date(a.login_time || 0),
        )[0] || {};
    const live =
      liveRows.find((row) => normalizeFoKey(row.fo_user_id) === foId) || {};
    const visits = visitRows.filter(
      (row) => normalizeFoKey(row.fo_user_id || row.employee_code) === foId,
    );
    const rawLogs = logRows
      .filter(
        (row) => normalizeFoKey(row.fo_user_id || row.employee_code) === foId,
      )
      .sort(
        (a, b) =>
          new Date(a.captured_at || a.logged_at || 0) -
          new Date(b.captured_at || b.logged_at || 0),
      );
    const goodLogs = rawLogs.filter(validReportPoint);
    const logsForDistance =
      goodLogs.length >= 2 ? goodLogs : rawLogs.filter(isValidRoutePoint);

    let runningKm = 0;
    logsForDistance.forEach((log, index) => {
      let segmentKm = 0;
      if (index > 0) {
        segmentKm = distanceKmBetween(logsForDistance[index - 1], log);
        runningKm += segmentKm;
      }
      routePointRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Date: formatDateOnly(log.captured_at || log.logged_at),
        Sequence: index + 1,
        "Captured Time": formatDateTime(log.captured_at || log.logged_at),
        Latitude: log.latitude,
        Longitude: log.longitude,
        Accuracy: log.accuracy ?? "",
        Speed: log.speed ?? "",
        Battery: log.battery_percentage ?? "",
        "Segment Distance KM": segmentKm.toFixed(3),
        "Running KM": runningKm.toFixed(3),
      });
      if (index > 0) {
        const gapMinutes =
          (new Date(log.captured_at || log.logged_at || 0) -
            new Date(
              logsForDistance[index - 1].captured_at ||
                logsForDistance[index - 1].logged_at ||
                0,
            )) /
          60000;
        if (gapMinutes > 10) {
          exceptionRows.push({
            "Employee ID": foId,
            "FO Name": foName,
            Type: "GPS gap above 10 minutes",
            Detail: `${gapMinutes.toFixed(0)} minutes`,
            Time: formatDateTime(log.captured_at || log.logged_at),
          });
        }
      }
      if (Number(log.accuracy) > 50) {
        exceptionRows.push({
          "Employee ID": foId,
          "FO Name": foName,
          Type: "Low GPS accuracy",
          Detail: `${Number(log.accuracy).toFixed(1)} m`,
          Time: formatDateTime(log.captured_at || log.logged_at),
        });
      }
    });

    let previousPoint = pointFromAttendanceStart(attendance);
    let previousVisitTime =
      attendance.login_time ||
      logsForDistance[0]?.captured_at ||
      logsForDistance[0]?.logged_at;
    let runningVisitKm = 0;
    visits.forEach((visit, index) => {
      const store = storesById.get(visit.store_id);
      const checkInPoint = pointFromVisit(visit, "checkin", store);
      const checkoutPoint =
        pointFromVisit(visit, "checkout", store) || checkInPoint;
      const routeLegKm = routeDistanceKmForWindow(
        logsForDistance,
        previousVisitTime,
        visit.check_in_time,
      );
      const fallbackLegKm =
        previousPoint && checkInPoint
          ? distanceKmBetween(previousPoint, checkInPoint)
          : 0;
      const distanceFromPrevious = routeLegKm ?? fallbackLegKm;
      runningVisitKm += distanceFromPrevious;
      const distanceFromStart =
        pointFromAttendanceStart(attendance) && checkInPoint
          ? distanceKmBetween(
              pointFromAttendanceStart(attendance),
              checkInPoint,
            )
          : 0;
      visitDetailRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Date: formatDateOnly(visit.check_in_time),
        "Visit Sequence": index + 1,
        "Site Name":
          visit.site_name || visit.store_name || store?.store_name || "",
        "Client Name": visit.client_name || store?.client_name || "",
        "Store Code": visit.store_code || store?.store_code || "",
        State: visit.state || store?.state || "",
        "Check-In Time": formatDateTime(visit.check_in_time),
        "Check-Out Time": formatDateTime(visit.checkout_time),
        "Visit Duration Minutes":
          visit.visit_duration_minutes ??
          minutesBetween(visit.check_in_time, visit.checkout_time),
        "Check-In Latitude": checkInPoint?.latitude ?? "",
        "Check-In Longitude": checkInPoint?.longitude ?? "",
        "Check-Out Latitude": checkoutPoint?.latitude ?? "",
        "Check-Out Longitude": checkoutPoint?.longitude ?? "",
        "GPS Accuracy":
          visit.checkin_accuracy ?? visit.current_gps_accuracy ?? "",
        "Distance From Previous Site KM": distanceFromPrevious.toFixed(3),
        "Running KM After Visit": runningVisitKm.toFixed(3),
        "Distance From Start KM": distanceFromStart.toFixed(3),
        "Remarks / Status": visit.status || visit.visit_status || "",
      });
      previousPoint = checkoutPoint || checkInPoint || previousPoint;
      previousVisitTime =
        visit.checkout_time || visit.check_in_time || previousVisitTime;
      if (!visit.checkout_time) {
        exceptionRows.push({
          "Employee ID": foId,
          "FO Name": foName,
          Type: "Missing Check-Out",
          Detail: visit.store_name || visit.site_name || "",
          Time: formatDateTime(visit.check_in_time),
        });
      }
    });

    if (!visits.length) {
      exceptionRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Type: "No site visits",
        Detail: "No site visits in selected range",
        Time: "",
      });
    }
    const activeAttendances = attendances.filter(
      (row) =>
        !row.logout_time && String(row.status || "").toLowerCase() === "active",
    );
    if (activeAttendances.length) {
      exceptionRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Type: "Active attendance not ended",
        Detail: `${activeAttendances.length} active attendance record(s)`,
        Time: formatDateTime(activeAttendances[0].login_time),
      });
    }
    if (activeAttendances.length > 1) {
      exceptionRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Type: "Duplicate active attendance",
        Detail: `${activeAttendances.length} active attendance records`,
        Time: "",
      });
    }
    rawLogs
      .filter((log) => !log.attendance_id)
      .forEach((log) => {
        exceptionRows.push({
          "Employee ID": foId,
          "FO Name": foName,
          Type: "Logs without attendance_id",
          Detail: `${log.latitude}, ${log.longitude}`,
          Time: formatDateTime(log.captured_at || log.logged_at),
        });
      });

    const calculatedKm = runningKm;
    const attendanceCompleted =
      attendance.logout_time ||
      String(attendance.status || "").toLowerCase() === "completed";
    const totalRouteKm =
      Number(
        attendanceCompleted
          ? (attendance.actual_km ?? attendance.total_raw_km)
          : (live.route_km_today ?? calculatedKm),
      ) || 0;
    const eligibleKm =
      Number(
        attendance.eligible_km ?? attendance.total_approved_km ?? totalRouteKm,
      ) || 0;
    const petrolAmount =
      Number(attendance.petrol_amount ?? eligibleKm * RATE_PER_KM) || 0;
    if (Math.abs(totalRouteKm - calculatedKm) > 2 && calculatedKm > 0) {
      exceptionRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Type: "Distance mismatch",
        Detail: `Reported ${totalRouteKm.toFixed(2)} km vs logs ${calculatedKm.toFixed(2)} km`,
        Time: "",
      });
    }

    summaryRows.push({
      "Employee ID": foId,
      "FO Name": foName,
      Date: `${toDateInputValue(from)} to ${toDateInputValue(to)}`,
      "Start Time": formatDateTime(attendance.login_time),
      "End Time": formatDateTime(attendance.logout_time),
      "Attendance Status": attendance.status || officer.status || "",
      "Total Route KM": totalRouteKm.toFixed(2),
      "Eligible KM": eligibleKm.toFixed(2),
      "Rate Per KM": RATE_PER_KM,
      "Petrol Amount": petrolAmount.toFixed(2),
      "Total Sites Visited": visits.length,
      "Total Time on Site": visits.reduce(
        (sum, visit) =>
          sum +
          Number(
            visit.visit_duration_minutes ||
              minutesBetween(visit.check_in_time, visit.checkout_time) ||
              0,
          ),
        0,
      ),
      "First Location": logsForDistance[0]
        ? `${logsForDistance[0].latitude}, ${logsForDistance[0].longitude}`
        : "",
      "Last Location": logsForDistance.at(-1)
        ? `${logsForDistance.at(-1).latitude}, ${logsForDistance.at(-1).longitude}`
        : "",
      "Battery Start if available": attendance.start_battery_percentage ?? "",
      "Battery End if available": attendance.end_battery_percentage ?? "",
      "Last Seen": formatDateTime(liveStatusTimestamp(live)),
    });
  });

  appendSheet(workbook, "Summary", summaryRows, [
    "Employee ID",
    "FO Name",
    "Date",
    "Start Time",
    "End Time",
    "Attendance Status",
    "Total Route KM",
    "Eligible KM",
    "Rate Per KM",
    "Petrol Amount",
    "Total Sites Visited",
    "Total Time on Site",
    "First Location",
    "Last Location",
    "Battery Start if available",
    "Battery End if available",
    "Last Seen",
  ]);
  appendSheet(workbook, "Site Visits Detail", visitDetailRows, [
    "Employee ID",
    "FO Name",
    "Date",
    "Visit Sequence",
    "Site Name",
    "Client Name",
    "Store Code",
    "State",
    "Check-In Time",
    "Check-Out Time",
    "Visit Duration Minutes",
    "Check-In Latitude",
    "Check-In Longitude",
    "Check-Out Latitude",
    "Check-Out Longitude",
    "GPS Accuracy",
    "Distance From Previous Site KM",
    "Running KM After Visit",
    "Distance From Start KM",
    "Remarks / Status",
  ]);
  appendSheet(workbook, "Route Points", routePointRows, [
    "Employee ID",
    "FO Name",
    "Date",
    "Sequence",
    "Captured Time",
    "Latitude",
    "Longitude",
    "Accuracy",
    "Speed",
    "Battery",
    "Segment Distance KM",
    "Running KM",
  ]);
  appendSheet(workbook, "Exceptions", exceptionRows, [
    "Employee ID",
    "FO Name",
    "Type",
    "Detail",
    "Time",
  ]);
  const selectedId = selectedOfficer
    ? normalizeFoKey(selectedOfficer.foId || selectedOfficer.employeeCode)
    : "All";
  XLSX.writeFile(
    workbook,
    `FO_Journey_Report_${selectedId}_${toDateInputValue(from)}_${toDateInputValue(to)}.xlsx`,
  );
}

export default function FOActivities() {
  usePageTitle("FO Activities");
  const [stateFilter, setStateFilter] = useState("All States");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [search, setSearch] = useState("");
  const [expandedMap, setExpandedMap] = useState(false);
  const [selectedOfficerId, setSelectedOfficerId] = useState(null);
  const [liveOfficers, setLiveOfficers] = useState([]);
  const [selectedRouteLogs, setSelectedRouteLogs] = useState([]);
  const [showSiteMarkers, setShowSiteMarkers] = useState(true);
  const [showRouteTrail, setShowRouteTrail] = useState(true);
  const [mapTheme, setMapTheme] = useState("light");
  const [mapCommand, setMapCommand] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [datePreset, setDatePreset] = useState("today");
  const [customFromDate, setCustomFromDate] = useState(
    toDateInputValue(new Date()),
  );
  const [customToDate, setCustomToDate] = useState(
    toDateInputValue(new Date()),
  );
  const profileRowsRef = useRef([]);

  const selectedRange = useMemo(
    () => dateRangeForPreset(datePreset, customFromDate, customToDate),
    [customFromDate, customToDate, datePreset],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadFoOperations() {
      if (!isSupabaseConfigured || !supabase) {
        return;
      }
      try {
        const fromIso = formatDateForDb(selectedRange.from);
        const toIso = formatDateForDb(selectedRange.to);
        const [attendanceRes, visitsRes, liveStatusRows, profilesRes] =
          await Promise.all([
            supabase
              .from("fo_attendance")
              .select("*")
              .gte("login_time", fromIso)
              .lte("login_time", toIso)
              .order("login_time", { ascending: false })
              .limit(500),
            supabase
              .from("fo_site_visits")
              .select("*")
              .gte("check_in_time", fromIso)
              .lte("check_in_time", toIso)
              .order("check_in_time", { ascending: false })
              .limit(500),
            fetchFoLiveStatusRows(),
            supabase
              .from("profiles")
              .select(
                "full_name, display_name, employee_code, username, role, state, status",
              )
              .or("role.ilike.FO,role.ilike.Field Officer")
              .limit(1000),
          ]);
        const errors = [attendanceRes, visitsRes, profilesRes]
          .map((res) => res?.error)
          .filter(Boolean);
        if (errors.length) {
          throw errors[0];
        }
        const profileRows = (profilesRes.data || []).filter(isRealFoProfile);
        const profilesByCode = profileByFoKey(profileRows);
        console.debug("FO_PROFILES_LOADED", profileRows.length);
        liveStatusRows.forEach((row) => {
          const foId = normalizeFoKey(row?.fo_user_id);
          if (foId && !profilesByCode.has(foId)) {
            console.debug("FO_INCLUDED_LIVE_WITHOUT_PROFILE", foId);
          }
        });
        const officersFromSupabase = buildLiveFoData({
          attendance: attendanceRes.data || [],
          visits: visitsRes.data || [],
          liveStatus: liveStatusRows,
          profiles: profileRows,
        });
        console.debug("FO_OFFICERS_BUILT", officersFromSupabase.length);
        if (!cancelled) {
          profileRowsRef.current = profileRows;
          setLiveOfficers(officersFromSupabase);
        }
      } catch (error) {
        console.warn("[myQPMS FO] Supabase FO fetch failed.", error);
        if (!cancelled) {
          setLiveOfficers([]);
        }
      }
    }
    loadFoOperations();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, selectedRange.from, selectedRange.to]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRefreshToken((value) => value + 1);
    }, 20000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    const channel = supabase
      .channel("fo-operations-live-status")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "fo_live_status" },
        (payload) => {
          console.debug("FO_REALTIME_UPDATE", payload.new?.fo_user_id);
          setLiveOfficers((officers) =>
            mergeRealtimeOfficer(officers, payload.new, profileRowsRef.current),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fo_live_status" },
        (payload) => {
          console.debug("FO_REALTIME_UPDATE", payload.new?.fo_user_id);
          setLiveOfficers((officers) =>
            mergeRealtimeOfficer(officers, payload.new, profileRowsRef.current),
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("REALTIME_CONNECTED");
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          console.log("REALTIME_RECONNECT", status);
          setRefreshToken((value) => value + 1);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const officers = liveOfficers;

  const filteredOfficers = useMemo(
    () =>
      officers.filter((officer) => {
        const stateMatches =
          stateFilter === "All States" || officer.state === stateFilter;
        const statusMatches =
          statusFilter === "All Status" || officer.status === statusFilter;
        const searchMatches =
          !search ||
          `${officer.name} ${officer.employeeCode || officer.foId} ${officer.assignedSite} ${officer.branch}`
            .toLowerCase()
            .includes(search.toLowerCase());
        return stateMatches && statusMatches && searchMatches;
      }),
    [officers, search, stateFilter, statusFilter],
  );

  const stateSummaryRows = useMemo(() => {
    if (!liveOfficers.length) return [];
    const byState = new Map();
    liveOfficers.forEach((officer) => {
      const current = byState.get(officer.state) || {
        id: officer.state,
        state: officer.state,
        activeSites: 0,
        tickets: 0,
        tasks: 0,
        visits: 0,
        sla: 91,
        status: "Stable",
      };
      current.activeSites +=
        officer.assignedSite === "No active store visit" ? 0 : 1;
      current.tasks +=
        officer.tasks?.filter((task) => task.task_status !== "completed")
          .length || 0;
      current.visits += officer.visits?.length || 0;
      if (officer.status === "Offline") current.status = "Critical";
      else if (officer.battery !== null && officer.battery < 20)
        current.status = "Warning";
      byState.set(officer.state, current);
    });
    return Array.from(byState.values());
  }, [liveOfficers]);

  const filteredStates = useMemo(
    () =>
      stateSummaryRows.filter((state) => {
        if (stateFilter !== "All States" && state.state !== stateFilter)
          return false;
        return filteredOfficers.some(
          (officer) => officer.state === state.state,
        );
      }),
    [filteredOfficers, stateFilter, stateSummaryRows],
  );

  const selectedOfficer =
    filteredOfficers.find((officer) => officer.id === selectedOfficerId) ||
    null;

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedRouteLogs() {
      if (!selectedOfficer || !isSupabaseConfigured || !supabase) {
        setSelectedRouteLogs([]);
        return;
      }
      const fromIso = formatDateForDb(selectedRange.from);
      const toIso = formatDateForDb(selectedRange.to);
      const selectedFoId = normalizeFoKey(selectedOfficer.foId);
      const { data, error } = await supabase
        .from("fo_location_logs")
        .select("*")
        .eq("fo_user_id", selectedFoId)
        .gte("captured_at", fromIso)
        .lte("captured_at", toIso)
        .order("captured_at", { ascending: true })
        .limit(5000);
      if (cancelled) return;
      if (error) {
        console.warn("[myQPMS FO] Selected FO route logs fetch failed.", error);
        setSelectedRouteLogs([]);
        return;
      }
      let fallbackRows = [];
      const { data: employeeCodeData, error: employeeCodeError } =
        await supabase
          .from("fo_location_logs")
          .select("*")
          .eq("employee_code", selectedFoId)
          .gte("captured_at", fromIso)
          .lte("captured_at", toIso)
          .order("captured_at", { ascending: true })
          .limit(5000);
      if (cancelled) return;
      if (employeeCodeError) {
        const message = String(employeeCodeError.message || "").toLowerCase();
        const missingEmployeeCodeColumn =
          employeeCodeError.code === "42703" ||
          employeeCodeError.code === "PGRST204" ||
          message.includes("employee_code");
        if (!missingEmployeeCodeColumn) {
          console.warn(
            "[myQPMS FO] Selected FO employee_code route log fallback failed.",
            employeeCodeError,
          );
        }
      } else {
        fallbackRows = employeeCodeData || [];
      }
      const routeRowsById = new Map();
      [...(data || []), ...fallbackRows].forEach((row, index) => {
        routeRowsById.set(
          row.id ||
            `${row.captured_at || row.logged_at || index}-${row.latitude}-${row.longitude}`,
          row,
        );
      });
      setSelectedRouteLogs(
        Array.from(routeRowsById.values()).sort(
          (a, b) =>
            new Date(a.captured_at || a.logged_at || 0) -
            new Date(b.captured_at || b.logged_at || 0),
        ),
      );
    }
    loadSelectedRouteLogs();
    return () => {
      cancelled = true;
    };
  }, [selectedOfficer, selectedRange.from, selectedRange.to]);

  function focusOfficer(officerId) {
    setSelectedOfficerId(officerId);
    setMapCommand({ type: "recenter", at: Date.now() });
  }

  const pins = useMemo(() => {
    const groups = new Map();
    const markerOfficers = filteredOfficers.filter((officer) => {
      const canShow = canShowOfficerMarker(officer);
      if (!canShow && !hasFiniteCoordinates(officer.coordinates)) {
        console.debug(
          "FO_MARKER_SKIPPED_NO_COORDINATES",
          officer.foId || officer.employeeCode,
        );
      }
      return canShow;
    });
    markerOfficers.forEach((officer) => {
      const lat = Number(officer.coordinates[0]);
      const lng = Number(officer.coordinates[1]);
      const isSelected = selectedOfficer?.id === officer.id;
      const key = isSelected
        ? `selected-${officer.id}`
        : `${Math.round(lat * 12) / 12}-${Math.round(lng * 12) / 12}`;
      const state = filteredStates.find(
        (item) => item.state === officer.state,
      ) || {
        id: officer.state,
        state: officer.state,
        tickets: 0,
        visits: officer.visits?.length || 0,
        status:
          officer.status === "Offline"
            ? "Critical"
            : officer.battery !== null && officer.battery < 20
              ? "Warning"
              : "Stable",
      };
      const group = groups.get(key) || {
        id: key,
        state,
        officers: [],
        coordinates: [0, 0],
      };
      group.officers.push(officer);
      group.coordinates[0] += lat;
      group.coordinates[1] += lng;
      groups.set(key, group);
    });

    const builtPins = Array.from(groups.values())
      .map((group) => {
        const stateOfficers = group.officers;
        const coordinates = [
          group.coordinates[0] / stateOfficers.length,
          group.coordinates[1] / stateOfficers.length,
        ];
        return {
          ...group,
          coordinates,
          activeOfficers: stateOfficers.filter(
            (officer) => officer.status === "Active",
          ).length,
          offlineOfficers: stateOfficers.filter(
            (officer) => officer.status === "Offline",
          ).length,
          lowBattery: stateOfficers.filter(
            (officer) => officer.battery !== null && officer.battery < 20,
          ).length,
          color: markerTone(group.state, stateOfficers),
        };
      })
      .sort((a, b) => {
        if (a.officers.some((officer) => officer.id === selectedOfficer?.id))
          return -1;
        if (b.officers.some((officer) => officer.id === selectedOfficer?.id))
          return 1;
        return b.activeOfficers - a.activeOfficers;
      });
    console.debug("FO_MARKERS_BUILT", builtPins.length);
    return builtPins;
  }, [filteredOfficers, filteredStates, selectedOfficer]);

  const sitePins = useMemo(
    () =>
      filteredOfficers
        .filter((officer) => Array.isArray(officer.siteCoordinates))
        .map((officer) => ({
          id: `site-${officer.id}`,
          name: officer.siteMarkerName,
          state: officer.state,
          coordinates: officer.siteCoordinates,
        })),
    [filteredOfficers],
  );

  const routeLines = useMemo(() => {
    if (!selectedOfficer) return [];
    return routeSegmentsFromLogs(selectedRouteLogs).map((positions, index) => ({
      id: `route-${selectedOfficer.id}-${index}`,
      positions,
      color: foMarkerColor(selectedOfficer),
    }));
  }, [selectedOfficer, selectedRouteLogs]);

  const totalStates =
    stateFilter === "All States"
      ? stateSummaryRows
      : stateSummaryRows.filter((state) => state.state === stateFilter);
  const totals = totalStates.reduce(
    (summary, state) => ({
      sites: summary.sites + state.activeSites,
      visits: summary.visits + state.visits,
      tickets: summary.tickets + state.tickets,
      tasks: summary.tasks + state.tasks,
      sla: summary.sla + state.sla,
    }),
    { sites: 0, visits: 0, tickets: 0, tasks: 0, sla: 0 },
  );
  const averageSla = totalStates.length
    ? Math.round(totals.sla / totalStates.length)
    : 0;
  const activeOfficers = filteredOfficers.filter(
    (officer) => officer.status === "Active",
  ).length;
  const offlineOfficers = filteredOfficers.filter(
    (officer) => officer.status === "Offline",
  ).length;
  const onTravelOfficers = filteredOfficers.filter((officer) =>
    /travel|transit|navigation/i.test(
      `${officer.action} ${officer.tasks?.[0]?.task_status || ""}`,
    ),
  ).length;
  const onSiteOfficers = filteredOfficers.filter((officer) =>
    /check|site|visit|progress/i.test(
      `${officer.action} ${officer.tasks?.[0]?.task_status || ""} ${officer.visits?.[0]?.visit_status || ""}`,
    ),
  ).length;
  const liveRawKm = filteredOfficers.reduce(
    (sum, officer) =>
      sum + Number(officer.actualKm ?? officer.routeKmToday ?? 0),
    0,
  );
  const totalPetrolAmount = filteredOfficers.reduce(
    (sum, officer) => sum + Number(officer.petrolAmount || 0),
    0,
  );
  const distanceTravelled = `${liveRawKm.toFixed(1)} km`;
  const avgRouteKm = filteredOfficers.length
    ? `${(liveRawKm / filteredOfficers.length).toFixed(1)} km`
    : "0.0 km";

  return (
    <div className="space-y-3">
      <PageHeader
        title="FO Operations Command Center"
        actions={
          <span className="command-pill">
            <RadioTower className="h-3.5 w-3.5 text-emerald-500" /> Live
            Tracking
          </span>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="lg:col-span-2">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Date Filter
              </span>
              <select
                value={datePreset}
                onChange={(event) => setDatePreset(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 Days</option>
                <option value="month">This Month</option>
                <option value="custom">Custom From / To</option>
              </select>
            </label>
            <label className="lg:col-span-2">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                From Date
              </span>
              <input
                type="date"
                value={customFromDate}
                onChange={(event) => {
                  setCustomFromDate(event.target.value);
                  setDatePreset("custom");
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400"
              />
            </label>
            <label className="lg:col-span-2">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                To Date
              </span>
              <input
                type="date"
                value={customToDate}
                onChange={(event) => {
                  setCustomToDate(event.target.value);
                  setDatePreset("custom");
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-qpms-400"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              exportFoOperationsExcel({
                officers: filteredOfficers,
                selectedOfficer,
                from: selectedRange.from,
                to: selectedRange.to,
              })
            }
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-100"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <FleetKpi
          label="Total Field Officers"
          value={filteredOfficers.length}
          icon={UserRoundCheck}
          tone="blue"
        />
        <FleetKpi
          label="Live / Active Now"
          value={activeOfficers}
          hint={
            filteredOfficers.length
              ? `${Math.round((activeOfficers / filteredOfficers.length) * 100)}%`
              : "0%"
          }
          icon={RadioTower}
          tone="green"
        />
        <FleetKpi
          label="On Travel"
          value={onTravelOfficers}
          icon={Bike}
          tone="blue"
        />
        <FleetKpi
          label="On Site Visit"
          value={onSiteOfficers}
          icon={MapPin}
          tone="purple"
        />
        <FleetKpi
          label="Offline"
          value={offlineOfficers}
          icon={ShieldAlert}
          tone={offlineOfficers ? "red" : "slate"}
        />
        <FleetKpi
          label="Total Route KM Today"
          value={distanceTravelled}
          icon={Route}
          tone="green"
        />
        <FleetKpi
          label="Total Petrol Amount Today"
          value={`₹${totalPetrolAmount.toFixed(0)}`}
          icon={CircleGauge}
          tone="amber"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
        <div className="grid min-h-[675px] xl:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_365px]">
          <div className="relative isolate min-h-[620px] overflow-hidden bg-sky-50">
            <OperationsMap
              pins={pins}
              sitePins={sitePins}
              routeLines={routeLines}
              expanded={false}
              showSites={showSiteMarkers}
              showRoutes={showRouteTrail}
              mapTheme={mapTheme}
              command={mapCommand}
              onSelectOfficer={focusOfficer}
              onCloseSelection={() => setSelectedOfficerId(null)}
            />
            {selectedOfficer && !routeLines.length ? (
              <div className="absolute left-5 top-5 z-[540] rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-semibold text-slate-600 shadow-xl backdrop-blur">
                No route data available for selected date.
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setMapCommand({ type: "fit", at: Date.now() })}
              className="focus-ring absolute left-5 top-[45%] z-[520] inline-flex items-center gap-2 rounded-lg border border-white/70 bg-white/95 px-4 py-3 text-xs font-black text-slate-700 shadow-xl backdrop-blur hover:text-qpms-700"
            >
              <Maximize2 className="h-4 w-4" /> Fit All
            </button>

            <div className="absolute left-5 top-[56%] z-[520] overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
              <button
                type="button"
                className="grid h-12 w-12 place-items-center border-b border-slate-200 text-2xl font-light text-slate-900"
              >
                +
              </button>
              <button
                type="button"
                className="grid h-12 w-12 place-items-center border-b border-slate-200 text-2xl font-light text-slate-900"
              >
                -
              </button>
              <button
                type="button"
                onClick={() =>
                  setMapCommand({ type: "recenter", at: Date.now() })
                }
                className="grid h-12 w-12 place-items-center text-slate-700"
              >
                <LocateFixed className="h-5 w-5" />
              </button>
            </div>

            <div className="absolute bottom-[118px] left-5 z-[520] flex flex-wrap items-center gap-4 rounded-xl border border-white/80 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
              <LegendItem color="#10b981" label="Live" helper="(0-2 min)" />
              <LegendItem color="#f59e0b" label="Recent" helper="(2-10 min)" />
              <LegendItem color="#ef4444" label="Offline" helper="(>10 min)" />
              <LegendItem color="#2563eb" label="Site / Office" site />
            </div>

            <div className="absolute bottom-5 left-5 z-[520] w-[min(720px,calc(100%-40px))] rounded-xl border border-white/80 bg-white/95 p-3 shadow-xl backdrop-blur">
              <div className="grid gap-3 md:grid-cols-4">
                <label>
                  <span className="sr-only">Region</span>
                  <select
                    value={stateFilter}
                    onChange={(event) => setStateFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-qpms-400"
                  >
                    <option>All States</option>
                    {stateSummaryRows.map((item) => (
                      <option key={item.id}>{item.state}</option>
                    ))}
                  </select>
                </label>
                <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-qpms-400">
                  <option>All Teams</option>
                </select>
                <label>
                  <span className="sr-only">Status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-qpms-400"
                  >
                    <option>All Status</option>
                    <option value="Active">Live</option>
                    <option value="Recent">Recently Active</option>
                    <option>Offline</option>
                  </select>
                </label>
                <label className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search FO by name or ID..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-qpms-400"
                  />
                </label>
              </div>
            </div>

            <div className="absolute right-5 top-5 z-[540] w-[255px] rounded-xl border border-slate-200 bg-white/96 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/90">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black text-slate-950 dark:text-white">
                  Map Controls
                </h2>
                <ChevronRight className="-rotate-90 h-4 w-4 text-slate-400" />
              </div>
              <div className="space-y-2">
                <ControlButton
                  icon={LocateFixed}
                  label="Recenter on Selected FO"
                  onClick={() =>
                    setMapCommand({ type: "recenter", at: Date.now() })
                  }
                />
                <ControlButton
                  icon={Maximize2}
                  label="Fit All Active Officers"
                  onClick={() => setMapCommand({ type: "fit", at: Date.now() })}
                />
                <button
                  type="button"
                  onClick={() => setShowSiteMarkers((value) => !value)}
                  className="focus-ring flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  Show Site Markers <ToggleSwitch checked={showSiteMarkers} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowRouteTrail((value) => !value)}
                  className="focus-ring flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  Show Route Trails <ToggleSwitch checked={showRouteTrail} />
                </button>
                <ControlButton
                  icon={RefreshCw}
                  label="Refresh Live Location"
                  onClick={() => setRefreshToken((value) => value + 1)}
                />
              </div>
              <p className="mt-4 text-[11px] font-black text-slate-500">
                Map Style
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {["light", "dark", "satellite"].map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => setMapTheme(theme)}
                    className={`rounded-md px-2 py-2 text-[11px] font-black capitalize transition ${mapTheme === theme ? "bg-white text-qpms-700 shadow-sm dark:bg-slate-950 dark:text-blue-300" : "text-slate-500"}`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>

            <div className="absolute right-5 bottom-[88px] z-[540] w-[255px] rounded-xl border border-slate-200 bg-white/96 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/90">
              <h2 className="mb-3 text-base font-black text-slate-950 dark:text-white">
                Legend
              </h2>
              <div className="space-y-3">
                <LegendItem
                  color="#10b981"
                  label="Live / Active"
                  helper="(Last 0-2 min)"
                />
                <LegendItem
                  color="#f59e0b"
                  label="Recently Active"
                  helper="(2-10 min)"
                />
                <LegendItem
                  color="#ef4444"
                  label="Offline"
                  helper="(>10 min)"
                />
                <LegendItem color="#2563eb" label="Site / Office" site />
                <LegendItem
                  color="#16a34a"
                  label="Route Trail"
                  helper="(Active)"
                  dashed
                />
                <LegendItem
                  color="#f59e0b"
                  label="Route Trail"
                  helper="(Recent)"
                  dashed
                />
              </div>
            </div>
          </div>

          <aside className="border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">
                  Field Officers ({filteredOfficers.length})
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Operational directory
                </p>
              </div>
              <button
                type="button"
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Filter className="h-4 w-4" /> Filter
              </button>
            </div>
            <label className="relative block border-b border-slate-100 p-4 dark:border-slate-800">
              <Search className="absolute left-7 top-7 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search officer..."
                className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-qpms-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <SelectedOfficerSummary
              officer={selectedOfficer}
              onClose={() => setSelectedOfficerId(null)}
            />
            <div className="max-h-[584px] overflow-y-auto">
              {filteredOfficers.map((officer) => (
                <OfficerDirectoryRow
                  key={officer.id}
                  officer={officer}
                  selected={selectedOfficer?.id === officer.id}
                  onSelect={() => focusOfficer(officer.id)}
                />
              ))}
              {!filteredOfficers.length ? (
                <div className="m-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-800">
                  No field officers match these filters.
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="focus-ring flex w-full items-center justify-center gap-2 border-t border-slate-100 px-4 py-4 text-sm font-black text-qpms-700 dark:border-slate-800 dark:text-blue-300"
            >
              View All Officers <ChevronRight className="h-4 w-4" />
            </button>
          </aside>
        </div>
      </section>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-900">
        <MetricTile
          label="Total Route KM Today"
          value={distanceTravelled}
          icon={Route}
          tone="green"
        />
        <MetricTile
          label="Avg. Route KM / FO"
          value={avgRouteKm}
          icon={Navigation2}
        />
        <MetricTile
          label="Petrol Amount"
          value={`₹${totalPetrolAmount.toFixed(0)}`}
          icon={CircleGauge}
          tone="amber"
        />
        <MetricTile
          label="Tasks Completed"
          value={totals.tasks}
          icon={ClipboardList}
          tone="purple"
        />
        <MetricTile
          label="Site Visits"
          value={totals.visits}
          icon={MapPinned}
          tone="amber"
        />
        <MetricTile
          label="SLA Health"
          value={`${averageSla}%`}
          icon={ShieldAlert}
          tone={averageSla >= 90 ? "green" : "amber"}
        />
        <MetricTile
          label="Avg. Response Time"
          value="--"
          icon={Clock}
          tone="green"
        />
      </div>

      {expandedMap ? (
        <div className="fixed inset-0 z-[1200] bg-slate-950/45 p-4 backdrop-blur-sm sm:p-7">
          <div className="flex h-full flex-col rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                Live Location - South India
              </h2>
              <button
                type="button"
                onClick={() => setExpandedMap(false)}
                className="focus-ring rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                aria-label="Close expanded map"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <div className="isolate min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <OperationsMap
                pins={pins}
                sitePins={sitePins}
                routeLines={routeLines}
                expanded
                showSites={showSiteMarkers}
                showRoutes={showRouteTrail}
                mapTheme={mapTheme}
                command={mapCommand}
                onSelectOfficer={focusOfficer}
                onCloseSelection={() => setSelectedOfficerId(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
