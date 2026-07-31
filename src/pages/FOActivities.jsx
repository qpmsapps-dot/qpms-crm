import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  Bike,
  Building2,
  CalendarDays,
  CircleGauge,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Eye,
  Filter,
  FilePlus,
  FileSpreadsheet,
  Fuel,
  Image,
  Info,
  LocateFixed,
  MapPin,
  MapPinned,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreVertical,
  Navigation2,
  Phone,
  PlayCircle,
  RadioTower,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  UploadCloud,
  User,
  UserRoundCheck,
  X,
  XCircle,
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
import qpmsLogo from "../assets/qpms-logo.png";
import { useAuth } from "../context/auth-context.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { authenticatedApiRequest, authenticatedFetch } from "../services/api.js";
import { authSessionManager, invalidateAuthOnUnauthorized, isAuthSessionError, SESSION_EXPIRED_MESSAGE } from "../services/authSession.js";
import { assertDemoWriteAllowed, isDemoUser } from "../utils/demoAccess.js";
import {
  EMPTY_OPERATIONS_SUMMARY,
  activityPreviewFileKind,
  nextPreviewIndex,
  operationsSummaryQuery,
  previewMenuState,
  shouldAcceptSummaryResponse,
} from "../utils/operationsDashboard.js";
import {
  buildEmployeeRangeExcelRows,
  employeeRangeQuery,
  employeeRangeMetric,
  reportReadiness,
} from "../utils/employeeRangeReport.js";

const SOUTH_INDIA_CENTER = [13.0827, 80.2707];
const INDIA_TIME_ZONE = "Asia/Kolkata";
const RATE_PER_KM = 4;
const CAR_RATE_PER_KM = 8;
const TRAVEL_MODE_RATE_PER_KM = {
  bike: RATE_PER_KM,
  own_vehicle: RATE_PER_KM,
  car: CAR_RATE_PER_KM,
};
const MAX_GPS_ACCURACY_METERS = 50;
const MIN_ROUTE_SEGMENT_METERS = 5;
const MAX_ROUTE_SEGMENT_METERS = 1000;
const MAX_ROUTE_SEGMENT_SECONDS = 600;
const MAX_ROUTE_SPEED_MPS = 33.33;
const LARGE_GPS_GAP_SECONDS = 600;
const GAP_DISTANCE_SAFETY_MULTIPLIER = 1.2;
const HIGH_CONFIDENCE_MULTIPLIER = 1.03;
const MEDIUM_CONFIDENCE_MULTIPLIER = 1.08;
const LOW_CONFIDENCE_MULTIPLIER = 1.12;
const SITE_GEOFENCE_METERS = 100;
const HIDDEN_EMPLOYEE_CODES = [
  "QPMSTN15702",
  "QPMSTN12345",
  "QPMSTN09876",
];
const HIDDEN_EMPLOYEE_CODE_SET = new Set(HIDDEN_EMPLOYEE_CODES);
const FO_SITE_VISIT_SELECT =
  "id,fo_user_id,employee_code,full_name,attendance_id,store_id,store_name,site_name,client_name,store_code,state,check_in_time,checkout_time,check_out_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,checkout_distance_meters,checkout_location_status,current_latitude,current_longitude,origin_lat,origin_lng,destination_lat,destination_lng,route_km,google_route_polyline,visit_duration_minutes,status,visit_status,checkout_note,metadata";
const FO_LIVE_STATUS_SELECT =
  "fo_user_id,latitude,longitude,last_seen_at,updated_at,route_km_today,travel_mode,rate_per_km,is_online,is_tracking,current_status,display_name,username,accuracy,battery_percentage";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
const MARKER_ANIMATION_MIN_MS = 15000;
const MARKER_ANIMATION_MAX_MS = 180000;
const MARKER_ANIMATION_DEFAULT_MS = 45000;
const MARKER_ANIMATION_RECENT_THRESHOLD_MS = 10 * 60 * 1000;
const ACTIVITY_PHOTO_TABS = ["All", "Inspection", "Training", "Deep Cleaning"];
const TRAINING_UPLOAD_CATEGORIES = [
  ["fo_briefing", "FO Briefing"],
  ["glass_cleaning", "Glass Cleaning"],
  ["floor_cleaning_mop", "Floor Cleaning with Mop"],
  ["floor_cleaning_ec_mop", "Floor Cleaning with EC Mop"],
  ["toilet_cleaning", "Toilet Cleaning"],
  ["cobweb_cleaning", "Cobweb Cleaning"],
];
const SNAP_TO_ROADS_MAX_POINTS_PER_REQUEST = 100;
const SNAP_TO_ROADS_MAX_INPUT_POINTS = 500;
const ROUTE_MAP_SEGMENT_MAX_GAP_SECONDS = 10 * 60;
const ROUTE_MAP_SEGMENT_MAX_DISTANCE_KM = 2;
const ROUTE_MAP_SEGMENT_MAX_SPEED_KMPH = 120;
const KM_RECALC_COOLDOWN_MS = 60 * 1000;
const KM_RECALC_RUNNING_MESSAGE = "Recalculation already running. Please wait.";
const MOVEMENT_FRESHNESS_MS = 5 * 60 * 1000;
const MOVEMENT_SPEED_THRESHOLD_MPS = 1;
const ENABLE_OPERATIONS_MAP_COORDINATE_WARNINGS =
  import.meta.env.DEV && import.meta.env.VITE_FO_COORDINATE_WARNINGS === "true";
const ACTIVE_OPERATIONAL_STATUSES = new Set([
  "ON_SITE",
  "ON_TRAVEL",
  "ACTIVE_STATIONARY",
]);
const OPERATIONAL_STATUS_LABELS = {
  ON_SITE: "On Site",
  ON_TRAVEL: "On Travel",
  ACTIVE_STATIONARY: "Active / Stationary",
  NOT_STARTED: "Not Started",
  ENDED: "Ended Day",
};
const ROUTE_MAP_SOUTH_INDIA_BOUNDS = {
  minLat: 6,
  maxLat: 20,
  minLng: 68,
  maxLng: 90,
};
const INR_CURRENCY = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatInr(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return INR_CURRENCY.format(number);
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculatePetrolAmount(
  payableKm,
  ratePerKm = RATE_PER_KM,
) {
  return toSafeNumber(payableKm) * toSafeNumber(ratePerKm, RATE_PER_KM);
}

function normalizeTravelMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ["bike", "own_vehicle", "car", "auto", "bus", "train", "other"].includes(normalized)
    ? normalized
    : "";
}

function travelModeLabel(value) {
  switch (normalizeTravelMode(value)) {
    case "bike":
    case "own_vehicle":
      return "Bike";
    case "car":
      return "Car";
    case "auto":
      return "Auto";
    case "bus":
      return "Bus";
    case "train":
      return "Train";
    case "other":
      return "Others";
    default:
      return "Not selected";
  }
}

function travelModeRatePerKm(value, fallback = RATE_PER_KM) {
  const normalized = normalizeTravelMode(value);
  if (TRAVEL_MODE_RATE_PER_KM[normalized]) {
    return TRAVEL_MODE_RATE_PER_KM[normalized];
  }
  return toSafeNumber(fallback, RATE_PER_KM);
}

function currentTravelModeFromRows({ live, attendance, officer } = {}) {
  return normalizeTravelMode(live?.travel_mode) ||
    normalizeTravelMode(attendance?.travel_mode) ||
    normalizeTravelMode(officer?.travelMode) ||
    "";
}

function formatCurrency(value) {
  return formatInr(value);
}

function toDateInputValue(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function logSupabaseError(context, error) {
  console.error(context, {
    code: error?.code || null,
    message: error?.message || String(error || "Unknown Supabase error"),
    details: error?.details || null,
    hint: error?.hint || null,
  });
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

function isOperationallyActive(officer) {
  return ACTIVE_OPERATIONAL_STATUSES.has(officer?.operationalStatus);
}

function operationalStatusLabel(status) {
  return OPERATIONAL_STATUS_LABELS[status] || "Not Started";
}

function officerStatus(officer) {
  const active = isOperationallyActive(officer);
  return {
    label: operationalStatusLabel(officer?.operationalStatus),
    tone: active ? "text-emerald-600" : "text-slate-500",
    dot: active ? "bg-emerald-500" : "bg-slate-400",
  };
}

function batteryState(officer) {
  if (officer.battery === null || !isOperationallyActive(officer))
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
    officers.some((officer) => !isOperationallyActive(officer));
  if (isCritical) return "#64748b";
  return "#10b981";
}

function foMarkerColor(officer) {
  return isOperationallyActive(officer) ? "#10b981" : "#64748b";
}

function escapeMarkerAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function foMarkerIcon(officer) {
  const color = foMarkerColor(officer);
  const isActive = isOperationallyActive(officer);
  const isSelected = officer.isSelected === true;
  const rotation = Number(officer.heading || 0);
  const imageUrl = firstNonEmptyText(
    officer.avatarUrl,
    officer.profileImageUrl,
    officer.profile_image_url,
    officer.metadata?.profile_image_url,
  );
  if (imageUrl) {
    return L.divIcon({
      className: "",
      html: `
        <div class="fo-map-avatar-marker ${isActive ? "fo-map-avatar-active" : "fo-map-avatar-inactive"} ${isSelected ? "fo-map-avatar-selected" : ""}" style="--marker-color:${color}; --marker-rotation:${rotation}deg;">
          ${isActive ? '<span class="fo-bike-pulse"></span>' : ""}
          <div class="fo-map-avatar-ring">
            <img class="fo-map-avatar-img" src="${escapeMarkerAttribute(imageUrl)}" alt="" onerror="this.closest('.fo-map-avatar-marker').classList.add('fo-map-avatar-broken');" />
            <span class="fo-map-avatar-fallback">
              <span class="fo-bike-glyph">&#128757;</span>
            </span>
          </div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
      popupAnchor: [0, -20],
    });
  }
  const bikeCore = `
    <span class="fo-bike-core" style="transform: rotate(${rotation}deg);">
      <span class="fo-bike-glyph">&#128757;</span>
    </span>
  `;
  return L.divIcon({
    className: "",
    html: `
      <div class="fo-bike-marker ${isSelected ? "fo-bike-marker-selected" : ""}" style="--marker-color:${color};">
        ${isActive ? '<span class="fo-bike-pulse"></span>' : ""}
        ${bikeCore}
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

function formatDurationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
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

function normalizeFoKey(value = "") {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function normalizeEmployeeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function isHiddenEmployeeCode(code) {
  return HIDDEN_EMPLOYEE_CODE_SET.has(normalizeEmployeeCode(code));
}

function isHiddenEmployeeRecord(record) {
  return [
    record?.employeeCode,
    record?.employee_code,
    record?.fo_user_id,
    record?.user_id,
    record?.profile?.employee_code,
    record?.attendance?.employee_code,
    record?.attendance?.fo_user_id,
    record?.foId,
  ].some(isHiddenEmployeeCode);
}

function formatDisplayKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 && number < 0.1 ? number.toFixed(2) : number.toFixed(1)} km`;
}

function profileKeys(row) {
  return [row?.fo_user_id, row?.id, row?.employee_code, row?.username]
    .map(normalizeFoKey)
    .filter(Boolean);
}

function isActiveProfile(profile) {
  return profile?.is_active === true && profileKeys(profile).length > 0;
}

const OPERATIONS_COMMAND_ALLOWED_ROLES = new Set([
  "gm",
  "south head",
  "branch head",
  "operations manager",
  "operation manager",
  "kam",
  "fo",
  "field officer",
]);

const OPERATIONS_COMMAND_EXCLUDED_ROLES = new Set([
  "md",
  "coo",
  "admin",
  "administrator",
  "developer",
  "finance",
  "finance gm",
  "cfo",
  "hr",
  "human resources",
  "business head",
]);

function isOperationsCommandEligibleRecord(record = {}) {
  const profile = record?.profile || record;
  const roleKey = normalizeRoleKey(profile?.role || record?.role);
  const designationKey = normalizeRoleKey(profile?.designation || record?.designation);
  const departmentKey = normalizeRoleKey(profile?.department || record?.department);
  const combinedKey = normalizeRoleKey([roleKey, designationKey, departmentKey].join(" "));

  if (!roleKey) return false;
  if (
    OPERATIONS_COMMAND_EXCLUDED_ROLES.has(roleKey) ||
    OPERATIONS_COMMAND_EXCLUDED_ROLES.has(designationKey) ||
    OPERATIONS_COMMAND_EXCLUDED_ROLES.has(departmentKey)
  ) {
    return false;
  }
  if (roleKey === "manager") {
    return combinedKey.includes("operation");
  }
  if (roleKey === "gm" && combinedKey.includes("finance")) {
    return false;
  }
  return OPERATIONS_COMMAND_ALLOWED_ROLES.has(roleKey);
}

const SELF_ADMIN_OPERATIONS_ROLES = new Set([
  "admin",
  "developer",
  "qpms admin",
  "qpmsadmin",
]);

function operationsSelfIdentity(user = {}) {
  const metadata = user?.metadata && typeof user.metadata === "object" ? user.metadata : {};
  const profile = user?.profile && typeof user.profile === "object" ? user.profile : {};
  return {
    roleKey: normalizeRoleKey(user?.rawRole || user?.role || metadata.role || profile.role),
    email: String(user?.email || user?.username || metadata.email || profile.email || "").trim().toLowerCase(),
    employeeCode: normalizeFoKey(
      firstNonEmptyText(
        user?.employee_code,
        user?.employeeCode,
        profile.employee_code,
        metadata.employee_code,
      ),
    ),
  };
}

function isSelfAdminOperationsProfile(profile = {}, user = {}) {
  const identity = operationsSelfIdentity(user);
  if (!SELF_ADMIN_OPERATIONS_ROLES.has(identity.roleKey)) return false;
  const profileRoleKey = normalizeRoleKey(profile?.role || profile?.rawRole);
  if (!SELF_ADMIN_OPERATIONS_ROLES.has(profileRoleKey)) return false;
  const profileEmail = String(profile?.email || profile?.username || "").trim().toLowerCase();
  const profileCode = normalizeFoKey(profile?.employee_code || profile?.employeeCode || profile?.username);
  const specificQpmsAdminMatch =
    (identity.email === "qpmsapps@gmail.com" || identity.employeeCode === "QPMSADMIN") &&
    (profileEmail === "qpmsapps@gmail.com" || profileCode === "QPMSADMIN");
  return Boolean(
    specificQpmsAdminMatch ||
      (identity.email && profileEmail === identity.email) ||
      (identity.employeeCode && profileCode === identity.employeeCode),
  );
}

function isOperationsCommandVisibleRecord(record = {}, user = {}) {
  const profile = record?.profile || record;
  return isOperationsCommandEligibleRecord(record) ||
    isSelfAdminOperationsProfile(profile, user);
}

function recordMatchesOfficerKeys(record, officerKeys) {
  if (!officerKeys?.size) return false;
  return [
    record?.fo_user_id,
    record?.employee_code,
    record?.username,
    record?.profile?.employee_code,
    record?.profile?.username,
  ]
    .map(normalizeFoKey)
    .filter(Boolean)
    .some((key) => officerKeys.has(key));
}

function operationalFoIdForOfficer(officer = {}) {
  return normalizeFoKey(
    officer?.profile?.employee_code ||
      officer?.employeeCode ||
      officer?.profile?.username ||
      officer?.username ||
      officer?.attendance?.employee_code ||
      officer?.attendance?.fo_user_id ||
      officer?.foId,
  );
}

function isValidRoutePoint(log) {
  if (log?.is_mocked || log?.metadata?.mock === true) return false;
  const accuracy = Number(log?.accuracy);
  return (
    isValidLatLng(log?.latitude, log?.longitude) &&
    Number.isFinite(accuracy) &&
    accuracy <= MAX_GPS_ACCURACY_METERS
  );
}

function isValidGpsLog(log) {
  if (log?.is_mocked || log?.metadata?.mock === true) return false;
  return isValidLatLng(log?.latitude, log?.longitude);
}

function locationTimestampMs(log) {
  return new Date(log?.captured_at || log?.logged_at || log?.created_at || log?.last_seen_at || 0).getTime();
}

function routePointTime(log) {
  return new Date(log?.captured_at || log?.logged_at || log?.created_at || 0);
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

function isSameSiteDrift(previous, current, visits = []) {
  const previousTime = routePointTime(previous);
  const currentTime = routePointTime(current);
  return visits.some((visit) => {
    const lat = numberOrNull(
      visit.current_latitude ?? visit.check_in_latitude ?? visit.latitude,
    );
    const lng = numberOrNull(
      visit.current_longitude ?? visit.check_in_longitude ?? visit.longitude,
    );
    if (lat === null || lng === null) return false;
    const checkIn = new Date(visit.check_in_time || visit.checkin_time || 0);
    const checkOutValue = visit.checkout_time || visit.check_out_time;
    const checkOut = checkOutValue ? new Date(checkOutValue) : null;
    if (previousTime < checkIn || (checkOut && currentTime > checkOut)) {
      return false;
    }
    const site = { latitude: lat, longitude: lng };
    return (
      distanceKmBetween(previous, site) * 1000 <= SITE_GEOFENCE_METERS &&
      distanceKmBetween(current, site) * 1000 <= SITE_GEOFENCE_METERS
    );
  });
}

function routeSegmentsFromLogs(logs = [], visits = []) {
  const ordered = logs
    .filter(isValidRoutePoint)
    .slice()
    .sort((a, b) => routePointTime(a) - routePointTime(b));
  const segments = [];
  let current = [];
  let previous = null;

  ordered.forEach((log) => {
    if (previous) {
      const secondsDiff = (routePointTime(log) - routePointTime(previous)) / 1000;
      const segmentMeters = distanceKmBetween(previous, log) * 1000;
      const accepted =
        segmentMeters >= MIN_ROUTE_SEGMENT_METERS &&
        segmentMeters <= MAX_ROUTE_SEGMENT_METERS &&
        secondsDiff > 0 &&
        secondsDiff <= MAX_ROUTE_SEGMENT_SECONDS &&
        segmentMeters / secondsDiff <= MAX_ROUTE_SPEED_MPS &&
        !isSameSiteDrift(previous, log, visits);
      if (!accepted) {
        if (current.length > 1) segments.push(current);
        current = [[Number(log.latitude), Number(log.longitude)]];
      } else {
        if (!current.length) {
          current.push([Number(previous.latitude), Number(previous.longitude)]);
        }
        current.push([Number(log.latitude), Number(log.longitude)]);
      }
    } else {
      current.push([Number(log.latitude), Number(log.longitude)]);
    }
    previous = log;
  });
  if (current.length > 1) segments.push(current);
  return segments;
}

async function buildMainMapRouteLines({ logs = [], color = "#2563eb", idPrefix = "route" }) {
  const gpsTrail = gpsTrailFromLogs(logs);
  const lines = gpsTrail.segments.map((positions, index) => ({
    id: `${idPrefix}-gps-${index}`,
    positions,
    color,
    source: "segmented_raw_gps",
  }));
  const routeUnavailable = gpsTrail.acceptedGpsPoints >= 2 && lines.length === 0;
  const diagnostics = {
    rawGpsPoints: gpsTrail.rawGpsPoints,
    acceptedGpsPoints: gpsTrail.acceptedGpsPoints,
    segmentsCreated: lines.length,
    skippedGapPoints: gpsTrail.skippedGapPoints,
    googleRouteApiFailed: false,
  };
  console.debug("FO_MAIN_MAP_ROUTE_FALLBACK_DIAGNOSTICS", diagnostics);
  return {
    lines,
    diagnostics,
    message: routeUnavailable
      ? "Route trail unavailable. Showing available points."
      : null,
  };
}

function routeKmFromLogs(logs = [], visits = []) {
  return routeSegmentsFromLogs(logs, visits).reduce((sum, segment) => {
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

function isBasicGpsLog(log) {
  if (log?.is_mocked || log?.metadata?.mock === true) return false;
  const lat = Number(log?.latitude);
  const lng = Number(log?.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    routePointTime(log).toString() !== "Invalid Date"
  );
}

function rawGpsKmFromLogs(logs = []) {
  const ordered = logs.filter(isBasicGpsLog).sort((a, b) => routePointTime(a) - routePointTime(b));
  let distance = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gapSeconds = (routePointTime(current) - routePointTime(previous)) / 1000;
    const segmentKm = distanceKmBetween(previous, current);
    if (gapSeconds > 0 && segmentKm * 1000 >= MIN_ROUTE_SEGMENT_METERS) {
      distance += segmentKm;
    }
  }
  return distance;
}

function foSafeKmFromLogs(logs = [], visits = []) {
  const ordered = logs
    .slice()
    .sort((a, b) => routePointTime(a) - routePointTime(b));
  const validLogs = ordered.filter(isValidRoutePoint);
  const rejectedPointsCount = ordered.length - validLogs.length;
  const rawGpsKm = rawGpsKmFromLogs(logs);
  let filteredGpsKm = 0;
  let gapSafetyKm = 0;
  const gaps = [];

  for (let index = 1; index < validLogs.length; index += 1) {
    const previous = validLogs[index - 1];
    const current = validLogs[index];
    const gapSeconds = (routePointTime(current) - routePointTime(previous)) / 1000;
    if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) continue;
    gaps.push(gapSeconds);
    const segmentMeters = distanceKmBetween(previous, current) * 1000;
    if (!Number.isFinite(segmentMeters) || segmentMeters < MIN_ROUTE_SEGMENT_METERS) {
      continue;
    }
    if (gapSeconds > LARGE_GPS_GAP_SECONDS) {
      gapSafetyKm += (segmentMeters / 1000) * GAP_DISTANCE_SAFETY_MULTIPLIER;
      continue;
    }
    const accepted =
      segmentMeters <= MAX_ROUTE_SEGMENT_METERS &&
      segmentMeters / gapSeconds <= MAX_ROUTE_SPEED_MPS &&
      !isSameSiteDrift(previous, current, visits);
    if (accepted) {
      filteredGpsKm += segmentMeters / 1000;
    }
  }

  const averageGapSeconds = gaps.length
    ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length
    : 0;
  const maxGapSeconds = gaps.length ? Math.max(...gaps) : 0;
  const gapAdjustedKm = filteredGpsKm + gapSafetyKm;
  const logsPerKm = filteredGpsKm > 0 ? validLogs.length / filteredGpsKm : validLogs.length;
  const rejectedRatio = ordered.length ? rejectedPointsCount / ordered.length : 0;
  let kmConfidence = "REVIEW";

  if (validLogs.length >= 2 && filteredGpsKm > 0 && rejectedRatio <= 0.35) {
    if (logsPerKm >= 8 && maxGapSeconds <= 180 && averageGapSeconds <= 90) {
      kmConfidence = "HIGH";
    } else if (
      logsPerKm >= 4 &&
      maxGapSeconds <= 600 &&
      averageGapSeconds <= 180
    ) {
      kmConfidence = "MEDIUM";
    } else if (logsPerKm >= 2 && maxGapSeconds <= 1800) {
      kmConfidence = "LOW";
    }
  }

  const confidenceAdjustedKm =
    kmConfidence === "HIGH"
      ? filteredGpsKm * HIGH_CONFIDENCE_MULTIPLIER
      : kmConfidence === "MEDIUM"
        ? filteredGpsKm * MEDIUM_CONFIDENCE_MULTIPLIER
        : kmConfidence === "LOW"
          ? filteredGpsKm * LOW_CONFIDENCE_MULTIPLIER
          : filteredGpsKm;
  const actualTravelKm = Math.max(filteredGpsKm, gapAdjustedKm, confidenceAdjustedKm);
  const adjustmentParts = [];
  if (gapAdjustedKm > filteredGpsKm) {
    adjustmentParts.push("Gap safety multiplier 1.20");
  }
  if (kmConfidence === "HIGH") {
    adjustmentParts.push("Confidence multiplier 1.03");
  } else if (kmConfidence === "MEDIUM") {
    adjustmentParts.push("Confidence multiplier 1.08");
  } else if (kmConfidence === "LOW") {
    adjustmentParts.push("Confidence multiplier 1.12");
  } else {
    adjustmentParts.push("Supervisor review required");
  }

  return {
    rawGpsKm,
    filteredGpsKm,
    gapAdjustedKm,
    gpsLogsCount: ordered.length,
    validPointsCount: validLogs.length,
    logsPerKm,
    averageGapSeconds,
    maxGapSeconds,
    rejectedPointsCount,
    kmConfidence,
    reviewRequired: kmConfidence === "LOW" || kmConfidence === "REVIEW",
    actualTravelKm,
    claimKm: actualTravelKm,
    petrolAmount: calculatePetrolAmount(actualTravelKm),
    adjustmentApplied: adjustmentParts.join(", "),
  };
}

function actualTravelKmFromAttendanceOrLogs(attendance, logs = [], visits = []) {
  const storedRawGpsKm = Number(attendance?.raw_gps_km);
  const storedFilteredGpsKm = Number(attendance?.filtered_gps_km);
  const storedActualTravelKm = Number(attendance?.actual_travel_km);
  const gpsAuditMetrics = logs.length ? foSafeKmFromLogs(logs, visits) : null;
  if (
    Number.isFinite(storedRawGpsKm) &&
    Number.isFinite(storedFilteredGpsKm) &&
    Number.isFinite(storedActualTravelKm) &&
    (storedRawGpsKm > 0 || storedFilteredGpsKm > 0 || storedActualTravelKm > 0)
  ) {
    return {
      ...emptyFoSafeKmMetrics(storedActualTravelKm),
      ...(gpsAuditMetrics || {}),
      rawGpsKm: storedRawGpsKm,
      filteredGpsKm: storedFilteredGpsKm,
      gapAdjustedKm: storedActualTravelKm,
      actualTravelKm: storedActualTravelKm,
      claimKm: storedActualTravelKm,
      adjustmentApplied: "Stored in fo_attendance",
    };
  }
  if (gpsAuditMetrics) return gpsAuditMetrics;
  const fallbackKm = Number(attendance?.actual_km ?? attendance?.total_raw_km ?? 0);
  return {
    ...emptyFoSafeKmMetrics(fallbackKm),
    filteredGpsKm: fallbackKm,
    actualTravelKm: fallbackKm,
    claimKm: fallbackKm,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatLng(lat, lng) {
  if (
    lat === null ||
    lat === undefined ||
    lng === null ||
    lng === undefined ||
    String(lat).trim() === "" ||
    String(lng).trim() === ""
  ) {
    return false;
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function warnSkippedInvalidCoordinate({ employeeCode, source, lat, lng }) {
  if (!ENABLE_OPERATIONS_MAP_COORDINATE_WARNINGS) return;
  console.warn("[Operations Map] skipped invalid coordinate", {
    employeeCode: employeeCode || "--",
    source: source || "unknown",
    lat,
    lng,
  });
}

function liveStatusTimestamp(row) {
  return (
    row?.updated_at ||
    row?.last_seen_at ||
    row?.last_seen ||
    row?.logged_at ||
    row?.created_at
  );
}

function hasFiniteCoordinates(coordinates) {
  return Array.isArray(coordinates) && isValidLatLng(coordinates[0], coordinates[1]);
}

function normalizeCoordinates(coordinates) {
  if (!hasFiniteCoordinates(coordinates)) return null;
  return [Number(coordinates[0]), Number(coordinates[1])];
}

function canShowOfficerMarker(officer) {
  return hasFiniteCoordinates(officer.coordinates);
}

function latestValidLocationLog(logs = []) {
  return [...logs]
    .filter(isValidGpsLog)
    .sort((a, b) => locationTimestampMs(b) - locationTimestampMs(a))[0] || null;
}

function gpsPointFromLiveOrLogs(live, logs = []) {
  const candidates = [];
  const liveLat = Number(live?.latitude ?? live?.lat);
  const liveLng = Number(live?.longitude ?? live?.lng ?? live?.long);
  const liveTimestamp = liveStatusTimestamp(live);
  if (isValidLatLng(live?.latitude ?? live?.lat, live?.longitude ?? live?.lng ?? live?.long) && liveTimestamp) {
    candidates.push({
      coordinates: [liveLat, liveLng],
      timestamp: liveTimestamp,
      accuracy: numberOrNull(live?.accuracy),
      speed: numberOrNull(live?.speed),
      heading: live?.heading ?? live?.bearing ?? null,
      source: "fo_live_status",
    });
  }
  const latestLog = latestValidLocationLog(logs);
  if (latestLog) {
    candidates.push({
      coordinates: [Number(latestLog.latitude), Number(latestLog.longitude)],
      timestamp: latestLog.captured_at || latestLog.logged_at,
      accuracy: numberOrNull(latestLog.accuracy),
      speed: numberOrNull(latestLog.speed),
      heading: latestLog.heading ?? latestLog.bearing ?? null,
      source: "fo_location_logs",
    });
  }
  return candidates.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )[0] || null;
}

function movementBearing(start, end) {
  const from = normalizeCoordinates(start);
  const to = normalizeCoordinates(end);
  if (!from || !to) return null;
  const lat1 = (from[0] * Math.PI) / 180;
  const lat2 = (to[0] * Math.PI) / 180;
  const deltaLng = ((to[1] - from[1]) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function markerAnimationDurationMs(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return MARKER_ANIMATION_DEFAULT_MS;
  }
  const scaled = distanceMeters * 120;
  return Math.min(
    MARKER_ANIMATION_MAX_MS,
    Math.max(MARKER_ANIMATION_MIN_MS, scaled),
  );
}

function markerAnimationLabel(timestamp) {
  if (!timestamp) return "Moving";
  const ageMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000),
  );
  if (ageMinutes < 1) return "Moving • last update just now";
  return `Moving • last update ${ageMinutes} min ago`;
}

function canAnimateOfficerMarker(officer) {
  if (!isOperationallyActive(officer)) return false;
  if (
    String(
      officer.attendance?.status || officer.action || officer.current_status || "",
    )
      .toLowerCase()
      .includes("completed")
  ) {
    return false;
  }
  const timestamp = officer.locationSourceTime;
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() <= MARKER_ANIMATION_RECENT_THRESHOLD_MS;
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

function profileByEmployeeCode(rows = []) {
  const profilesByCode = new Map();
  rows.forEach((profile) => {
    profileKeys(profile).forEach((key) => profilesByCode.set(key, profile));
  });
  return profilesByCode;
}

function profileMetadata(profile) {
  return profile?.metadata && typeof profile.metadata === "object" && !Array.isArray(profile.metadata)
    ? profile.metadata
    : {};
}

function firstNonEmptyText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function firstPositiveNumber(...values) {
  return values
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0) ?? null;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinatesFromFields(row, latitudeField, longitudeField) {
  const latitude = optionalFiniteNumber(row?.[latitudeField]);
  const longitude = optionalFiniteNumber(row?.[longitudeField]);
  return hasFiniteCoordinates([latitude, longitude])
    ? [latitude, longitude]
    : null;
}

function matchOfficerProfile({ officer = {}, attendance, visits = [], profilesByCode }) {
  const identifiers = [
    officer.employee_code,
    officer.employeeCode,
    officer.fo_user_id,
    officer.foId,
    attendance?.employee_code,
    attendance?.fo_user_id,
    ...visits.flatMap((visit) => [visit?.employee_code, visit?.fo_user_id]),
  ];
  for (const identifier of identifiers) {
    const profile = profilesByCode.get(normalizeFoKey(identifier));
    if (profile) return profile;
  }
  return null;
}

function enrichOfficer({ officer, attendance, visits = [], live, profilesByCode }) {
  const activeVisit = visits.find(isSiteVisitOpen) || null;
  const profile = matchOfficerProfile({ officer, attendance, visits, profilesByCode });
  const metadata = profileMetadata(profile);
  const employeeCode = firstNonEmptyText(
    officer.employee_code,
    officer.employeeCode,
    officer.fo_user_id,
    officer.foId,
    attendance?.employee_code,
    attendance?.fo_user_id,
    activeVisit?.employee_code,
    activeVisit?.fo_user_id,
    profile?.employee_code,
    profile?.username,
  );

  const displayNameCandidates = [
    [profile?.full_name, "profile.full_name"],
    [activeVisit?.full_name, "site_visit.full_name"],
    [attendance?.full_name, "attendance.full_name"],
    [officer.full_name, "officer.full_name"],
    [employeeCode, "employee_code"],
  ];
  const displayNameMatch = displayNameCandidates.find(([value]) =>
    Boolean(firstNonEmptyText(value)),
  );
  const name = firstNonEmptyText(displayNameMatch?.[0], employeeCode);
  const displayNameSource = displayNameMatch?.[1] || "employee_code";

  const locationCandidates = [
    [coordinatesFromFields(live, "latitude", "longitude"), "live_status"],
    [coordinatesFromFields(activeVisit, "current_latitude", "current_longitude"), "site_visit.current"],
    [coordinatesFromFields(activeVisit, "check_in_latitude", "check_in_longitude"), "site_visit.check_in"],
    [coordinatesFromFields(activeVisit, "destination_lat", "destination_lng"), "site_visit.destination"],
    [coordinatesFromFields(attendance, "start_latitude", "start_longitude"), "attendance.start"],
  ];
  const locationMatch = locationCandidates.find(([coordinates]) => coordinates);
  const coordinates = locationMatch?.[0] || null;
  const locationSource = locationMatch?.[1] || "none";

  const attendanceKm = firstPositiveNumber(
    attendance?.total_route_km,
    attendance?.eligible_km,
    attendance?.total_approved_km,
  );
  const liveKm = firstPositiveNumber(live?.route_km_today);
  const siteVisitKm = visits.reduce((sum, visit) => {
    const routeKm = Number(visit?.route_km);
    return Number.isFinite(routeKm) && routeKm > 0 ? sum + routeKm : sum;
  }, 0);
  const activeVisitKm = firstPositiveNumber(activeVisit?.route_km);
  const kmCandidates = [
    [attendanceKm, "attendance"],
    [liveKm, "live_status.route_km_today"],
    [siteVisitKm > 0 ? siteVisitKm : null, "site_visits.route_km_sum"],
    [activeVisitKm, "active_site_visit.route_km"],
    [0, "zero"],
  ];
  const kmMatch = kmCandidates.find(([value]) => value !== null && value !== undefined);
  const eligibleKm = Number(kmMatch?.[0] || 0);
  const travelMode = currentTravelModeFromRows({ live, attendance, officer });
  const ratePerKm = travelModeRatePerKm(
    travelMode,
    live?.rate_per_km ?? attendance?.rate_per_km ?? officer.ratePerKm,
  );
  const petrolAmountPending = isCanonicalPetrolPending(attendance);
  const storedPetrolAmount = numberOrNull(attendance?.petrol_amount);
  const profileOnly = Boolean(
    profile &&
      !live &&
      !attendance &&
      visits.length === 0 &&
      (officer.logs?.length || 0) === 0,
  );
  const resolvedEmployeeCode = profileOnly
    ? firstNonEmptyText(profile?.employee_code, profile?.username, employeeCode)
    : employeeCode;
  const kmSource = profileOnly ? "none" : kmMatch?.[1] || "zero";
  const sourceTimestamp =
    locationSource === "live_status"
      ? liveStatusTimestamp(live)
      : locationSource.startsWith("site_visit")
        ? activeVisit?.check_in_time
        : attendance?.login_time;
  const dataSources = [
    live ? "live_status" : null,
    attendance ? "attendance" : null,
    visits.length ? "site_visit" : null,
    profile ? "profile" : null,
  ].filter(Boolean);

  return {
    ...officer,
    profile,
    employeeCode: resolvedEmployeeCode,
    employeeKey: normalizeFoKey(resolvedEmployeeCode),
    name,
    state: profile?.state || officer.state || "--",
    branch: profile?.state || officer.branch || officer.state || "--",
    phone: profile?.mobile || profile?.phone || officer.phone || "--",
    email: profile?.email || officer.email || "",
    username: profile?.username || officer.username || "",
    role: profile?.role || officer.role || "--",
    designation: profile?.designation || officer.designation || "--",
    department: profile?.department || officer.department || "--",
    business: profile?.business || officer.business || "--",
    avatarUrl: firstNonEmptyText(metadata.profile_image_url, officer.avatarUrl, officer.profileImageUrl, officer.profile_image_url),
    profileImageUrl: firstNonEmptyText(metadata.profile_image_url, officer.profileImageUrl, officer.profile_image_url, officer.avatarUrl),
    profile_image_url: firstNonEmptyText(metadata.profile_image_url, officer.profile_image_url, officer.profileImageUrl, officer.avatarUrl),
    displayNameSource: profileOnly ? "profile" : displayNameSource,
    coordinates,
    locationSource,
    locationSourceTime: sourceTimestamp || officer.locationSourceTime || null,
    accuracy:
      locationSource === "live_status"
        ? optionalFiniteNumber(live?.accuracy)
        : optionalFiniteNumber(activeVisit?.current_gps_accuracy ?? activeVisit?.checkin_accuracy),
    heading: locationSource === "live_status" ? live?.heading ?? live?.bearing ?? null : null,
    speed: locationSource === "live_status" ? optionalFiniteNumber(live?.speed) : null,
    foLatitude: coordinates?.[0] ?? null,
    foLongitude: coordinates?.[1] ?? null,
    siteCoordinates: activeVisit
      ? coordinatesFromFields(activeVisit, "current_latitude", "current_longitude") ||
        coordinatesFromFields(activeVisit, "check_in_latitude", "check_in_longitude") ||
        coordinatesFromFields(activeVisit, "destination_lat", "destination_lng")
      : null,
    eligibleKm,
    routeKmToday: eligibleKm,
    travelMode,
    travelModeLabel: travelModeLabel(travelMode),
    ratePerKm,
    petrolAmount: petrolAmountPending
      ? null
      : storedPetrolAmount ?? calculatePetrolAmount(eligibleKm, ratePerKm),
    petrolAmountPending,
    routeKmSource: kmSource,
    kmSource,
    dataSources,
    sourceUsed: profileOnly ? "profile_only" : dataSources.join(" / ") || "unknown",
    isProfileOnly: profileOnly,
  };
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

async function fetchFoLiveStatusRows() {
  let baseQuery = supabase
    .from("fo_live_status")
    .select(FO_LIVE_STATUS_SELECT)
    .order("last_seen_at", { ascending: false })
    .limit(5000);
  let { data, error } = await baseQuery;

  if (error) {
    const message = String(error.message || "").toLowerCase();
    const missingColumn =
      error.code === "42703" ||
      error.code === "PGRST204" ||
      message.includes("column") ||
      message.includes("could not find");
    if (!missingColumn) throw error;
    const fallback = await supabase
      .from("fo_live_status")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(5000);
    if (fallback.error) throw fallback.error;
    data = fallback.data || [];
  }

  const rows = mergeLiveStatusRows(data || []);
  console.debug("FO_LIVE_STATUS_ROWS_FETCHED", rows.length);
  return rows;
}

async function fetchFoSiteVisitRows(fromIso, toIso) {
  let query = supabase
    .from("fo_site_visits")
    .select(FO_SITE_VISIT_SELECT)
    .gte("check_in_time", fromIso)
    .lte("check_in_time", toIso)
    .order("check_in_time", { ascending: false })
    .limit(5000);
  let response = await query;
  if (response.error) {
    logSupabaseError("[myQPMS FO] fo_site_visits select failed.", response.error);
    const message = String(response.error.message || "").toLowerCase();
    const missingColumn =
      response.error.code === "42703" ||
      response.error.code === "PGRST204" ||
      message.includes("column") ||
      message.includes("could not find");
    if (!missingColumn) throw response.error;
    response = await supabase
      .from("fo_site_visits")
      .select("*")
      .gte("check_in_time", fromIso)
      .lte("check_in_time", toIso)
      .order("check_in_time", { ascending: false })
      .limit(5000);
    if (response.error) {
      logSupabaseError("[myQPMS FO] fo_site_visits fallback select failed.", response.error);
      throw response.error;
    }
  }
  return response.data || [];
}

function siteVisitFoId(visit) {
  return normalizeFoKey(visit?.fo_user_id || visit?.employee_code);
}

function siteVisitCoordinates(visit) {
  const checkInLat = numberOrNull(visit?.check_in_latitude);
  const checkInLng = numberOrNull(visit?.check_in_longitude);
  if (checkInLat !== null && checkInLng !== null) {
    return [checkInLat, checkInLng];
  }
  const checkOutLat = numberOrNull(visit?.check_out_latitude);
  const checkOutLng = numberOrNull(visit?.check_out_longitude);
  if (checkOutLat !== null && checkOutLng !== null) {
    return [checkOutLat, checkOutLng];
  }
  return null;
}

function siteVisitName(visit) {
  return (
    visit?.store_name ||
    visit?.site_name ||
    visit?.store_code ||
    visit?.site_code ||
    "Visited site"
  );
}

function siteVisitCheckoutValue(visit) {
  return visit?.check_out_time || visit?.checkout_time || null;
}

function isSiteVisitOpen(visit) {
  const status = String(visit?.status || visit?.visit_status || "");
  return (
    Boolean(visit?.check_in_time) &&
    !visit?.checkout_time &&
    !visit?.check_out_time &&
    !/completed|closed|checked\s*out|checkout|ended/i.test(status)
  );
}

function isSameIndiaDate(value, dateInput) {
  if (!value || !dateInput) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return toDateInputValue(parsed) === dateInput;
}

function isCurrentAttendanceVisit(visit, attendance, dateInput) {
  if (!visit) return false;
  const visitAttendanceId = String(visit.attendance_id || "");
  const attendanceId = String(attendance?.id || "");
  if (visitAttendanceId && attendanceId) {
    return visitAttendanceId === attendanceId;
  }
  return isSameIndiaDate(visit.check_in_time, dateInput);
}

function isAttendanceEnded(attendance) {
  return (
    Boolean(attendance?.logout_time) ||
    /completed|ended|closed|logout|stale\s*auto\s*ended|stale_auto_ended/i.test(String(attendance?.status || ""))
  );
}

function isAttendanceActive(attendance) {
  return (
    Boolean(attendance) &&
    !attendance?.logout_time &&
    !isAttendanceEnded(attendance) &&
    String(attendance?.status || "Active").toLowerCase() === "active"
  );
}

function siteVisitStatus(visit) {
  const raw = String(visit?.status || "").trim();
  if (raw) return raw;
  return isSiteVisitOpen(visit) ? "Checked In" : "Checked Out";
}

function siteVisitDuration(visit) {
  const explicit = Number(visit?.visit_duration_minutes);
  if (Number.isFinite(explicit)) return `${Math.round(explicit)} min`;
  const checkOut = siteVisitCheckoutValue(visit);
  if (!visit?.check_in_time || !checkOut) return "--";
  const minutes = Math.max(
    0,
    Math.round((new Date(checkOut) - new Date(visit.check_in_time)) / 60000),
  );
  return `${minutes} min`;
}

function buildSiteVisitPin(visit, officersByFoId, index) {
  const coordinates = siteVisitCoordinates(visit);
  if (!coordinates) return null;
  const foId = siteVisitFoId(visit);
  const officer = officersByFoId.get(foId);
  const siteName = siteVisitName(visit);
  console.debug("FO_SITE_VISIT_POPUP_READY", siteName, foId || "--");
  return {
    id:
      visit.id ||
      `visit-${foId || "unknown"}-${visit.check_in_time || siteVisitCheckoutValue(visit) || index}-${coordinates[0]}-${coordinates[1]}`,
    coordinates,
    siteName,
    clientName: visit.client_name || "--",
    storeCode: visit.store_code || visit.site_code || "--",
    foName:
      visit.fo_name ||
      visit.display_name ||
      officer?.name ||
      visit.full_name ||
      "--",
    foId: foId || "--",
    checkIn: formatDateTime(visit.check_in_time),
    checkOut: formatDateTime(visit.check_out_time || visit.checkout_time),
    duration: siteVisitDuration(visit),
    status: siteVisitStatus(visit),
  };
}

function emptyFoSafeKmMetrics(fallbackKm = 0) {
  const rawGpsKm = Number(fallbackKm) || 0;
  return {
    rawGpsKm,
    filteredGpsKm: rawGpsKm,
    gapAdjustedKm: rawGpsKm,
    actualTravelKm: rawGpsKm,
    gpsLogsCount: 0,
    validPointsCount: 0,
    logsPerKm: 0,
    averageGapSeconds: 0,
    maxGapSeconds: 0,
    rejectedPointsCount: 0,
    kmConfidence: rawGpsKm > 0 ? "REVIEW" : "REVIEW",
    reviewRequired: true,
    claimKm: rawGpsKm,
    petrolAmount: calculatePetrolAmount(rawGpsKm),
    adjustmentApplied: "Supervisor review required",
  };
}

function sumSiteVisitRouteKm(visits = []) {
  return visits.reduce((sum, visit) => {
    const routeKm = Number(visit?.route_km);
    return Number.isFinite(routeKm) && routeKm > 0 ? sum + routeKm : sum;
  }, 0);
}

function payableKmFromAttendance(row) {
  const candidates = [
    row?.total_approved_km,
    row?.eligible_km,
    row?.total_route_km,
    0,
  ];
  const value = candidates
    .map((item) => Number(item))
    .find((item) => Number.isFinite(item));
  const storedPayableKm = value || 0;
  const metadata = attendanceMetadata(row);
  const adjustmentIncluded =
    metadata.approved_adjustment_included_in_payable === true ||
    String(metadata.approved_adjustment_included_in_payable || "").toLowerCase() === "true";
  const includedAdjustmentKm = adjustmentIncluded
    ? numberOrNull(metadata.approved_adjustment_km) || 0
    : 0;
  return Math.max(0, storedPayableKm - includedAdjustmentKm);
}

function petrolAmountFromAttendance(row) {
  if (isCanonicalPetrolPending(row)) return null;
  const stored = numberOrNull(row?.petrol_amount);
  if (stored !== null) return stored;
  return calculatePetrolAmount(
    payableKmFromAttendance(row),
    travelModeRatePerKm(row?.travel_mode, row?.rate_per_km),
  );
}

function sumAttendancePetrolAmount(rows = []) {
  const values = rows.map(petrolAmountFromAttendance);
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function isCanonicalPetrolPending(row) {
  const metadata = attendanceMetadata(row);
  return (
    String(row?.route_sync_status || "").toLowerCase() ===
      "pending_canonical_end_day_recalculation" ||
    metadata.canonical_recalculation_pending === true ||
    String(metadata.km_recalculation_status || "").toLowerCase() === "pending"
  );
}

function officerPetrolDisplay(officer, provisionalKm = 0) {
  if (officer?.petrolAmountPending) return "Pending";
  const stored = numberOrNull(officer?.petrolAmount);
  if (stored !== null) return formatCurrency(stored);
  return `${formatCurrency(
    calculatePetrolAmount(provisionalKm, officer?.ratePerKm),
  )} provisional`;
}

function includedApprovedAdjustmentKmFromAttendance(row) {
  const metadata = attendanceMetadata(row);
  const adjustmentIncluded =
    metadata.approved_adjustment_included_in_payable === true ||
    String(metadata.approved_adjustment_included_in_payable || "").toLowerCase() === "true";
  if (!adjustmentIncluded) return null;
  const adjustmentKm = numberOrNull(metadata.approved_adjustment_km);
  return adjustmentKm !== null && adjustmentKm > 0 ? adjustmentKm : 0;
}

function approvedMissingCheckoutAdjustmentKmFromVisit(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const reviewStatus = String(metadata.checkout_review_status || "").trim().toLowerCase();
  if (reviewStatus !== "approved") return 0;
  const approvedKm = numberOrNull(
    metadata.approved_missing_checkout_km ??
      metadata.approved_missing_checkout_adjustment_km ??
      metadata.approved_missing_km ??
      metadata.approved_missing_checkout ??
      visit?.approved_missing_checkout_km ??
      visit?.approved_missing_km,
  );
  return approvedKm !== null && approvedKm > 0 ? approvedKm : 0;
}

function approvedMissingCheckoutAdjustmentKm(visits = []) {
  const seenVisitKeys = new Set();
  return visits.reduce((sum, visit, index) => {
    const visitKey = String(
      visit?.id ||
        `${visit?.employee_code || visit?.fo_user_id || "visit"}:${visit?.check_in_time || index}:${visit?.check_out_time || ""}`,
    );
    if (seenVisitKeys.has(visitKey)) return sum;
    seenVisitKeys.add(visitKey);
    return sum + approvedMissingCheckoutAdjustmentKmFromVisit(visit);
  }, 0);
}

function logPayableKmSource(foId, source, km) {
  console.debug("FO_PAYABLE_KM_SOURCE_SELECTED", foId, source, km);
  console.debug("FO_ROUTE_KM_TODAY_VALUE", foId, km);
}

function gpsFallbackReviewFromAttendance(attendance) {
  const metadata = attendanceMetadata(attendance);
  const fallbackKm = numberOrNull(
    metadata.suggested_review_km ??
      metadata.fallback_gps_km ??
      attendance?.suggested_review_km ??
      attendance?.fallback_gps_km,
  );
  const reviewRequired =
    metadata.gps_fallback_review_required === true ||
    String(metadata.gps_fallback_review_required || "").toLowerCase() === "true" ||
    (fallbackKm !== null && fallbackKm > 0);
  return {
    reviewRequired,
    fallbackKm,
    reason: metadata.gps_fallback_review_reason || null,
  };
}

function payableRouteKmForOfficer({ foId, live, attendance, visits = [] }) {
  const siteVisitRouteKm = sumSiteVisitRouteKm(visits);
  const liveKm = Number(live?.route_km_today);
  const attendanceCandidates = [
    ["fo_attendance.eligible_km", attendance?.eligible_km],
    ["fo_attendance.total_route_km", attendance?.total_route_km],
    ["fo_attendance.total_approved_km", attendance?.total_approved_km],
  ]
    .map(([source, value]) => ({ source, km: Number(value) }))
    .filter((item) => Number.isFinite(item.km) && item.km > 0);
  const attendancePayable = attendanceCandidates.sort((a, b) => b.km - a.km)[0] || null;
  const attendanceCompleted =
    Boolean(attendance?.logout_time) ||
    /completed|closed|ended|logout/i.test(String(attendance?.status || ""));

  if (attendanceCompleted && attendancePayable) {
    logPayableKmSource(foId, attendancePayable.source, attendancePayable.km);
    return {
      km: attendancePayable.km,
      source: attendancePayable.source,
    };
  }

  const candidates = [
    { source: "fo_site_visits.route_km_sum", km: siteVisitRouteKm },
    { source: "fo_live_status.route_km_today", km: liveKm },
    attendancePayable,
  ].filter((item) => item && Number.isFinite(item.km) && item.km > 0);
  const selected = candidates.sort((a, b) => b.km - a.km)[0];
  if (selected) {
    logPayableKmSource(foId, selected.source, selected.km);
    return {
      km: selected.km,
      source: selected.source,
    };
  }

  const gpsFallbackReview = gpsFallbackReviewFromAttendance(attendance);
  if (visits.length > 0 && gpsFallbackReview.reviewRequired) {
    const source = gpsFallbackReview.fallbackKm
      ? `Needs Review (GPS fallback ${gpsFallbackReview.fallbackKm.toFixed(1)} km)`
      : "Needs Review";
    logPayableKmSource(foId, source, 0);
    return {
      km: 0,
      source,
    };
  }

  logPayableKmSource(foId, "zero", 0);
  return {
    km: 0,
    source: "zero",
  };
}

function reviewFlagsForOfficer({ systemKm = 0, attendance, visits = [], logs = [] }) {
  const flags = new Set();
  const storedFlags = String(attendance?.eligibility_status || "")
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);
  storedFlags.forEach((flag) => {
    if (
      [
        "ROUTE_KM_ZERO_WITH_VISITS",
        "GOOGLE_ROUTE_FAILED",
        "MISSING_ANCHOR_COORDINATES",
        "OPEN_SITE_VISIT",
        "LOW_GPS_LOG_COUNT",
        "PRE_SITE_SOURCING_REVIEW",
        "GPS_DETOUR_REVIEW_REQUIRED",
        "GPS_FALLBACK_REVIEW_REQUIRED",
        "TRAVEL_LEG_PAYABLE_ZERO",
      ].includes(flag)
    ) {
      flags.add(flag);
    }
  });
  if (Number(systemKm) <= 0 && visits.length > 0) {
    flags.add("ROUTE_KM_ZERO_WITH_VISITS");
  }
  if (visits.some(isSiteVisitOpen)) {
    flags.add("OPEN_SITE_VISIT");
  }
  if (logs.length < 5) {
    flags.add("LOW_GPS_LOG_COUNT");
  }
  if (
    visits.some(
      (visit) =>
        !siteVisitCoordinates(visit) &&
        !(
          Number.isFinite(Number(visit?.destination_lat)) &&
          Number.isFinite(Number(visit?.destination_lng))
        ),
    )
  ) {
    flags.add("MISSING_ANCHOR_COORDINATES");
  }
  if (
    visits.length > 0 &&
    String(attendance?.route_sync_status || "").toLowerCase() === "review_required"
  ) {
    flags.add("GOOGLE_ROUTE_FAILED");
  }
  const gpsFallbackReview = gpsFallbackReviewFromAttendance(attendance);
  if (visits.length > 0 && Number(systemKm) <= 0 && gpsFallbackReview.reviewRequired) {
    flags.add("GPS_FALLBACK_REVIEW_REQUIRED");
  }
  return [...flags];
}

function officerFromRows({ foId, live, attendance, visits, logs, statusDate, profilesByCode }) {
  const record = attendance || {};
  const foVisits = visits || [];
  const foLogs = logs || [];
  const gpsPoint = gpsPointFromLiveOrLogs(live, foLogs);
  const employeeKey = normalizeFoKey(
    live?.fo_user_id ||
      record.fo_user_id ||
      foVisits[0]?.fo_user_id ||
      foLogs[0]?.fo_user_id ||
      record.employee_code ||
      foVisits[0]?.employee_code ||
      foLogs[0]?.employee_code ||
      foId,
  );
  const operational = deriveOperationalStatus({
    employeeKey,
    attendance: record,
    visits: foVisits,
    live,
    logs: foLogs,
    gpsPoint,
    dateInput: statusDate,
  });
  const coordinates = gpsPoint?.coordinates ?? null;
  const sourceTimestamp =
    gpsPoint?.timestamp || liveStatusTimestamp(live) || record.login_time;
  const payableRouteKm = payableRouteKmForOfficer({
    foId,
    live,
    attendance: record,
    visits: foVisits,
  });
  const includedAdjustmentKm = includedApprovedAdjustmentKmFromAttendance(record);
  const basePayableKm = includedAdjustmentKm === null
    ? payableRouteKm.km
    : Math.max(0, payableRouteKm.km - includedAdjustmentKm);
  const missingCheckoutAdjustmentKm = includedAdjustmentKm === null
    ? approvedMissingCheckoutAdjustmentKm(foVisits)
    : includedAdjustmentKm;
  const payableKm =
    basePayableKm + missingCheckoutAdjustmentKm;
  const foSafeKm = actualTravelKmFromAttendanceOrLogs(record, foLogs, foVisits);
  const actualKm = Number(foSafeKm.actualTravelKm ?? record.actual_km ?? record.total_raw_km ?? 0);
  const eligibleKm = payableKm;
  const travelMode = currentTravelModeFromRows({ live, attendance: record });
  const ratePerKm = travelModeRatePerKm(
    travelMode,
    live?.rate_per_km ?? record.rate_per_km,
  );
  const storedPetrolAmount = numberOrNull(record.petrol_amount);
  const petrolAmountPending = isCanonicalPetrolPending(record);
  const petrolAmount = petrolAmountPending
    ? null
    : storedPetrolAmount ?? calculatePetrolAmount(eligibleKm, ratePerKm);
  const reviewFlags = reviewFlagsForOfficer({
    systemKm: eligibleKm,
    attendance: record,
    visits: foVisits,
    logs: foLogs,
  });
  const employeeCode = firstNonEmptyText(
    record.employee_code,
    record.fo_user_id,
    foVisits[0]?.employee_code,
    foVisits[0]?.fo_user_id,
    live?.fo_user_id,
    foId,
  );
  const state = live?.state || record.state || "--";

  const baseOfficer = {
    id: `live-${foId}`,
    employeeKey,
    foId,
    name: employeeCode,
    employeeCode,
    status: operational.operationalStatus,
    ...operational,
    assignedSite:
      operational.openVisit?.store_name ||
      operational.openVisit?.site_name ||
      "No active store visit",
    branch: state,
    state,
    checkIn: formatTime(record.login_time),
    lastSeen: formatDateTime(sourceTimestamp),
    battery: batteryFromRow(live),
    action:
      live?.current_status ||
      record.status ||
      (attendance || foVisits.length || foLogs.length
        ? "Attendance captured"
        : "Not Started"),
    phone: record.mobile || live?.mobile || "--",
    coordinates,
    heading: gpsPoint?.heading ?? null,
    speed: gpsPoint?.speed ?? null,
    accuracy: gpsPoint?.accuracy ?? null,
    actualKm,
    basePayableKm,
    approvedMissingCheckoutAdjustmentKm: missingCheckoutAdjustmentKm,
    finalPayableKm: payableKm,
    rawGpsKm: Number(foSafeKm.rawGpsKm || 0),
    filteredGpsKm: Number(foSafeKm.filteredGpsKm || 0),
    actualTravelKm: Number(foSafeKm.actualTravelKm || actualKm || 0),
    eligibleKm,
    travelMode,
    travelModeLabel: travelModeLabel(travelMode),
    ratePerKm,
    petrolAmount,
    petrolAmountPending,
    routeKmToday: eligibleKm,
    routeKmSource: payableRouteKm.source,
    reviewFlags,
    foSafeKm,
    siteCoordinates: null,
    siteMarkerName: "Assigned site",
    foLatitude: coordinates?.[0] ?? null,
    foLongitude: coordinates?.[1] ?? null,
    locationSourceTime: sourceTimestamp,
    locationSource: gpsPoint?.source ?? null,
    hasLiveStatus: Boolean(live),
    attendance: attendance || null,
    tasks: [],
    visits: foVisits,
    logs: foLogs,
    conveyance: null,
  };
  return enrichOfficer({
    officer: baseOfficer,
    attendance: attendance || null,
    visits: foVisits,
    live,
    profilesByCode,
  });
}

function buildLiveFoData({ attendance, visits, liveStatus, profiles, logs, statusDate, currentUser }) {
  const activeProfiles = profiles.filter(
    (profile) => isActiveProfile(profile) && isOperationsCommandVisibleRecord(profile, currentUser),
  );
  const uniqueProfilesByCode = new Map();
  activeProfiles.forEach((profile) => {
    const canonical = normalizeFoKey(
      profile?.employee_code || profile?.username || profile?.id,
    );
    if (canonical && !uniqueProfilesByCode.has(canonical)) {
      uniqueProfilesByCode.set(canonical, profile);
    }
  });
  const uniqueProfiles = Array.from(uniqueProfilesByCode.values());
  const profilesByCode = profileByEmployeeCode(uniqueProfiles);
  const canonicalProfileCode = new Map();
  uniqueProfilesByCode.forEach((profile, canonical) => {
    if (!canonical) return;
    profileKeys(profile).forEach((key) => canonicalProfileCode.set(key, canonical));
  });
  const matchedActivityIds = new Set();
  const missingFromProfiles = new Set();
  const activityKeys = (row) =>
    [row?.fo_user_id, row?.employee_code, row?.username]
      .map(normalizeFoKey)
      .filter(Boolean);
  const canonicalActivityId = (row) => {
    const keys = activityKeys(row);
    const canonical = keys
      .map((key) => canonicalProfileCode.get(key))
      .find(Boolean);
    if (canonical) {
      matchedActivityIds.add(canonical);
      return canonical;
    }
    if (keys[0]) missingFromProfiles.add(keys[0]);
    return null;
  };
  const latestMatchedRows = (rows, timestampForRow) => {
    const latestRows = new Map();
    rows.forEach((row) => {
      const canonical = canonicalActivityId(row);
      if (!canonical) return;
      const current = latestRows.get(canonical);
      if (
        !current ||
        new Date(timestampForRow(row) || 0) >
          new Date(timestampForRow(current) || 0)
      ) {
        latestRows.set(canonical, row);
      }
    });
    return latestRows;
  };
  const latestAttendance = latestMatchedRows(
    attendance,
    (row) => row?.login_time || row?.created_at,
  );
  const attendanceByFo = attendance.reduce((map, row) => {
    const id = canonicalActivityId(row);
    if (!id) return map;
    const list = map.get(id) || [];
    list.push(row);
    map.set(id, list);
    return map;
  }, new Map());
  const latestLiveStatus = latestMatchedRows(liveStatus, liveStatusTimestamp);
  const visitsByFo = visits.reduce((map, visit) => {
    const id = canonicalActivityId(visit);
    if (!id) return map;
    const list = map.get(id) || [];
    list.push(visit);
    map.set(id, list);
    return map;
  }, new Map());
  const logsByFo = (logs || []).reduce((map, log) => {
    const id = canonicalActivityId(log);
    if (!id) return map;
    const list = map.get(id) || [];
    list.push(log);
    map.set(id, list);
    return map;
  }, new Map());

  const officers = Array.from(uniqueProfilesByCode.keys()).map((foId) => {
    const officer = officerFromRows({
      foId,
      live: latestLiveStatus.get(foId),
      attendance: latestAttendance.get(foId),
      visits: visitsByFo.get(foId) || [],
      logs: logsByFo.get(foId) || [],
      statusDate,
      profilesByCode,
    });
    const rangeAttendances = (attendanceByFo.get(foId) || []).sort(
      (a, b) => new Date(a.login_time || 0) - new Date(b.login_time || 0),
    );
    const rangePayableKm = rangeAttendances.reduce(
      (sum, row) => sum + payableKmFromAttendance(row),
      0,
    );
    const rangeApprovedMissingKm = approvedMissingCheckoutAdjustmentKm(
      visitsByFo.get(foId) || [],
    );
    const rangeFinalPayableKm = rangePayableKm + rangeApprovedMissingKm;
    return {
      ...officer,
      attendances: rangeAttendances,
      basePayableKm: rangeAttendances.length
        ? rangePayableKm
        : officer.basePayableKm,
      approvedMissingCheckoutAdjustmentKm: rangeAttendances.length
        ? rangeApprovedMissingKm
        : officer.approvedMissingCheckoutAdjustmentKm,
      finalPayableKm: rangeAttendances.length
        ? rangeFinalPayableKm
        : officer.finalPayableKm,
      eligibleKm: rangeAttendances.length
        ? rangeFinalPayableKm
        : officer.eligibleKm,
      routeKmToday: rangeAttendances.length
        ? rangeFinalPayableKm
        : officer.routeKmToday,
      petrolAmount: rangeAttendances.length
        ? sumAttendancePetrolAmount(rangeAttendances)
        : officer.petrolAmount,
      petrolAmountPending: rangeAttendances.some(isCanonicalPetrolPending),
    };
  });
  const mergeDiagnostics = {
    activeProfilesCount: activeProfiles.length,
    operationsExcludedProfilesCount: profiles.filter(
      (profile) => isActiveProfile(profile) && !isOperationsCommandVisibleRecord(profile, currentUser),
    ).length,
    activityDerivedOfficerCount: matchedActivityIds.size,
    finalMergedOfficerCount: officers.length,
    profileOnlyOfficerCount: officers.filter((officer) => officer.isProfileOnly)
      .length,
    missingFromProfilesCount: missingFromProfiles.size,
    duplicateEmployeeCodesRemoved:
      activeProfiles.length - uniqueProfilesByCode.size,
  };
  console.debug("FO_PROFILE_MASTER_MERGE", mergeDiagnostics);
  if (import.meta.env.DEV) {
    officers.forEach((officer) => {
      console.debug("FO_OFFICER_ENRICHED", {
        employeeCode: officer.employeeCode || officer.foId,
        sourceUsed: officer.sourceUsed,
        displayNameSource: officer.displayNameSource,
        locationSource: officer.locationSource,
        kmSource: officer.kmSource,
      });
    });
    console.debug("FO_OFFICER_ENRICHMENT_SUMMARY", {
      officersMissingProfileName: officers.filter(
        (officer) =>
          !["profile", "profile.full_name"].includes(officer.displayNameSource),
      ).length,
      ...mergeDiagnostics,
    });
  }
  return officers;
}

function officerFromLiveStatus(row, profilesByCode, existing = {}) {
  const foId = normalizeFoKey(
    row?.fo_user_id || existing.foId || existing.employeeCode,
  );
  if (!foId) return null;
  const gpsPoint = gpsPointFromLiveOrLogs(row, []);
  const coordinates =
    gpsPoint?.coordinates ??
    (hasFiniteCoordinates(existing.coordinates) ? existing.coordinates : null);
  if (!coordinates && hasFiniteCoordinates(existing.coordinates)) {
    console.debug("FO_COORDINATES_CLEARED", foId);
  }
  const timestamp =
    gpsPoint?.timestamp ||
    (coordinates ? existing.locationSourceTime : liveStatusTimestamp(row));
  const employeeKey = normalizeFoKey(row?.fo_user_id || existing.employeeKey || existing.foId || existing.employeeCode);
  const operational = deriveOperationalStatus({
    employeeKey,
    attendance: existing.attendance,
    visits: existing.visits || [],
    live: row,
    logs: existing.logs || [],
    gpsPoint,
  });
  const battery = batteryFromRow(row);
  const actualKm = Number(existing.foSafeKm?.actualTravelKm ?? existing.actualKm ?? 0);
  const payableRouteKm = payableRouteKmForOfficer({
    foId,
    live: row,
    attendance: existing.attendance,
    visits: existing.visits || [],
  });
  const eligibleKm = payableRouteKm.km;
  const travelMode = currentTravelModeFromRows({
    live: row,
    attendance: existing.attendance,
    officer: existing,
  });
  const ratePerKm = travelModeRatePerKm(
    travelMode,
    row?.rate_per_km ?? existing.attendance?.rate_per_km ?? existing.ratePerKm,
  );
  const petrolAmount = existing.petrolAmountPending
    ? null
    : numberOrNull(existing.petrolAmount) ??
      calculatePetrolAmount(eligibleKm, ratePerKm);
  const reviewFlags = reviewFlagsForOfficer({
    systemKm: eligibleKm,
    attendance: existing.attendance,
    visits: existing.visits || [],
    logs: existing.logs || [],
  });
  const employeeCode = firstNonEmptyText(
    existing.employeeCode,
    existing.attendance?.employee_code,
    existing.attendance?.fo_user_id,
    row?.fo_user_id,
    foId,
  );
  const baseOfficer = {
    ...existing,
    id: existing.id || `live-${foId}`,
    employeeKey,
    foId,
    name: existing.name || employeeCode,
    employeeCode,
    status: operational.operationalStatus,
    ...operational,
    assignedSite: existing.assignedSite || "No active store visit",
    branch: row?.state || existing.state || "--",
    state: row?.state || existing.state || "--",
    lastSeen: formatDateTime(timestamp),
    battery: battery ?? existing.battery ?? null,
    action: row?.current_status || existing.action || "Attendance captured",
    coordinates,
    heading: gpsPoint?.heading ?? existing.heading ?? null,
    speed: gpsPoint?.speed ?? existing.speed ?? null,
    accuracy: gpsPoint?.accuracy ?? existing.accuracy ?? null,
    actualKm,
    rawGpsKm: existing.rawGpsKm ?? Number(existing.foSafeKm?.rawGpsKm || 0),
    filteredGpsKm: existing.filteredGpsKm ?? Number(existing.foSafeKm?.filteredGpsKm || 0),
    actualTravelKm: existing.actualTravelKm ?? Number(existing.foSafeKm?.actualTravelKm || actualKm || 0),
    eligibleKm,
    routeKmToday: eligibleKm,
    routeKmSource: payableRouteKm.source,
    travelMode,
    travelModeLabel: travelModeLabel(travelMode),
    ratePerKm,
    petrolAmount,
    petrolAmountPending: existing.petrolAmountPending === true,
    reviewFlags,
    foSafeKm: existing.foSafeKm || emptyFoSafeKmMetrics(actualKm),
    foLatitude: coordinates?.[0] ?? null,
    foLongitude: coordinates?.[1] ?? null,
    locationSourceTime: timestamp,
    locationSource: gpsPoint?.source ?? existing.locationSource ?? null,
    hasLiveStatus: true,
    tasks: existing.tasks || [],
    visits: existing.visits || [],
    logs: existing.logs || [],
    conveyance: null,
  };
  const enrichedOfficer = enrichOfficer({
    officer: baseOfficer,
    attendance: existing.attendance,
    visits: existing.visits || [],
    live: row,
    profilesByCode,
  });
  if (import.meta.env.DEV) {
    console.debug("FO_REALTIME_OFFICER_ENRICHED", {
      employeeCode: enrichedOfficer.employeeCode || enrichedOfficer.foId,
      sourceUsed: enrichedOfficer.sourceUsed,
      displayNameSource: enrichedOfficer.displayNameSource,
      locationSource: enrichedOfficer.locationSource,
      kmSource: enrichedOfficer.kmSource,
    });
  }
  return enrichedOfficer;
}

function mergeRealtimeOfficer(officers, liveRow, profileRows, currentUser) {
  const profilesByCode = profileByEmployeeCode(profileRows);
  const liveFoId = normalizeFoKey(liveRow?.fo_user_id);
  const profile = profilesByCode.get(liveFoId);
  if (!profile) return officers;
  if (!isOperationsCommandVisibleRecord(profile, currentUser)) return officers;
  const foId = normalizeFoKey(
    profile?.employee_code || profile?.username || profile?.id,
  );
  const existingIndex = officers.findIndex(
    (officer) =>
      normalizeFoKey(officer.foId) === foId ||
      normalizeFoKey(officer.employeeCode) === foId ||
      profileKeys(profile).includes(normalizeFoKey(officer.foId)) ||
      profileKeys(profile).includes(normalizeFoKey(officer.employeeCode)),
  );
  const existing = existingIndex >= 0 ? officers[existingIndex] : {};
  const nextOfficer = officerFromLiveStatus(
    { ...liveRow, fo_user_id: foId },
    profilesByCode,
    existing,
  );
  if (!nextOfficer) return officers;
  if (existingIndex < 0) return officers;
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

function FleetKpi({ label, value, icon, tone = "blue", hint, loading = false, error = false }) {
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
    <div className="flex min-h-[116px] rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_10px_26px_rgba(15,23,42,0.06)] transition hover:border-qpms-200 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="whitespace-normal text-[11px] font-semibold leading-tight text-slate-600 dark:text-slate-400">
            {label}
          </p>
          <div className="mt-2 flex items-end gap-2">
            <p className="break-words text-2xl font-black leading-none tracking-normal text-slate-950 dark:text-white">
              {loading ? <span className="inline-block h-6 w-20 animate-pulse rounded bg-slate-200" aria-label={`${label} loading`} /> : value}
            </p>
            {hint ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {hint}
              </span>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-[10px] font-bold text-rose-600">Unable to load filtered total</p>
          ) : null}
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

function operationsAvatarTone(officer) {
  return isOperationallyActive(officer)
    ? {
        ring: "ring-emerald-500/90",
        bg: "bg-emerald-500",
        soft: "bg-emerald-50 text-emerald-700",
      }
    : {
        ring: "ring-slate-300",
        bg: "bg-slate-400",
        soft: "bg-slate-100 text-slate-600",
      };
}

function OperationsAvatar({ officer, size = "h-10 w-10", iconSize = "h-5 w-5" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = firstNonEmptyText(
    officer?.avatarUrl,
    officer?.profileImageUrl,
    officer?.profile_image_url,
    officer?.metadata?.profile_image_url,
  );
  const showImage = Boolean(imageUrl) && !imageFailed;
  const tone = operationsAvatarTone(officer);
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full text-white shadow-sm ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ${tone.ring} ${tone.bg}`}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Bike className={iconSize} />
      )}
    </span>
  );
}

function OfficerDirectoryRow({ officer, selected, onSelect }) {
  const distanceToday = Number(
    officer.eligibleKm ?? officer.routeKmToday ?? 0,
  );
  const hasReviewWarning =
    Boolean(officer.reviewFlags?.length) || officer.foSafeKm?.reviewRequired;
  const statusStyles =
    isOperationallyActive(officer)
      ? { chip: "bg-emerald-50 text-emerald-700" }
      : { chip: "bg-slate-100 text-slate-600" };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring m-0.5 w-[calc(100%-4px)] rounded-xl border px-3.5 py-3 text-left transition hover:border-qpms-200 hover:bg-qpms-50/40 dark:hover:bg-slate-800/70 ${
        selected
          ? "border-qpms-300 bg-qpms-50/80 shadow-sm dark:border-qpms-700 dark:bg-qpms-500/10"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      }`}
    >
      <div className="flex items-start gap-3">
        <OperationsAvatar officer={officer} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950 dark:text-white">
                {officer.name}
              </p>
              <p className="truncate text-[11px] font-semibold text-slate-500">
                {officer.employeeCode || officer.foId}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-black ${statusStyles.chip}`}
            >
              {operationalStatusLabel(officer.operationalStatus)}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
            {officer.designation || officer.role || "Field Operations"} -{" "}
            {officer.state || "--"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">
                Payable KM
              </span>
              <strong className="mt-0.5 block text-xs text-emerald-700">
                {formatDisplayKm(distanceToday)}
              </strong>
            </div>
            <div>
              <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">
                Petrol Amount
              </span>
              <strong className="mt-0.5 block text-xs text-slate-900 dark:text-white">
                {officerPetrolDisplay(officer, distanceToday)}
              </strong>
            </div>
          </div>
          <p className="mt-2 truncate text-[10px] font-bold text-slate-500">
            Travel Mode: {officer.travelModeLabel || travelModeLabel(officer.travelMode)}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
            <span className="truncate">
              <Clock className="mr-1 inline h-3 w-3" />
              {officer.isProfileOnly ? "Not started" : officer.lastSeen || "--"}
            </span>
            {hasReviewWarning ? (
              <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 font-black text-amber-700">
                Review
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function ExecutiveOfficerPanel({
  officer,
  onDetailedView,
  onClose,
  siteVisitCount,
}) {
  if (!officer) return null;
  const routeKm = Number(officer.eligibleKm ?? officer.routeKmToday ?? 0);
  const ratePerKm = travelModeRatePerKm(officer.travelMode, officer.ratePerKm);
  const petrolAmount = officer.petrolAmountPending
    ? null
    : numberOrNull(officer.petrolAmount) ??
      calculatePetrolAmount(routeKm, ratePerKm);
  const status = officerStatus(officer);
  const activeVisit = (officer.visits || []).find(isSiteVisitOpen);
  const coordinates = normalizeCoordinates(officer.coordinates);
  const hasReviewWarning =
    Boolean(officer.reviewFlags?.length) || officer.foSafeKm?.reviewRequired;
  const statusClass =
    isOperationallyActive(officer)
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-600";

  return (
    <div className="border-b border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 gap-3">
            <OperationsAvatar officer={officer} size="h-9 w-9" iconSize="h-4 w-4" />
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-black text-slate-950 dark:text-white">
                {officer.name}
              </h2>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${statusClass}`}>
                {status.label}
              </span>
              {hasReviewWarning ? (
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                  Review
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              {officer.employeeCode || officer.foId || "--"}
            </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-xs font-black text-slate-500 hover:text-rose-600 dark:border-slate-700"
            aria-label="Close selected employee"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="space-y-2 text-xs font-semibold">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Last update</span>
              <strong className="text-right text-slate-800 dark:text-slate-100">
                {officer.lastSeen || "--"}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Location</span>
              <strong className="text-right text-slate-800 dark:text-slate-100">
                {coordinates
                  ? `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`
                  : "No Location Available"}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Role</span>
              <strong className="text-right text-slate-800 dark:text-slate-100">
                {officer.designation || officer.role || "--"}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Business / State</span>
              <strong className="text-right text-slate-800 dark:text-slate-100">
                {officer.business || "--"} / {officer.state || "--"}
              </strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Travel Mode</span>
              <strong className="text-right text-slate-800 dark:text-slate-100">
                {officer.travelModeLabel || travelModeLabel(officer.travelMode)}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-50 p-2 text-center">
              <span className="block text-[9px] font-bold uppercase text-emerald-600">
                Payable KM
              </span>
              <strong className="mt-1 block text-sm text-emerald-800">
                {Number.isFinite(routeKm) ? `${routeKm.toFixed(1)} km` : "--"}
              </strong>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-center">
              <span className="block text-[9px] font-bold uppercase text-amber-600">
                Petrol
              </span>
              <strong className="mt-1 block text-sm text-amber-900">
                {officer.petrolAmountPending
                  ? "Pending"
                  : formatCurrency(petrolAmount)}
              </strong>
            </div>
            <div className="rounded-lg bg-violet-50 p-2 text-center">
              <span className="block text-[9px] font-bold uppercase text-violet-600">
                Sites
              </span>
              <strong className="mt-1 block text-sm text-violet-900">
                {siteVisitCount ?? officer.visits?.length ?? 0}
              </strong>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold dark:bg-slate-900">
            <span className="text-slate-500">Active site</span>
            <strong className="ml-2 text-slate-900 dark:text-white">
              {activeVisit ? visitTitle(activeVisit) : "None"}
            </strong>
          </div>

          <button
            type="button"
            onClick={onDetailedView}
            className="focus-ring w-full rounded-lg bg-qpms-700 px-4 py-2.5 text-sm font-black text-white hover:bg-qpms-800"
          >
            Detailed View
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectedOfficerSummary({
  officer,
  onClose,
  onRecalculateKm,
  recalculatingKm = false,
  recalculationResult = null,
  roadKmEstimate,
  foSafeKm,
  siteVisitCount,
}) {
  if (!officer) return null;
  const status = officerStatus(officer);
  const battery = batteryState(officer);
  const kmMetrics = foSafeKm || officer.foSafeKm || emptyFoSafeKmMetrics(0);
  const routeKm = Number(officer.eligibleKm ?? officer.routeKmToday ?? 0);
  const actualTravelKm = Number(
    officer.actualTravelKm ?? kmMetrics.actualTravelKm ?? officer.actualKm ?? 0,
  );
  const filteredGpsKm = Number(officer.filteredGpsKm ?? kmMetrics.filteredGpsKm ?? 0);
  const routeVsActualDelta = routeKm - actualTravelKm;
  const claimKm = routeKm;
  const hasClaimKm = Number.isFinite(claimKm);
  const reviewFlags = officer.reviewFlags || [];
  const gpsFallbackReview = gpsFallbackReviewFromAttendance(officer.attendance);
  const workingMinutes = attendanceWorkingMinutes(officer.attendance || {});
  const roadKmLabel = roadKmEstimate
    ? `${Number(roadKmEstimate.roadKm || 0).toFixed(1)} km reference only${
        roadKmEstimate.usedFallback ? " fallback" : ""
      }`
    : "--";
  const claimKmLabel = hasClaimKm ? formatDisplayKm(claimKm) : "--";
  const ratePerKm = travelModeRatePerKm(officer.travelMode, officer.ratePerKm);
  const claimPetrol = officer.petrolAmountPending
    ? null
    : numberOrNull(officer.petrolAmount) ??
      calculatePetrolAmount(claimKm, ratePerKm);
  const statusText = status.label;
  const statusClass = isOperationallyActive(officer)
    ? "bg-emerald-50 text-emerald-700"
    : "bg-slate-100 text-slate-600";

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
        <span>Accuracy</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {officer.accuracy === null || officer.accuracy === undefined
            ? "--"
            : `${Number(officer.accuracy).toFixed(1)} m`}
        </strong>
        <span>Latest Lat/Lng</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {hasFiniteCoordinates(officer.coordinates)
            ? `${Number(officer.coordinates[0]).toFixed(5)}, ${Number(officer.coordinates[1]).toFixed(5)}`
            : "No Location Available"}
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
            Payable KM
          </p>
          <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">
            {routeKm.toFixed(1)} km
          </p>
          {routeKm <= 0 && gpsFallbackReview.reviewRequired ? (
            <p className="mt-1 text-[11px] font-bold text-amber-700">
              Needs Review
              {gpsFallbackReview.fallbackKm ? `: ${gpsFallbackReview.fallbackKm.toFixed(1)} km GPS evidence` : ""}
            </p>
          ) : null}
        </div>
        <span className="rounded-xl bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Route className="h-4 w-4" />
        </span>
      </div>
      <button
        type="button"
        onClick={onRecalculateKm}
        disabled={recalculatingKm}
        className="focus-ring mt-3 w-full rounded-lg border border-qpms-200 bg-white px-3 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"
      >
        {recalculatingKm ? "Recalculating KM..." : "Recalculate KM"}
      </button>
      {recalculationResult?.ok === true ? (
        <p className="mt-2 text-[11px] font-semibold text-slate-500">
          KM recalculation completed. Refreshing payable values.
        </p>
      ) : null}
      {recalculationResult?.ok === false && recalculationResult?.message ? (
        <p className="mt-2 text-[11px] font-semibold text-amber-700">
          {recalculationResult.message}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-white/70 p-3 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
        <span>Travel Mode</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {officer.travelModeLabel || travelModeLabel(officer.travelMode)}
        </strong>
        <span>Petrol Amount</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {formatInr(claimPetrol)}
        </strong>
        <span>Sites Visited</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {siteVisitCount ?? officer.visits?.length ?? 0}
        </strong>
        <span>Working Hours</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {durationMinutesLabel(workingMinutes)}
        </strong>
        <span>Attendance Status</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {officer.attendance?.status || status.label || "--"}
        </strong>
      </div>
      <details className="mt-3 rounded-xl border border-slate-100 bg-white/60 p-3 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
        <summary className="cursor-pointer select-none text-xs font-black text-slate-700 dark:text-slate-200">
          GPS Audit Details
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
        <span>Raw GPS KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {Number(kmMetrics.rawGpsKm || 0).toFixed(1)} km
        </strong>
        <span>Filtered GPS KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {filteredGpsKm.toFixed(1)} km
        </strong>
        <span>GPS Audit KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {actualTravelKm.toFixed(1)} km
        </strong>
        <span>Payable vs GPS Delta</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {routeVsActualDelta.toFixed(1)} km
        </strong>
        <span>Payable KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {claimKmLabel}
        </strong>
        <span>Petrol Amount</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {formatInr(claimPetrol)}
        </strong>
        <span>GPS Audit Confidence</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {["HIGH", "MEDIUM", "LOW"].includes(String(kmMetrics.kmConfidence || "").toUpperCase())
            ? kmMetrics.kmConfidence
            : "Needs Review"}
        </strong>
        <span>Review Required</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {reviewFlags.length || kmMetrics.reviewRequired ? "Yes" : "No"}
        </strong>
        <span>Review Flags</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {reviewFlags.length ? reviewFlags.join(", ") : "--"}
        </strong>
        <span>GPS Logs Count</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {Number(kmMetrics.gpsLogsCount || 0)}
        </strong>
        <span>Max GPS Gap</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {formatDurationSeconds(kmMetrics.maxGapSeconds)}
        </strong>
        <span>Adjustment Applied</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {kmMetrics.adjustmentApplied || "--"}
        </strong>
        <span>Road Estimate</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {roadKmLabel}
        </strong>
        <span>Road KM Source</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {roadKmEstimate
            ? `${roadKmEstimate.status === "google" ? "Google" : roadKmEstimate.status} / ${roadKmEstimate.anchorCount || 0} anchors`
            : "--"}
        </strong>
        <span>Petrol</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {formatInr(officer.petrolAmount || 0)}
        </strong>
        </div>
      </details>
    </div>
  );
}

function flattenRouteLinePoints(routeLines = []) {
  return routeLines
    .flatMap((route) => route.positions || [])
    .map(normalizeCoordinates)
    .filter(Boolean);
}

function MapViewport({ pins, sitePins, routeLines, expanded, command }) {
  const map = useMap();
  const didInitialFitRef = useRef(false);
  const mountedRef = useRef(true);
  const safelyUseMap = useCallback((callback) => {
    if (!mountedRef.current) return false;
    try {
      const container = map.getContainer();
      if (!container?.isConnected || !map._loaded) return false;
      callback(map);
      return true;
    } catch {
      return false;
    }
  }, [map]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => safelyUseMap((activeMap) => activeMap.invalidateSize()), 80);
    return () => window.clearTimeout(timer);
  }, [expanded, safelyUseMap]);

  useEffect(() => {
    const container = map.getContainer();
    const parent = container.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return undefined;
    let animationFrame = null;
    const observer = new ResizeObserver(() => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        safelyUseMap((activeMap) => activeMap.invalidateSize());
      });
    });
    observer.observe(parent);
    return () => {
      observer.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [map, safelyUseMap]);

  useEffect(() => {
    const validPinPoints = pins
      .map((pin) => normalizeCoordinates(pin.coordinates))
      .filter(Boolean);
    const validSitePoints = sitePins
      .map((site) => normalizeCoordinates(site.coordinates))
      .filter(Boolean);

    if (!validPinPoints.length && !didInitialFitRef.current) {
      safelyUseMap((activeMap) => activeMap.setView(SOUTH_INDIA_CENTER, 6));
      didInitialFitRef.current = true;
      return;
    }

    if (!command && !didInitialFitRef.current && validPinPoints.length) {
      safelyUseMap((activeMap) => activeMap.fitBounds(
        validPinPoints,
        { padding: [44, 44], maxZoom: 13 },
      ));
      didInitialFitRef.current = true;
      return;
    }

    if (!command) return;

    if (command.type === "current-location") {
      const coordinates = normalizeCoordinates(command.coordinates);
      if (!coordinates) {
        warnSkippedInvalidCoordinate({
          employeeCode: command.employeeCode,
          source: command.source || "current-location",
          lat: command.coordinates?.[0],
          lng: command.coordinates?.[1],
        });
        return;
      }
      safelyUseMap((activeMap) => activeMap.flyTo(coordinates, 15, { duration: 0.55 }));
      return;
    }

    if (command.type === "fit-route") {
      const routePoints = flattenRouteLinePoints(routeLines);
      const points = [...routePoints, ...validSitePoints];
      if (points.length === 1) {
        safelyUseMap((activeMap) => activeMap.flyTo(points[0], 14, { duration: 0.45 }));
      } else if (points.length > 1) {
        safelyUseMap((activeMap) => activeMap.fitBounds(points, { padding: [56, 56], maxZoom: 15 }));
      } else {
        console.warn("[Operations Map] Fit Route skipped: no valid coordinates");
      }
      return;
    }

    if (command.type === "fit-all") {
      if (validPinPoints.length === 1) {
        safelyUseMap((activeMap) => activeMap.flyTo(validPinPoints[0], 13, { duration: 0.45 }));
      } else if (validPinPoints.length > 1) {
        safelyUseMap((activeMap) => activeMap.fitBounds(
          validPinPoints,
          { padding: [44, 44], maxZoom: 13 },
        ));
      } else {
        console.warn("[Operations Map] Fit All skipped: no valid coordinates");
      }
    }
  }, [command, pins, routeLines, safelyUseMap, sitePins]);

  return null;
}

function MapBackgroundClose({ onClose }) {
  useMapEvents({
    click: () => onClose?.(),
  });
  return null;
}

function MapEmployeePopupRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <strong className="max-w-[150px] text-right font-bold text-slate-800">
        {value || "--"}
      </strong>
    </div>
  );
}

function MapEmployeePopupCard({ officer }) {
  const activeVisit = (officer.visits || []).find(isSiteVisitOpen);
  const batteryLabel =
    officer.battery === null || officer.battery === undefined
      ? "--"
      : `${officer.battery}%`;
  const statusLabel =
    officer.operationalStatusLabel ||
    operationalStatusLabel(officer.operationalStatus);
  const roleLabel = officer.designation || officer.role || "--";

  return (
    <div className="border-b border-slate-100 pb-2 text-xs last:border-b-0">
      <div className="mb-2">
        <p className="text-sm font-black text-slate-950">
          {officer.name || "--"}
        </p>
        <p className="font-bold text-slate-500">
          {officer.employeeCode || officer.foId || "--"}
        </p>
      </div>
      <div className="space-y-1.5">
        <MapEmployeePopupRow label="State" value={officer.state} />
        <MapEmployeePopupRow label="Role" value={roleLabel} />
        <MapEmployeePopupRow label="Business" value={officer.business} />
        <MapEmployeePopupRow label="Battery" value={batteryLabel} />
        <MapEmployeePopupRow label="Status" value={statusLabel} />
        <MapEmployeePopupRow label="Last Seen" value={officer.lastSeen} />
      </div>
      <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
        <p className="text-[10px] font-black uppercase text-slate-400">
          Active Site
        </p>
        {activeVisit ? (
          <div className="mt-1 space-y-1 text-slate-600">
            <p>
              Site:{" "}
              <strong className="text-slate-800">
                {visitTitle(activeVisit)}
              </strong>
            </p>
            <p>
              Client:{" "}
              <strong className="text-slate-800">
                {visitClient(activeVisit)}
              </strong>
            </p>
            <p>
              Check-in:{" "}
              <strong className="text-slate-800">
                {formatDateTime(activeVisit.check_in_time)}
              </strong>
            </p>
          </div>
        ) : (
          <p className="mt-1 font-bold text-slate-600">None</p>
        )}
      </div>
    </div>
  );
}

function OperationsMap({
  pins,
  sitePins,
  routeLines,
  routeTrailMessage,
  expanded,
  showSites,
  showRoutes,
  mapTheme,
  command,
  onSelectOfficer,
  onCloseSelection,
}) {
  // TODO: optional Google Maps provider switch using Google Maps JS API key
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
  const safePins = useMemo(
    () =>
      pins.flatMap((pin) => {
        const coordinates = normalizeCoordinates(pin.coordinates);
        if (!coordinates) {
          warnSkippedInvalidCoordinate({
            employeeCode:
              pin.officers?.[0]?.employeeCode || pin.officers?.[0]?.foId,
            source: "officer_marker",
            lat: pin.coordinates?.[0],
            lng: pin.coordinates?.[1],
          });
          return [];
        }
        return [{ ...pin, coordinates }];
      }),
    [pins],
  );
  const safeSitePins = useMemo(
    () =>
      sitePins.flatMap((site) => {
        const coordinates = normalizeCoordinates(site.coordinates);
        if (!coordinates) {
          warnSkippedInvalidCoordinate({
            employeeCode: site.foId,
            source: "site_marker",
            lat: site.coordinates?.[0],
            lng: site.coordinates?.[1],
          });
          return [];
        }
        return [{ ...site, coordinates }];
      }),
    [sitePins],
  );
  const safeRouteLines = useMemo(
    () =>
      routeLines.flatMap((route) => {
        const positions = (route.positions || [])
          .map((position) => {
            const coordinates = normalizeCoordinates(position);
            if (!coordinates) {
              warnSkippedInvalidCoordinate({
                employeeCode: route.employeeCode,
                source: route.source || "route_trail",
                lat: position?.[0],
                lng: position?.[1],
              });
            }
            return coordinates;
          })
          .filter(Boolean);
        return positions.length >= 2 ? [{ ...route, positions }] : [];
      }),
    [routeLines],
  );
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
      <MapViewport
        pins={safePins}
        sitePins={safeSitePins}
        routeLines={safeRouteLines}
        expanded={expanded}
        command={command}
      />
      <MapBackgroundClose onClose={onCloseSelection} />
      {showRoutes
        ? safeRouteLines.map((route) => (
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
      {showRoutes && routeTrailMessage ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[500] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-bold text-amber-800 shadow-sm">
          {routeTrailMessage}
        </div>
      ) : null}
      {showSites
        ? safeSitePins.map((site) => (
            <Marker
              key={site.id}
              position={site.coordinates}
              icon={siteMarkerIcon()}
            >
              <Popup>
                <div className="min-w-[240px] space-y-1 text-xs text-slate-700">
                  <p className="text-sm font-bold text-slate-950">
                    Site: {site.siteName}
                  </p>
                  <p>Client: {site.clientName}</p>
                  <p>Store Code: {site.storeCode}</p>
                  <p>FO: {site.foName}</p>
                  <p>Employee ID: {site.foId}</p>
                  <p>Check-In: {site.checkIn}</p>
                  <p>Check-Out: {site.checkOut}</p>
                  <p>Duration: {site.duration}</p>
                  <p>Status: {site.status}</p>
                </div>
              </Popup>
            </Marker>
          ))
        : null}
      {safePins.map((pin) => (
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
            <div className="min-w-[240px] space-y-2 text-slate-700">
              <p className="text-sm font-bold text-slate-950">
                {pin.state.state}
              </p>
              {pin.officers.map((officer) => (
                <MapEmployeePopupCard key={officer.id} officer={officer} />
              ))}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function validReportPoint(log) {
  return isValidRoutePoint(log);
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
  const metadata =
    attendance?.metadata &&
    typeof attendance.metadata === "object" &&
    !Array.isArray(attendance.metadata)
      ? attendance.metadata
      : {};
  const lat = numberOrNull(
    attendance?.start_latitude ??
      attendance?.start_lat ??
      attendance?.login_latitude ??
      attendance?.login_lat ??
      attendance?.start_location_latitude ??
      metadata.start_latitude ??
      metadata.start_lat ??
      metadata.login_latitude ??
      metadata.login_lat ??
      metadata.start_location_latitude,
  );
  const lng = numberOrNull(
    attendance?.start_longitude ??
      attendance?.start_lng ??
      attendance?.login_longitude ??
      attendance?.login_lng ??
      attendance?.start_location_longitude ??
      metadata.start_longitude ??
      metadata.start_lng ??
      metadata.login_longitude ??
      metadata.login_lng ??
      metadata.start_location_longitude,
  );
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
  const distance = routeKmFromLogs(windowLogs);
  return distance > 0 ? distance : null;
}

function appendSheet(workbook, name, rows, headers) {
  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [], {
    header: headers,
    skipHeader: false,
  });
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

function dateInputValue(value) {
  if (!value) return toDateInputValue(new Date());
  if (typeof value === "string") {
    return value.includes("T") ? toDateInputValue(new Date(value)) : value.slice(0, 10);
  }
  return toDateInputValue(value);
}

function dateInputsBetween(from, to) {
  const fromDate = dateInputValue(from);
  const toDate = dateInputValue(to);
  const dates = [];
  let cursor = indiaDateFromInput(fromDate);
  const end = indiaDateFromInput(toDate);
  while (cursor <= end) {
    dates.push(toDateInputValue(cursor));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates.length ? dates : [fromDate];
}

function findOfficerForFoId(officers = [], foId) {
  const normalized = normalizeFoKey(foId);
  if (!normalized) return null;
  return (
    officers.find(
      (officer) =>
        normalizeFoKey(officer.foId || officer.employeeCode) === normalized,
    ) || null
  );
}

function officerForVisitRow(officers = [], row = {}) {
  return findOfficerForFoId(officers, row.fo_user_id || row.employee_code);
}

function attendanceDateLabel(row) {
  return row?.attendance_date || formatDateOnly(row?.login_time);
}

function attendanceDateInput(row = {}) {
  return firstNonEmptyText(row.attendance_date, row.login_time ? dateInputValue(row.login_time) : "");
}

function profileToExportOfficer(profile = {}) {
  const metadata = profileMetadata(profile);
  const employeeCode = firstNonEmptyText(profile.employee_code, profile.username, profile.id);
  return {
    id: normalizeFoKey(employeeCode || profile.id),
    foId: employeeCode,
    employeeCode,
    employeeKey: normalizeFoKey(employeeCode),
    profile,
    name: firstNonEmptyText(profile.display_name, profile.full_name, employeeCode),
    state: profile.state || "--",
    branch: profile.state || "--",
    phone: profile.mobile || profile.phone || "--",
    email: profile.email || "",
    username: profile.username || "",
    role: profile.role || "--",
    designation: profile.designation || "--",
    department: profile.department || "--",
    business: profile.business || "--",
    avatarUrl: firstNonEmptyText(metadata.profile_image_url),
    profileImageUrl: firstNonEmptyText(metadata.profile_image_url),
    profile_image_url: firstNonEmptyText(metadata.profile_image_url),
    operationalStatus: "NOT_STARTED",
    operationalStatusLabel: operationalStatusLabel("NOT_STARTED"),
    eligibleKm: 0,
    routeKmToday: 0,
    petrolAmount: 0,
    visits: [],
    attendances: [],
  };
}

function officerSearchMatches(officer, searchText = "") {
  const normalizedSearch = searchText.trim().toLowerCase();
  if (!normalizedSearch) return true;
  return [
    officer.name,
    officer.employeeCode,
    officer.foId,
    officer.username,
    officer.phone,
    officer.email,
    officer.role,
    officer.designation,
    officer.department,
    officer.state,
    officer.business,
    officer.operationalStatus,
    officer.operationalStatusLabel,
    operationalStatusLabel(officer.operationalStatus),
    officer.assignedSite,
    officer.branch,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedSearch);
}

function exportOfficerMatchesFilters(officer, filters = {}) {
  const stateMatches =
    !filters.state || filters.state === "All States" || officer.state === filters.state;
  const businessMatches =
    !filters.business ||
    filters.business === "All Business" ||
    officer.business === filters.business;
  return stateMatches && businessMatches && officerSearchMatches(officer, filters.search || "");
}

function visitsForEmployeeDate(siteVisitRows = [], employeeKey, dateInput) {
  return siteVisitRows.filter((visit) => {
    const visitEmployeeKey = normalizeFoKey(visit.fo_user_id || visit.employee_code);
    return (
      visitEmployeeKey === employeeKey &&
      dateInputValue(visit.check_in_time) === dateInput
    );
  });
}

function operationalStatusForHistoricalAttendance(attendance, visits = []) {
  if (!attendance) return "NOT_STARTED";
  if (isAttendanceEnded(attendance)) return "ENDED";
  if (visits.some(isSiteVisitOpen)) return "ON_SITE";
  return "ACTIVE_STATIONARY";
}

function exportFilteredOperationsDashboardExcel({
  officers,
  attendanceRows,
  siteVisitRows,
  from,
  to,
  filters,
}) {
  const exportOfficers = (officers || []).filter(
    (officer) => !isHiddenEmployeeRecord(officer),
  );
  const officerIds = new Set(
    exportOfficers
      .map((officer) => normalizeFoKey(officer.foId || officer.employeeCode))
      .filter(Boolean),
  );
  const workbook = XLSX.utils.book_new();

  const exportDates = dateInputsBetween(from, to);
  const attendanceSummaryRows = [];
  exportOfficers.forEach((officer) => {
    const employeeKey = normalizeFoKey(officer.foId || officer.employeeCode);
    exportDates.forEach((dateInput) => {
      const row =
        (attendanceRows || []).find(
          (attendance) =>
            normalizeFoKey(attendance.fo_user_id || attendance.employee_code) === employeeKey &&
            attendanceDateInput(attendance) === dateInput,
        ) || null;
      const dateVisits = visitsForEmployeeDate(siteVisitRows, employeeKey, dateInput);
      const operationalStatus = operationalStatusForHistoricalAttendance(row, dateVisits);
      const exportOfficer = {
        ...officer,
        operationalStatus,
        operationalStatusLabel: operationalStatusLabel(operationalStatus),
      };
      if (!statusFilterMatches(exportOfficer, filters?.status || "All Status")) return;
      const basePayableKm = row ? payableKmFromAttendance(row) : 0;
      const approvedMissingKm = approvedMissingCheckoutAdjustmentKm(dateVisits);
      const finalPayableKm = basePayableKm + approvedMissingKm;
      const lastVisitTime = dateVisits
        .map((visit) => siteVisitCheckoutValue(visit) || visit.check_in_time)
        .filter(Boolean)
        .sort()
        .at(-1);
      const lastLocationTime =
        row?.last_location_time || row?.updated_at || lastVisitTime || row?.logout_time || row?.login_time;
      attendanceSummaryRows.push({
        "Employee Code": officer.employeeCode || row?.employee_code || row?.fo_user_id || "",
        "Employee Name":
          officer.name || row?.full_name || row?.display_name || row?.employee_name || "",
        "Role / Designation": officer.designation || officer.role || row?.designation || "",
        State: officer.state || row?.state || "",
        Business: officer.business || row?.business || "",
        "Attendance Date": row ? attendanceDateLabel(row) : dateInput,
        "Start Day Time / Login Time": formatDateTime(row?.login_time),
        "End Day Time / Logout Time": formatDateTime(row?.logout_time),
        "Current Status": row
          ? operationalStatusLabel(operationalStatus)
          : "Not Started",
        "Total Visits": dateVisits.length,
        "Base Payable KM": basePayableKm.toFixed(2),
        "Approved Missing KM Adjustment": approvedMissingKm.toFixed(2),
        "Final Payable KM": finalPayableKm.toFixed(2),
        "Travel Mode": travelModeLabel(row?.travel_mode || officer.travelMode),
        "Petrol Amount": isCanonicalPetrolPending(row)
          ? "Pending canonical recalculation"
          : Number(petrolAmountFromAttendance(row) || 0).toFixed(2),
        "Last Location Time": formatDateTime(lastLocationTime),
      });
    });
  });
  const filteredAttendanceSummaryRows = attendanceSummaryRows.filter(Boolean);
  const statusFilteredOfficerIds = new Set(
    filteredAttendanceSummaryRows
      .map((row) => normalizeFoKey(row["Employee Code"]))
      .filter(Boolean),
  );
  const detailOfficerIds =
    filters?.status && filters.status !== "All Status"
      ? statusFilteredOfficerIds
      : officerIds;

  const siteVisitDetailRows = (siteVisitRows || [])
    .filter((visit) => detailOfficerIds.has(normalizeFoKey(visit.fo_user_id || visit.employee_code)))
    .map((visit) => {
      const officer = officerForVisitRow(exportOfficers, visit) || {};
      const routeKm = Number(visit.route_km);
      const missingEvidence = missingCheckoutEvidence(visit);
      const finalPayableKm =
        (Number.isFinite(routeKm) && routeKm > 0 ? routeKm : 0) +
        missingEvidence.approvedKm;
      const reviewStatus = checkoutReviewStatus(visit);
      const metadata = visit?.metadata && typeof visit.metadata === "object" && !Array.isArray(visit.metadata)
        ? visit.metadata
        : {};
      return {
        "Employee Code": officer.employeeCode || visit.employee_code || visit.fo_user_id || "",
        "Employee Name":
          officer.name || visit.full_name || visit.display_name || visit.fo_name || "",
        State: officer.state || visit.state || "",
        Business: officer.business || visit.business || "",
        "Store Code": visit.store_code || visit.site_code || "",
        "Store Name / Site Name": visit.store_name || visit.site_name || "",
        "Client Name": visit.client_name || "",
        "Check-In Time": formatDateTime(visit.check_in_time),
        "Check-Out Time": formatDateTime(siteVisitCheckoutValue(visit)),
        "Visit Status": siteVisitStatus(visit),
        "Visit Duration": siteVisitDuration(visit),
        "Route KM / Payable KM": Number.isFinite(routeKm) ? routeKm.toFixed(2) : "",
        "Missing KM Detected": missingCheckoutKmLabel(visit),
        "Approved Missing KM": missingEvidence.approvedKm.toFixed(2),
        "Final Payable KM": finalPayableKm.toFixed(2),
        "Checkout Review Status": reviewStatus.label,
        "Approval Remarks / Approved By": [
          metadata.checkout_review_approval_remarks,
          metadata.checkout_review_approved_by_employee_code,
        ].filter(Boolean).join(" / "),
        "Checkout Note": visit.checkout_note || visit.check_out_note || "",
      };
    });

  const userSummaryRows = exportOfficers
    .filter(
      (officer) =>
        !filters?.status ||
        filters.status === "All Status" ||
        statusFilteredOfficerIds.has(normalizeFoKey(officer.foId || officer.employeeCode)),
    )
    .map((officer) => {
      const foId = normalizeFoKey(officer.foId || officer.employeeCode);
      const officerAttendances = (attendanceRows || []).filter(
        (row) => normalizeFoKey(row.fo_user_id || row.employee_code) === foId,
      );
      const officerVisits = (siteVisitRows || []).filter(
        (visit) => normalizeFoKey(visit.fo_user_id || visit.employee_code) === foId,
      );
      const latestAttendance =
        officerAttendances
          .slice()
          .sort(
            (a, b) =>
              new Date(b.logout_time || b.login_time || 0) -
              new Date(a.logout_time || a.login_time || 0),
          )[0] || null;
      const summaryStatus = operationalStatusForHistoricalAttendance(
        latestAttendance,
        latestAttendance
          ? visitsForEmployeeDate(siteVisitRows, foId, attendanceDateInput(latestAttendance))
          : [],
      );
      const basePayableKm = officerAttendances.reduce(
        (sum, row) => sum + payableKmFromAttendance(row),
        0,
      );
      const approvedMissingKm = approvedMissingCheckoutAdjustmentKm(officerVisits);
      const finalPayableKm = basePayableKm + approvedMissingKm;
      return {
        "Employee Code": officer.employeeCode || officer.foId || "",
        "Employee Name": officer.name || "",
        "Role / Designation": officer.designation || officer.role || "",
        State: officer.state || "",
        Business: officer.business || "",
        "Current Status": operationalStatusLabel(summaryStatus),
        "Attendance Records": officerAttendances.length,
        "Total Visits": officerVisits.length,
        "Base Payable KM": basePayableKm.toFixed(2),
        "Approved Missing KM Adjustment": approvedMissingKm.toFixed(2),
        "Final Payable KM": finalPayableKm.toFixed(2),
        "Travel Mode": officer.travelModeLabel || travelModeLabel(officer.travelMode),
        "Petrol Amount": sumAttendancePetrolAmount(officerAttendances).toFixed(2),
        "Last Location Time": formatDateTime(
          latestAttendance?.last_location_time ||
            latestAttendance?.updated_at ||
            latestAttendance?.logout_time ||
            latestAttendance?.login_time,
        ),
      };
    });

  if (import.meta.env.DEV) {
    console.log("EXPORT FINAL ROW COUNTS", {
      attendanceSummaryRows: filteredAttendanceSummaryRows.length,
      siteVisitRows: siteVisitDetailRows.length,
      userSummaryRows: userSummaryRows.length,
    });
  }

  appendSheet(workbook, "Attendance Summary", filteredAttendanceSummaryRows, [
    "Employee Code",
    "Employee Name",
    "Role / Designation",
    "State",
    "Business",
    "Attendance Date",
    "Start Day Time / Login Time",
    "End Day Time / Logout Time",
    "Current Status",
    "Total Visits",
    "Base Payable KM",
    "Approved Missing KM Adjustment",
    "Final Payable KM",
    "Travel Mode",
    "Petrol Amount",
    "Last Location Time",
  ]);
  appendSheet(workbook, "Site Visit Details", siteVisitDetailRows, [
    "Employee Code",
    "Employee Name",
    "State",
    "Business",
    "Store Code",
    "Store Name / Site Name",
    "Client Name",
    "Check-In Time",
    "Check-Out Time",
    "Visit Status",
    "Visit Duration",
    "Route KM / Payable KM",
    "Missing KM Detected",
    "Approved Missing KM",
    "Final Payable KM",
    "Checkout Review Status",
    "Approval Remarks / Approved By",
    "Checkout Note",
  ]);
  if (userSummaryRows.length) {
    appendSheet(workbook, "User Summary", userSummaryRows, [
      "Employee Code",
      "Employee Name",
      "Role / Designation",
      "State",
      "Business",
      "Current Status",
      "Attendance Records",
      "Total Visits",
      "Base Payable KM",
      "Approved Missing KM Adjustment",
      "Final Payable KM",
      "Travel Mode",
      "Petrol Amount",
      "Last Location Time",
    ]);
  }

  const filterLabel = [
    filters?.state !== "All States" ? filters?.state : "All_States",
    filters?.business !== "All Business" ? filters?.business : "All_Business",
    filters?.status !== "All Status" ? filters?.status : "All_Status",
  ]
    .map(sanitizeReportFilenamePart)
    .filter(Boolean)
    .join("_");

  XLSX.writeFile(
    workbook,
    `Operations_Command_Center_${toDateInputValue(from)}_${toDateInputValue(to)}_${filterLabel || "Filtered"}.xlsx`,
  );
}

async function exportHistoricalOperationsDashboardExcel({
  from,
  to,
  filters,
  currentUser,
}) {
  if (!isSupabaseConfigured || !supabase) return;
  await authSessionManager().requireSession();
  const fromDate = dateInputValue(from);
  const toDate = dateInputValue(to);
  const fromIso = formatDateForDb(startOfIndiaDayFromInput(fromDate));
  const toIso = formatDateForDb(endOfIndiaDayFromInput(toDate));
  const state = filters?.state || "All States";
  const business = filters?.business || "All Business";
  const status = filters?.status || "All Status";
  const searchText = filters?.search || "";

  if (import.meta.env.DEV) {
    console.log("EXPORT FILTERS", {
      fromDate,
      toDate,
      state,
      business,
      status,
      searchText,
    });
  }

  const [profilesRes, attendanceRes, siteVisits] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, display_name, employee_code, username, mobile, email, role, department, designation, business, state, status, is_active, metadata",
      )
      .eq("is_active", true)
      .limit(5000),
    supabase
      .from("fo_attendance")
      .select("*")
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate)
      .order("attendance_date", { ascending: true })
      .limit(20000),
    fetchFoSiteVisitRows(fromIso, toIso),
  ]);
  const errors = [profilesRes, attendanceRes]
    .map((res) => res?.error)
    .filter(Boolean);
  if (errors.length) throw errors[0];

  const profiles = profilesRes.data || [];
  const exportOfficers = profiles
    .filter(
      (profile) =>
        isActiveProfile(profile) &&
        isOperationsCommandVisibleRecord(profile, currentUser) &&
        !isHiddenEmployeeRecord(profile),
    )
    .map(profileToExportOfficer)
    .filter((officer) => exportOfficerMatchesFilters(officer, { state, business, search: searchText }));
  const officerKeys = new Set(
    exportOfficers
      .flatMap((officer) => [
        officer.foId,
        officer.employeeCode,
        officer.username,
        officer.profile?.employee_code,
        officer.profile?.username,
      ])
      .map(normalizeFoKey)
      .filter(Boolean),
  );
  const attendanceRows = (attendanceRes.data || []).filter((row) =>
    recordMatchesOfficerKeys(row, officerKeys),
  );
  const siteVisitRows = (siteVisits || []).filter((visit) =>
    recordMatchesOfficerKeys(visit, officerKeys),
  );

  if (import.meta.env.DEV) {
    console.log("EXPORT FETCH COUNTS", {
      profiles: profiles.length,
      attendance: attendanceRows.length,
      siteVisits: siteVisitRows.length,
    });
  }

  exportFilteredOperationsDashboardExcel({
    officers: exportOfficers,
    attendanceRows,
    siteVisitRows,
    from: startOfIndiaDayFromInput(fromDate),
    to: endOfIndiaDayFromInput(toDate),
    filters: {
      state,
      business,
      status,
      search: searchText,
    },
  });
}

async function _exportFoOperationsExcel({
  officers,
  selectedOfficer,
  from,
  to,
}) {
  if (!isSupabaseConfigured || !supabase) return;
  const exportOfficers = (selectedOfficer ? [selectedOfficer] : officers).filter(
    (officer) => !isHiddenEmployeeRecord(officer),
  );
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
    const exportState = firstNonEmptyText(
      officer.state,
      officer.profile?.state,
      attendance.state,
      attendance.profile?.state,
      visits.find((visit) => firstNonEmptyText(visit?.state))?.state,
      "--",
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
    const logsForDistance = rawLogs.filter(validReportPoint);

    let runningKm = 0;
    logsForDistance.forEach((log, index) => {
      let segmentKm = 0;
      if (index > 0) {
        const previous = logsForDistance[index - 1];
        const segmentMeters = distanceKmBetween(previous, log) * 1000;
        const secondsDiff = (routePointTime(log) - routePointTime(previous)) / 1000;
        const accepted =
          segmentMeters >= MIN_ROUTE_SEGMENT_METERS &&
          segmentMeters <= MAX_ROUTE_SEGMENT_METERS &&
          secondsDiff > 0 &&
          secondsDiff <= MAX_ROUTE_SEGMENT_SECONDS &&
          segmentMeters / secondsDiff <= MAX_ROUTE_SPEED_MPS &&
          !isSameSiteDrift(previous, log, visits);
        if (accepted) {
          segmentKm = segmentMeters / 1000;
          runningKm += segmentKm;
        }
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
        "Check-Out Time": formatDateTime(siteVisitCheckoutValue(visit)),
        "Visit Duration Minutes":
          visit.visit_duration_minutes ??
          minutesBetween(visit.check_in_time, siteVisitCheckoutValue(visit)),
        "Check-In Latitude": checkInPoint?.latitude ?? "",
        "Check-In Longitude": checkInPoint?.longitude ?? "",
        "Check-Out Latitude": checkoutPoint?.latitude ?? "",
        "Check-Out Longitude": checkoutPoint?.longitude ?? "",
        "GPS Accuracy":
          visit.checkin_accuracy ?? visit.current_gps_accuracy ?? "",
        "Distance From Previous Site KM": distanceFromPrevious.toFixed(3),
        "Running KM After Visit": runningVisitKm.toFixed(3),
        "Distance From Start KM": distanceFromStart.toFixed(3),
        "Missing KM Detected": missingCheckoutKmLabel(visit),
        "Approved Missing KM": missingCheckoutEvidence(visit).approvedKm.toFixed(2),
        "Final Payable KM": (
          (Number.isFinite(Number(visit.route_km)) && Number(visit.route_km) > 0
            ? Number(visit.route_km)
            : 0) + missingCheckoutEvidence(visit).approvedKm
        ).toFixed(2),
        "Checkout Review Status": checkoutReviewStatus(visit).label,
        "Approval Remarks / Approved By": [
          visit?.metadata?.checkout_review_approval_remarks,
          visit?.metadata?.checkout_review_approved_by_employee_code,
        ].filter(Boolean).join(" / "),
        "Remarks / Status": visit.status || visit.visit_status || "",
      });
      previousPoint = checkoutPoint || checkInPoint || previousPoint;
      previousVisitTime =
        siteVisitCheckoutValue(visit) || visit.check_in_time || previousVisitTime;
      if (isSiteVisitOpen(visit)) {
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

    const safeKm = actualTravelKmFromAttendanceOrLogs(attendance, rawLogs, visits);
    const calculatedKm = safeKm.actualTravelKm || runningKm;
    const payableRouteKm = payableRouteKmForOfficer({
      foId,
      live,
      attendance,
      visits,
    }).km;
    const basePayableKm = payableRouteKm;
    const approvedMissingKm = approvedMissingCheckoutAdjustmentKm(visits);
    const eligibleKm = basePayableKm + approvedMissingKm;
    const exportTravelMode = currentTravelModeFromRows({ live, attendance, officer });
    const exportRatePerKm = travelModeRatePerKm(
      exportTravelMode,
      live?.rate_per_km ?? attendance?.rate_per_km ?? officer.ratePerKm,
    );
    const petrolAmount = petrolAmountFromAttendance(attendance);
    if (Math.abs(payableRouteKm - calculatedKm) > 2 && calculatedKm > 0) {
      exceptionRows.push({
        "Employee ID": foId,
        "FO Name": foName,
        Type: "Route vs actual travel mismatch",
        Detail: `Route ${payableRouteKm.toFixed(2)} km vs actual travel ${calculatedKm.toFixed(2)} km`,
        Time: "",
      });
    }

    summaryRows.push({
      "Employee ID": foId,
      "FO Name": foName,
      State: exportState,
      Date: `${toDateInputValue(from)} to ${toDateInputValue(to)}`,
      "Start Time": formatDateTime(attendance.login_time),
      "End Time": formatDateTime(attendance.logout_time),
      "Attendance Status": attendance.status || officer.operationalStatusLabel || "",
      "Raw GPS KM": safeKm.rawGpsKm.toFixed(2),
      "Filtered GPS KM": safeKm.filteredGpsKm.toFixed(2),
      "Actual Travel KM": safeKm.actualTravelKm.toFixed(2),
      "Base Payable KM": basePayableKm.toFixed(2),
      "Approved Missing KM Adjustment": approvedMissingKm.toFixed(2),
      "Final Payable KM": eligibleKm.toFixed(2),
      "Route vs Actual KM": (eligibleKm - safeKm.actualTravelKm).toFixed(2),
      "Claim KM": eligibleKm.toFixed(2),
      "Travel Mode": travelModeLabel(exportTravelMode),
      "Rate Per KM": exportRatePerKm,
      "Petrol Amount": petrolAmount === null
        ? "Pending canonical recalculation"
        : petrolAmount.toFixed(2),
      "KM Confidence": safeKm.kmConfidence,
      "Review Required": safeKm.reviewRequired ? "Yes" : "No",
      "GPS Logs Count": safeKm.gpsLogsCount,
      "Logs Per KM": safeKm.logsPerKm.toFixed(2),
      "Average GPS Gap Seconds": safeKm.averageGapSeconds.toFixed(2),
      "Max GPS Gap Seconds": safeKm.maxGapSeconds.toFixed(2),
      "Rejected Points Count": safeKm.rejectedPointsCount,
      "Adjustment Applied": safeKm.adjustmentApplied,
      "Total Sites Visited": visits.length,
      "Total Time on Site": visits.reduce(
        (sum, visit) =>
          sum +
          Number(
            visit.visit_duration_minutes ||
              minutesBetween(visit.check_in_time, siteVisitCheckoutValue(visit)) ||
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
    "State",
    "Date",
    "Start Time",
    "End Time",
    "Attendance Status",
    "Raw GPS KM",
    "Filtered GPS KM",
    "Actual Travel KM",
    "Base Payable KM",
    "Approved Missing KM Adjustment",
    "Final Payable KM",
    "Route vs Actual KM",
    "Claim KM",
    "Travel Mode",
    "Rate Per KM",
    "Petrol Amount",
    "KM Confidence",
    "Review Required",
    "GPS Logs Count",
    "Logs Per KM",
    "Average GPS Gap Seconds",
    "Max GPS Gap Seconds",
    "Rejected Points Count",
    "Adjustment Applied",
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
    "Missing KM Detected",
    "Approved Missing KM",
    "Final Payable KM",
    "Checkout Review Status",
    "Approval Remarks / Approved By",
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

function exportEmployeeRangeExcel(dataset) {
  const rows = buildEmployeeRangeExcelRows(dataset);
  const workbook = XLSX.utils.book_new();
  appendSheet(workbook, "Period Summary", rows.periodSummary);
  appendSheet(workbook, "Daily Attendance", rows.dailyAttendance);
  appendSheet(workbook, "Site Visits", rows.siteVisits);
  appendSheet(workbook, "Travel Claims", rows.travelClaims);
  const employeeCode = sanitizeReportFilenamePart(
    dataset?.employee?.employee_code || "Employee",
  );
  const fromDate = sanitizeReportFilenamePart(dataset?.period?.from_date);
  const toDate = sanitizeReportFilenamePart(dataset?.period?.to_date);
  XLSX.writeFile(
    workbook,
    `${employeeCode}_Field_Activity_KM_Report_${fromDate}_to_${toDate}.xlsx`,
  );
}

function latestRouteSegmentFromLogs(logs = []) {
  const orderedLogs = logs
    .filter(isValidRoutePoint)
    .slice()
    .sort((a, b) => routePointTime(a) - routePointTime(b));
  if (orderedLogs.length < 2) return null;
  const start = orderedLogs[orderedLogs.length - 2];
  const end = orderedLogs[orderedLogs.length - 1];
  return {
    start: [Number(start.latitude), Number(start.longitude)],
    end: [Number(end.latitude), Number(end.longitude)],
  };
}

function displayValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "--";
  return `${value}${suffix}`;
}

function sanitizeReportFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildFieldActivityReportFilename(employee, fromDate, toDate) {
  const employeeCode = sanitizeReportFilenamePart(
    employee?.employee_code ||
      employee?.employeeCode ||
      employee?.fo_user_id ||
      employee?.foId,
  );
  const employeeName = sanitizeReportFilenamePart(
    employee?.full_name ||
      employee?.display_name ||
      employee?.name,
  );
  const identity = [employeeCode, employeeName].filter(Boolean).join("_");
  const reportName = [identity, "Field_Activity_KM_Report"]
    .filter(Boolean)
    .join("_");
  const fromValue = fromDate ? toDateInputValue(new Date(fromDate)) : "";
  const toValue = toDate ? toDateInputValue(new Date(toDate)) : "";
  const dateSuffix =
    fromValue && toValue ? `_${fromValue}_to_${toValue}` : "";
  return `${reportName || "Field_Activity_KM_Report"}${dateSuffix}`;
}

function numberLabel(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(1)}${suffix}`;
}

function moneyLabel(value) {
  return formatCurrency(value);
}

function reportMoneyLabel(value) {
  if (value === null || value === undefined || value === "") return "--";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function reportKilometerLabel(value) {
  if (value === null || value === undefined || value === "") return "--";
  const kilometer = Number(value);
  return Number.isFinite(kilometer) ? `${kilometer.toFixed(2)} km` : "--";
}

function durationMinutesLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value === 0) return "0 min";
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function attendanceWorkingMinutes(attendance) {
  if (!attendance?.login_time || !attendance?.logout_time) return null;
  const minutes = Math.max(
    0,
    Math.round((new Date(attendance.logout_time) - new Date(attendance.login_time)) / 60000),
  );
  return Number.isFinite(minutes) ? minutes : null;
}

function visitMinutes(visit) {
  const explicit = Number(visit?.visit_duration_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const checkOut = siteVisitCheckoutValue(visit);
  if (!visit?.check_in_time || !checkOut) return null;
  const minutes = Math.max(
    0,
    Math.round((new Date(checkOut) - new Date(visit.check_in_time)) / 60000),
  );
  return Number.isFinite(minutes) ? minutes : null;
}

function sortedOfficerVisits(officer) {
  return (officer?.visits || [])
    .slice()
    .sort((a, b) => new Date(a.check_in_time || 0) - new Date(b.check_in_time || 0));
}

function visitTitle(visit) {
  return visit?.store_name || visit?.site_name || visit?.store_code || visit?.site_code || "--";
}

function visitClient(visit) {
  return visit?.client_name || "--";
}

function visitBusinessType(visit) {
  const metadata = visit?.metadata && typeof visit.metadata === "object" && !Array.isArray(visit.metadata)
    ? visit.metadata
    : {};
  return (
    metadata.business ||
    metadata.business_type ||
    metadata.store_business ||
    metadata.client_business ||
    visit?.client_name ||
    "--"
  );
}

function visitRouteSourceLabel(visit) {
  const metadata = visit?.metadata && typeof visit.metadata === "object" && !Array.isArray(visit.metadata)
    ? visit.metadata
    : {};
  const source = String(metadata.distance_source || visit?.distance_source || "").trim().toLowerCase();
  const api = String(metadata.route_api || "").trim().toLowerCase();
  const status = String(metadata.route_request_status || "").trim();
  if (
    metadata.closed_source === "end_day_open_site_auto_close" ||
    String(visit?.status || "").toLowerCase() === "closed by end day" ||
    String(visit?.visit_status || "").toLowerCase() === "closed by end day"
  ) {
    return "Closed by End Day / No payable KM after check-in";
  }
  if (source === "google_distance_matrix" || (source === "google" && api === "distance_matrix")) {
    return "Google Distance Matrix";
  }
  if (source === "unavailable" || metadata.needs_review === true) {
    return status ? `Missing / Needs Review (${status})` : "Missing / Needs Review";
  }
  if (source === "google_directions" || source === "google_directions_recalculation") {
    return "Google Directions";
  }
  if (Number(visit?.route_km) > 0) return "Unknown old data";
  return "Missing / Needs Review";
}

function isAttendanceForDate(attendance, dateInput) {
  if (!attendance || !dateInput) return false;
  if (String(attendance.attendance_date || "").slice(0, 10) === dateInput) return true;
  return isSameIndiaDate(attendance.login_time, dateInput);
}

function isAttendanceActiveForDate(attendance, dateInput) {
  return (
    isAttendanceForDate(attendance, dateInput) &&
    Boolean(attendance?.login_time) &&
    isAttendanceActive(attendance)
  );
}

function latestOpenSiteVisitForDate(visits = [], attendance = null, dateInput = toDateInputValue(new Date())) {
  return visits
    .filter((visit) => isSiteVisitOpen(visit) && isCurrentAttendanceVisit(visit, attendance, dateInput))
    .sort((a, b) => new Date(b.check_in_time || b.created_at || 0) - new Date(a.check_in_time || a.created_at || 0))[0] || null;
}

function isFreshTimestamp(value, freshnessMs = MOVEMENT_FRESHNESS_MS) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= freshnessMs;
}

function textIndicatesMovement(value = "") {
  return /moving|travel|transit|navigation|en\s*route|on\s*route|driv/i.test(String(value || ""));
}

function freshSpeedIndicatesMovement(speed, timestamp) {
  const parsed = Number(speed);
  return Number.isFinite(parsed) && parsed > MOVEMENT_SPEED_THRESHOLD_MPS && isFreshTimestamp(timestamp);
}

function latestLogWithFreshSpeed(logs = []) {
  return [...logs]
    .filter((log) => freshSpeedIndicatesMovement(log?.speed, log?.captured_at || log?.logged_at || log?.created_at))
    .sort((a, b) => routePointTime(b) - routePointTime(a))[0] || null;
}

function hasFreshMovement({ live, logs = [], gpsPoint }) {
  const liveTimestamp = liveStatusTimestamp(live);
  if (textIndicatesMovement(live?.current_status) && isFreshTimestamp(liveTimestamp)) return true;
  if (freshSpeedIndicatesMovement(gpsPoint?.speed, gpsPoint?.timestamp)) return true;
  return Boolean(latestLogWithFreshSpeed(logs));
}

function deriveOperationalStatus({
  employeeKey,
  attendance,
  visits = [],
  live,
  logs = [],
  gpsPoint,
  dateInput = toDateInputValue(new Date()),
}) {
  const todayAttendanceExists = isAttendanceForDate(attendance, dateInput);
  const hasActiveAttendanceToday = isAttendanceActiveForDate(attendance, dateInput);
  const openVisit = hasActiveAttendanceToday
    ? latestOpenSiteVisitForDate(visits, attendance, dateInput)
    : null;
  const hasOpenSiteVisit = Boolean(openVisit);
  const isCurrentlyMoving = hasActiveAttendanceToday && !hasOpenSiteVisit
    ? hasFreshMovement({ live, logs, gpsPoint })
    : false;
  let operationalStatus = "NOT_STARTED";

  if (hasActiveAttendanceToday && hasOpenSiteVisit) {
    operationalStatus = "ON_SITE";
  } else if (hasActiveAttendanceToday && isCurrentlyMoving) {
    operationalStatus = "ON_TRAVEL";
  } else if (hasActiveAttendanceToday) {
    operationalStatus = "ACTIVE_STATIONARY";
  } else if (todayAttendanceExists && isAttendanceEnded(attendance)) {
    operationalStatus = "ENDED";
  }

  return {
    employeeKey,
    hasActiveAttendanceToday,
    hasOpenSiteVisit,
    isCurrentlyMoving,
    openVisit,
    operationalStatus,
    operationalStatusLabel: operationalStatusLabel(operationalStatus),
  };
}

function statusFilterMatches(officer, filter) {
  if (filter === "All Status") return true;
  if (filter === "Active") return isOperationallyActive(officer);
  if (filter === "Offline") return ["NOT_STARTED", "ENDED"].includes(officer?.operationalStatus);
  return officer?.operationalStatus === filter;
}

function visitLocation(visit) {
  const lat = numberOrNull(visit?.check_in_latitude ?? visit?.current_latitude ?? visit?.destination_lat);
  const lng = numberOrNull(visit?.check_in_longitude ?? visit?.current_longitude ?? visit?.destination_lng);
  if (lat !== null && lng !== null) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return visit?.state || "--";
}

function visitCheckInCoordinates(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const latitude = numberOrNull(
    visit?.check_in_latitude ??
      visit?.checkin_latitude ??
      visit?.check_in_lat ??
      visit?.latitude ??
      metadata.check_in_latitude ??
      metadata.checkin_latitude ??
      metadata.check_in_lat ??
      metadata.latitude,
  );
  const longitude = numberOrNull(
    visit?.check_in_longitude ??
      visit?.checkin_longitude ??
      visit?.check_in_lng ??
      visit?.longitude ??
      metadata.check_in_longitude ??
      metadata.checkin_longitude ??
      metadata.check_in_lng ??
      metadata.longitude,
  );
  return isValidLatLng(latitude, longitude)
    ? { latitude, longitude }
    : null;
}

function formatVisitCoordinates(coordinates) {
  if (!coordinates) return "--";
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

function visitGoogleMapsUrl(coordinates) {
  if (!coordinates) return null;
  return `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}`;
}

function visitRemarks(visit) {
  return visit?.checkout_note || visit?.visit_status || visit?.status || "--";
}

function checkoutDistanceFromVisit(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const candidates = [
    metadata.checkout_distance_meters,
    metadata.checkout_distance_from_site_meters,
    metadata.distance_from_site_meters,
    metadata.checkout_distance,
    visit?.checkout_distance_meters,
    visit?.distance_from_site_meters,
  ];
  const value = candidates
    .map(Number)
    .find((candidate) => Number.isFinite(candidate) && candidate >= 0);
  return value ?? null;
}

function checkoutExceptionForVisit(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const checkoutValue = siteVisitCheckoutValue(visit);
  const combinedText = [
    visit?.status,
    visit?.visit_status,
    visit?.checkout_note,
    metadata.closed_source,
    metadata.auto_closed_reason,
    metadata.checkout_exception_type,
    metadata.checkout_reason,
    metadata.warning,
    metadata.checkout_warning,
    metadata.stale_reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const distanceMeters = checkoutDistanceFromVisit(visit);
  const isAutoClosed =
    metadata.auto_closed === true ||
    metadata.stale_auto_closed === true ||
    metadata.checkout_exception_type === "missed_checkout_auto_closed" ||
    metadata.closed_source === "end_day_open_site_auto_close" ||
    /stale|auto[\s_-]*clos|closed by end day/.test(combinedText);
  const isManual =
    metadata.force_checkout === true ||
    metadata.admin_support_source === "backend_force_checkout" ||
    /force[\s_-]*checkout|manual[\s_-]*checkout|admin[\s_-]*checkout/.test(
      combinedText,
    );
  const isFarCheckout =
    metadata.checkout_outside_site === true ||
    metadata.outside_geofence === true ||
    metadata.distance_warning === true ||
    /far from|away from|outside (site|geofence)|distance warning/.test(
      combinedText,
    );
  const needsReview =
    metadata.requires_checkout_review === true ||
    metadata.needs_review === true ||
    /needs review|clarification|required review/.test(combinedText);

  if (!checkoutValue && !isAutoClosed) {
    return {
      type: "missing",
      label: "Checkout Missing",
      tone: "red",
      requiresReview: true,
      distanceMeters,
    };
  }
  if (isFarCheckout) {
    return {
      type: "exception",
      label: "Checkout Exception",
      tone: "amber",
      requiresReview: true,
      distanceMeters,
    };
  }
  if (isManual) {
    return {
      type: "manual",
      label: "Manual Checkout",
      tone: "amber",
      requiresReview: true,
      distanceMeters,
    };
  }
  if (isAutoClosed) {
    return {
      type: "auto",
      label: "Auto Closed",
      tone: "slate",
      requiresReview: true,
      distanceMeters,
    };
  }
  if (needsReview) {
    return {
      type: "review",
      label: "Needs Review",
      tone: "amber",
      requiresReview: true,
      distanceMeters,
    };
  }
  return {
    type: "normal",
    label: "Checked Out",
    tone: "green",
    requiresReview: false,
    distanceMeters,
  };
}

function normalizeRoleKey(role = "") {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

const temporarySwitchAllowedRoles = new Set([
  "admin",
  "developer",
  "qpmsadmin",
  "qpms admin",
  "qpms_admin",
]);

function resolveTemporarySwitchRole(user = {}) {
  const metadata = user?.metadata && typeof user.metadata === "object" ? user.metadata : {};
  const profile = user?.profile && typeof user.profile === "object" ? user.profile : {};
  const userProfile = user?.userProfile && typeof user.userProfile === "object" ? user.userProfile : {};
  const currentUser = user?.currentUser && typeof user.currentUser === "object" ? user.currentUser : {};
  const authUser = user?.authUser && typeof user.authUser === "object" ? user.authUser : {};
  const authMetadata =
    authUser?.user_metadata && typeof authUser.user_metadata === "object"
      ? authUser.user_metadata
      : {};
  const appMetadata =
    authUser?.app_metadata && typeof authUser.app_metadata === "object"
      ? authUser.app_metadata
      : {};
  const candidates = [
    profile.role,
    userProfile.role,
    currentUser.role,
    user.rawRole,
    user.role,
    metadata.role,
    metadata.rawRole,
    metadata.app_role,
    metadata.user_role,
    user.user_metadata?.role,
    user.app_metadata?.role,
    authUser.role,
    authMetadata.role,
    appMetadata.role,
  ];
  for (const value of candidates) {
    const normalizedRole = String(value || "").trim().toLowerCase();
    if (!normalizedRole) continue;
    if (temporarySwitchAllowedRoles.has(normalizedRole)) return normalizedRole;
    const roleKey = normalizeRoleKey(normalizedRole);
    if (temporarySwitchAllowedRoles.has(roleKey)) return roleKey;
  }
  return String(candidates.find(Boolean) || "").trim().toLowerCase();
}

function canReviewCheckoutException(role) {
  const roleKey = normalizeRoleKey(role);
  return [
    "admin",
    "developer",
    "qpms admin",
    "qpmsadmin",
    "operations manager",
    "operation manager",
    "om",
    "branch head",
    "bh",
    "coo",
    "gm",
    "management",
  ].includes(roleKey);
}

function canApproveCheckoutMissingKm(role) {
  const roleKey = normalizeRoleKey(role);
  return ["admin", "developer", "qpms admin", "qpmsadmin"].includes(roleKey);
}

function checkoutReviewStatus(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const value = [
    metadata.checkout_review_status,
    metadata.exception_review_status,
    metadata.review_status,
    visit?.review_status,
  ]
    .find(Boolean);
  const normalized = String(value || "").trim().toLowerCase();
  if (/approv/.test(normalized)) {
    return { label: "Approved", tone: "green" };
  }
  if (/reject/.test(normalized)) {
    return { label: "Rejected", tone: "red" };
  }
  if (/clarif/.test(normalized)) {
    return { label: "Clarification Needed", tone: "blue" };
  }
  return { label: "Pending Review", tone: "amber" };
}

function missingCheckoutEvidence(visit) {
  const metadata =
    visit?.metadata &&
    typeof visit.metadata === "object" &&
    !Array.isArray(visit.metadata)
      ? visit.metadata
      : {};
  const detectedKm = numberOrNull(
    metadata.missing_checkout_km_detected ??
      metadata.missing_km_detected ??
      visit?.missing_checkout_km_detected,
  );
  const approvedKm = numberOrNull(
    metadata.approved_missing_km ??
      metadata.approved_missing_checkout_km ??
      metadata.approved_missing_checkout_adjustment_km ??
      visit?.approved_missing_km,
  );
  const suggestedKm = numberOrNull(
    metadata.suggested_missing_checkout_km ??
      metadata.suggested_missing_checkout_haversine_km,
  );
  const suggestedAmount = numberOrNull(
    metadata.suggested_missing_checkout_amount ??
      (suggestedKm === null ? null : suggestedKm * RATE_PER_KM),
  );
  const approvedAmount = numberOrNull(
    metadata.approved_missing_checkout_amount ??
      metadata.approved_missing_checkout_adjustment_amount ??
      (approvedKm === null ? null : approvedKm * RATE_PER_KM),
  );
  const gpsEvidence =
    metadata.latest_gps_evidence &&
    typeof metadata.latest_gps_evidence === "object" &&
    !Array.isArray(metadata.latest_gps_evidence)
      ? metadata.latest_gps_evidence
      : null;
  const evidenceStatus =
    metadata.latest_gps_evidence_status ||
    metadata.gps_evidence_status ||
    (gpsEvidence ? "fresh" : "");
  const detectedAt =
    gpsEvidence?.detected_at ||
    gpsEvidence?.captured_at ||
    metadata.latest_gps_detected_at ||
    null;
  return {
    detectedKm,
    approvedKm: approvedKm ?? 0,
    approvedAmount: approvedAmount ?? 0,
    suggestedKm,
    suggestedAmount,
    suggestedSource: metadata.suggested_missing_checkout_source || null,
    googleError: metadata.suggested_missing_checkout_google_error || null,
    evidenceStatus,
    detectedAt,
    gpsEvidence,
    hasDetectedKm: detectedKm !== null,
  };
}

function missingCheckoutKmLabel(visit) {
  const evidence = missingCheckoutEvidence(visit);
  if (evidence.suggestedKm !== null) return `${evidence.suggestedKm.toFixed(1)} km`;
  if (evidence.hasDetectedKm) return `${evidence.detectedKm.toFixed(1)} km`;
  return "--";
}

function missingCheckoutEvidenceLabel(visit) {
  const evidence = missingCheckoutEvidence(visit);
  if (evidence.detectedAt) {
    return `Latest GPS: ${formatTime(evidence.detectedAt)}`;
  }
  if (String(evidence.evidenceStatus || "").toLowerCase() === "stale") {
    return "GPS evidence stale";
  }
  return "No fresh GPS evidence";
}

function CheckoutStatusChip({ exception }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black ${tones[exception?.tone] || tones.slate}`}
    >
      {exception?.label || "Needs Review"}
    </span>
  );
}

function CheckoutReviewStatusChip({ status }) {
  const tones = {
    amber: "bg-amber-100 text-amber-800",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-rose-100 text-rose-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black ${tones[status?.tone] || tones.amber}`}
    >
      {status?.label || "Pending Review"}
    </span>
  );
}

function normalizeActivityGroup(value, uploadRole = "") {
  const text = `${value || ""} ${uploadRole || ""}`.toLowerCase();
  if (text.includes("inspect")) return "Inspection";
  if (text.includes("deep") || text.includes("clean")) return "Deep Cleaning";
  if (text.includes("train")) return "Training";
  if (text.includes("doc") || text.includes("pdf") || text.includes("report")) return "Documents";
  return "Others";
}

function activityUploadIsImage(upload) {
  const type = String(upload?.file_type || "").toLowerCase();
  const name = String(upload?.file_name || upload?.file_url || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
}

function activityUploadName(upload) {
  return upload?.file_name || upload?.file_url?.split("/").pop() || "Uploaded file";
}

function activityUploadTime(upload) {
  return upload?.uploaded_at || upload?.created_at || upload?.submitted_at;
}

function filteredActivityUploads(uploads = [], filter = "All") {
  if (filter === "All") return uploads;
  return uploads.filter((upload) => upload.activityGroup === filter);
}

function objectMetadata(row) {
  return row?.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function activityTypeLabel(value) {
  return normalizeActivityGroup(value || "Others");
}

function activityStatusFromRecord(record = {}) {
  const metadata = objectMetadata(record);
  const rawStatus =
    record.review_status ||
    record.status ||
    metadata.review_status ||
    metadata.checkout_review_status ||
    metadata.activity_review_status ||
    "";
  const normalized = String(rawStatus || "").trim().toLowerCase();
  if (metadata.pending_images === true || normalized.includes("missing")) {
    return { label: "Missing More Uploads", tone: "rose" };
  }
  if (normalized.includes("approve")) return { label: "Approved", tone: "green" };
  if (normalized.includes("reject")) return { label: "Rejected", tone: "rose" };
  return { label: "Pending Review", tone: "amber" };
}

function activityModalTypeFromFilter(filter) {
  if (filter === "Inspection") return "inspection";
  if (filter === "Training") return "training";
  if (filter === "Deep Cleaning") return "deepCleaning";
  return "select";
}

function activityModalLabel(type) {
  if (type === "inspection") return "Inspection";
  if (type === "training") return "Training";
  if (type === "deepCleaning") return "Deep Cleaning";
  return "Activity";
}

function activityUploadMetadata(upload = {}) {
  return objectMetadata(upload);
}

function isActivityDocument(upload = {}) {
  const metadata = activityUploadMetadata(upload);
  const role = String(upload.upload_role || "").toLowerCase();
  const type = String(upload.file_type || "").toLowerCase();
  const name = String(upload.file_name || upload.file_url || "").toLowerCase();
  return (
    metadata.training_document === true ||
    metadata.supporting_document === true ||
    role.includes("document") ||
    role.includes("pdf") ||
    type.includes("pdf") ||
    /\.pdf($|\?)/i.test(name)
  );
}

function deepCleaningUploadStage(upload = {}) {
  const metadata = activityUploadMetadata(upload);
  const role = String(upload.upload_role || "").toLowerCase();
  const stage = String(
    metadata.deep_cleaning_stage ||
      metadata.cleaning_stage ||
      metadata.photo_stage ||
      "",
  ).toLowerCase();
  if (stage.includes("before") || role.includes("before")) return "before";
  if (stage.includes("after") || role.includes("after")) return "after";
  if (isActivityDocument(upload)) return "document";
  return "other";
}

function trainingUploadCategory(upload = {}) {
  const metadata = activityUploadMetadata(upload);
  if (isActivityDocument(upload)) return "document";
  return String(metadata.training_category || "training_photo").trim() || "training_photo";
}

function trainingUploadCategoryLabel(upload = {}) {
  const metadata = activityUploadMetadata(upload);
  return String(metadata.training_category_label || "Training Photo").trim();
}

function activityCardInsight(activityGroup, uploads = [], record = {}) {
  const recordMetadata = objectMetadata(record);
  if (activityGroup === "Deep Cleaning") {
    const before = uploads.filter((upload) => deepCleaningUploadStage(upload) === "before");
    const after = uploads.filter((upload) => deepCleaningUploadStage(upload) === "after");
    const documents = uploads.filter((upload) => deepCleaningUploadStage(upload) === "document");
    const missingAfter = before.length > 0 && after.length === 0;
    return {
      before,
      after,
      documents,
      beforeCount: before.length,
      afterCount: after.length,
      documentCount: documents.length,
      statusOverride: missingAfter
        ? { label: "Pending After Images", tone: "rose" }
        : null,
      summary: [
        before.length ? `${before.length} Before` : null,
        after.length ? `${after.length} After` : null,
        documents.length ? "Document" : null,
      ].filter(Boolean),
    };
  }
  if (activityGroup === "Training") {
    const documents = uploads.filter(isActivityDocument);
    const categories = new Map();
    uploads
      .filter((upload) => !isActivityDocument(upload))
      .forEach((upload) => {
        const key = trainingUploadCategory(upload);
        const label = trainingUploadCategoryLabel(upload);
        if (!categories.has(key)) {
          categories.set(key, { key, label, uploads: [] });
        }
        categories.get(key).uploads.push(upload);
      });
    const hkStaff = Array.isArray(recordMetadata.hk_staff_attended)
      ? recordMetadata.hk_staff_attended
      : [];
    const completedFromMetadata = Array.isArray(recordMetadata.training_categories_completed)
      ? recordMetadata.training_categories_completed.length
      : Number(recordMetadata.training_categories_completed_count);
    const completedCount = Number.isFinite(completedFromMetadata)
      ? completedFromMetadata
      : categories.size;
    return {
      documents,
      documentCount: documents.length,
      trainingCategories: Array.from(categories.values()),
      trainingCategoryCount: completedCount,
      hkStaff,
      hkStaffCount: hkStaff.length,
      summary: [
        `${completedCount || 0} Categories`,
        hkStaff.length ? `${hkStaff.length} HK Staff` : null,
        documents.length ? "Document" : null,
      ].filter(Boolean),
    };
  }
  const documents = uploads.filter(isActivityDocument);
  const photos = uploads.filter((upload) => !isActivityDocument(upload));
  return {
    documents,
    documentCount: documents.length,
    photos,
    photoCount: photos.length,
    summary: [
      photos.length ? `${photos.length} Photos` : null,
      documents.length ? "Document" : null,
    ].filter(Boolean),
  };
}

function generatedUserRole(user = {}) {
  return firstNonEmptyText(
    user?.rawRole,
    user?.role,
    user?.profile?.role,
    user?.userProfile?.role,
    user?.currentUser?.role,
    user?.metadata?.role,
    user?.authUser?.user_metadata?.role,
  );
}

function canUseWebActivityUpload(user = {}) {
  const roleKey = normalizeRoleKey(generatedUserRole(user));
  return [
    "admin",
    "qpms admin",
    "qpmsadmin",
    "developer",
    "operations manager",
    "operation manager",
    "om",
    "branch head",
    "bh",
  ].includes(roleKey);
}

function hasTechnicalKmAccess(user = {}) {
  const roleKey = normalizeRoleKey(generatedUserRole(user));
  return [
    "admin",
    "developer",
    "qpms admin",
    "qpmsadmin",
    "it admin",
    "management it admin",
    "md",
  ].includes(roleKey);
}

function uploadedByMetadata(user = {}) {
  return {
    uploaded_from: "web",
    uploaded_by_employee_code: firstNonEmptyText(
      user?.employee_code,
      user?.employeeCode,
      user?.profile?.employee_code,
      user?.userProfile?.employee_code,
      user?.currentUser?.employee_code,
      user?.email,
    ),
    uploaded_by_name: firstNonEmptyText(
      user?.full_name,
      user?.display_name,
      user?.name,
      user?.profile?.full_name,
      user?.userProfile?.full_name,
      user?.email,
    ),
    uploaded_by_role: generatedUserRole(user),
  };
}

function selectedEmployeeCodeForActivity(officer = {}) {
  return firstNonEmptyText(
    officer.employeeCode,
    officer.foId,
    officer.employee_code,
    officer.fo_user_id,
    officer.profile?.employee_code,
    officer.profile?.username,
  );
}

function activityDbTypeForModal(type) {
  if (type === "inspection") return "inspection";
  if (type === "training") return "training";
  if (type === "deepCleaning") return "deep_cleaning";
  return "";
}

function storageSafePart(value, fallback = "file") {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function fileExtensionFromName(name = "", type = "") {
  const ext = String(name).split(".").pop();
  if (ext && ext !== name) return storageSafePart(ext.toLowerCase(), "bin");
  if (String(type).includes("pdf")) return "pdf";
  if (String(type).includes("png")) return "png";
  if (String(type).includes("jpeg") || String(type).includes("jpg")) return "jpg";
  return "bin";
}

function activityUploadRole(type, kind, categoryKey = "") {
  if (type === "inspection") {
    return kind === "document" ? "inspection_document" : "inspection_photo";
  }
  if (type === "training") {
    return kind === "document" ? "training_document" : `training_${categoryKey || "photo"}`;
  }
  if (type === "deepCleaning") {
    if (kind === "before") return "deep_cleaning_before";
    if (kind === "after") return "deep_cleaning_after";
    return "deep_cleaning_document";
  }
  return "activity_upload";
}

async function signedActivityUploadUrl(upload) {
  const fileUrl = upload?.file_url;
  if (!fileUrl) return null;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  if (!supabase?.storage) return null;
  const bucket = upload.storage_bucket || "fo-activity-uploads";
  const path = fileUrl.replace(new RegExp(`^${bucket}/`), "").replace(/^\/+/, "");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error) {
    console.warn("[myQPMS FO] Activity upload signed URL failed.", {
      uploadId: upload.id,
      bucket,
      message: error.message,
    });
    return null;
  }
  return data?.signedUrl || null;
}

function uploadMatchesSelectedContext(upload, { attendanceId, siteVisitIds }) {
  if (attendanceId && upload.attendance_id && String(upload.attendance_id) === String(attendanceId)) {
    return true;
  }
  if (upload.site_visit_id && siteVisitIds.has(String(upload.site_visit_id))) {
    return true;
  }
  return !upload.attendance_id && !upload.site_visit_id;
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("column") ||
    message.includes(String(columnName || "").toLowerCase())
  );
}

async function fetchLocationLogsByColumn({ idColumn, idValue, timeColumn, fromIso, toIso }) {
  const { data, error } = await supabase
    .from("fo_location_logs")
    .select("*")
    .eq(idColumn, idValue)
    .gte(timeColumn, fromIso)
    .lte(timeColumn, toIso)
    .order(timeColumn, { ascending: true })
    .limit(10000);
  if (error) {
    if (isMissingColumnError(error, idColumn) || isMissingColumnError(error, timeColumn)) {
      return [];
    }
    throw error;
  }
  return data || [];
}

function routePointFromVisit(visit, phase = "checkin") {
  const latKeys =
    phase === "checkout"
      ? ["check_out_latitude", "current_latitude", "destination_lat"]
      : ["check_in_latitude", "current_latitude", "destination_lat"];
  const lngKeys =
    phase === "checkout"
      ? ["check_out_longitude", "current_longitude", "destination_lng"]
      : ["check_in_longitude", "current_longitude", "destination_lng"];
  for (const latKey of latKeys) {
    for (const lngKey of lngKeys) {
      const lat = numberOrNull(visit?.[latKey]);
      const lng = numberOrNull(visit?.[lngKey]);
      if (lat !== null && lng !== null) return [lat, lng];
    }
  }
  return null;
}

function detailRouteAnchor(id, type, label, coordinates, title) {
  if (!hasFiniteCoordinates(coordinates)) return null;
  return {
    id,
    type,
    label,
    coordinates,
    title,
  };
}

function routePointFromAttendanceEnd(attendance) {
  const metadata = attendanceMetadata(attendance);
  const lat = numberOrNull(
    attendance?.end_latitude ??
      attendance?.logout_latitude ??
      attendance?.end_lat ??
      attendance?.logout_lat ??
      attendance?.end_location_latitude ??
      metadata.end_latitude ??
      metadata.logout_latitude ??
      metadata.end_lat ??
      metadata.logout_lat ??
      metadata.end_location_latitude,
  );
  const lng = numberOrNull(
    attendance?.end_longitude ??
      attendance?.logout_longitude ??
      attendance?.end_lng ??
      attendance?.logout_lng ??
      attendance?.end_location_longitude ??
      metadata.end_longitude ??
      metadata.logout_longitude ??
      metadata.end_lng ??
      metadata.logout_lng ??
      metadata.end_location_longitude,
  );
  return lat !== null && lng !== null ? [lat, lng] : null;
}

function attendanceEndCoordinates(attendance) {
  const point = routePointFromAttendanceEnd(attendance);
  return point ? { latitude: point[0], longitude: point[1] } : null;
}

function attendanceMetadata(attendance) {
  return attendance?.metadata &&
    typeof attendance.metadata === "object" &&
    !Array.isArray(attendance.metadata)
    ? attendance.metadata
    : {};
}

function finalReturnLegKmFromAttendance(attendance) {
  const metadata = attendanceMetadata(attendance);
  const finalLegs = [
    ...(Array.isArray(attendance?.travel_legs) ? attendance.travel_legs : []),
    ...(Array.isArray(metadata.travel_legs) ? metadata.travel_legs : []),
  ].filter((leg) =>
    leg?.type === "last_checkout_to_end_day" ||
    leg?.leg_type === "last_checkout_to_end_day" ||
    leg?.is_final_return_leg === true,
  );
  const finalLegKm = finalLegs
    .flatMap((leg) => [leg?.calculated_km, leg?.calculatedKm, leg?.km, leg?.payable_km])
    .map(numberOrNull)
    .find((value) => value !== null && value > 0);
  if (finalLegKm !== undefined) return finalLegKm;

  return numberOrNull(
    metadata.final_return_leg_km ??
      metadata.finalReturnLegKm ??
      attendance?.final_return_leg_km,
  );
}

function isStaleAutoEndedAttendance(attendance) {
  const metadata = attendanceMetadata(attendance);
  return (
    /stale\s*auto\s*ended/i.test(String(attendance?.status || "")) ||
    metadata.stale_auto_ended === true ||
    metadata.auto_ended === true
  );
}

function staleAutoEndReviewNote(attendance) {
  if (!isStaleAutoEndedAttendance(attendance)) return null;
  const metadata = attendanceMetadata(attendance);
  if (metadata.stale_auto_end_gps_evidence_status === "found") {
    return "Auto-ended / Requires review - GPS evidence available";
  }
  if (metadata.stale_auto_end_gps_evidence_status === "not_found") {
    return "Auto-ended / Requires review - End GPS missing";
  }
  return "Auto-ended / Requires review";
}

let googleMapsScriptPromise = null;
const snapToRoadsCache = new Map();

function loadGoogleMapsScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps requires a browser."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("Google Maps key is not configured."));
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-myqpms-google-maps='true']");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
    script.async = true;
    script.defer = true;
    script.dataset.myqpmsGoogleMaps = "true";
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(script);
  });
  return googleMapsScriptPromise;
}

function decodeGooglePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const path = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = null;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    path.push([lat / 1e5, lng / 1e5]);
  }
  return path.filter(hasFiniteCoordinates);
}

function createRouteMapCoordinateStats() {
  return {
    routeMapOriginalPointCount: 0,
    routeMapAcceptedOriginalCount: 0,
    routeMapSwappedCorrectionCount: 0,
    routeMapRejectedInvalidCount: 0,
    routeMapRejectedExamples: [],
  };
}

function isSouthIndiaRouteCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ROUTE_MAP_SOUTH_INDIA_BOUNDS.minLat &&
    lat <= ROUTE_MAP_SOUTH_INDIA_BOUNDS.maxLat &&
    lng >= ROUTE_MAP_SOUTH_INDIA_BOUNDS.minLng &&
    lng <= ROUTE_MAP_SOUTH_INDIA_BOUNDS.maxLng
  );
}

function routeMapPointArray(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  if (point && typeof point === "object") {
    return [Number(point.latitude ?? point.lat), Number(point.longitude ?? point.lng)];
  }
  return [Number.NaN, Number.NaN];
}

function normalizeRouteMapCoordinate(point, stats, source = "unknown") {
  if (point === null || point === undefined) return null;
  const [lat, lng] = routeMapPointArray(point);
  stats.routeMapOriginalPointCount += 1;
  if (isSouthIndiaRouteCoordinate(lat, lng)) {
    stats.routeMapAcceptedOriginalCount += 1;
    return [lat, lng];
  }
  if (isSouthIndiaRouteCoordinate(lng, lat)) {
    stats.routeMapSwappedCorrectionCount += 1;
    return [lng, lat];
  }
  stats.routeMapRejectedInvalidCount += 1;
  if (stats.routeMapRejectedExamples.length < 5) {
    stats.routeMapRejectedExamples.push({ source, lat, lng });
  }
  return null;
}

function storedRoutePolylinesFromVisits(visits = [], stats = createRouteMapCoordinateStats()) {
  return visits
    .map((visit) => visit?.google_route_polyline || visit?.metadata?.google_route_polyline)
    .map(decodeGooglePolyline)
    .map((path, pathIndex) =>
      path
        .map((point, pointIndex) =>
          normalizeRouteMapCoordinate(point, stats, `polyline_${pathIndex}_${pointIndex}`),
        )
        .filter(Boolean),
    )
    .filter((path) => path.length > 1);
}

function isValidGpsTrailLog(log) {
  if (!isValidGpsLog(log)) return false;
  const accuracy = Number(log?.accuracy);
  const timestampMs = routePointTime(log).getTime();
  return (
    Number.isFinite(accuracy) &&
    accuracy <= MAX_GPS_ACCURACY_METERS &&
    Number.isFinite(timestampMs)
  );
}

async function fetchLocationLogsByAttendanceId(attendanceId, { fromIso = null, toIso = null } = {}) {
  let query = supabase
    .from("fo_location_logs")
    .select("*")
    .eq("attendance_id", attendanceId)
    .order("captured_at", { ascending: true })
    .limit(10000);
  if (fromIso && toIso) {
    query = query.gte("captured_at", fromIso).lte("captured_at", toIso);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function gpsTrailGapReason(previous, current) {
  const secondsGap = (current.timestampMs - previous.timestampMs) / 1000;
  const distanceKm = distanceKmBetween(
    { latitude: previous.point[0], longitude: previous.point[1] },
    { latitude: current.point[0], longitude: current.point[1] },
  );
  const speedKmph = secondsGap > 0 ? distanceKm / (secondsGap / 3600) : Number.POSITIVE_INFINITY;
  const previousDate = toDateInputValue(new Date(previous.timestampMs));
  const currentDate = toDateInputValue(new Date(current.timestampMs));
  if (previousDate !== currentDate) {
    return { reason: "date_mismatch", secondsGap, distanceKm, speedKmph };
  }
  if (secondsGap <= 0) {
    return { reason: "invalid_time", secondsGap, distanceKm, speedKmph };
  }
  if (secondsGap > ROUTE_MAP_SEGMENT_MAX_GAP_SECONDS) {
    return { reason: "time_gap", secondsGap, distanceKm, speedKmph };
  }
  if (distanceKm > ROUTE_MAP_SEGMENT_MAX_DISTANCE_KM) {
    return { reason: "distance_gap", secondsGap, distanceKm, speedKmph };
  }
  if (speedKmph > ROUTE_MAP_SEGMENT_MAX_SPEED_KMPH) {
    return { reason: "speed_gap", secondsGap, distanceKm, speedKmph };
  }
  return null;
}

function gpsTrailFromLogs(logs = [], stats = createRouteMapCoordinateStats()) {
  const ordered = logs
    .filter(isValidGpsTrailLog)
    .slice()
    .sort((a, b) => routePointTime(a) - routePointTime(b));
  const normalizedPoints = [];
  let duplicatesRemoved = 0;
  ordered.forEach((log) => {
    const point = normalizeRouteMapCoordinate(
      [Number(log.latitude), Number(log.longitude)],
      stats,
      `gps_log_${log.id || log.captured_at || log.logged_at || log.created_at || normalizedPoints.length}`,
    );
    if (!point) return;
    const previous = normalizedPoints.at(-1);
    if (previous && previous.point[0] === point[0] && previous.point[1] === point[1]) {
      duplicatesRemoved += 1;
      return;
    }
    normalizedPoints.push({
      point,
      timestampMs: routePointTime(log).getTime(),
      source: log.id || log.captured_at || log.logged_at || log.created_at || normalizedPoints.length,
    });
  });
  const segments = [];
  const gapBreakExamples = [];
  let currentSegment = [];
  let previousPoint = null;
  normalizedPoints.forEach((currentPoint) => {
    const gap = previousPoint ? gpsTrailGapReason(previousPoint, currentPoint) : null;
    if (gap) {
      if (currentSegment.length > 1) segments.push(currentSegment);
      if (gapBreakExamples.length < 10) {
        gapBreakExamples.push({
          reason: gap.reason,
          from: previousPoint.source,
          to: currentPoint.source,
          secondsGap: Number(gap.secondsGap.toFixed(0)),
          distanceKm: Number(gap.distanceKm.toFixed(3)),
          speedKmph: Number(gap.speedKmph.toFixed(1)),
        });
      }
      currentSegment = [];
    }
    currentSegment.push(currentPoint.point);
    previousPoint = currentPoint;
  });
  if (currentSegment.length > 1) segments.push(currentSegment);
  return {
    trail: segments[0] || [],
    segments,
    rawGpsPoints: logs.length,
    acceptedGpsPoints: normalizedPoints.length,
    validPointsCount: ordered.length,
    duplicatesRemoved,
    gapBreakExamples,
    segmentsSkippedCount: normalizedPoints.length - segments.reduce((sum, segment) => sum + segment.length, 0),
    skippedGapPoints:
      logs.length - normalizedPoints.length +
      normalizedPoints.length - segments.reduce((sum, segment) => sum + segment.length, 0),
  };
}

function perpendicularPointDistance(point, start, end) {
  const [lat, lng] = point;
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;
  const dLat = endLat - startLat;
  const dLng = endLng - startLng;
  if (dLat === 0 && dLng === 0) {
    return Math.hypot(lat - startLat, lng - startLng);
  }
  const t = Math.max(0, Math.min(1, ((lat - startLat) * dLat + (lng - startLng) * dLng) / (dLat * dLat + dLng * dLng)));
  return Math.hypot(lat - (startLat + t * dLat), lng - (startLng + t * dLng));
}

function simplifyRoutePoints(points, epsilon = 0.00012) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularPointDistance(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= epsilon) return [points[0], points.at(-1)];
  const left = simplifyRoutePoints(points.slice(0, maxIndex + 1), epsilon);
  const right = simplifyRoutePoints(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function capRoutePoints(points, maxPoints = SNAP_TO_ROADS_MAX_INPUT_POINTS) {
  if (points.length <= maxPoints) return points;
  const capped = [points[0]];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let index = 1; index < maxPoints - 1; index += 1) {
    capped.push(points[Math.round(index * step)]);
  }
  capped.push(points.at(-1));
  return capped;
}

function downsampleGpsTrailForSnap(points = []) {
  if (points.length <= SNAP_TO_ROADS_MAX_INPUT_POINTS) return points;
  let epsilon = 0.00008;
  let simplified = points;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    simplified = simplifyRoutePoints(points, epsilon);
    if (simplified.length <= SNAP_TO_ROADS_MAX_INPUT_POINTS) break;
    epsilon *= 1.7;
  }
  return capRoutePoints(simplified, SNAP_TO_ROADS_MAX_INPUT_POINTS);
}

function simplifiedGpsTrailForDisplay(points = []) {
  if (points.length <= 120) return points;
  let epsilon = 0.00018;
  let simplified = points;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    simplified = simplifyRoutePoints(points, epsilon);
    if (simplified.length <= 160) break;
    epsilon *= 1.6;
  }
  return capRoutePoints(simplified, 160);
}

function chunkRoutePoints(points = [], size = SNAP_TO_ROADS_MAX_POINTS_PER_REQUEST) {
  const chunks = [];
  if (points.length <= size) return points.length ? [points] : [];
  let index = 0;
  while (index < points.length) {
    chunks.push(points.slice(index, Math.min(points.length, index + size)));
    if (index + size >= points.length) break;
    index += size - 1;
  }
  return chunks;
}

async function snapGpsSegmentToRoads(points = []) {
  const downsampled = downsampleGpsTrailForSnap(points);
  const chunks = chunkRoutePoints(downsampled);
  const snappedPath = [];

  for (const chunk of chunks) {
    if (chunk.length < 2) continue;
    const url = new URL("https://roads.googleapis.com/v1/snapToRoads");
    url.searchParams.set("interpolate", "true");
    url.searchParams.set("path", chunk.map((point) => `${point[0]},${point[1]}`).join("|"));
    url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
    const response = await fetch(url);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = { parse_error: error?.message || String(error) };
    }
    if (!response.ok) {
      const error = new Error(`Snap to Roads HTTP ${response.status}`);
      error.roadsApiResponse = payload;
      throw error;
    }
    if (payload.error) {
      const error = new Error(payload.error.message || payload.error.status || "Snap to Roads failed");
      error.roadsApiResponse = payload.error;
      throw error;
    }
    (payload.snappedPoints || []).forEach((point) => {
      const location = point.location;
      if (!location) return;
      const next = [Number(location.latitude), Number(location.longitude)];
      if (!hasFiniteCoordinates(next)) return;
      const previous = snappedPath.at(-1);
      if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
      snappedPath.push(next);
    });
  }

  if (snappedPath.length < 2) {
    throw new Error("Snap to Roads returned insufficient points");
  }

  return {
    path: snappedPath,
    downsampledGpsPoints: downsampled.length,
    snapApiChunkCount: chunks.length,
    snappedPointsReturned: snappedPath.length,
  };
}

async function snapGpsSegmentsToRoads(segments = []) {
  const renderedSegments = [];
  const errors = [];
  let downsampledGpsPoints = 0;
  let snapApiChunkCount = 0;
  let snappedPointsReturned = 0;
  let snappedSegmentsCount = 0;
  let failedSegmentsCount = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.length < 2) continue;
    const downsampled = downsampleGpsTrailForSnap(segment);
    downsampledGpsPoints += downsampled.length;
    snapApiChunkCount += chunkRoutePoints(downsampled).length;
    try {
      const snapped = await snapGpsSegmentToRoads(segment);
      renderedSegments.push(snapped.path);
      snappedPointsReturned += snapped.snappedPointsReturned;
      snappedSegmentsCount += 1;
    } catch (error) {
      failedSegmentsCount += 1;
      const simplified = simplifiedGpsTrailForDisplay(segment);
      if (simplified.length > 1) renderedSegments.push(simplified);
      errors.push({
        segmentIndex: index,
        message: error?.message || String(error),
        roadsApiResponse: error?.roadsApiResponse || null,
      });
    }
  }

  if (!renderedSegments.length) {
    const error = new Error("Snap to Roads returned no renderable segments");
    error.roadsApiResponse = errors;
    throw error;
  }

  return {
    paths: renderedSegments,
    status: failedSegmentsCount
      ? snappedSegmentsCount
        ? "partial"
        : "failed"
      : "success",
    downsampledGpsPoints,
    snapApiChunkCount,
    snappedPointsReturned,
    snappedSegmentsCount,
    failedSegmentsCount,
    errors,
  };
}

function buildDetailMapPoints(officer, routeLogs) {
  const visits = sortedOfficerVisits(officer);
  const coordinateStats = createRouteMapCoordinateStats();
  const start = normalizeRouteMapCoordinate(
    pointFromAttendanceStart(officer?.attendance),
    coordinateStats,
    "attendance_start",
  );
  const end = normalizeRouteMapCoordinate(
    routePointFromAttendanceEnd(officer?.attendance),
    coordinateStats,
    "attendance_end",
  );
  const gpsTrail = gpsTrailFromLogs(routeLogs, coordinateStats);
  const storedPolylines = storedRoutePolylinesFromVisits(visits, coordinateStats);
  const anchors = [
    detailRouteAnchor(
      "start",
      "start",
      "S",
      start,
      "Start Day",
    ),
    ...visits.flatMap((visit, index) => {
      const checkIn = normalizeRouteMapCoordinate(
        routePointFromVisit(visit, "checkin"),
        coordinateStats,
        `site_${index + 1}_checkin`,
      );
      const checkOut = normalizeRouteMapCoordinate(
        routePointFromVisit(visit, "checkout"),
        coordinateStats,
        `site_${index + 1}_checkout`,
      );
      const siteCoordinates = checkIn || checkOut;
      const siteAnchor = detailRouteAnchor(
        visit.id || `site-${index + 1}`,
        "site",
        index + 1,
        siteCoordinates,
        visitTitle(visit),
      );
      const checkoutAnchor =
        checkOut && checkIn && (checkOut[0] !== checkIn[0] || checkOut[1] !== checkIn[1])
          ? detailRouteAnchor(
              `${visit.id || `site-${index + 1}`}-checkout`,
              "checkout",
              null,
              checkOut,
              `${visitTitle(visit)} checkout`,
            )
          : null;
      return [siteAnchor, checkoutAnchor].filter(Boolean);
    }),
    detailRouteAnchor("end", "end", "E", end, "End Day"),
  ].filter(Boolean);
  const hasGpsTrail = gpsTrail.segments.length > 0;
  const routeTrail = hasGpsTrail
    ? gpsTrail.trail
    : storedPolylines.length
      ? storedPolylines[0]
      : [];
  const markers = spreadDetailMarkers(
    anchors.filter((anchor) => ["start", "site", "end"].includes(anchor.type)),
  );
  return {
    anchors,
    markers,
    storedPolylines,
    routeTrail,
    gpsSegments: gpsTrail.segments,
    gpsFetchedCount: routeLogs.length,
    rawGpsPoints: gpsTrail.rawGpsPoints,
    acceptedGpsPoints: gpsTrail.acceptedGpsPoints,
    gpsValidPointsCount: gpsTrail.validPointsCount,
    gpsDuplicatesRemoved: gpsTrail.duplicatesRemoved,
    gpsSegmentCount: gpsTrail.segments.length,
    gpsSegmentPointCounts: gpsTrail.segments.map((segment) => segment.length),
    gpsSegmentsSkippedCount: gpsTrail.segmentsSkippedCount,
    skippedGapPoints: gpsTrail.skippedGapPoints,
    gpsGapBreakExamples: gpsTrail.gapBreakExamples,
    coordinateStats,
    routeSource: hasGpsTrail
      ? "gps-trail"
      : storedPolylines.length
        ? "stored-polyline"
        : "fallback-anchors",
  };
}

function spreadDetailMarkers(markers = []) {
  const grouped = markers.reduce((map, marker) => {
    const key = marker.coordinates.map((value) => Number(value).toFixed(4)).join(",");
    const list = map.get(key) || [];
    list.push(marker);
    map.set(key, list);
    return map;
  }, new Map());

  return markers.map((marker) => {
    const key = marker.coordinates.map((value) => Number(value).toFixed(4)).join(",");
    const siblings = grouped.get(key) || [];
    if (siblings.length <= 1) return marker;
    const index = siblings.findIndex((item) => item.id === marker.id);
    const angle = (index / siblings.length) * Math.PI * 2;
    const radius = 5.2;
    return {
      ...marker,
      displayOffset: {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      },
    };
  });
}

function googleLatLng(point, displayOffset) {
  if (!hasFiniteCoordinates(point)) return null;
  const latOffset = (displayOffset?.y || 0) * -0.00004;
  const lngOffset = (displayOffset?.x || 0) * 0.00004;
  return {
    lat: Number(point[0]) + latOffset,
    lng: Number(point[1]) + lngOffset,
  };
}

function firstValidPointFromPaths(paths = []) {
  for (const path of paths) {
    const point = path.find(hasFiniteCoordinates);
    if (point) return point;
  }
  return null;
}

function GoogleRouteMap({ officer, routeLogs, fromDate, toDate }) {
  const points = useMemo(() => buildDetailMapPoints(officer, routeLogs), [officer, routeLogs]);
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const roadSnapRequestAvailableRef = useRef(true);
  const [mapStatus, setMapStatus] = useState(GOOGLE_MAPS_API_KEY ? "loading" : "missing-key");
  const [routeViewMode, setRouteViewMode] = useState("road");
  const [snapResult, setSnapResult] = useState({
    status: "skipped",
    paths: [],
    downsampledGpsPoints: 0,
    snapApiChunkCount: 0,
    snappedPointsReturned: 0,
    snappedSegmentsCount: 0,
    failedSegmentsCount: 0,
    errors: [],
  });
  const snapCacheKey = [
    officer?.foId || officer?.employeeCode || "unknown",
    formatDateOnly(fromDate),
    formatDateOnly(toDate),
    points.gpsValidPointsCount,
    points.gpsDuplicatesRemoved,
    points.gpsSegmentCount,
  ].join("|");
  const simplifiedGpsTrail = useMemo(
    () => points.gpsSegments.map((segment) => simplifiedGpsTrailForDisplay(segment)).filter((segment) => segment.length > 1),
    [points.gpsSegments],
  );
  const selectedRoute = useMemo(() => {
    if (routeViewMode === "markers") {
      return { paths: [], source: "markers_only", label: "Markers Only" };
    }
    if (routeViewMode === "raw") {
      return { paths: points.gpsSegments, source: "raw_gps", label: "Segmented Raw GPS" };
    }
    if (["success", "partial"].includes(snapResult.status) && snapResult.paths?.length) {
      return {
        paths: snapResult.paths,
        source: snapResult.status === "partial" ? "mixed_snapped_simplified" : "snapped_gps",
        label: snapResult.status === "partial" ? "Road-snapped GPS Trail" : "Road-snapped GPS Trail",
      };
    }
    if (points.routeSource === "gps-trail") {
      return { paths: simplifiedGpsTrail, source: "simplified_gps", label: "Simplified GPS Trail" };
    }
    if (points.routeSource === "stored-polyline") {
      return { paths: points.storedPolylines, source: "polyline", label: "Stored Polyline" };
    }
    return { paths: [], source: "markers_only", label: "Markers Only" };
  }, [points.gpsSegments, points.routeSource, points.storedPolylines, routeViewMode, simplifiedGpsTrail, snapResult]);
  const renderedPolylinePointCount = selectedRoute.paths.reduce((sum, path) => sum + path.length, 0);
  const renderedSegmentsCreated = selectedRoute.paths.filter((path) => path.length > 1).length;
  const routeTrailUnavailable =
    points.acceptedGpsPoints >= 2 &&
    points.gpsSegmentCount === 0 &&
    !points.storedPolylines.length;
  const hasMapGeometry = renderedPolylinePointCount > 1 || points.markers.length > 0;

  useEffect(() => {
    let cancelled = false;
    async function loadSnappedTrail() {
      if (points.routeSource !== "gps-trail" || !points.gpsSegments.length || !GOOGLE_MAPS_API_KEY) {
        setSnapResult({
          status: "skipped",
          paths: [],
          downsampledGpsPoints: 0,
          snapApiChunkCount: 0,
          snappedPointsReturned: 0,
          snappedSegmentsCount: 0,
          failedSegmentsCount: 0,
          errors: [],
        });
        return;
      }
      const cached = snapToRoadsCache.get(snapCacheKey);
      if (cached) {
        setSnapResult(cached);
        return;
      }
      if (!roadSnapRequestAvailableRef.current) {
        setSnapResult({
          status: "skipped",
          paths: [],
          downsampledGpsPoints: 0,
          snapApiChunkCount: 0,
          snappedPointsReturned: 0,
          snappedSegmentsCount: 0,
          failedSegmentsCount: 0,
          errors: [],
        });
        return;
      }
      roadSnapRequestAvailableRef.current = false;
      try {
        const snapped = await snapGpsSegmentsToRoads(points.gpsSegments);
        const result = { ...snapped };
        if (result.errors?.length) {
          console.warn("[myQPMS FO] Snap to Roads partially failed; using simplified GPS for failed segments.", {
            officer_id: officer?.foId || officer?.employeeCode,
            date_range: `${formatDateOnly(fromDate)} to ${formatDateOnly(toDate)}`,
            roadsApiErrors: result.errors,
          });
        }
        snapToRoadsCache.set(snapCacheKey, result);
        if (!cancelled) setSnapResult(result);
      } catch (error) {
        const downsampledSegments = points.gpsSegments.map((segment) => downsampleGpsTrailForSnap(segment));
        console.warn("[myQPMS FO] Snap to Roads failed; using raw GPS trail.", {
          officer_id: officer?.foId || officer?.employeeCode,
          date_range: `${formatDateOnly(fromDate)} to ${formatDateOnly(toDate)}`,
          message: error?.message || String(error),
          roadsApiResponse: error?.roadsApiResponse || null,
        });
        const result = {
          status: "failed",
          paths: [],
          downsampledGpsPoints: downsampledSegments.reduce((sum, segment) => sum + segment.length, 0),
          snapApiChunkCount: downsampledSegments.reduce((sum, segment) => sum + chunkRoutePoints(segment).length, 0),
          snappedPointsReturned: 0,
          snappedSegmentsCount: 0,
          failedSegmentsCount: points.gpsSegments.length,
          errors: [
            {
              message: error?.message || String(error),
              roadsApiResponse: error?.roadsApiResponse || null,
            },
          ],
        };
        snapToRoadsCache.set(snapCacheKey, result);
        if (!cancelled) setSnapResult(result);
      }
    }
    loadSnappedTrail();
    return () => {
      cancelled = true;
    };
  }, [fromDate, officer?.employeeCode, officer?.foId, points.gpsSegments, points.routeSource, snapCacheKey, toDate]);

  useEffect(() => {
    const coordinateStats = points.coordinateStats || createRouteMapCoordinateStats();
    const swappedRatio = coordinateStats.routeMapOriginalPointCount
      ? coordinateStats.routeMapSwappedCorrectionCount / coordinateStats.routeMapOriginalPointCount
      : 0;
    console.debug("FO_DRILLDOWN_ROUTE_MAP_DIAGNOSTICS", {
      officer_name: officer?.name,
      officer_id: officer?.foId || officer?.employeeCode,
      date_range: `${formatDateOnly(fromDate)} to ${formatDateOnly(toDate)}`,
      attendance_rows_count: officer?.attendance?.id ? 1 : 0,
      site_visits_count: officer?.visits?.length || 0,
      gps_logs_fetched_count: points.gpsFetchedCount,
      valid_gps_points_count: points.gpsValidPointsCount,
      duplicate_points_removed_count: points.gpsDuplicatesRemoved,
      rawGpsPoints: points.rawGpsPoints,
      acceptedGpsPoints: points.acceptedGpsPoints,
      segmentsCreated: points.gpsSegmentCount,
      skippedGapPoints: points.skippedGapPoints,
      googleRouteApiFailed: ["failed", "partial"].includes(snapResult.status),
      downsampledGpsPoints: snapResult.downsampledGpsPoints,
      snapApiChunkCount: snapResult.snapApiChunkCount,
      snappedPointsReturned: snapResult.snappedPointsReturned,
      snapToRoadStatus: snapResult.status,
      finalPathSource: selectedRoute.source,
      selectedRouteViewMode: routeViewMode,
      renderedPolylinePointCount,
      renderedPolylineSegmentCount: renderedSegmentsCreated,
      renderedPolylineSource: selectedRoute.source,
      gpsSegmentCount: points.gpsSegmentCount,
      gpsSegmentPointCounts: points.gpsSegmentPointCounts,
      gpsSegmentsSkippedCount: points.gpsSegmentsSkippedCount,
      gpsGapBreakExamples: points.gpsGapBreakExamples,
      roadsApiErrors: snapResult.errors,
      final_marker_count: points.markers.length,
      routeMapOriginalPointCount: coordinateStats.routeMapOriginalPointCount,
      routeMapAcceptedOriginalCount: coordinateStats.routeMapAcceptedOriginalCount,
      routeMapSwappedCorrectionCount: coordinateStats.routeMapSwappedCorrectionCount,
      routeMapRejectedInvalidCount: coordinateStats.routeMapRejectedInvalidCount,
      routeMapRejectedExamples: coordinateStats.routeMapRejectedExamples,
    });
    if (swappedRatio > 0.1) {
      console.warn("FO route map detected swapped latitude/longitude values.", {
        officer_name: officer?.name,
        officer_id: officer?.foId || officer?.employeeCode,
        swapped_ratio: Number(swappedRatio.toFixed(3)),
        swapped_count: coordinateStats.routeMapSwappedCorrectionCount,
        total_points: coordinateStats.routeMapOriginalPointCount,
      });
    }
  }, [fromDate, officer, points, renderedPolylinePointCount, renderedSegmentsCreated, routeViewMode, selectedRoute.source, snapResult, toDate]);

  useEffect(() => {
    let cancelled = false;
    async function renderMap() {
      try {
        const maps = await loadGoogleMapsScript();
        if (cancelled || !mapElementRef.current) return;
        const firstPoint =
          points.markers[0]?.coordinates ||
          firstValidPointFromPaths(selectedRoute.paths) ||
          points.routeTrail.find(hasFiniteCoordinates) ||
          SOUTH_INDIA_CENTER;
        const center = googleLatLng(firstPoint) || { lat: SOUTH_INDIA_CENTER[0], lng: SOUTH_INDIA_CENTER[1] };
        if (!mapRef.current) {
          mapRef.current = new maps.Map(mapElementRef.current, {
            center,
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            clickableIcons: false,
          });
        }

        overlaysRef.current.forEach((overlay) => overlay.setMap(null));
        overlaysRef.current = [];
        const bounds = new maps.LatLngBounds();
        let hasBounds = false;

        selectedRoute.paths
          .filter((path) => path.length > 1)
          .forEach((path) => {
            const googlePath = path.map((point) => googleLatLng(point)).filter(Boolean);
            if (googlePath.length < 2) return;
            googlePath.forEach((latLng) => {
              bounds.extend(latLng);
              hasBounds = true;
            });
            const polyline = new maps.Polyline({
              path: googlePath,
              geodesic: true,
              strokeColor: "#1557ff",
              strokeOpacity: selectedRoute.source === "raw_gps" ? 0.42 : 0.68,
              strokeWeight: selectedRoute.source === "raw_gps" ? 2 : 3,
              map: mapRef.current,
            });
            overlaysRef.current.push(polyline);
          });

        points.markers.forEach((marker) => {
          const position = googleLatLng(marker.coordinates, marker.displayOffset);
          if (!position) return;
          bounds.extend(position);
          hasBounds = true;
          const isStart = marker.type === "start";
          const isEnd = marker.type === "end";
          const mapMarker = new maps.Marker({
            map: mapRef.current,
            position,
            title: marker.title,
            label: {
              text: String(marker.label || ""),
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: "800",
            },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: isStart || isEnd ? 12 : 11,
              fillColor: isStart ? "#10b981" : isEnd ? "#ef4444" : "#1557ff",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });
          overlaysRef.current.push(mapMarker);
        });

        if (hasBounds) {
          mapRef.current.fitBounds(bounds, 48);
        } else {
          mapRef.current.setCenter(center);
          mapRef.current.setZoom(11);
        }
        setMapStatus("ready");
      } catch (error) {
        console.warn("[myQPMS FO] Google map unavailable.", error);
        if (!cancelled) setMapStatus("unavailable");
      }
    }
    renderMap();
    return () => {
      cancelled = true;
    };
  }, [points, selectedRoute]);

  return (
    <div className="relative h-[340px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-inner">
      <div ref={mapElementRef} className="absolute inset-0" />
      {mapStatus !== "ready" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
          {mapStatus === "missing-key" ? "Google Maps key is not configured." : "Loading route map..."}
        </div>
      ) : null}
      {mapStatus === "ready" && !hasMapGeometry ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white/80 text-sm font-semibold text-slate-500">
          No GPS trail or route anchors available for selected filters.
        </div>
      ) : null}
      {routeViewMode === "road" &&
      !routeTrailUnavailable &&
      ["failed", "partial"].includes(snapResult.status) ? (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-bold text-amber-800 shadow-sm">
          Road snapping unavailable — showing segmented raw GPS trail
        </div>
      ) : null}
      {routeTrailUnavailable ? (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-bold text-amber-800 shadow-sm">
          Route trail unavailable. Showing available points.
        </div>
      ) : null}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 text-xs font-black text-slate-600 shadow-sm">
        {[
          ["road", "Road Trail"],
          ["raw", "Raw GPS"],
          ["markers", "Markers Only"],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setRouteViewMode(mode)}
            className={`rounded-md px-3 py-1.5 transition ${
              routeViewMode === mode
                ? "bg-qpms-700 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="absolute right-4 top-4 z-10 w-28 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs font-semibold text-slate-600 shadow-sm">
        <p className="mb-2 font-black text-slate-900">Legend</p>
        <LegendDot color="bg-emerald-500" label="Start Day" />
        <LegendDot color="bg-blue-600" label="Site Visit" />
        <LegendDot color="bg-red-500" label="End Day" />
        <div className="mt-2 flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full bg-blue-600" />
          <span>Route</span>
        </div>
        <p className="mt-2 text-[10px] font-bold uppercase text-slate-400">
          {selectedRoute.label}
        </p>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}

function DetailSummaryCard({ icon, label, value, hint, tone = "blue" }) {
  const Icon = icon;
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    purple: "bg-violet-50 text-violet-700",
  };
  return (
    <div className="min-h-[116px] rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <div className="flex h-full items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tones[tone] || tones.blue}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-normal break-words text-[11px] font-semibold leading-4 text-slate-600">
            {label}
          </p>
          <p className="mt-1 whitespace-normal break-words text-lg font-black leading-tight text-slate-950 sm:text-xl xl:text-[22px]">
            {value || "--"}
          </p>
          <p className="mt-1 whitespace-normal break-words text-xs font-semibold leading-4 text-slate-500">
            {hint || "--"}
          </p>
        </div>
      </div>
    </div>
  );
}

function UploadModalFileSection({
  title,
  subtitle = "JPG, PNG, PDF",
  accept,
  files = [],
  onFiles,
  compact = false,
}) {
  return (
    <section className={`rounded-xl border border-slate-200 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</p>
        </div>
        <label className="focus-within:ring-2 focus-within:ring-qpms-100 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-qpms-200 px-3 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50">
          <UploadCloud className="h-4 w-4" />
          Upload
          <input
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {files.map((file, index) => {
          const isImage = /^image\//i.test(file.type || "");
          const previewUrl = isImage ? URL.createObjectURL(file) : null;
          return (
            <div
              key={`${file.name}-${file.size}-${index}`}
              className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
              title={file.name}
            >
              {previewUrl ? (
                <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
              ) : (
                <FilePlus className="h-6 w-6" />
              )}
            </div>
          );
        })}
        <label className="grid h-16 w-16 shrink-0 cursor-pointer place-items-center rounded-lg border border-dashed border-blue-200 bg-blue-50/40 text-blue-600 hover:bg-blue-50">
          <PlusIcon />
          <input
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </section>
  );
}

function PlusIcon() {
  return <span className="text-2xl font-black leading-none">+</span>;
}

function FieldOfficerDetailsView({
  officer,
  rangeDataset,
  rangeDatasetLoading = false,
  rangeDatasetError = "",
  generatedByUser,
  routeLogs,
  activitySubmissions = [],
  activityUploads = [],
  fromDate,
  toDate,
  draftFromDate,
  draftToDate,
  onDraftFromDate,
  onDraftToDate,
  onApplyDate,
  onBack,
  onExport,
  onRecalculateKm,
  onTemporarySwitchKm,
  onCheckoutReviewAction,
  checkoutReviewBusyVisitId = null,
  recalculatingKm = false,
  recalculatingSwitchKm = false,
  recalculationResult = null,
  fullTechnicalAccess = false,
  canReviewCheckoutExceptions = false,
  canApproveCheckoutMissingKmReviews = false,
  onActivityUploadSaved,
  onRouteGpsEvidenceActive,
}) {
  const [selectedVisitIndex, setSelectedVisitIndex] = useState(0);
  const [photoFilter, setPhotoFilter] = useState("All");
  const [photoSearch, setPhotoSearch] = useState("");
  const [selectedActivityCardId, setSelectedActivityCardId] = useState(null);
  const [activityMenuCardId, setActivityMenuCardId] = useState(null);
  const [activityPreviewCard, setActivityPreviewCard] = useState(null);
  const [activityPreviewFiles, setActivityPreviewFiles] = useState([]);
  const [activityPreviewIndex, setActivityPreviewIndex] = useState(0);
  const [activityPreviewLoading, setActivityPreviewLoading] = useState(false);
  const [activityPreviewError, setActivityPreviewError] = useState("");
  const [activityPreviewImageFailed, setActivityPreviewImageFailed] = useState(false);
  const [activityPreviewImageLoading, setActivityPreviewImageLoading] = useState(false);
  const [activityReviewRemarks, setActivityReviewRemarks] = useState("");
  const [uploadInfoVisible, setUploadInfoVisible] = useState(true);
  const [activityUploadModal, setActivityUploadModal] = useState(null);
  const [activityUploadSaving, setActivityUploadSaving] = useState(false);
  const [activityUploadError, setActivityUploadError] = useState("");
  const [activityUploadDraft, setActivityUploadDraft] = useState({
    visitId: "",
    inspectionPhotos: [],
    inspectionDocuments: [],
    hkStaff: [],
    hkEmpId: "",
    hkName: "",
    trainingPhotos: {},
    trainingDocuments: [],
    deepBefore: [],
    deepAfter: [],
    deepDocuments: [],
  });
  const [routeMapOpen, setRouteMapOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  const [drillDownOpen, setDrillDownOpen] = useState(true);
  const [printRequested, setPrintRequested] = useState(false);
  const [checkoutReviewPreview, setCheckoutReviewPreview] = useState(null);
  const activityMenuRef = useRef(null);
  const activityPreviewRequestRef = useRef(0);
  const visits = useMemo(() => sortedOfficerVisits(officer), [officer]);
  const attendances = useMemo(
    () =>
      (officer?.attendances?.length
        ? officer.attendances
        : officer?.attendance
          ? [officer.attendance]
          : []
      )
        .slice()
        .sort(
          (a, b) =>
            new Date(a.login_time || 0) - new Date(b.login_time || 0),
        ),
    [officer],
  );
  const attendance = useMemo(() => officer?.attendance || {}, [officer?.attendance]);
  const firstAttendance = attendances[0] || attendance;
  const lastAttendance = attendances.at(-1) || attendance;
  const activeVisitIndex = visits.length
    ? Math.min(selectedVisitIndex, visits.length - 1)
    : 0;
  const selectedVisit = visits[activeVisitIndex] || null;
  const selectedEmployeeKeys = useMemo(() => {
    const keys = [
      officer?.employeeCode,
      officer?.foId,
      officer?.employee_code,
      officer?.fo_user_id,
      officer?.profile?.employee_code,
      officer?.profile?.username,
      attendance?.employee_code,
      attendance?.fo_user_id,
      ...visits.flatMap((visit) => [visit?.employee_code, visit?.fo_user_id]),
    ]
      .map(normalizeFoKey)
      .filter(Boolean);
    return new Set(keys);
  }, [attendance, officer, visits]);
  const selectedAttendanceIds = useMemo(
    () =>
      new Set(
        attendances
          .map((row) => String(row?.id || ""))
          .filter(Boolean),
      ),
    [attendances],
  );
  const selectedVisitIds = useMemo(
    () =>
      new Set(
        visits
          .map((visit) => String(visit?.id || ""))
          .filter(Boolean),
      ),
    [visits],
  );
  const rowMatchesSelectedEmployee = useMemo(
    () => (row) => {
      if (!row) return false;
      const rowEmployeeKeys = [
        row.employee_code,
        row.fo_user_id,
        row.username,
        row.submission?.employee_code,
        row.submission?.fo_user_id,
      ]
        .map(normalizeFoKey)
        .filter(Boolean);
      if (rowEmployeeKeys.some((key) => selectedEmployeeKeys.has(key))) {
        return true;
      }
      const attendanceId = row.attendance_id || row.submission?.attendance_id;
      if (attendanceId && selectedAttendanceIds.has(String(attendanceId))) {
        return true;
      }
      const siteVisitId = row.site_visit_id || row.submission?.site_visit_id;
      if (siteVisitId && selectedVisitIds.has(String(siteVisitId))) {
        return true;
      }
      return false;
    },
    [selectedAttendanceIds, selectedEmployeeKeys, selectedVisitIds],
  );
  const selectedEmployeeActivitySubmissions = useMemo(
    () => activitySubmissions.filter(rowMatchesSelectedEmployee),
    [activitySubmissions, rowMatchesSelectedEmployee],
  );
  const selectedEmployeeActivitySubmissionIds = useMemo(
    () =>
      new Set(
        selectedEmployeeActivitySubmissions
          .map((submission) => String(submission?.id || ""))
          .filter(Boolean),
      ),
    [selectedEmployeeActivitySubmissions],
  );
  const selectedEmployeeActivityUploads = useMemo(
    () =>
      activityUploads.filter((upload) => {
        if (rowMatchesSelectedEmployee(upload)) return true;
        return (
          upload?.submission_id &&
          selectedEmployeeActivitySubmissionIds.has(String(upload.submission_id))
        );
      }),
    [activityUploads, rowMatchesSelectedEmployee, selectedEmployeeActivitySubmissionIds],
  );
  const visibleActivityUploads = useMemo(() => {
    const selectedVisitId = selectedVisit?.id ? String(selectedVisit.id) : null;
    const siteScopedUploads = selectedVisitId
      ? selectedEmployeeActivityUploads.filter((upload) => {
          const uploadVisitId = upload.site_visit_id || upload.submission?.site_visit_id;
          return uploadVisitId && String(uploadVisitId) === selectedVisitId;
        })
      : selectedEmployeeActivityUploads;
    return filteredActivityUploads(siteScopedUploads, photoFilter);
  }, [photoFilter, selectedEmployeeActivityUploads, selectedVisit]);
  const webUploadEnabled = canUseWebActivityUpload(generatedByUser);
  const activityUploadsBySubmissionId = useMemo(() => {
    const map = new Map();
    selectedEmployeeActivityUploads.forEach((upload) => {
      const key = upload.submission_id ? String(upload.submission_id) : "";
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(upload);
    });
    return map;
  }, [selectedEmployeeActivityUploads]);
  const activityCards = useMemo(() => {
    const cards = [];
    const submissionIdsWithCards = new Set();
    selectedEmployeeActivitySubmissions.forEach((submission) => {
      const uploadsForSubmission = activityUploadsBySubmissionId.get(String(submission.id)) || [];
      const metadata = objectMetadata(submission);
      const activityGroup = activityTypeLabel(submission.activity_type || metadata.activity_type);
      const primaryUpload = uploadsForSubmission[0] || null;
      const pendingImages =
        metadata.pending_images === true ||
        metadata.pending_images === "true" ||
        uploadsForSubmission.length === 0;
      const status = pendingImages
        ? { label: "Missing More Uploads", tone: "rose" }
        : activityStatusFromRecord(submission);
      const insight = activityCardInsight(activityGroup, uploadsForSubmission, submission);
      cards.push({
        id: `submission-${submission.id}`,
        kind: uploadsForSubmission.length ? "upload" : "missing",
        activityGroup,
        title: firstNonEmptyText(
          submission.store_name,
          submission.site_name,
          submission.store_code,
          "Activity submission",
        ),
        siteCode: firstNonEmptyText(submission.store_code, metadata.store_code, "--"),
        uploadedBy: firstNonEmptyText(submission.full_name, submission.employee_code, submission.fo_user_id, officer?.name),
        uploadedAt: submission.submitted_at || submission.created_at,
        visitDateTime: submission.submitted_at || submission.created_at,
        remarks: firstNonEmptyText(submission.remarks, metadata.remarks, "--"),
        status: insight.statusOverride || status,
        uploads: uploadsForSubmission,
        thumbnail: primaryUpload?.displayUrl || null,
        fileCount: uploadsForSubmission.length,
        record: submission,
        insight,
      });
      submissionIdsWithCards.add(String(submission.id));
    });
    selectedEmployeeActivityUploads.forEach((upload) => {
      if (upload.submission_id && submissionIdsWithCards.has(String(upload.submission_id))) return;
      const metadata = objectMetadata(upload);
      const activityGroup = activityTypeLabel(upload.activity_type || upload.upload_role || metadata.activity_type);
      const insight = activityCardInsight(activityGroup, [upload], upload);
      cards.push({
        id: `upload-${upload.id || upload.local_id || upload.file_url}`,
        kind: "upload",
        activityGroup,
        title: firstNonEmptyText(
          upload.store_name,
          upload.site_name,
          upload.submission?.store_name,
          upload.submission?.site_name,
          upload.store_code,
          "Uploaded activity",
        ),
        siteCode: firstNonEmptyText(upload.store_code, upload.submission?.store_code, metadata.store_code, "--"),
        uploadedBy: firstNonEmptyText(upload.uploaded_by_name, upload.full_name, upload.employee_code, upload.fo_user_id, officer?.name),
        uploadedAt: activityUploadTime(upload),
        visitDateTime: upload.submission?.submitted_at || upload.uploaded_at || upload.created_at,
        remarks: firstNonEmptyText(upload.remarks, upload.submission?.remarks, metadata.remarks, "--"),
        status: insight.statusOverride || activityStatusFromRecord(upload),
        uploads: [upload],
        thumbnail: upload.displayUrl || null,
        fileCount: 1,
        record: upload,
        insight,
      });
    });
    return cards.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime(),
    );
  }, [selectedEmployeeActivitySubmissions, selectedEmployeeActivityUploads, activityUploadsBySubmissionId, officer?.name]);
  const filteredActivityCards = useMemo(() => {
    const search = photoSearch.trim().toLowerCase();
    return activityCards.filter((card) => {
      if (photoFilter !== "All" && card.activityGroup !== photoFilter) return false;
      if (!search) return true;
      return [
        card.activityGroup,
        card.title,
        card.siteCode,
        card.uploadedBy,
        card.remarks,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [activityCards, photoFilter, photoSearch]);
  const pendingUploadCount = activityCards.filter((card) => card.status.tone === "rose").length;
  const uploadedActivityCount = activityCards.filter((card) => card.fileCount > 0).length;
  const selectedActivityCard =
    filteredActivityCards.find((card) => card.id === selectedActivityCardId) ||
    filteredActivityCards[0] ||
    null;

  useEffect(() => {
    function handlePointerDown(event) {
      if (activityMenuCardId && !activityMenuRef.current?.contains(event.target)) {
        setActivityMenuCardId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activityMenuCardId]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (activityPreviewCard) {
        if (event.key === "Escape") {
          event.preventDefault();
          activityPreviewRequestRef.current += 1;
          setActivityPreviewCard(null);
          setActivityPreviewFiles([]);
          setActivityPreviewError("");
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setActivityPreviewImageFailed(false);
          setActivityPreviewImageLoading(true);
          setActivityPreviewIndex((index) => nextPreviewIndex(index, activityPreviewFiles.length, 1));
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setActivityPreviewImageFailed(false);
          setActivityPreviewImageLoading(true);
          setActivityPreviewIndex((index) => nextPreviewIndex(index, activityPreviewFiles.length, -1));
        }
        return;
      }
      if (event.key === "Escape" && activityMenuCardId) setActivityMenuCardId(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activityMenuCardId, activityPreviewCard, activityPreviewFiles.length]);

  async function openActivityPreview(card, initialIndex = 0) {
    if (!card?.uploads?.length) return;
    const requestId = activityPreviewRequestRef.current + 1;
    activityPreviewRequestRef.current = requestId;
    setActivityMenuCardId(null);
    setActivityPreviewCard(card);
    setActivityPreviewFiles([]);
    setActivityPreviewIndex(Math.max(0, Math.min(initialIndex, card.uploads.length - 1)));
    setActivityPreviewLoading(true);
    setActivityPreviewImageLoading(true);
    setActivityPreviewError("");
    try {
      const files = await Promise.all(
        card.uploads.map(async (upload) => ({
          ...upload,
          displayUrl: upload.displayUrl || await signedActivityUploadUrl(upload),
        })),
      );
      if (activityPreviewRequestRef.current !== requestId) return;
      setActivityPreviewFiles(files);
      if (!files.some((file) => file.displayUrl)) {
        setActivityPreviewError("No authorized preview URL is available for these files.");
      }
    } catch (error) {
      if (activityPreviewRequestRef.current !== requestId) return;
      setActivityPreviewError(error.message || "Unable to load activity preview.");
    } finally {
      if (activityPreviewRequestRef.current === requestId) setActivityPreviewLoading(false);
    }
  }

  function closeActivityPreview() {
    activityPreviewRequestRef.current += 1;
    setActivityPreviewCard(null);
    setActivityPreviewFiles([]);
    setActivityPreviewError("");
  }
  const activeActivityPreviewFile = activityPreviewFiles[activityPreviewIndex] || null;
  const activeActivityPreviewKind = activityPreviewFileKind(activeActivityPreviewFile || {});
  const activityVisitOptions = visits.map((visit, index) => ({
    id: String(visit.id || index),
    visit,
    label: `${visitTitle(visit)} • ${formatDateTime(visit.check_in_time)}`,
  }));
  const openActivityUploadFlow = () => {
    if (!webUploadEnabled) {
      return;
    }
    const modalType = activityModalTypeFromFilter(photoFilter);
    setActivityUploadError("");
    setActivityUploadModal(modalType);
    setActivityUploadDraft((draft) => ({
      ...draft,
      visitId: draft.visitId || activityVisitOptions[0]?.id || "",
    }));
  };
  const openActivityUploadModal = (type) => {
    setActivityUploadError("");
    setActivityUploadModal(type);
    setActivityUploadDraft((draft) => ({
      ...draft,
      visitId: draft.visitId || activityVisitOptions[0]?.id || "",
    }));
  };
  const closeActivityUploadModal = () => {
    if (activityUploadSaving) return;
    setActivityUploadError("");
    setActivityUploadModal(null);
  };
  const updateActivityDraftFiles = (key, files) => {
    setActivityUploadDraft((draft) => ({
      ...draft,
      [key]: [...(draft[key] || []), ...Array.from(files || [])],
    }));
  };
  const updateTrainingCategoryFiles = (categoryKey, files) => {
    setActivityUploadDraft((draft) => ({
      ...draft,
      trainingPhotos: {
        ...draft.trainingPhotos,
        [categoryKey]: [
          ...(draft.trainingPhotos[categoryKey] || []),
          ...Array.from(files || []),
        ],
      },
    }));
  };
  const addActivityDraftHkStaff = () => {
    const empId = activityUploadDraft.hkEmpId.trim();
    const name = activityUploadDraft.hkName.trim();
    if (!empId && !name) return;
    setActivityUploadDraft((draft) => ({
      ...draft,
      hkStaff: [...draft.hkStaff, { emp_id: empId, name }],
      hkEmpId: "",
      hkName: "",
    }));
  };
  const activityUploadFileItems = () => {
    if (activityUploadModal === "inspection") {
      return [
        ...activityUploadDraft.inspectionPhotos.map((file) => ({
          file,
          kind: "photo",
          metadata: { inspection_photo: true },
        })),
        ...activityUploadDraft.inspectionDocuments.map((file) => ({
          file,
          kind: "document",
          metadata: {
            inspection_document: true,
            document_source_type: file.type?.startsWith("image/") ? "image" : "pdf",
          },
        })),
      ];
    }
    if (activityUploadModal === "training") {
      const categoryFiles = TRAINING_UPLOAD_CATEGORIES.flatMap(([key, label]) =>
        (activityUploadDraft.trainingPhotos[key] || []).map((file) => ({
          file,
          kind: "photo",
          categoryKey: key,
          metadata: {
            training_category: key,
            training_category_label: label,
            training_photo: true,
          },
        })),
      );
      return [
        ...categoryFiles,
        ...activityUploadDraft.trainingDocuments.map((file) => ({
          file,
          kind: "document",
          metadata: {
            training_document: true,
            document_source_type: file.type?.startsWith("image/") ? "image" : "pdf",
          },
        })),
      ];
    }
    if (activityUploadModal === "deepCleaning") {
      return [
        ...activityUploadDraft.deepBefore.map((file) => ({
          file,
          kind: "before",
          metadata: {
            deep_cleaning_stage: "before",
            before_image: true,
          },
        })),
        ...activityUploadDraft.deepAfter.map((file) => ({
          file,
          kind: "after",
          metadata: {
            deep_cleaning_stage: "after",
            after_image: true,
          },
        })),
        ...activityUploadDraft.deepDocuments.map((file) => ({
          file,
          kind: "document",
          metadata: {
            supporting_document: true,
            deep_cleaning_document: true,
            document_source_type: file.type?.startsWith("image/") ? "image" : "pdf",
          },
        })),
      ];
    }
    return [];
  };
  const resetActivityUploadDraft = () => {
    setActivityUploadDraft({
      visitId: "",
      inspectionPhotos: [],
      inspectionDocuments: [],
      hkStaff: [],
      hkEmpId: "",
      hkName: "",
      trainingPhotos: {},
      trainingDocuments: [],
      deepBefore: [],
      deepAfter: [],
      deepDocuments: [],
    });
  };
  const selectedActivityVisitContext = () => {
    const option = activityVisitOptions.find((item) => item.id === activityUploadDraft.visitId);
    const visit = option?.visit || visits[0] || null;
    const attendanceForVisit =
      attendances.find((row) => String(row?.id || "") === String(visit?.attendance_id || "")) ||
      attendance ||
      firstAttendance ||
      null;
    return { visit, attendance: attendanceForVisit };
  };
  const buildSubmissionMetadata = ({ status, fileItems, visit, activityType }) => {
    const uploader = uploadedByMetadata(generatedByUser);
    const base = {
      ...uploader,
      store_name: visit?.store_name || visit?.site_name || visitTitle(visit),
      client_name: visit?.client_name || visit?.clientName || visitClient(visit),
      state: visit?.state || officer?.state || null,
      activity_date: toDateInputValue(new Date(visit?.check_in_time || fromDate || new Date())),
      pending_images: fileItems.length === 0,
      web_upload_status: status,
      web_uploaded_at: new Date().toISOString(),
    };
    if (activityType === "training") {
      const completed = TRAINING_UPLOAD_CATEGORIES
        .filter(([key]) => (activityUploadDraft.trainingPhotos[key] || []).length > 0)
        .map(([key]) => key);
      return {
        ...base,
        hk_staff_attended: activityUploadDraft.hkStaff,
        training_categories_total: TRAINING_UPLOAD_CATEGORIES.length,
        training_categories_completed: completed,
        training_categories_completed_count: completed.length,
        training_document_uploaded: activityUploadDraft.trainingDocuments.length > 0,
      };
    }
    if (activityType === "deep_cleaning") {
      return {
        ...base,
        deep_cleaning_before_count: activityUploadDraft.deepBefore.length,
        deep_cleaning_after_count: activityUploadDraft.deepAfter.length,
        deep_cleaning_document_uploaded: activityUploadDraft.deepDocuments.length > 0,
      };
    }
    return {
      ...base,
      inspection_photo_count: activityUploadDraft.inspectionPhotos.length,
      inspection_document_uploaded: activityUploadDraft.inspectionDocuments.length > 0,
    };
  };
  const saveActivityUploadDraft = async (action) => {
    if (!webUploadEnabled) {
      setActivityUploadError("You do not have permission to upload activity files.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setActivityUploadError("Upload failed because Supabase is not configured.");
      return;
    }
    const activityType = activityDbTypeForModal(activityUploadModal);
    if (!activityType) {
      setActivityUploadError("Please select an activity type.");
      return;
    }
    const { visit, attendance: selectedAttendance } = selectedActivityVisitContext();
    if (!visit?.id) {
      setActivityUploadError("Please select a site visit before uploading.");
      return;
    }
    const employeeCode = selectedEmployeeCodeForActivity(officer);
    if (!employeeCode) {
      setActivityUploadError("Selected employee code is missing.");
      return;
    }
    const fileItems = activityUploadFileItems();
    if (action === "submit" && activityType === "training" && fileItems.length === 0) {
      setActivityUploadError("Please upload at least one training photo or document before submitting.");
      return;
    }
    const unsupported = fileItems.find(({ file }) => {
      const type = String(file.type || "").toLowerCase();
      return !type.startsWith("image/") && type !== "application/pdf";
    });
    if (unsupported) {
      setActivityUploadError("Unsupported file type. Please upload JPG, PNG, or PDF.");
      return;
    }
    const tooLarge = fileItems.find(({ file }) => file.size > 10 * 1024 * 1024);
    if (tooLarge) {
      setActivityUploadError("File too large. Please upload files up to 10MB each.");
      return;
    }

    setActivityUploadSaving(true);
    setActivityUploadError("");
    const uploadedStoragePaths = [];
    try {
      const status = action === "draft" ? "draft" : "submitted";
      const existingRes = await supabase
        .from("fo_activity_submissions")
        .select("*")
        .eq("site_visit_id", visit.id)
        .eq("activity_type", activityType)
        .or(`fo_user_id.eq.${employeeCode},employee_code.eq.${employeeCode}`)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingRes.error) throw existingRes.error;

      const existingMetadata = objectMetadata(existingRes.data);
      const metadata = {
        ...existingMetadata,
        ...buildSubmissionMetadata({ status, fileItems, visit, activityType }),
      };
      const submissionPayload = {
        fo_user_id: employeeCode,
        employee_code: employeeCode,
        attendance_id: selectedAttendance?.id || visit.attendance_id || null,
        site_visit_id: visit.id,
        store_id: visit.store_id || null,
        store_code: visit.store_code || null,
        activity_type: activityType,
        status,
        remarks: null,
        submitted_at: existingRes.data?.submitted_at || new Date().toISOString(),
        metadata,
        updated_at: new Date().toISOString(),
      };

      let submissionId = existingRes.data?.id;
      if (submissionId) {
        const updateRes = await supabase
          .from("fo_activity_submissions")
          .update(submissionPayload)
          .eq("id", submissionId)
          .select("id")
          .maybeSingle();
        if (updateRes.error) throw updateRes.error;
      } else {
        const insertRes = await supabase
          .from("fo_activity_submissions")
          .insert({ ...submissionPayload, local_id: `web-${crypto.randomUUID()}` })
          .select("id")
          .maybeSingle();
        if (insertRes.error) throw insertRes.error;
        submissionId = insertRes.data?.id;
      }
      if (!submissionId) throw new Error("Activity submission could not be saved.");

      for (const item of fileItems) {
        const { file, kind, categoryKey, metadata: fileMetadata } = item;
        const extension = fileExtensionFromName(file.name, file.type);
        const attendanceDate = toDateInputValue(new Date(selectedAttendance?.login_time || visit.check_in_time || fromDate || new Date()));
        const path = [
          storageSafePart(employeeCode),
          attendanceDate,
          storageSafePart(activityType),
          storageSafePart(submissionId),
          `${storageSafePart(crypto.randomUUID())}_${storageSafePart(file.name.replace(/\.[^.]+$/, ""), "activity")}.${extension}`,
        ].join("/");
        const uploadRes = await supabase.storage
          .from("fo-activity-uploads")
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadRes.error) throw uploadRes.error;
        uploadedStoragePaths.push(path);
        const fileUrl = `fo-activity-uploads/${path}`;
        const uploadRole = activityUploadRole(activityUploadModal, kind, categoryKey);
        const uploadMetadata = {
          ...uploadedByMetadata(generatedByUser),
          store_name: visit.store_name || visit.site_name || visitTitle(visit),
          client_name: visit.client_name || visitClient(visit),
          state: visit.state || officer?.state || null,
          upload_role: uploadRole,
          ...fileMetadata,
        };
        const uploadRowRes = await supabase
          .from("fo_activity_uploads")
          .insert({
            submission_id: submissionId,
            fo_user_id: employeeCode,
            employee_code: employeeCode,
            attendance_id: selectedAttendance?.id || visit.attendance_id || null,
            site_visit_id: visit.id,
            store_code: visit.store_code || null,
            activity_type: activityType,
            upload_role: uploadRole,
            file_url: fileUrl,
            file_name: file.name,
            file_type: file.type || "application/octet-stream",
            file_size: file.size,
            storage_bucket: "fo-activity-uploads",
            uploaded_at: new Date().toISOString(),
            local_id: `web-upload-${crypto.randomUUID()}`,
            metadata: uploadMetadata,
          });
        if (uploadRowRes.error) throw uploadRowRes.error;
      }

      if (typeof onActivityUploadSaved === "function") {
        onActivityUploadSaved();
      }
      resetActivityUploadDraft();
      closeActivityUploadModal();
    } catch (error) {
      console.warn("[myQPMS FO] Web activity upload failed.", error);
      await Promise.allSettled(
        uploadedStoragePaths.map((path) =>
          supabase.storage.from("fo-activity-uploads").remove([path]),
        ),
      );
      const message = String(error?.message || error || "");
      if (/permission|policy|rls|denied/i.test(message)) {
        setActivityUploadError("Storage or database permission denied for this upload.");
      } else {
        setActivityUploadError(message || "Upload failed. Please try again.");
      }
    } finally {
      setActivityUploadSaving(false);
    }
  };
  const status = officerStatus(officer);
  const isLive = isOperationallyActive(officer);
  const periodSummary = rangeDataset?.period_summary || {};
  const reportKilometer = employeeRangeMetric(rangeDataset, "kilometer");
  const reportTotalAmount = employeeRangeMetric(rangeDataset, "total_amount");
  const reportState = reportReadiness({
    loading: rangeDatasetLoading,
    dataset: rangeDataset,
    error: rangeDatasetError,
  });
  const workingMinutes = attendances.reduce(
    (sum, row) => sum + Number(attendanceWorkingMinutes(row) || 0),
    0,
  );
  const storedPayableKm = Number(officer?.eligibleKm ?? officer?.routeKmToday);
  const approvedMissingCheckoutKm = Number(
    officer?.approvedMissingCheckoutAdjustmentKm ??
      approvedMissingCheckoutAdjustmentKm(visits),
  );
  const basePayableKm = Number.isFinite(Number(officer?.basePayableKm))
    ? Number(officer.basePayableKm)
    : Number.isFinite(storedPayableKm)
      ? Math.max(0, storedPayableKm - (Number.isFinite(approvedMissingCheckoutKm) ? approvedMissingCheckoutKm : 0))
      : 0;
  const totalKm = basePayableKm + (Number.isFinite(approvedMissingCheckoutKm) ? approvedMissingCheckoutKm : 0);
  const gpsMetrics = useMemo(
    () =>
      actualTravelKmFromAttendanceOrLogs(
        attendance,
        routeLogs,
        visits,
      ),
    [attendance, routeLogs, visits],
  );
  const gpsAuditKm = Number(
    rangeDataset
      ? periodSummary.actual_travel_km
      : routeLogs.length
        ? gpsMetrics.actualTravelKm
        : officer?.actualTravelKm ?? gpsMetrics.actualTravelKm ?? officer?.actualKm,
  );
  const kmDelta =
    Number.isFinite(totalKm) && Number.isFinite(gpsAuditKm)
      ? totalKm - gpsAuditKm
      : null;
  const differencePercent =
    Number.isFinite(kmDelta) && Number.isFinite(gpsAuditKm) && gpsAuditKm > 0
      ? (kmDelta / gpsAuditKm) * 100
      : null;
  const travelMode = currentTravelModeFromRows({ attendance, officer });
  const ratePerKm = travelModeRatePerKm(
    travelMode,
    officer?.ratePerKm ?? attendance?.rate_per_km,
  );
  const storedDetailPetrolAmount = attendances.length
    ? sumAttendancePetrolAmount(attendances)
    : null;
  const detailPetrolPending = attendances.some(isCanonicalPetrolPending);
  const petrolAmount = detailPetrolPending
    ? undefined
    : storedDetailPetrolAmount ?? calculatePetrolAmount(totalKm, ratePerKm);
  const startPoint = pointFromAttendanceStart(firstAttendance);
  const endPoint = routePointFromAttendanceEnd(lastAttendance);
  const startBattery =
    firstAttendance.start_battery_percentage ?? firstAttendance.battery_start;
  const endBattery =
    lastAttendance.end_battery_percentage ?? lastAttendance.battery_end;
  const reviewFlags = officer?.reviewFlags || [];
  const attendanceMeta = attendanceMetadata(attendance);
  const gpsFallbackReview = gpsFallbackReviewFromAttendance(attendance);
  const travelLegs = Array.isArray(attendanceMeta.travel_legs)
    ? attendanceMeta.travel_legs
    : [];
  const firstPreSiteLeg =
    travelLegs.find((leg) => leg?.type === "start_to_first_checkin") || null;
  const payableKmSourceReason =
    gpsFallbackReview.reason ||
    attendanceMeta.selected_km_source_reason ||
    attendanceMeta.payable_km_source_reason ||
    firstPreSiteLeg?.payable_km_source_reason ||
    attendanceMeta.payable_km_source_detail ||
    attendanceMeta.selected_km_source ||
    officer?.routeKmSource ||
    "--";
  const googleDirectRouteKm = numberOrNull(
    firstPreSiteLeg?.google_direct_route_km,
  );
  const preSiteRawGpsKm = numberOrNull(firstPreSiteLeg?.raw_gps_km);
  const preSiteFilteredGpsKm = numberOrNull(firstPreSiteLeg?.filtered_gps_km);
  const checkoutExceptions = useMemo(
    () =>
      visits
        .map((visit, index) => ({
          visit,
          index,
          exception: checkoutExceptionForVisit(visit),
        }))
        .filter((item) => item.exception.requiresReview),
    [visits],
  );
  const timelineRows = useMemo(() => {
    const rows = [];
    if (firstAttendance.login_time) {
      const startCoordinates = pointFromAttendanceStart(firstAttendance);
      rows.push({
        key: "start",
        index: <PlayCircle className="h-4 w-4" />,
        site: "Start Day",
        location: startCoordinates
          ? `${startCoordinates.latitude.toFixed(5)}, ${startCoordinates.longitude.toFixed(5)}`
          : "--",
        locationCoordinates: startCoordinates,
        checkIn: formatDateTime(firstAttendance.login_time),
        checkOut: "--",
        duration: "--",
        travelFromPrevious: "--",
        distance: "--",
        missingKm: "--",
        remarks: "Start of day",
      });
    }
    visits.forEach((visit, index) => {
      const exception = checkoutExceptionForVisit(visit);
      rows.push({
        key: visit.id || `${visit.check_in_time}-${index}`,
        index: index + 1,
        site: `${visitTitle(visit)} / ${visitClient(visit)}`,
        location: visitLocation(visit),
        locationCoordinates: visitCheckInCoordinates(visit),
        checkIn: formatDateTime(visit.check_in_time),
        checkOut: formatDateTime(siteVisitCheckoutValue(visit)),
        duration: durationMinutesLabel(visitMinutes(visit)),
        travelFromPrevious: index === 0 ? "Start Day" : visitTitle(visits[index - 1]),
        distance: numberLabel(visit.route_km, " km"),
        missingKm: exception.requiresReview ? missingCheckoutKmLabel(visit) : "--",
        missingEvidence: exception.requiresReview ? missingCheckoutEvidenceLabel(visit) : "",
        remarks: visitRemarks(visit),
        exception,
        visit,
        visitIndex: index,
      });
    });
    if (lastAttendance.logout_time) {
      const endCoordinates = attendanceEndCoordinates(lastAttendance);
      const staleAutoEndNote = staleAutoEndReviewNote(lastAttendance);
      const finalReturnLegKm = finalReturnLegKmFromAttendance(lastAttendance);
      const finalReturnLegDistance =
        finalReturnLegKm === null ? "--" : numberLabel(finalReturnLegKm, " km");
      if (import.meta.env.DEV) {
        const finalLegMetadata = attendanceMetadata(lastAttendance);
        console.log("FINAL LEG DEBUG", {
          attendanceId: lastAttendance.id,
          lastSiteName: visits.length ? visitTitle(visits.at(-1)) : null,
          lastSiteCheckoutLat:
            finalLegMetadata.final_return_leg_origin_lat ??
            finalLegMetadata.final_return_leg_from?.latitude ??
            null,
          lastSiteCheckoutLng:
            finalLegMetadata.final_return_leg_origin_lng ??
            finalLegMetadata.final_return_leg_from?.longitude ??
            null,
          endLat:
            finalLegMetadata.final_return_leg_destination_lat ??
            finalLegMetadata.final_return_leg_to?.latitude ??
            endCoordinates?.latitude ??
            null,
          endLng:
            finalLegMetadata.final_return_leg_destination_lng ??
            finalLegMetadata.final_return_leg_to?.longitude ??
            endCoordinates?.longitude ??
            null,
          finalLegKm: finalReturnLegKm,
          totalPayableKm: totalKm,
        });
      }
      rows.push({
        key: "end",
        index: <Square className="h-3.5 w-3.5" />,
        site: "End Day",
        location: endCoordinates
          ? `${endCoordinates.latitude.toFixed(5)}, ${endCoordinates.longitude.toFixed(5)}`
          : "--",
        locationCoordinates: endCoordinates,
        checkIn: "--",
        checkOut: formatDateTime(lastAttendance.logout_time),
        duration: durationMinutesLabel(workingMinutes),
        travelFromPrevious: visits.length ? visitTitle(visits.at(-1)) : "--",
        distance: finalReturnLegDistance,
        missingKm: "--",
        remarks: staleAutoEndNote || "End of day",
      });
    }
    return rows;
  }, [firstAttendance, lastAttendance, totalKm, visits, workingMinutes]);

  const selectedTravelFromPrevious = selectedVisit
    ? activeVisitIndex === 0
      ? "Start Day"
      : visitTitle(visits[activeVisitIndex - 1])
    : "--";
  const selectedCheckoutException = selectedVisit
    ? checkoutExceptionForVisit(selectedVisit)
    : null;
  const selectedCheckoutReviewStatus = selectedVisit
    ? checkoutReviewStatus(selectedVisit)
    : null;
  const selectedCheckInCoordinates = selectedVisit
    ? visitCheckInCoordinates(selectedVisit)
    : null;
  const generatedByName =
    generatedByUser?.full_name ||
    generatedByUser?.display_name ||
    generatedByUser?.name ||
    generatedByUser?.profile?.full_name ||
    generatedByUser?.profile?.display_name ||
    generatedByUser?.email ||
    generatedByUser?.employee_code ||
    "myQPMS User";
  const generatedByRole =
    generatedByUser?.rawRole || generatedByUser?.role || "";
  const generatedByLabel = generatedByRole
    ? `${generatedByName} (${generatedByRole})`
    : generatedByName;
  const showCheckoutReviewPreview = (visit, action) => {
    setCheckoutReviewPreview({
      visitKey:
        visit?.id ||
        `${visit?.check_in_time || "visit"}-${visitTitle(visit)}`,
      action,
      message:
        "Approval saving requires backend support. This is currently a UI preview only.",
    });
  };
  const handleCheckoutReviewAction = (visit, action) => {
    if (typeof onCheckoutReviewAction === "function") {
      onCheckoutReviewAction(visit, action);
      return;
    }
    showCheckoutReviewPreview(visit, action);
  };
  const canViewRouteGpsEvidence = fullTechnicalAccess;
  const tabs = useMemo(() => [
    ["overview", "Overview"],
    ["visits", "Visits"],
    ["activity", "Activity Photos"],
    ["km", "KM & Petrol"],
    ...(canViewRouteGpsEvidence ? [["route", "Route / GPS Evidence"]] : []),
    ["report", "Report"],
  ], [canViewRouteGpsEvidence]);
  const activeDetailTab = tabs.some(([id]) => id === activeTab)
    ? activeTab
    : "overview";
  useEffect(() => {
    onRouteGpsEvidenceActive?.(activeDetailTab === "route" || routeMapOpen ? officer?.id || null : null);
    return () => onRouteGpsEvidenceActive?.(null);
  }, [activeDetailTab, officer?.id, onRouteGpsEvidenceActive, routeMapOpen]);
  const printReport = useCallback(() => {
    const previousTitle = document.title;
    const reportTitle = buildFieldActivityReportFilename(
      officer,
      fromDate,
      toDate,
    );
    let restored = false;
    let fallbackTimer;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
      window.removeEventListener("focus", restoreTitle);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };

    document.title = reportTitle;
    window.addEventListener("afterprint", restoreTitle, { once: true });
    window.addEventListener("focus", restoreTitle, { once: true });
    fallbackTimer = window.setTimeout(restoreTitle, 60000);
    window.print();
  }, [fromDate, officer, toDate]);
  useEffect(() => {
    if (
      !printRequested ||
      activeDetailTab !== "report" ||
      reportState !== "ready"
    ) {
      return undefined;
    }
    let secondFrame = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPrintRequested(false);
        printReport();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [activeDetailTab, printReport, printRequested, reportState]);
  const openPrintReport = () => {
    if (reportState !== "ready") return;
    setDrillDownOpen(true);
    setActiveTab("report");
    setPrintRequested(true);
  };

  if (!drillDownOpen) {
    return (
      <div className="min-h-screen space-y-4 bg-slate-50/70 p-1 sm:p-2">
        <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                onClick={onBack}
                className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-qpms-700 hover:bg-qpms-50"
                aria-label="Back to list"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-black text-slate-950 sm:text-2xl">
                  {officer?.name || "--"}
                </h1>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Employee ID: {displayValue(officer?.employeeCode || officer?.foId)} ·{" "}
                  {displayValue(officer?.designation || officer?.role)} ·{" "}
                  {displayValue(officer?.state)}
                </p>
                <p className="mt-1 text-xs font-semibold text-qpms-700">
                  Selected range: {formatDateOnly(fromDate)} to {formatDateOnly(toDate)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="date"
                value={draftFromDate}
                onChange={(event) => onDraftFromDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                aria-label="Detail from date"
              />
              <span className="pb-2 text-xs text-slate-400">to</span>
              <input
                type="date"
                value={draftToDate}
                onChange={(event) => onDraftToDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                aria-label="Detail to date"
              />
              <button
                type="button"
                onClick={onApplyDate}
                className="focus-ring rounded-lg border border-qpms-200 px-3 py-2 text-xs font-black text-qpms-700"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setDrillDownOpen(true)}
                className="focus-ring inline-flex items-center gap-2 rounded-lg bg-qpms-700 px-4 py-2 text-xs font-black text-white hover:bg-qpms-800"
              >
                <ClipboardList className="h-4 w-4" /> Open Drill Down
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3 xl:grid-cols-7">
          <DetailSummaryCard icon={PlayCircle} label="Period First Start" value={formatTime(firstAttendance.login_time)} hint={formatDateOnly(firstAttendance.login_time)} tone="green" />
          <DetailSummaryCard icon={Square} label="Period Last End" value={formatTime(lastAttendance.logout_time)} hint={formatDateOnly(lastAttendance.logout_time)} tone="red" />
          <DetailSummaryCard icon={MapPin} label="Total Sites" value={visits.length || "--"} hint="Selected range" tone="purple" />
          <DetailSummaryCard icon={Route} label="Kilometer" value={reportKilometerLabel(reportKilometer)} hint="Bike and Car payable distance" tone="green" />
          <DetailSummaryCard icon={Bike} label="Travel Mode" value={travelModeLabel(travelMode)} hint={`Current @ ${formatInr(ratePerKm)} / km`} tone="blue" />
          <DetailSummaryCard icon={Fuel} label="Total Amount" value={reportMoneyLabel(reportTotalAmount)} hint="Travel reimbursement total" tone="amber" />
          <DetailSummaryCard icon={ShieldCheck} label="Period Attendance Status" value={displayValue(periodSummary.period_attendance_status || lastAttendance.status)} hint={attendances.length > 1 ? `${attendances.length} attendance records` : "--"} tone={periodSummary.incomplete_count > 0 ? "amber" : "blue"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-950">Visit Timeline Summary</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {visits.length} visits in the selected date range
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRouteMapOpen((value) => !value)}
                className="focus-ring inline-flex items-center gap-2 rounded-lg border border-qpms-200 px-3 py-2 text-xs font-black text-qpms-700"
              >
                <MapPinned className="h-4 w-4" />
                {routeMapOpen ? "Hide Route Map" : "Show Route Map"}
              </button>
            </div>
            <div className="mt-3 overflow-auto rounded-xl border border-slate-100">
              <table className="min-w-[680px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                  <tr>
                    {["#", "Site / Client", "Check-in", "Check-out", "Duration", "Route KM", "Remarks"].map((heading) => (
                      <th key={heading} className="px-3 py-3">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold text-slate-600">
                  {visits.map((visit, index) => (
                    <tr key={visit.id || index}>
                      <td className="px-3 py-3">{index + 1}</td>
                      <td className="px-3 py-3 font-black text-slate-900">{visitTitle(visit)} / {visitClient(visit)}</td>
                      <td className="whitespace-nowrap px-3 py-3">{formatDateTime(visit.check_in_time)}</td>
                      <td className="whitespace-nowrap px-3 py-3">{formatDateTime(siteVisitCheckoutValue(visit))}</td>
                      <td className="px-3 py-3">{durationMinutesLabel(visitMinutes(visit))}</td>
                      <td className="px-3 py-3">{numberLabel(visit.route_km, " km")}</td>
                      <td className="px-3 py-3">{visitRemarks(visit)}</td>
                    </tr>
                  ))}
                  {!visits.length ? (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">No visits available for this date range.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {routeMapOpen ? (
              <div className="mt-4">
                <GoogleRouteMap officer={officer} routeLogs={routeLogs} fromDate={fromDate} toDate={toDate} />
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-black text-slate-950">Business Summary</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold">
                <div className="flex justify-between"><span className="text-slate-500">Attendance days</span><strong>{attendances.length || "--"}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Site visits</span><strong>{visits.length}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Base Payable KM</span><strong>{basePayableKm.toFixed(1)} km</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Approved Missing KM</span><strong>{approvedMissingCheckoutKm.toFixed(1)} km</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Final Payable KM</span><strong className="text-emerald-600">{Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--"}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Travel Mode</span><strong>{travelModeLabel(travelMode)}</strong></div>
                <div className="flex justify-between border-t border-slate-100 pt-3"><span className="text-slate-600">Petrol Amount</span><strong className="text-lg">{moneyLabel(petrolAmount)}</strong></div>
              </div>
            </section>
            {reviewFlags.length ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-sm font-black text-amber-900">Needs attention</h2>
                <p className="mt-2 text-xs font-semibold leading-5 text-amber-800">
                  Some attendance or route records need administrative review.
                </p>
              </section>
            ) : null}
            <button
              type="button"
              onClick={() => setDrillDownOpen(true)}
              className="focus-ring w-full rounded-xl bg-qpms-700 px-4 py-3 text-sm font-black text-white"
            >
              View KM Report
            </button>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="fo-activity-detail min-h-screen space-y-4 bg-slate-50/70 p-1 sm:p-2">
      <header className="fo-screen-only rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-black text-slate-700 hover:text-qpms-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Employees
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="focus-ring grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-gradient-to-br from-qpms-100 to-blue-50 text-lg font-black text-qpms-700 shadow-sm"
              aria-label="Back to employees"
            >
              {String(officer?.name || officer?.employeeCode || "U").trim().slice(0, 1).toUpperCase()}
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-black text-slate-950 sm:text-2xl">
                  {officer?.name || "--"}
                </h1>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isLive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  Today's Status: {isLive ? "Active" : displayValue(status.label)}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {displayValue(officer?.designation || officer?.role)} <span className="px-1">•</span>
                {displayValue(officer?.state)} <span className="px-1">•</span>
                Employee ID: {displayValue(officer?.employeeCode || officer?.foId)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              <label>
                <span className="sr-only">From Date</span>
                <input
                  type="date"
                  value={draftFromDate}
                  onChange={(event) => onDraftFromDate(event.target.value)}
                  className="w-[124px] border-0 bg-transparent p-0 text-xs font-bold text-slate-700 outline-none"
                />
              </label>
              <span className="text-xs font-semibold text-slate-400">–</span>
              <label>
                <span className="sr-only">To Date</span>
                <input
                  type="date"
                  value={draftToDate}
                  onChange={(event) => onDraftToDate(event.target.value)}
                  className="w-[124px] border-0 bg-transparent p-0 text-xs font-bold text-slate-700 outline-none"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={onApplyDate}
              className="focus-ring rounded-xl bg-qpms-700 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-qpms-800"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={openPrintReport}
              disabled={reportState !== "ready"}
              className="focus-ring inline-flex items-center gap-2 rounded-xl border border-qpms-200 bg-white px-3 py-2.5 text-xs font-black text-qpms-700 shadow-sm hover:bg-qpms-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export PDF
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={reportState !== "ready"}
              className="focus-ring inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </button>
            <button
              type="button"
              className="focus-ring grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50"
              aria-label="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <div className="fo-screen-only grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailSummaryCard icon={PlayCircle} label="Period First Start" value={formatTime(firstAttendance.login_time)} hint={formatDateOnly(firstAttendance.login_time)} tone="green" />
        <DetailSummaryCard icon={Square} label="Period Last End" value={formatTime(lastAttendance.logout_time)} hint={formatDateOnly(lastAttendance.logout_time)} tone="red" />
        <DetailSummaryCard icon={MapPin} label="Total Sites" value={visits.length || "--"} hint="Visited" tone="purple" />
        <DetailSummaryCard icon={Route} label="Kilometer" value={reportKilometerLabel(reportKilometer)} hint="Bike and Car payable distance" tone="green" />
        <DetailSummaryCard icon={Navigation2} label="GPS Audit KM" value={Number.isFinite(gpsAuditKm) ? `${gpsAuditKm.toFixed(1)} km` : "--"} hint="Supporting evidence" tone="blue" />
        <DetailSummaryCard icon={CircleGauge} label="Delta" value={Number.isFinite(kmDelta) ? `${kmDelta.toFixed(1)} km` : "--"} hint={Number.isFinite(differencePercent) ? `${differencePercent.toFixed(1)}%` : "--"} tone={Math.abs(kmDelta || 0) > 2 ? "amber" : "green"} />
        <DetailSummaryCard icon={Fuel} label="Total Amount" value={reportMoneyLabel(reportTotalAmount)} hint="Travel reimbursement total" tone="amber" />
        <DetailSummaryCard icon={ShieldCheck} label="Period Attendance Status" value={displayValue(periodSummary.period_attendance_status || lastAttendance.status)} hint={`${periodSummary.attendance_count || attendances.length} attendance record(s)`} tone={periodSummary.incomplete_count > 0 ? "amber" : "green"} />
      </div>
      <header className="fo-screen-only hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="focus-ring mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-qpms-700 hover:bg-qpms-50"
              aria-label="Back to operations dashboard"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="break-words text-xl font-black text-slate-950 sm:text-2xl">
                {officer?.name || "--"} — Field Activity & KM Report
              </h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Employee ID: {displayValue(officer?.employeeCode || officer?.foId)} ·{" "}
                {displayValue(officer?.designation || officer?.role)} ·{" "}
                {displayValue(officer?.state)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <label>
              <span className="sr-only">From Date</span>
              <input
                type="date"
                value={draftFromDate}
                onChange={(event) => onDraftFromDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-qpms-500"
              />
            </label>
            <span className="pb-2 text-xs font-semibold text-slate-400">to</span>
            <label>
              <span className="sr-only">To Date</span>
              <input
                type="date"
                value={draftToDate}
                onChange={(event) => onDraftToDate(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-qpms-500"
              />
            </label>
            <button
              type="button"
              onClick={onApplyDate}
              className="focus-ring rounded-lg border border-qpms-200 px-3 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50"
            >
              Apply
            </button>
              <button
                type="button"
                onClick={openPrintReport}
                disabled={reportState !== "ready"}
                className="focus-ring inline-flex items-center gap-2 rounded-lg border border-qpms-200 bg-white px-3 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export PDF
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={reportState !== "ready"}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </button>
            <button
              type="button"
              onClick={onBack}
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-qpms-700 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" /> Back to List
            </button>
          </div>
        </div>
      </header>

      <div className="fo-screen-only hidden grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <DetailSummaryCard icon={PlayCircle} label="Period First Start" value={formatTime(firstAttendance.login_time)} hint={formatDateOnly(firstAttendance.login_time)} tone="green" />
        <DetailSummaryCard icon={Square} label="Period Last End" value={formatTime(lastAttendance.logout_time)} hint={formatDateOnly(lastAttendance.logout_time)} tone="red" />
        <DetailSummaryCard icon={MapPin} label="Total Sites" value={visits.length || "--"} hint="Visited" tone="purple" />
        <DetailSummaryCard icon={Route} label="Kilometer" value={reportKilometerLabel(reportKilometer)} hint="Bike and Car payable distance" tone="green" />
        {fullTechnicalAccess ? <DetailSummaryCard icon={Navigation2} label="GPS Audit KM" value={Number.isFinite(gpsAuditKm) ? `${gpsAuditKm.toFixed(1)} km` : "--"} hint="Supporting evidence" tone="blue" /> : null}
        {fullTechnicalAccess ? <DetailSummaryCard icon={CircleGauge} label="Delta" value={Number.isFinite(kmDelta) ? `${kmDelta.toFixed(1)} km` : "--"} hint={Number.isFinite(differencePercent) ? `${differencePercent.toFixed(1)}%` : "--"} tone={Math.abs(kmDelta || 0) > 2 ? "amber" : "green"} /> : null}
        <DetailSummaryCard icon={Fuel} label="Total Amount" value={reportMoneyLabel(reportTotalAmount)} hint="Travel reimbursement total" tone="amber" />
        <DetailSummaryCard icon={ShieldCheck} label="Period Attendance Status" value={displayValue(periodSummary.period_attendance_status || lastAttendance.status)} hint={`${periodSummary.attendance_count || attendances.length} attendance record(s)`} tone={periodSummary.incomplete_count > 0 ? "amber" : "green"} />
      </div>

      <nav className="fo-screen-only flex overflow-x-auto rounded-2xl border border-slate-200 bg-white px-2 shadow-sm">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`focus-ring min-w-max border-b-2 px-5 py-3 text-sm font-bold ${
              activeDetailTab === id
                ? "border-qpms-600 text-qpms-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeDetailTab === "overview" ? (
        <div className="fo-screen-only grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-slate-950">Employee & Attendance</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Employee Name", officer?.name],
                ["Employee ID", officer?.employeeCode || officer?.foId],
                ["Role / Designation", officer?.designation || officer?.role],
                ["State", officer?.state],
                ["Mobile", officer?.phone],
                ["Attendance Status", attendance.status || status.label],
                ["Working Duration", durationMinutesLabel(workingMinutes)],
                ["Total Visits", visits.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-black text-slate-800">{displayValue(value)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-slate-950">Start / End Day Evidence</h2>
            <div className="mt-4 space-y-3">
              {[
                ["Start Day", formatDateTime(attendance.login_time), startPoint ? formatVisitCoordinates(startPoint) : "--", startBattery],
                ["End Day", formatDateTime(attendance.logout_time), endPoint ? formatVisitCoordinates({ latitude: endPoint[0], longitude: endPoint[1] }) : "--", endBattery],
              ].map(([label, time, location, battery]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm text-slate-900">{label}</strong>
                    <span className="text-xs font-bold text-slate-500">{time}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-500">Location: {location}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Battery: {battery === null || battery === undefined ? "--" : `${battery}%`}
                  </p>
                </div>
              ))}
              {reviewFlags.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                  Review warnings: {reviewFlags.join(", ")}
                </div>
              ) : null}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <h2 className="text-base font-black text-slate-950">
              Site Visit Summary
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Total Sites Visited", visits.length],
                ["First Site", visits.length ? visitTitle(visits[0]) : "--"],
                ["Last Site", visits.length ? visitTitle(visits.at(-1)) : "--"],
                ["Checkout Exceptions", checkoutExceptions.length],
                ["Open / Missing Checkout", checkoutExceptions.filter((item) => item.exception.type === "missing").length],
                ["Base Payable KM", `${basePayableKm.toFixed(1)} km`],
                ["Approved Missing KM Adjustment", `${approvedMissingCheckoutKm.toFixed(1)} km`],
                ["Final Payable KM", Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--"],
                ["Petrol Amount", moneyLabel(petrolAmount)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">
                    {label}
                  </p>
                  <p className="mt-1 break-words text-sm font-black text-slate-800">
                    {displayValue(value)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeDetailTab === "visits" ? (
        <div className="fo-screen-only min-w-0 space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-950">
              Visit Timeline{" "}
              <span className="text-sm font-semibold text-slate-500">
                ({visits.length} Sites Visited)
              </span>
            </h2>
            <div className="mt-3 w-full overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-[1080px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    {["#", "Site / Client", "Location Lat/Lng", "Check-in", "Check-out", "Duration", "Travel from Previous", "Route KM", "Missing KM", "Remarks / Review"].map((heading) => (
                      <th key={heading} className="whitespace-nowrap px-3 py-3">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold text-slate-600">
                  {timelineRows.map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => row.visitIndex !== undefined && setSelectedVisitIndex(row.visitIndex)}
                      className={row.visitIndex !== undefined ? "cursor-pointer hover:bg-qpms-50/40" : ""}
                    >
                      <td className="px-3 py-3">
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-black text-white ${row.key === "start" ? "bg-emerald-500" : row.key === "end" ? "bg-slate-500" : "bg-blue-600"}`}>{row.index}</span>
                      </td>
                      <td className="min-w-44 px-3 py-3 font-black text-slate-900">{row.site}</td>
                      <td className="min-w-44 px-3 py-3">
                        {row.locationCoordinates ? (
                          <a
                            href={visitGoogleMapsUrl(row.locationCoordinates)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="font-bold text-qpms-700 underline decoration-qpms-200 underline-offset-2 hover:text-qpms-900"
                            title="Open location in Google Maps"
                          >
                            {formatVisitCoordinates(row.locationCoordinates)}
                          </a>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">{row.checkIn}</td>
                      <td className="whitespace-nowrap px-3 py-3">{row.checkOut}</td>
                      <td className="whitespace-nowrap px-3 py-3">{row.duration}</td>
                      <td className="min-w-36 px-3 py-3">{row.travelFromPrevious}</td>
                      <td className="whitespace-nowrap px-3 py-3">{row.distance}</td>
                      <td className="min-w-32 px-3 py-3">
                        <div className="space-y-1">
                          <p className="font-black text-slate-800">{row.missingKm || "--"}</p>
                          {row.missingEvidence ? (
                            <p className="text-[10px] font-semibold text-slate-500">
                              {row.missingEvidence}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="min-w-44 px-3 py-3">
                        <div className="space-y-1.5">
                          {row.exception ? <CheckoutStatusChip exception={row.exception} /> : null}
                          <p className="break-words text-[11px] text-slate-500">{row.remarks}</p>
                          {row.exception?.requiresReview ? (
                            <>
                              <CheckoutReviewStatusChip
                                status={checkoutReviewStatus(row.visit)}
                              />
                              <p className="text-[10px] font-semibold text-amber-700">
                                Operation Manager / Branch Head review required
                              </p>
                              {canApproveCheckoutMissingKmReviews ? (
                                <div
                                  className="flex flex-wrap gap-1"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {[
                                    ["Approve", "Approve"],
                                    ["Reject", "Reject"],
                                    ["Ask Clarification", "Ask Clarification"],
                                  ].map(([label, action]) => (
                                    <button
                                      key={action}
                                      type="button"
                                      disabled={checkoutReviewBusyVisitId === row.visit?.id}
                                      onClick={() =>
                                        action === "Ask Clarification"
                                          ? showCheckoutReviewPreview(row.visit, action)
                                          : handleCheckoutReviewAction(row.visit, action)
                                      }
                                      className="focus-ring rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-black text-slate-700 hover:border-qpms-300 hover:bg-qpms-50 disabled:opacity-50"
                                    >
                                      {checkoutReviewBusyVisitId === row.visit?.id ? "Saving..." : label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {checkoutReviewPreview?.visitKey ===
                              (row.visit?.id ||
                                `${row.visit?.check_in_time || "visit"}-${visitTitle(row.visit)}`) ? (
                                <div className="rounded-md bg-slate-100 p-2 text-[10px] font-semibold text-slate-600">
                                  <strong>
                                    Preview only — not saved
                                    {checkoutReviewPreview.action
                                      ? ` (${checkoutReviewPreview.action})`
                                      : ""}
                                  </strong>
                                  <p className="mt-1">
                                    {checkoutReviewPreview.message}
                                  </p>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!timelineRows.length ? (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-slate-500">No visit timeline available for selected filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              Missing KM is captured for review only. It is added to payable KM only after Operations Manager / Branch Head approval.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-950">
                  Selected Site Details
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {visits.length ? `Site ${activeVisitIndex + 1} of ${visits.length}` : "No site selected"}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={visits.length <= 1} onClick={() => setSelectedVisitIndex((value) => Math.max(0, value - 1))} className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-qpms-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" disabled={visits.length <= 1} onClick={() => setSelectedVisitIndex((value) => Math.min(visits.length - 1, value + 1))} className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-qpms-700 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Site / Client", selectedVisit ? `${visitTitle(selectedVisit)} / ${visitClient(selectedVisit)}` : "--"],
                ["Client Name", visitClient(selectedVisit)],
                ["Business Type", visitBusinessType(selectedVisit)],
                ["Address / Coordinates", selectedVisit?.address || selectedVisit?.location_name || visitLocation(selectedVisit)],
                [
                  "Location Lat/Lng",
                  selectedCheckInCoordinates
                    ? formatVisitCoordinates(selectedCheckInCoordinates)
                    : "--",
                ],
                ["Check-in", formatDateTime(selectedVisit?.check_in_time)],
                ["Check-out", formatDateTime(siteVisitCheckoutValue(selectedVisit))],
                ["Duration", durationMinutesLabel(visitMinutes(selectedVisit))],
                ["Travel from Previous", selectedTravelFromPrevious],
                ["Route KM", numberLabel(selectedVisit?.route_km, " km")],
                ["Missing KM Detected", selectedCheckoutException?.requiresReview ? missingCheckoutKmLabel(selectedVisit) : "--"],
                ["Suggested Amount", selectedCheckoutException?.requiresReview && missingCheckoutEvidence(selectedVisit).suggestedAmount !== null ? formatInr(missingCheckoutEvidence(selectedVisit).suggestedAmount) : "--"],
                ["Approved Missing KM", `${missingCheckoutEvidence(selectedVisit).approvedKm.toFixed(1)} km`],
                ["Approved Amount", `${formatInr(missingCheckoutEvidence(selectedVisit).approvedAmount)}`],
                ["GPS Evidence", selectedCheckoutException?.requiresReview ? missingCheckoutEvidenceLabel(selectedVisit) : "--"],
                ["Route Source", visitRouteSourceLabel(selectedVisit)],
                ["Remarks", visitRemarks(selectedVisit)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-qpms-700">{label}</p>
                  {label === "Location Lat/Lng" &&
                  selectedCheckInCoordinates ? (
                    <a
                      href={visitGoogleMapsUrl(selectedCheckInCoordinates)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-words text-xs font-bold text-qpms-700 underline decoration-qpms-200 underline-offset-2 hover:text-qpms-900"
                    >
                      {value}
                    </a>
                  ) : (
                    <p className="mt-1 break-words text-xs font-semibold text-slate-700">{displayValue(value)}</p>
                  )}
                </div>
              ))}
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-qpms-700">Checkout Status</p>
                <div className="mt-2">
                  {selectedCheckoutException ? <CheckoutStatusChip exception={selectedCheckoutException} /> : "--"}
                </div>
              </div>
            </div>
          </section>

          {selectedCheckoutException?.requiresReview ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <h2 className="text-base font-black text-amber-950">
                Checkout Exception Review
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Site / Client", `${visitTitle(selectedVisit)} / ${visitClient(selectedVisit)}`],
                  ["Exception Type", selectedCheckoutException.label],
                  ["Existing Remarks", visitRemarks(selectedVisit)],
                  ["Checkout Distance", selectedCheckoutException.distanceMeters === null ? "--" : `${selectedCheckoutException.distanceMeters.toFixed(0)} m`],
                  ["Check-in Time", formatDateTime(selectedVisit?.check_in_time)],
                  ["Check-out Time", formatDateTime(siteVisitCheckoutValue(selectedVisit))],
                  ["Route KM", numberLabel(selectedVisit?.route_km, " km")],
                  ["Suggested KM", missingCheckoutEvidence(selectedVisit).suggestedKm === null ? "--" : `${missingCheckoutEvidence(selectedVisit).suggestedKm.toFixed(1)} km`],
                  ["Suggested Amount", missingCheckoutEvidence(selectedVisit).suggestedAmount === null ? "--" : formatInr(missingCheckoutEvidence(selectedVisit).suggestedAmount)],
                  ["Payable KM Impact", Number(selectedVisit?.route_km) > 0 ? `${Number(selectedVisit.route_km).toFixed(1)} km route contribution` : "--"],
                  ["Review Status", selectedCheckoutReviewStatus?.label || "Pending Review"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] font-bold uppercase text-amber-700">{label}</p>
                    <p className="mt-1 break-words text-xs font-semibold text-amber-950">{displayValue(value)}</p>
                  </div>
                ))}
              </div>
              {canApproveCheckoutMissingKmReviews ? (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {["Approve", "Reject", "Ask Clarification"].map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={checkoutReviewBusyVisitId === selectedVisit?.id}
                        onClick={() =>
                          action === "Ask Clarification"
                            ? showCheckoutReviewPreview(selectedVisit, action)
                            : handleCheckoutReviewAction(selectedVisit, action)
                        }
                        className="focus-ring rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {checkoutReviewBusyVisitId === selectedVisit?.id ? "Saving..." : action}
                      </button>
                    ))}
                  </div>
                  {checkoutReviewPreview?.visitKey ===
                  (selectedVisit?.id ||
                    `${selectedVisit?.check_in_time || "visit"}-${visitTitle(selectedVisit)}`) ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 p-3 text-xs font-semibold text-slate-700">
                      <strong>
                        Preview only — not saved
                        {checkoutReviewPreview.action
                          ? ` (${checkoutReviewPreview.action})`
                          : ""}
                      </strong>
                      <p className="mt-1">{checkoutReviewPreview.message}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-amber-800">
                      Approval saving requires backend support.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-xs font-semibold text-amber-800">
                  This exception requires Operations Manager / Branch Head review.
                </p>
              )}
            </section>
          ) : null}

          <section className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-black text-slate-950">Activity Photos <span className="text-sm text-slate-500">({visibleActivityUploads.length})</span></h2>
            <div className="mt-3 flex max-w-full flex-wrap gap-2">
              {ACTIVITY_PHOTO_TABS.map((tab) => (
                <button key={tab} type="button" onClick={() => setPhotoFilter(tab)} className={`focus-ring rounded-lg border px-3 py-2 text-xs font-black ${photoFilter === tab ? "border-qpms-700 bg-qpms-700 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{tab}</button>
              ))}
            </div>
            <div className="mt-4 min-h-[180px] rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4">
              {visibleActivityUploads.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleActivityUploads.map((upload) => (
                    <a key={upload.id || upload.local_id || upload.file_url} href={upload.displayUrl || undefined} target="_blank" rel="noreferrer" className="grid grid-cols-[56px_1fr] gap-3 rounded-lg border border-slate-100 bg-white p-2 hover:border-qpms-200">
                      <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-md bg-slate-50 text-slate-300">
                        {activityUploadIsImage(upload) && upload.displayUrl ? <img src={upload.displayUrl} alt={activityUploadName(upload)} className="h-full w-full object-cover" /> : <Image className="h-7 w-7" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-slate-800">{activityUploadName(upload)}</span>
                        <span className="mt-1 block truncate text-[11px] font-semibold text-qpms-700">{upload.activityGroup}</span>
                        <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">{formatDateTime(activityUploadTime(upload))}</span>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[145px] place-items-center text-center">
                  <div>
                    <Image className="mx-auto h-12 w-12 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-500">No activity photos uploaded for selected filters.</p>
                    {activitySubmissions.length && !activityUploads.length ? <p className="mt-1 text-xs font-semibold text-slate-400">Activity submissions found, but no upload files are linked.</p> : null}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeDetailTab === "activity" ? (
        <section className="fo-screen-only overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">Activity Photos & Uploads</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                View, upload and manage activity photos, documents and other files.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {uploadInfoVisible ? (
                <div className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">
                  <Info className="h-4 w-4" />
                  Web upload available for OM / BH / Admin
                  <button
                    type="button"
                    onClick={() => setUploadInfoVisible(false)}
                    className="focus-ring grid h-5 w-5 place-items-center rounded-full hover:bg-blue-100"
                    aria-label="Hide upload information"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Uploaded Activities</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{uploadedActivityCount || 0}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Employee-specific uploads</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Pending Uploads</p>
                  <p className={`mt-2 text-2xl font-black ${pendingUploadCount ? "text-amber-700" : "text-slate-950"}`}>{pendingUploadCount || 0}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Missing files or proof</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Latest Activity Type</p>
                  <p className="mt-2 truncate text-lg font-black text-slate-950">{activityCards[0]?.activityGroup || "--"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(activityCards[0]?.uploadedAt)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Review Status</p>
                  <p className="mt-2 truncate text-lg font-black text-slate-950">{selectedActivityCard?.status?.label || "--"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Selected card</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex max-w-full flex-wrap gap-2">
                  {ACTIVITY_PHOTO_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setPhotoFilter(tab)}
                      className={`focus-ring rounded-lg border px-3 py-2 text-xs font-black ${
                        photoFilter === tab
                          ? "border-qpms-700 bg-qpms-700 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={photoSearch}
                      onChange={(event) => setPhotoSearch(event.target.value)}
                      placeholder="Search activities, sites, remarks..."
                      className="h-10 w-full min-w-[260px] rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none focus:border-qpms-400"
                    />
                  </label>
                  <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {formatDateOnly(fromDate)} – {formatDateOnly(toDate)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredActivityCards.map((card) => {
                  const statusClass =
                    card.status.tone === "green"
                      ? "bg-emerald-50 text-emerald-700"
                      : card.status.tone === "rose"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700";
                  const typeClass =
                    card.activityGroup === "Inspection"
                      ? "bg-blue-50 text-blue-700"
                      : card.activityGroup === "Deep Cleaning"
                        ? "bg-emerald-50 text-emerald-700"
                        : card.activityGroup === "Training"
                          ? "bg-violet-50 text-violet-700"
                          : "bg-slate-100 text-slate-700";
                  return (
                    <article
                      key={card.id}
                      onClick={() => setSelectedActivityCardId(card.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedActivityCardId(card.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`focus-ring relative rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        selectedActivityCard?.id === card.id ? "border-qpms-600 ring-2 ring-qpms-100" : "border-slate-200"
                      }`}
                    >
                      <div className="relative h-32 overflow-hidden rounded-t-xl bg-slate-100">
                        {card.thumbnail && activityUploadIsImage(card.uploads[0]) ? (
                          <img src={card.thumbnail} alt={card.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center bg-gradient-to-br from-slate-50 to-blue-50 text-slate-300">
                            {card.activityGroup === "Documents" ? <FilePlus className="h-10 w-10" /> : <Image className="h-10 w-10" />}
                          </div>
                        )}
                        <span className="absolute left-3 top-3 rounded-md bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white">
                          {card.fileCount || 0} {card.fileCount === 1 ? "File" : "Files"}
                        </span>
                      </div>
                      <div className="space-y-2 p-3">
                        <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black ${typeClass}`}>
                          {card.activityGroup}
                        </span>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{card.title}</p>
                            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                              {card.uploadedBy} • {formatDateTime(card.uploadedAt)}
                            </p>
                            {card.insight?.summary?.length ? (
                              <p className="mt-1 truncate text-[11px] font-black text-qpms-700">
                                {card.insight.summary.join(" • ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="relative shrink-0" ref={activityMenuCardId === card.id ? activityMenuRef : null}>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActivityMenuCardId((current) => previewMenuState(current, card.id));
                              }}
                              className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              aria-label={`Open actions for ${card.title}`}
                              aria-haspopup="menu"
                              aria-expanded={activityMenuCardId === card.id}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                            {activityMenuCardId === card.id ? (
                              <div
                                role="menu"
                                className="absolute right-0 top-9 z-50 min-w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={!card.uploads.length}
                                  onClick={() => openActivityPreview(card)}
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <Eye className="h-4 w-4" /> Preview
                                </button>
                                {card.thumbnail ? (
                                  <a
                                    role="menuitem"
                                    href={card.thumbnail}
                                    target="_blank"
                                    rel="noreferrer"
                                    download={activityUploadName(card.uploads[0])}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                  >
                                    <Download className="h-4 w-4" /> Download
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${statusClass}`}>
                          {card.status.label}
                        </span>
                      </div>
                    </article>
                  );
                })}

                <button
                  type="button"
                  disabled={!webUploadEnabled}
                  onClick={openActivityUploadFlow}
                  className="focus-ring grid min-h-[236px] place-items-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-5 text-center text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <span>
                    <UploadCloud className="mx-auto h-10 w-10" />
                    <span className="mt-3 block text-sm font-black">Drag & drop files here or click to browse</span>
                    <span className="mt-1 block text-xs font-semibold">
                      {webUploadEnabled
                        ? "Inspection, Training, Deep Cleaning • JPG, PNG, PDF"
                        : "Read-only view. Upload is available for OM / BH / Admin."}
                    </span>
                  </span>
                </button>
              </div>
              {!filteredActivityCards.length ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                  <Image className="mx-auto h-12 w-12 text-slate-300" />
                  <p className="mt-3 text-sm font-black text-slate-700">No activity uploads found for this employee in the selected date range.</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {activityCards.length ? "Try All or clear the search text." : "Uploads will appear here after this employee submits activity photos or documents."}
                  </p>
                </div>
              ) : null}
            </div>

            <aside className="border-t border-slate-200 bg-slate-50/70 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto lg:border-l lg:border-t-0">
              {selectedActivityCard ? (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="overflow-hidden rounded-xl bg-slate-100">
                    {selectedActivityCard.thumbnail && activityUploadIsImage(selectedActivityCard.uploads[0]) ? (
                      <img src={selectedActivityCard.thumbnail} alt={selectedActivityCard.title} className="h-44 w-full object-cover" />
                    ) : (
                      <div className="grid h-44 place-items-center text-slate-300">
                        {selectedActivityCard.activityGroup === "Documents" ? <FilePlus className="h-12 w-12" /> : <Image className="h-12 w-12" />}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                      selectedActivityCard.status.tone === "green"
                        ? "bg-emerald-50 text-emerald-700"
                        : selectedActivityCard.status.tone === "rose"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700"
                    }`}>
                      {selectedActivityCard.status.label}
                    </span>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700">
                      {selectedActivityCard.activityGroup}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-950">{selectedActivityCard.title}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDateTime(selectedActivityCard.uploadedAt)}
                    </p>
                  </div>
                  <div className="grid gap-3 text-xs">
                    {[
                      ["Activity Type", selectedActivityCard.activityGroup],
                      ["Site / Store", selectedActivityCard.title],
                      ["Site Code", selectedActivityCard.siteCode],
                      ["Uploaded By", selectedActivityCard.uploadedBy],
                      ["Visit Date & Time", formatDateTime(selectedActivityCard.visitDateTime)],
                      ["Remarks", selectedActivityCard.remarks],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="font-bold uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="mt-1 break-words font-semibold text-slate-700">{displayValue(value)}</p>
                      </div>
                    ))}
                  </div>
                  {selectedActivityCard.activityGroup === "Deep Cleaning" ? (
                    <div className="space-y-3">
                      {[
                        ["Before Images", selectedActivityCard.insight.before],
                        ["After Images", selectedActivityCard.insight.after],
                        ["Supporting Document", selectedActivityCard.insight.documents],
                      ].map(([label, uploads]) => (
                        <div key={label}>
                          <p className="text-xs font-black text-slate-900">
                            {label} ({uploads.length})
                          </p>
                          <div className="mt-2 flex gap-2 overflow-x-auto">
                            {uploads.map((upload) => (
                              <a
                                key={upload.id || upload.file_url}
                                href={upload.displayUrl || undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300"
                              >
                                {activityUploadIsImage(upload) && upload.displayUrl ? (
                                  <img src={upload.displayUrl} alt={activityUploadName(upload)} className="h-full w-full object-cover" />
                                ) : (
                                  <FilePlus className="h-6 w-6" />
                                )}
                              </a>
                            ))}
                            {!uploads.length ? (
                              <span className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400">
                                None
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : selectedActivityCard.activityGroup === "Training" ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-black text-slate-900">
                          HK Staff Attended ({selectedActivityCard.insight.hkStaffCount || 0})
                        </p>
                        <div className="mt-2 space-y-1">
                          {selectedActivityCard.insight.hkStaff?.length ? (
                            selectedActivityCard.insight.hkStaff.map((staff, index) => (
                              <div key={`${staff.emp_id || staff.name || "staff"}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                                {displayValue(staff.emp_id || staff.empId)} • {displayValue(staff.name)}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs font-semibold text-slate-500">No HK staff captured.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">Training Categories</p>
                        <div className="mt-2 space-y-2">
                          {selectedActivityCard.insight.trainingCategories?.length ? (
                            selectedActivityCard.insight.trainingCategories.map((category) => (
                              <div key={category.key} className="rounded-lg border border-slate-200 p-2">
                                <p className="text-[11px] font-black text-slate-700">{category.label}</p>
                                <div className="mt-2 flex gap-2 overflow-x-auto">
                                  {category.uploads.map((upload) => (
                                    <a
                                      key={upload.id || upload.file_url}
                                      href={upload.displayUrl || undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300"
                                    >
                                      {activityUploadIsImage(upload) && upload.displayUrl ? (
                                        <img src={upload.displayUrl} alt={activityUploadName(upload)} className="h-full w-full object-cover" />
                                      ) : (
                                        <Image className="h-5 w-5" />
                                      )}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs font-semibold text-slate-500">No category photos captured.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">
                          Supporting Document ({selectedActivityCard.insight.documentCount || 0})
                        </p>
                        <div className="mt-2 flex gap-2">
                          {(selectedActivityCard.insight.documents || []).map((upload) => (
                            <a
                              key={upload.id || upload.file_url}
                              href={upload.displayUrl || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-qpms-700"
                            >
                              <FilePlus className="h-4 w-4" /> {activityUploadName(upload)}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-black text-slate-900">
                          Photos ({selectedActivityCard.insight.photoCount ?? selectedActivityCard.fileCount})
                        </p>
                        <div className="mt-2 flex gap-2 overflow-x-auto">
                          {(selectedActivityCard.insight.photos || selectedActivityCard.uploads).slice(0, 6).map((upload) => (
                            <a
                              key={upload.id || upload.file_url}
                              href={upload.displayUrl || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300"
                            >
                              {activityUploadIsImage(upload) && upload.displayUrl ? (
                                <img src={upload.displayUrl} alt={activityUploadName(upload)} className="h-full w-full object-cover" />
                              ) : (
                                <Image className="h-6 w-6" />
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">
                          Supporting Document ({selectedActivityCard.insight.documentCount || 0})
                        </p>
                        <div className="mt-2 flex gap-2">
                          {(selectedActivityCard.insight.documents || []).map((upload) => (
                            <a
                              key={upload.id || upload.file_url}
                              href={upload.displayUrl || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-qpms-700"
                            >
                              <FilePlus className="h-4 w-4" /> {activityUploadName(upload)}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-xs font-black text-slate-900">Review Actions</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 px-2 py-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 py-2 text-[10px] font-black text-rose-700 hover:bg-rose-50"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button
                        type="button"
                        className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-blue-200 px-2 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Ask Clarification
                      </button>
                    </div>
                    <textarea
                      value={activityReviewRemarks}
                      onChange={(event) => setActivityReviewRemarks(event.target.value)}
                      placeholder="Add remarks (optional)..."
                      className="mt-3 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold outline-none focus:border-qpms-400"
                    />
                    <button
                      type="button"
                      className="focus-ring mt-2 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
                  <div>
                    <Image className="mx-auto h-12 w-12 text-slate-300" />
                    <p className="mt-3 text-sm font-black text-slate-700">Select an activity upload</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Details and review actions appear here.</p>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      ) : null}

      {activityPreviewCard ? (
        <div
          className="fo-screen-only fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${activityPreviewCard.activityGroup} activity files`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeActivityPreview();
          }}
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-black text-slate-950">
                    {activityPreviewCard.activityGroup}
                  </h2>
                  <span className="rounded-md bg-qpms-50 px-2 py-1 text-[10px] font-black text-qpms-700">
                    {activityPreviewFiles.length
                      ? `${activityPreviewIndex + 1} of ${activityPreviewFiles.length}`
                      : `${activityPreviewCard.fileCount || 0} files`}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs font-semibold text-slate-600">
                  {activityPreviewCard.title} / {activityPreviewCard.siteCode}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                  Uploaded by {activityPreviewCard.uploadedBy} • {formatDateTime(activityPreviewCard.uploadedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeActivityPreview}
                className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close activity preview"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-5">
              {activityPreviewLoading ? (
                <div className="grid min-h-[48vh] place-items-center text-center text-white">
                  <div>
                    <RefreshCw className="mx-auto h-8 w-8 animate-spin" />
                    <p className="mt-3 text-sm font-bold">Loading authorized preview…</p>
                  </div>
                </div>
              ) : activityPreviewError && !activeActivityPreviewFile ? (
                <div className="max-w-md rounded-xl border border-rose-400/40 bg-rose-950/50 p-5 text-center text-sm font-bold text-rose-100">
                  {activityPreviewError}
                </div>
              ) : activeActivityPreviewFile ? (
                <>
                  {activeActivityPreviewKind === "image" ? (
                    <div className="relative grid min-h-[48vh] w-full place-items-center">
                      {activityPreviewImageLoading && !activityPreviewImageFailed ? (
                        <RefreshCw className="absolute h-8 w-8 animate-spin text-white" aria-label="Loading image" />
                      ) : null}
                      {!activeActivityPreviewFile.displayUrl || activityPreviewImageFailed ? (
                        <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center text-slate-200">
                          <Image className="mx-auto h-12 w-12 text-slate-500" />
                          <p className="mt-3 text-sm font-black">Image preview could not be loaded.</p>
                          <p className="mt-1 break-all text-xs text-slate-400">{activityUploadName(activeActivityPreviewFile)}</p>
                        </div>
                      ) : (
                        <img
                          key={activeActivityPreviewFile.id || activeActivityPreviewFile.file_url}
                          src={activeActivityPreviewFile.displayUrl}
                          alt={activityUploadName(activeActivityPreviewFile)}
                          className={`max-h-[65vh] max-w-full object-contain ${activityPreviewImageLoading ? "opacity-0" : "opacity-100"}`}
                          onLoad={() => setActivityPreviewImageLoading(false)}
                          onError={() => {
                            setActivityPreviewImageLoading(false);
                            setActivityPreviewImageFailed(true);
                          }}
                        />
                      )}
                    </div>
                  ) : activeActivityPreviewKind === "pdf" && activeActivityPreviewFile.displayUrl ? (
                    <iframe
                      src={activeActivityPreviewFile.displayUrl}
                      title={activityUploadName(activeActivityPreviewFile)}
                      className="h-[65vh] w-full rounded-lg bg-white"
                    />
                  ) : (
                    <div className="max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 text-center text-slate-100">
                      <FilePlus className="mx-auto h-12 w-12 text-slate-400" />
                      <p className="mt-3 break-all text-sm font-black">{activityUploadName(activeActivityPreviewFile)}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        {activeActivityPreviewFile.file_type || "Document preview is not supported in the browser."}
                      </p>
                      {activeActivityPreviewFile.displayUrl ? (
                        <div className="mt-4 flex justify-center gap-2">
                          <a
                            href={activeActivityPreviewFile.displayUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-ring rounded-lg bg-white px-4 py-2 text-xs font-black text-slate-900"
                          >
                            Open
                          </a>
                          <a
                            href={activeActivityPreviewFile.displayUrl}
                            download={activityUploadName(activeActivityPreviewFile)}
                            className="focus-ring rounded-lg border border-slate-600 px-4 py-2 text-xs font-black text-white"
                          >
                            Download
                          </a>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={activityPreviewIndex <= 0}
                    onClick={() => {
                      setActivityPreviewImageFailed(false);
                      setActivityPreviewImageLoading(true);
                      setActivityPreviewIndex((index) => nextPreviewIndex(index, activityPreviewFiles.length, -1));
                    }}
                    className="focus-ring absolute left-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-slate-900 shadow disabled:cursor-not-allowed disabled:opacity-30 sm:left-5"
                    aria-label="Previous activity file"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    disabled={activityPreviewIndex >= activityPreviewFiles.length - 1}
                    onClick={() => {
                      setActivityPreviewImageFailed(false);
                      setActivityPreviewImageLoading(true);
                      setActivityPreviewIndex((index) => nextPreviewIndex(index, activityPreviewFiles.length, 1));
                    }}
                    className="focus-ring absolute right-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-slate-900 shadow disabled:cursor-not-allowed disabled:opacity-30 sm:right-5"
                    aria-label="Next activity file"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>

            <footer className="border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
              <p className="text-xs font-semibold text-slate-600">
                <span className="font-black text-slate-900">Remarks:</span> {activityPreviewCard.remarks || "--"}
              </p>
              {activityPreviewFiles.length > 1 ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Activity file thumbnails">
                  {activityPreviewFiles.map((file, index) => {
                    const kind = activityPreviewFileKind(file);
                    const nearCurrent = Math.abs(index - activityPreviewIndex) <= 2;
                    return (
                      <button
                        key={file.id || `${file.file_url}-${index}`}
                        type="button"
                        onClick={() => {
                          setActivityPreviewImageFailed(false);
                          setActivityPreviewImageLoading(true);
                          setActivityPreviewIndex(index);
                        }}
                        className={`focus-ring grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border-2 bg-slate-100 ${
                          index === activityPreviewIndex ? "border-qpms-600" : "border-transparent"
                        }`}
                        aria-label={`Preview file ${index + 1}`}
                        aria-current={index === activityPreviewIndex ? "true" : undefined}
                      >
                        {kind === "image" && nearCurrent && file.displayUrl ? (
                          <img src={file.displayUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : kind === "pdf" ? (
                          <span className="text-[10px] font-black text-rose-700">PDF</span>
                        ) : (
                          <FilePlus className="h-5 w-5 text-slate-500" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {activityUploadModal ? (
        <div className="fo-screen-only fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  {activityUploadModal === "select"
                    ? "Select Activity Type"
                    : `Upload ${activityModalLabel(activityUploadModal)}`}
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {displayValue(officer?.employeeCode || officer?.foId)} • {formatDateOnly(fromDate)} – {formatDateOnly(toDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeActivityUploadModal}
                className="focus-ring grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Close upload modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activityUploadModal === "select" ? (
              <div className="grid gap-3 p-5 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openActivityUploadModal("inspection")}
                  className="focus-ring rounded-2xl border border-slate-200 p-4 text-left shadow-sm hover:border-qpms-300 hover:bg-qpms-50"
                >
                  <Image className="h-7 w-7 text-qpms-700" />
                  <p className="mt-3 text-sm font-black text-slate-950">Inspection</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Upload inspection photos and optional document</p>
                </button>
                <button
                  type="button"
                  onClick={() => openActivityUploadModal("training")}
                  className="focus-ring rounded-2xl border border-slate-200 p-4 text-left shadow-sm hover:border-qpms-300 hover:bg-qpms-50"
                >
                  <UserRoundCheck className="h-7 w-7 text-qpms-700" />
                  <p className="mt-3 text-sm font-black text-slate-950">Training</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Capture HK staff, category photos and document</p>
                </button>
                <button
                  type="button"
                  onClick={() => openActivityUploadModal("deepCleaning")}
                  className="focus-ring rounded-2xl border border-slate-200 p-4 text-left shadow-sm hover:border-qpms-300 hover:bg-qpms-50"
                >
                  <ClipboardList className="h-7 w-7 text-qpms-700" />
                  <p className="mt-3 text-sm font-black text-slate-950">Deep Cleaning</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Upload before, after and supporting document</p>
                </button>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Activity Type</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{activityModalLabel(activityUploadModal)}</p>
                  </div>
                  <label className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Site / Visit</span>
                    <select
                      value={activityUploadDraft.visitId}
                      onChange={(event) =>
                        setActivityUploadDraft((draft) => ({
                          ...draft,
                          visitId: event.target.value,
                        }))
                      }
                      className="mt-1 w-full bg-transparent text-sm font-black text-slate-900 outline-none"
                    >
                      {activityVisitOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                      {!activityVisitOptions.length ? <option value="">No visit available</option> : null}
                    </select>
                  </label>
                </div>

                {activityUploadModal === "inspection" ? (
                  <div className="grid gap-4">
                    <UploadModalFileSection
                      title="Inspection Photos"
                      accept="image/png,image/jpeg"
                      files={activityUploadDraft.inspectionPhotos}
                      onFiles={(files) => updateActivityDraftFiles("inspectionPhotos", files)}
                    />
                    <UploadModalFileSection
                      title="Supporting Document"
                      subtitle="Optional PDF or image"
                      accept="application/pdf,image/png,image/jpeg"
                      files={activityUploadDraft.inspectionDocuments}
                      onFiles={(files) => updateActivityDraftFiles("inspectionDocuments", files)}
                    />
                  </div>
                ) : null}

                {activityUploadModal === "training" ? (
                  <div className="grid gap-4">
                    <section className="rounded-xl border border-slate-200 p-4">
                      <h3 className="text-sm font-black text-slate-950">HK Staff Attended</h3>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={activityUploadDraft.hkEmpId}
                          onChange={(event) =>
                            setActivityUploadDraft((draft) => ({ ...draft, hkEmpId: event.target.value }))
                          }
                          placeholder="HK Scrum ID / Emp ID"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-qpms-400"
                        />
                        <input
                          value={activityUploadDraft.hkName}
                          onChange={(event) =>
                            setActivityUploadDraft((draft) => ({ ...draft, hkName: event.target.value }))
                          }
                          placeholder="HK Name"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-qpms-400"
                        />
                        <button
                          type="button"
                          onClick={addActivityDraftHkStaff}
                          className="focus-ring rounded-lg border border-qpms-200 px-3 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50"
                        >
                          Add Another Staff
                        </button>
                      </div>
                      {activityUploadDraft.hkStaff.length ? (
                        <div className="mt-3 grid gap-2">
                          {activityUploadDraft.hkStaff.map((staff, index) => (
                            <div key={`${staff.emp_id}-${staff.name}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                              <span>{displayValue(staff.emp_id)} • {displayValue(staff.name)}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setActivityUploadDraft((draft) => ({
                                    ...draft,
                                    hkStaff: draft.hkStaff.filter((_, itemIndex) => itemIndex !== index),
                                  }))
                                }
                                className="text-slate-400 hover:text-rose-600"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                    <section className="rounded-xl border border-slate-200 p-4">
                      <h3 className="text-sm font-black text-slate-950">Training Category Uploads</h3>
                      <div className="mt-3 grid gap-3">
                        {TRAINING_UPLOAD_CATEGORIES.map(([key, label]) => (
                          <UploadModalFileSection
                            key={key}
                            compact
                            title={label}
                            accept="image/png,image/jpeg"
                            files={activityUploadDraft.trainingPhotos[key] || []}
                            onFiles={(files) => updateTrainingCategoryFiles(key, files)}
                          />
                        ))}
                      </div>
                    </section>
                    <UploadModalFileSection
                      title="Supporting Document"
                      subtitle="PDF or image"
                      accept="application/pdf,image/png,image/jpeg"
                      files={activityUploadDraft.trainingDocuments}
                      onFiles={(files) => updateActivityDraftFiles("trainingDocuments", files)}
                    />
                  </div>
                ) : null}

                {activityUploadModal === "deepCleaning" ? (
                  <div className="grid gap-4">
                    <UploadModalFileSection
                      title="Before Images"
                      accept="image/png,image/jpeg"
                      files={activityUploadDraft.deepBefore}
                      onFiles={(files) => updateActivityDraftFiles("deepBefore", files)}
                    />
                    <UploadModalFileSection
                      title="After Images"
                      accept="image/png,image/jpeg"
                      files={activityUploadDraft.deepAfter}
                      onFiles={(files) => updateActivityDraftFiles("deepAfter", files)}
                    />
                    <UploadModalFileSection
                      title="Supporting Document"
                      subtitle="PDF or image accepted"
                      accept="application/pdf,image/png,image/jpeg"
                      files={activityUploadDraft.deepDocuments}
                      onFiles={(files) => updateActivityDraftFiles("deepDocuments", files)}
                    />
                    <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
                      If an image is uploaded as a document, it will remain available as an image until web PDF conversion is connected.
                    </p>
                  </div>
                ) : null}

                {activityUploadError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                    {activityUploadError}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={activityUploadSaving}
                    onClick={() => saveActivityUploadDraft("draft")}
                    className="focus-ring rounded-xl border border-qpms-200 px-4 py-2.5 text-xs font-black text-qpms-700 hover:bg-qpms-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activityUploadSaving ? "Saving..." : "Save Draft"}
                  </button>
                  <button
                    type="button"
                    disabled={activityUploadSaving}
                    onClick={() => saveActivityUploadDraft("submit")}
                    className="focus-ring rounded-xl bg-qpms-700 px-4 py-2.5 text-xs font-black text-white hover:bg-qpms-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {activityUploadSaving ? "Uploading..." : "Submit"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeDetailTab === "km" ? (
        <section className="fo-screen-only rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              ["Base Payable KM", `${basePayableKm.toFixed(1)} km`, "text-slate-800"],
              ["Approved Missing KM Adjustment", `${approvedMissingCheckoutKm.toFixed(1)} km`, "text-emerald-600"],
              ["Final Payable KM", Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--", "text-emerald-600"],
              ...(fullTechnicalAccess
                ? [
                    ["GPS Audit KM", Number.isFinite(gpsAuditKm) ? `${gpsAuditKm.toFixed(1)} km` : "--", "text-blue-600"],
                    ["Difference", Number.isFinite(kmDelta) ? `${kmDelta.toFixed(1)} km` : "--", "text-amber-600"],
                    ["Difference %", Number.isFinite(differencePercent) ? `${differencePercent.toFixed(1)}%` : "--", "text-amber-600"],
                  ]
                : []),
              [`Petrol @ ₹${ratePerKm}/km`, moneyLabel(petrolAmount), "text-slate-950"],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold text-slate-500">{label}</p>
                <p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          {fullTechnicalAccess ? <p className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
            Payable KM is used for reimbursement. GPS Audit KM is supporting evidence only.
          </p> : null}
          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                <tr>
                  {["Site / Client", "Travel From Previous", "Route KM", "Missing KM Detected", "Approved Missing KM", "Final Payable KM", "Remarks / Exception"].map((heading) => (
                    <th key={heading} className="px-3 py-3">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((visit, index) => {
                  const exception = checkoutExceptionForVisit(visit);
                  const routeKm = Number(visit?.route_km);
                  const missingEvidence = missingCheckoutEvidence(visit);
                  const finalPayableKm =
                    (Number.isFinite(routeKm) && routeKm > 0 ? routeKm : 0) +
                    (Number.isFinite(missingEvidence.approvedKm) ? missingEvidence.approvedKm : 0);
                  return (
                    <tr key={visit.id || index}>
                      <td className="px-3 py-3 font-black text-slate-900">
                        {visitTitle(visit)} / {visitClient(visit)}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {index === 0 ? "Start Day" : visitTitle(visits[index - 1])}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {numberLabel(visit.route_km, " km")}
                      </td>
                      <td className="px-3 py-3 text-amber-700">
                        <div className="space-y-1">
                          <span className="font-bold">
                            {exception.requiresReview
                              ? missingCheckoutKmLabel(visit)
                              : "--"}
                          </span>
                          {exception.requiresReview ? (
                            <p className="text-[10px] font-semibold text-slate-500">
                              {missingCheckoutEvidenceLabel(visit)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-bold text-emerald-700">
                        {missingEvidence.approvedKm > 0
                          ? `${missingEvidence.approvedKm.toFixed(1)} km`
                          : "0.0 km"}
                      </td>
                      <td className="px-3 py-3 font-bold text-emerald-700">
                        {finalPayableKm > 0
                          ? `${finalPayableKm.toFixed(1)} km`
                          : "--"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <CheckoutStatusChip exception={exception} />
                          <p className="text-[11px] text-slate-500">
                            {visitRemarks(visit)}
                          </p>
                          {exception.requiresReview ? (
                            <>
                              <CheckoutReviewStatusChip
                                status={checkoutReviewStatus(visit)}
                              />
                              {canReviewCheckoutExceptions ? (
                                <div className="flex flex-wrap gap-1">
                                  {["Approve", "Reject", "Ask Clarification"].map(
                                    (action) => (
                                      <button
                                        key={action}
                                        type="button"
                                        onClick={() =>
                                          showCheckoutReviewPreview(visit, action)
                                        }
                                        className="focus-ring rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-black text-slate-700 hover:bg-qpms-50"
                                      >
                                        {action}
                                      </button>
                                    ),
                                  )}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visits.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      No site-wise KM data available for the selected range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-6 rounded-xl bg-slate-50 p-4 text-sm font-semibold">
            <span>
              Total Payable KM:{" "}
              <strong className="text-emerald-700">
                {Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--"}
              </strong>
            </span>
            <span>
              Canonical Petrol Amount:{" "}
              <strong className="text-slate-950">
                {moneyLabel(petrolAmount)}
              </strong>
            </span>
          </div>
        </section>
      ) : null}

      {activeDetailTab === "route" ? (
        <div className="fo-screen-only space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-950">Route / GPS Evidence</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">GPS evidence is shown separately from payable route KM.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={onRecalculateKm} disabled={recalculatingKm} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-qpms-200 px-4 py-2 text-xs font-black text-qpms-700 hover:bg-qpms-50 disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${recalculatingKm ? "animate-spin" : ""}`} />
                  {recalculatingKm
                    ? "Recalculating Selected Period..."
                    : "Recalculate Selected Period"}
                </button>
                {onTemporarySwitchKm ? (
                  <button type="button" onClick={onTemporarySwitchKm} disabled={recalculatingSwitchKm} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-black text-orange-800 hover:bg-orange-100 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${recalculatingSwitchKm ? "animate-spin" : ""}`} />
                    {recalculatingSwitchKm ? "Temporary..." : "Temporary Switch KM"}
                  </button>
                ) : null}
                <button type="button" onClick={() => setRouteMapOpen((value) => !value)} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-qpms-700 px-4 py-2 text-xs font-black text-white hover:bg-qpms-800">
                  <MapPinned className="h-4 w-4" /> {routeMapOpen ? "Hide Route Map" : "Show Route Map"}
                </button>
              </div>
            </div>
            {recalculationResult?.message ? <p className={`mt-3 rounded-lg p-3 text-xs font-semibold ${recalculationResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{recalculationResult.message}</p> : null}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["GPS Log Count", gpsMetrics.gpsLogsCount],
                ["Raw GPS KM", `${Number(gpsMetrics.rawGpsKm || 0).toFixed(1)} km`],
                ["Filtered GPS KM", `${Number(gpsMetrics.filteredGpsKm || 0).toFixed(1)} km`],
                ["GPS Audit KM", `${Number(gpsAuditKm || 0).toFixed(1)} km`],
                ["Valid Points", gpsMetrics.validPointsCount],
                ["Rejected Points", gpsMetrics.rejectedPointsCount],
                ["Max GPS Gap", formatDurationSeconds(gpsMetrics.maxGapSeconds)],
                ["Confidence", gpsMetrics.kmConfidence || "Needs Review"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[11px] font-bold uppercase text-slate-400">{label}</p>
                  <p className="mt-1 text-base font-black text-slate-900">{displayValue(value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <strong className="text-slate-900">Route source</strong>
                <p className="mt-1 text-slate-600">{officer.routeKmSource || "--"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <strong className="text-slate-900">Review flags</strong>
                <p className="mt-1 text-slate-600">{reviewFlags.length ? reviewFlags.join(", ") : "No review flags"}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Google Direct Route KM", googleDirectRouteKm === null ? "--" : `${googleDirectRouteKm.toFixed(1)} km`],
                ["Pre-site Raw GPS KM", preSiteRawGpsKm === null ? "--" : `${preSiteRawGpsKm.toFixed(1)} km`],
                ["Pre-site Filtered GPS KM", preSiteFilteredGpsKm === null ? "--" : `${preSiteFilteredGpsKm.toFixed(1)} km`],
                ["Suggested Review KM", gpsFallbackReview.fallbackKm === null ? "--" : `${gpsFallbackReview.fallbackKm.toFixed(1)} km`],
                ["Payable Source Reason", payableKmSourceReason],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4 text-sm">
                  <strong className="text-slate-900">{label}</strong>
                  <p className="mt-1 break-words text-slate-600">{displayValue(value)}</p>
                </div>
              ))}
            </div>
            {routeMapOpen ? <div className="mt-4"><GoogleRouteMap officer={officer} routeLogs={routeLogs} fromDate={fromDate} toDate={toDate} /></div> : null}
          </section>
        </div>
      ) : null}

      {activeDetailTab === "report" ? (
        <div className="fo-report-shell rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="fo-screen-only mb-4 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-800">This layout is optimized for print and PDF. Use Export PDF to generate a shareable report.</p>
            <button
              type="button"
              onClick={openPrintReport}
              disabled={reportState !== "ready"}
              className="focus-ring rounded-lg bg-qpms-700 px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rangeDatasetLoading ? "Loading report..." : "Export PDF"}
            </button>
          </div>
          {rangeDatasetLoading ? (
            <div className="rounded-xl border border-slate-200 p-8 text-center text-sm font-semibold text-slate-600">
              Loading the complete selected-period report...
            </div>
          ) : null}
          {rangeDatasetError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
              {rangeDatasetError}
            </div>
          ) : null}
          {reportState === "ready" ? (
          <article className="fo-print-report mx-auto max-w-[980px] bg-white text-slate-900">
            <div className="fo-report-header flex items-start justify-between gap-6 border-b-2 border-qpms-700 pb-4">
              <div className="flex min-w-0 items-start gap-4">
                <img
                  src={qpmsLogo}
                  alt="QPMS logo"
                  className="h-16 w-16 shrink-0 rounded-xl object-cover"
                />
                <div>
                  <p className="text-xl font-black leading-none text-qpms-700">
                    QPMS
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-600">
                    Quality Property Management Services
                  </p>
                  <h1 className="mt-3 text-2xl font-black">
                    Field Activity & KM Report
                  </h1>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {formatDateOnly(fromDate)} to {formatDateOnly(toDate)}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right text-xs leading-5 text-slate-500">
                <p>
                  <strong className="text-slate-700">Generated by:</strong>{" "}
                  {generatedByLabel}
                </p>
                <p>
                  <strong className="text-slate-700">Generated at:</strong>{" "}
                  {formatDateTime(new Date())}
                </p>
              </div>
            </div>

            <section className="fo-report-section mt-5">
              <h2 className="mb-3 text-base font-black text-slate-900">
                Period Summary
              </h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-slate-200 p-4 text-sm md:grid-cols-4">
              {[
                ["Employee Name", officer?.name],
                ["Employee ID", officer?.employeeCode || officer?.foId],
                ["Role / Designation", officer?.designation || officer?.role],
                ["State", officer?.state],
                ["Mobile", officer?.phone],
                ["Selected Period", `${rangeDataset?.period?.from_date || formatDateOnly(fromDate)} to ${rangeDataset?.period?.to_date || formatDateOnly(toDate)}`],
                ["Period Attendance Status", periodSummary.period_attendance_status || lastAttendance.status],
                ["Period First Start", formatDateTime(periodSummary.first_start || firstAttendance.login_time)],
                ["Period Last End", formatDateTime(periodSummary.last_end || lastAttendance.logout_time)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-bold text-slate-400">{label}</p>
                  <p className="mt-1 font-bold text-slate-800">
                    {displayValue(value)}
                  </p>
                </div>
              ))}
              </div>
            </section>

            <section className="fo-report-section mt-5">
              <h2 className="mb-3 text-base font-black text-slate-900">
                Travel Reimbursement Summary
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                    Kilometer
                  </p>
                  <p className="mt-2 text-2xl font-black text-emerald-900">
                    {reportKilometerLabel(reportKilometer)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    Bike and Car payable distance only
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                    Total Amount
                  </p>
                  <p className="mt-2 text-2xl font-black text-amber-950">
                    {reportMoneyLabel(reportTotalAmount)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    Travel reimbursement total
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3 text-xs md:grid-cols-4">
                {[
                  ["Kilometer", reportKilometerLabel(reportKilometer)],
                  ["Distance Reimbursement", reportMoneyLabel(periodSummary.distance_amount)],
                  ["Other Transport Amount", reportMoneyLabel(periodSummary.other_transport_amount)],
                  ["Eligible Ticket / Parking Amount", reportMoneyLabel(periodSummary.eligible_ticket_parking_amount ?? periodSummary.eligible_claim_amount)],
                  ["Total Man Days", periodSummary.total_man_days ?? periodSummary.attendance_day_count ?? 0],
                  ["Total Visits", periodSummary.total_visits ?? periodSummary.visit_count ?? visits.length],
                  ["Attendance Records", periodSummary.attendance_records ?? periodSummary.attendance_count ?? attendances.length],
                  ["Total Amount", reportMoneyLabel(reportTotalAmount)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="font-bold text-slate-400">{label}</p>
                    <p className="mt-1 break-words font-black text-slate-800">{displayValue(value)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="fo-report-table-section mt-6">
              <h2 className="text-base font-black">Daily Attendance Summary</h2>
              <table className="mt-2 w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-slate-100">
                    {["Date", "Start", "End", "Status", "Mode(s)", "Visits", "Kilometer", "Distance Reimbursement", "Ticket / Other Transport Amount", "Parking Amount", "Total Amount"].map((heading) => (
                      <th key={heading} className="border border-slate-200 px-1.5 py-2">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(rangeDataset?.daily_summary || []).map((row) => (
                    <tr key={row.attendance_id}>
                      <td className="border border-slate-200 px-1.5 py-2">{row.attendance_date}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{formatTime(row.login_time)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{formatTime(row.logout_time)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{displayValue(row.status)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{(row.modes || []).map(travelModeLabel).join(", ") || "Not selected"}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{row.visit_count}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{Number(row.kilometer || 0).toFixed(2)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{reportMoneyLabel(row.distance_amount)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{reportMoneyLabel(row.other_transport_amount ?? row.ticket_amount)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{reportMoneyLabel(row.parking_amount)}</td>
                      <td className="border border-slate-200 px-1.5 py-2">{reportMoneyLabel(row.total_amount ?? row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="fo-report-table-section mt-6">
              <h2 className="text-base font-black">Site Visit Summary</h2>
              <table className="mt-2 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    {["Date", "Site / Client", "Check-in", "Check-out", "Duration", "Travel from Previous", "Route KM"].map((heading) => (
                      <th key={heading} className="border border-slate-200 px-2 py-2">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(rangeDataset?.site_visit_summary || []).map((row, index, rows) => {
                    const visitDate = row.attendance_date;
                    const previousVisitDate = rows[index - 1]?.attendance_date;
                    return (
                      <Fragment key={`${row.attendance_id}-${row.row_type}-${index}`}>
                        {visitDate !== previousVisitDate ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="border border-slate-200 bg-slate-50 px-2 py-1.5 font-black text-slate-700"
                            >
                              Attendance date: {visitDate}
                            </td>
                          </tr>
                        ) : null}
                        <tr>
                          <td className="border border-slate-200 px-2 py-2">{visitDate}</td>
                          <td className="border border-slate-200 px-2 py-2">
                            {[row.site_name, row.client_name].filter(Boolean).join(" / ")}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {row.check_in_time ? formatDateTime(row.check_in_time) : "--"}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {row.check_out_time ? formatDateTime(row.check_out_time) : "--"}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {durationMinutesLabel(row.visit_duration_minutes)}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {row.travel_from_previous || "--"}
                          </td>
                          <td className="border border-slate-200 px-2 py-2">
                            {Number.isFinite(Number(row.route_km)) && Number(row.route_km) > 0
                              ? `${Number(row.route_km).toFixed(2)} km`
                              : "--"}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {!rangeDataset?.site_visit_summary?.length ? (
                    <tr>
                      <td colSpan={7} className="border border-slate-200 px-2 py-5 text-center">
                        No attendance sequence available.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>

            <section className="fo-report-acknowledgement mt-6 rounded-lg border border-slate-300 p-4">
              <h2 className="text-base font-black text-slate-900">
                Employee Acknowledgement
              </h2>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                I confirm that the above site visit and travel reimbursement details are
                verified for the selected period.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 text-xs">
                <div>
                  <div className="h-14 border-b border-slate-500" />
                  <p className="mt-2 font-bold text-slate-600">
                    Employee Signature
                  </p>
                </div>
                <div>
                  <div className="h-14 border-b border-slate-500" />
                  <p className="mt-2 font-bold text-slate-600">Employee Name</p>
                </div>
                <div>
                  <div className="h-8 border-b border-slate-500" />
                  <p className="mt-2 font-bold text-slate-600">Date</p>
                </div>
                <div>
                  <div className="h-8 border-b border-slate-500" />
                  <p className="mt-2 font-bold text-slate-600">Remarks</p>
                </div>
              </div>
            </section>

            <p className="mt-5 border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500">
              Kilometer includes eligible Bike/Car payable distance only. Other Transport Amount
              includes eligible approved Train, Bus, Auto and Other ticket-based reimbursement.
              Total Amount includes distance reimbursement, eligible other-transport fare and
              eligible parking reimbursement.
            </p>
            <div className="fo-print-page-number" aria-hidden="true" />
          </article>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailStripItem({ icon, label, value, hint }) {
  const Icon = icon;
  return (
    <div className="flex items-center gap-3 px-3">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-qpms-50 text-qpms-700">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <p className="mt-1 truncate text-base font-black text-slate-950">{value || "--"}</p>
        {hint ? <p className="truncate text-xs font-semibold text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function todayAttendanceFromRows(rows = []) {
  const sorted = rows
    .slice()
    .sort((a, b) => new Date(b.login_time || b.created_at || 0) - new Date(a.login_time || a.created_at || 0));
  return sorted[0] || null;
}

function activeSiteVisitFromRows(rows = [], attendance = null, dateInput = toDateInputValue(new Date())) {
  return rows
    .slice()
    .sort((a, b) => new Date(b.check_in_time || b.created_at || 0) - new Date(a.check_in_time || a.created_at || 0))
    .find((visit) => isSiteVisitOpen(visit) && isCurrentAttendanceVisit(visit, attendance, dateInput)) || null;
}

function supportActionAvailability({ attendanceRows = [], visitRows = [], date = toDateInputValue(new Date()) }) {
  const attendance = todayAttendanceFromRows(attendanceRows);
  const activeVisit = activeSiteVisitFromRows(visitRows, attendance, date);
  const hasAttendance = Boolean(attendance);
  const attendanceActive = isAttendanceActive(attendance);
  const attendanceEnded = isAttendanceEnded(attendance);

  return {
    attendance,
    activeVisit,
    canCheckOut: Boolean(activeVisit),
    canEndDay: attendanceActive && !activeVisit,
    canStartDay: !hasAttendance,
    canReopenAttendance: hasAttendance && attendanceEnded,
  };
}

function FoSupportActionPanel({
  officer,
  context,
  loading,
  busy,
  pendingAction,
  remarks,
  message,
  onRemarksChange,
  onBeginAction,
  onCancelAction,
  onConfirmAction,
  onDetailedView,
  onClose,
  onRecalculateKm,
  onTemporarySwitchKm,
  recalculatingKm = false,
  recalculatingSwitchKm = false,
  recalculationResult = null,
  roadKmEstimate,
  foSafeKm,
  siteVisitCount,
}) {
  if (!officer) return null;
  const availability = supportActionAvailability(context || {});
  const status = officerStatus(officer);
  const battery = batteryState(officer);
  const kmMetrics = foSafeKm || officer.foSafeKm || emptyFoSafeKmMetrics(0);
  const routeKm = Number(officer.eligibleKm ?? officer.routeKmToday ?? 0);
  const actualTravelKm = Number(
    officer.actualTravelKm ?? kmMetrics.actualTravelKm ?? officer.actualKm ?? 0,
  );
  const filteredGpsKm = Number(officer.filteredGpsKm ?? kmMetrics.filteredGpsKm ?? 0);
  const routeVsActualDelta = routeKm - actualTravelKm;
  const claimKm = routeKm;
  const hasClaimKm = Number.isFinite(claimKm);
  const reviewFlags = officer.reviewFlags || [];
  const roadKmLabel = roadKmEstimate
    ? `${Number(roadKmEstimate.roadKm || 0).toFixed(1)} km reference only${
        roadKmEstimate.usedFallback ? " fallback" : ""
      }`
    : "--";
  const claimKmLabel = hasClaimKm ? formatDisplayKm(claimKm) : "--";
  const ratePerKm = travelModeRatePerKm(officer.travelMode, officer.ratePerKm);
  const claimPetrol = officer.petrolAmountPending
    ? null
    : numberOrNull(officer.petrolAmount) ??
      calculatePetrolAmount(claimKm, ratePerKm);
  const statusText = status.label;
  const statusClass = isOperationallyActive(officer)
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  const accuracyLabel =
    officer.accuracy === null || officer.accuracy === undefined
      ? "--"
      : `${Number(officer.accuracy).toFixed(1)}m`;
  const coordinateLabel = hasFiniteCoordinates(officer.coordinates)
    ? `${Number(officer.coordinates[0]).toFixed(5)}, ${Number(officer.coordinates[1]).toFixed(5)}`
    : "No Location";
  const activeSiteLabel = availability.activeVisit ? visitTitle(availability.activeVisit) : "None";
  const actions = [
    {
      id: "start_day",
      label: "Start Day",
      enabled: availability.canStartDay,
      hint: "Create today's attendance",
    },
    {
      id: "check_out",
      label: "Check Out",
      enabled: availability.canCheckOut,
      hint: availability.activeVisit ? visitTitle(availability.activeVisit) : "No active site visit",
    },
    {
      id: "end_day",
      label: "End Day",
      enabled: availability.canEndDay,
      hint: availability.attendance ? formatTime(availability.attendance.login_time) : "No active attendance",
    },
    {
      id: "recalculate",
      label: "Recalculate",
      enabled: Boolean(onRecalculateKm),
      hint: "Refresh payable KM",
    },
    {
      id: "detailed_view",
      label: "Detailed View",
      enabled: Boolean(onDetailedView),
      hint: "Open FO drill-down",
    },
  ];

  const pendingLabel = actions.find((action) => action.id === pendingAction)?.label;

  return (
    <div className="border-b border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
          <div className="flex min-w-0 gap-3">
            <OperationsAvatar officer={officer} size="h-9 w-9" iconSize="h-4 w-4" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-black text-slate-950 dark:text-white">{officer.name}</h2>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-black ${statusClass}`}>
                  {statusText}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500">
                {officer.employeeCode || officer.foId || "--"}
              </p>
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              aria-label="Close selected officer"
            >
              x
            </button>
          ) : null}
        </div>

        <div className="space-y-2.5 px-3 py-3">
          {loading ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs font-semibold text-slate-500 dark:border-slate-800">
              Loading today's FO status...
            </div>
          ) : (
            <>
              <div className="grid gap-1 text-[11px] font-semibold text-slate-500">
                <div className="flex items-center justify-between gap-2">
                  <span>Battery <strong className={battery.tone}>{battery.label}</strong> | Accuracy <strong className="text-slate-800 dark:text-slate-100">{accuracyLabel}</strong></span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Last Seen</span>
                  <strong className="text-slate-800 dark:text-slate-100">{officer.lastSeen || "--"}</strong>
                </div>
                <div className="truncate text-slate-600 dark:text-slate-300">
                  Lat/Lng: <strong className="text-slate-800 dark:text-slate-100">{coordinateLabel}</strong>
                </div>
                <div className="truncate text-slate-600 dark:text-slate-300">
                  Role: <strong className="text-slate-800 dark:text-slate-100">{officer.designation || officer.role || "--"}</strong>
                </div>
                <div className="truncate text-slate-600 dark:text-slate-300">
                  Business / State: <strong className="text-slate-800 dark:text-slate-100">{officer.business || "--"} / {officer.state || "--"}</strong>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] font-semibold text-slate-500">
                <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
                  KM <strong className="text-slate-950 dark:text-white">{routeKm.toFixed(1)}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
                  Petrol <strong className="text-slate-950 dark:text-white">{formatInr(claimPetrol)}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
                  Sites <strong className="text-slate-950 dark:text-white">{siteVisitCount ?? officer.visits?.length ?? 0}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-semibold text-slate-500">
                <div className="truncate rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900">
                  Status <strong className="text-slate-950 dark:text-white">{status.label || "--"}</strong>
                </div>
                <div className="truncate rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900" title={activeSiteLabel}>
                  Active Site <strong className="text-slate-950 dark:text-white">{activeSiteLabel}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      if (action.id === "recalculate") {
                        onRecalculateKm?.();
                        return;
                      }
                      if (action.id === "detailed_view") {
                        onDetailedView?.();
                        return;
                      }
                      onBeginAction(action.id);
                    }}
                    disabled={busy || recalculatingKm || !action.enabled}
                    className="focus-ring rounded-lg border border-slate-200 px-2 py-1.5 text-center text-[11px] font-black text-slate-700 hover:border-qpms-300 hover:bg-qpms-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
                    title={action.hint}
                  >
                    {action.id === "recalculate" && recalculatingKm ? "Recalc..." : action.label}
                  </button>
                ))}
              </div>
              {onTemporarySwitchKm ? (
                <button
                  type="button"
                  onClick={onTemporarySwitchKm}
                  disabled={busy || recalculatingKm || recalculatingSwitchKm}
                  className="focus-ring w-full rounded-lg border border-orange-200 bg-orange-50 px-2 py-2 text-center text-[11px] font-black text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Temporary Bike to non-bike switch KM recalculation"
                >
                  {recalculatingSwitchKm ? "Temporary Switch KM..." : "Temporary Switch KM"}
                </button>
              ) : null}

              {pendingAction ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-black text-amber-900">Confirm {pendingLabel}</p>
                  <textarea
                    value={remarks}
                    onChange={(event) => onRemarksChange(event.target.value)}
                    rows={2}
                    className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-amber-500"
                    placeholder="Reason / remarks"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={onCancelAction}
                      disabled={busy}
                      className="focus-ring rounded-lg border border-amber-200 px-3 py-2 text-xs font-black text-amber-800 hover:bg-white disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onConfirmAction}
                      disabled={busy || !remarks.trim()}
                      className="focus-ring rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? "Updating..." : "Confirm Update"}
                    </button>
                  </div>
                </div>
              ) : null}

              {message ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {message}
                </p>
              ) : null}

              {recalculationResult?.ok === true ? (
                <p className="text-[11px] font-semibold text-slate-500">
                  KM recalculation completed. Refreshing payable values.
                </p>
              ) : null}
              {recalculationResult?.ok === false && recalculationResult?.message ? (
                <p className="text-[11px] font-semibold text-amber-700">
                  {recalculationResult.message}
                </p>
              ) : null}

              <details className="rounded-lg border border-slate-100 bg-white/60 p-2 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                <summary className="cursor-pointer select-none text-xs font-black text-slate-700 dark:text-slate-200">
                  GPS Audit
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <span>Raw GPS KM</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {Number(kmMetrics.rawGpsKm || 0).toFixed(1)} km
                  </strong>
                  <span>Filtered GPS KM</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {filteredGpsKm.toFixed(1)} km
                  </strong>
                  <span>GPS Audit KM</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {actualTravelKm.toFixed(1)} km
                  </strong>
                  <span>Payable vs GPS Delta</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {routeVsActualDelta.toFixed(1)} km
                  </strong>
                  <span>Payable KM</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {claimKmLabel}
                  </strong>
                  <span>Petrol Amount</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {formatInr(claimPetrol)}
                  </strong>
                  <span>GPS Audit Confidence</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {["HIGH", "MEDIUM", "LOW"].includes(String(kmMetrics.kmConfidence || "").toUpperCase())
                      ? kmMetrics.kmConfidence
                      : "Needs Review"}
                  </strong>
                  <span>Review Required</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {reviewFlags.length || kmMetrics.reviewRequired ? "Yes" : "No"}
                  </strong>
                  <span>Review Flags</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {reviewFlags.length ? reviewFlags.join(", ") : "--"}
                  </strong>
                  <span>GPS Logs Count</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {Number(kmMetrics.gpsLogsCount || 0)}
                  </strong>
                  <span>Max GPS Gap</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {formatDurationSeconds(kmMetrics.maxGapSeconds)}
                  </strong>
                  <span>Adjustment Applied</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {kmMetrics.adjustmentApplied || "--"}
                  </strong>
                  <span>Road Estimate</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {roadKmLabel}
                  </strong>
                  <span>Road KM Source</span>
                  <strong className="text-right text-slate-800 dark:text-slate-100">
                    {roadKmEstimate
                      ? `${roadKmEstimate.status === "google" ? "Google" : roadKmEstimate.status} / ${roadKmEstimate.anchorCount || 0} anchors`
                      : "--"}
                  </strong>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function useAnimatedOfficerMarkers(officers, selectedOfficerId, selectedRouteLogs) {
  const [animatedMarkers, setAnimatedMarkers] = useState({});
  const targetCoordinatesRef = useRef(new Map());
  const selectedSegmentKeyRef = useRef(null);
  const animationsRef = useRef(new Map());
  const frameRef = useRef(null);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const latestSelectedSegment = latestRouteSegmentFromLogs(selectedRouteLogs);
    const latestSelectedSegmentKey = latestSelectedSegment
      ? `${latestSelectedSegment.start.join(",")}-${latestSelectedSegment.end.join(",")}`
      : null;
    const currentOfficerIds = new Set(officers.map((officer) => officer.id));
    const now = performance.now();

    setAnimatedMarkers((currentMarkers) => {
      const nextMarkers = { ...currentMarkers };

      Object.keys(nextMarkers).forEach((id) => {
        if (!currentOfficerIds.has(id)) {
          delete nextMarkers[id];
          targetCoordinatesRef.current.delete(id);
          animationsRef.current.delete(id);
        }
      });

      officers.forEach((officer) => {
        const target = normalizeCoordinates(officer.coordinates);
        if (!target || !canShowOfficerMarker(officer)) {
          delete nextMarkers[officer.id];
          targetCoordinatesRef.current.delete(officer.id);
          animationsRef.current.delete(officer.id);
          return;
        }

        const previousTarget = targetCoordinatesRef.current.get(officer.id);
        const targetKey = target.join(",");
        const shouldAnimateSelectedSegment =
          officer.id === selectedOfficerId &&
          latestSelectedSegment &&
          selectedSegmentKeyRef.current !== latestSelectedSegmentKey;
        if (previousTarget?.key === targetKey && !shouldAnimateSelectedSegment) {
          return;
        }

        if (!canAnimateOfficerMarker(officer)) {
          nextMarkers[officer.id] = {
            coordinates: target,
            heading: officer.heading,
            isAnimating: false,
            movementStatusLabel: null,
          };
          targetCoordinatesRef.current.set(officer.id, {
            key: targetKey,
            coordinates: target,
          });
          animationsRef.current.delete(officer.id);
          return;
        }

        let start =
          normalizeCoordinates(nextMarkers[officer.id]?.coordinates) ||
          normalizeCoordinates(previousTarget?.coordinates);
        if (
          (!start || shouldAnimateSelectedSegment) &&
          officer.id === selectedOfficerId &&
          latestSelectedSegment
        ) {
          start = latestSelectedSegment.start;
        }
        if (!start) {
          nextMarkers[officer.id] = {
            coordinates: target,
            heading: officer.heading,
            isAnimating: false,
            movementStatusLabel: null,
          };
          targetCoordinatesRef.current.set(officer.id, {
            key: targetKey,
            coordinates: target,
          });
          return;
        }

        const distanceMeters = distanceKmBetween(
          { latitude: start[0], longitude: start[1] },
          { latitude: target[0], longitude: target[1] },
        ) * 1000;
        const heading = movementBearing(start, target) ?? officer.heading;

        if (distanceMeters > MAX_ROUTE_SEGMENT_METERS) {
          nextMarkers[officer.id] = {
            coordinates: target,
            heading,
            isAnimating: false,
            movementStatusLabel: null,
          };
          animationsRef.current.delete(officer.id);
        } else {
          const duration = markerAnimationDurationMs(distanceMeters);
          const label = markerAnimationLabel(officer.locationSourceTime);
          animationsRef.current.set(officer.id, {
            start,
            end: target,
            startTime: now,
            duration,
            heading,
            label,
          });
          nextMarkers[officer.id] = {
            coordinates: start,
            heading,
            isAnimating: true,
            movementStatusLabel: label,
          };
        }

        targetCoordinatesRef.current.set(officer.id, {
          key: targetKey,
          coordinates: target,
        });
      });

      selectedSegmentKeyRef.current = latestSelectedSegmentKey;

      return nextMarkers;
    });

    if (animationsRef.current.size && !frameRef.current) {
      const animate = (frameTime) => {
        let hasActiveAnimations = false;
        setAnimatedMarkers((currentMarkers) => {
          const nextMarkers = { ...currentMarkers };
          animationsRef.current.forEach((animation, officerId) => {
            const progress = Math.min(
              1,
              (frameTime - animation.startTime) / animation.duration,
            );
            const coordinates = [
              animation.start[0] +
                (animation.end[0] - animation.start[0]) * progress,
              animation.start[1] +
                (animation.end[1] - animation.start[1]) * progress,
            ];
            nextMarkers[officerId] = {
              coordinates,
              heading: animation.heading,
              isAnimating: progress < 1,
              movementStatusLabel: progress < 1 ? animation.label : null,
            };
            if (progress >= 1) {
              animationsRef.current.delete(officerId);
            } else {
              hasActiveAnimations = true;
            }
          });
          return nextMarkers;
        });
        if (hasActiveAnimations) {
          frameRef.current = window.requestAnimationFrame(animate);
        } else {
          frameRef.current = null;
        }
      };
      frameRef.current = window.requestAnimationFrame(animate);
    }
  }, [officers, selectedOfficerId, selectedRouteLogs]);

  return animatedMarkers;
}

export default function FOActivities() {
  usePageTitle("FO Activities");
  const { user, session, authStatus, authError } = useAuth();
  const hasDemoBackendReadSession = authStatus === "ready" && isDemoUser(user);
  const hasActiveSession = authStatus === "ready" && (Boolean(session?.access_token) || hasDemoBackendReadSession);
  const currentRole = normalizeRoleKey(generatedUserRole(user));
  const fullTechnicalAccess = hasTechnicalKmAccess(user);
  const canRunBatchKmRecalculation = ["admin", "developer", "qpmsadmin", "md", "coo"].includes(currentRole);
  const temporarySwitchNormalizedRole = resolveTemporarySwitchRole(user);
  const canUseTemporarySwitchKm = temporarySwitchAllowedRoles.has(temporarySwitchNormalizedRole);
  const canRunTemporarySwitchKm = canUseTemporarySwitchKm;
  const canReviewCheckoutExceptions =
    canReviewCheckoutException(currentRole);
  const canApproveCheckoutMissingKmReviews =
    canApproveCheckoutMissingKm(currentRole);
  const [stateFilter, setStateFilter] = useState("All States");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [businessFilter, setBusinessFilter] = useState("All Business");
  const [draftStateFilter, setDraftStateFilter] = useState("All States");
  const [draftStatusFilter, setDraftStatusFilter] = useState("All Status");
  const [draftBusinessFilter, setDraftBusinessFilter] = useState("All Business");
  const [search, setSearch] = useState("");
  const [expandedMap, setExpandedMap] = useState(false);
  const [selectedOfficerId, setSelectedOfficerId] = useState(null);
  const [employeeRangeDataset, setEmployeeRangeDataset] = useState(null);
  const [employeeRangeLoading, setEmployeeRangeLoading] = useState(false);
  const [employeeRangeError, setEmployeeRangeError] = useState("");
  const [mapRouteOfficerId, setMapRouteOfficerId] = useState(null);
  const [supportOfficerId, setSupportOfficerId] = useState(null);
  const [supportContext, setSupportContext] = useState({ attendanceRows: [], visitRows: [] });
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportPendingAction, setSupportPendingAction] = useState(null);
  const [supportRemarks, setSupportRemarks] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [checkoutReviewBusyVisitId, setCheckoutReviewBusyVisitId] = useState(null);
  const [liveOfficers, setLiveOfficers] = useState([]);
  const [attendanceKpiRows, setAttendanceKpiRows] = useState([]);
  const [siteVisitRows, setSiteVisitRows] = useState([]);
  const [selectedRouteLogs, setSelectedRouteLogs] = useState([]);
  const [selectedRouteEvidenceOfficerId, setSelectedRouteEvidenceOfficerId] = useState(null);
  const [mainMapRouteLines, setMainMapRouteLines] = useState([]);
  const [mainMapRouteMessage, setMainMapRouteMessage] = useState(null);
  const [selectedActivitySubmissions, setSelectedActivitySubmissions] = useState([]);
  const [selectedActivityUploads, setSelectedActivityUploads] = useState([]);
  const [selectedActivityReloadToken, setSelectedActivityReloadToken] = useState(0);
  const [showSiteMarkers, setShowSiteMarkers] = useState(true);
  const [showRouteTrail, setShowRouteTrail] = useState(true);
  const [mapTheme, setMapTheme] = useState("light");
  const [mapControlsCollapsed, setMapControlsCollapsed] = useState(false);
  const [mapCommand, setMapCommand] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [kmRecalcBusy, setKmRecalcBusy] = useState(false);
  const [kmRecalcResult, setKmRecalcResult] = useState(null);
  const [switchKmRecalcBusy, setSwitchKmRecalcBusy] = useState(false);
  const [batchKmRecalcBusy, setBatchKmRecalcBusy] = useState(false);
  const [batchKmRecalcProgress, setBatchKmRecalcProgress] = useState(null);
  const [batchKmRecalcResume, setBatchKmRecalcResume] = useState(null);
  const [dashboardExportBusy, setDashboardExportBusy] = useState(false);
  const [customFromDate, setCustomFromDate] = useState(
    toDateInputValue(new Date()),
  );
  const [customToDate, setCustomToDate] = useState(
    toDateInputValue(new Date()),
  );
  const [draftFromDate, setDraftFromDate] = useState(customFromDate);
  const [draftToDate, setDraftToDate] = useState(customToDate);
  const [filteredSummary, setFilteredSummary] = useState(EMPTY_OPERATIONS_SUMMARY);
  const [filteredSummaryLoading, setFilteredSummaryLoading] = useState(false);
  const [filteredSummaryError, setFilteredSummaryError] = useState("");
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [demoDateRange, setDemoDateRange] = useState(null);
  const [detailDraftFromDate, setDetailDraftFromDate] = useState(customFromDate);
  const [detailDraftToDate, setDetailDraftToDate] = useState(customToDate);
  const profileRowsRef = useRef([]);
  const mainRouteFitKeyRef = useRef(null);
  const kmRecalcCooldownRef = useRef(new Map());
  const kmRecalcInFlightRef = useRef(new Set());
  const summaryRequestSequenceRef = useRef(0);
  const employeeRangeRequestSequenceRef = useRef(0);

  const selectedRange = useMemo(
    () => dateRangeForPreset("custom", customFromDate, customToDate),
    [customFromDate, customToDate],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadFoOperations() {
      if (!isSupabaseConfigured || !supabase || !hasActiveSession) {
        return;
      }
      try {
        if (hasDemoBackendReadSession) {
          const query = operationsSummaryQuery({
            dateFrom: selectedRange.fromDate,
            dateTo: selectedRange.toDate,
            state: stateFilter,
            business: businessFilter,
            status: statusFilter,
          });
          const response = await authenticatedFetch(`${API_BASE_URL}/api/fo/operations/dashboard?${query}`);
          const payload = await response.json();
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.message || "Operations dashboard failed.");
          }
          const profileRows = payload.profiles || [];
          const officersFromBackend = buildLiveFoData({
            attendance: payload.attendances || [],
            visits: payload.site_visits || [],
            liveStatus: payload.live_status || [],
            profiles: profileRows,
            logs: [],
            statusDate: selectedRange.toDate,
            currentUser: user,
          });
          if (!cancelled) {
            profileRowsRef.current = profileRows;
            setAttendanceKpiRows(payload.attendances || []);
            setSiteVisitRows(payload.site_visits || []);
            setLiveOfficers(officersFromBackend);
          }
          return;
        }
        await authSessionManager().requireSession();
        const fromIso = formatDateForDb(selectedRange.from);
        const toIso = formatDateForDb(selectedRange.to);
        const [attendanceRes, siteVisits, liveStatusRows, profilesRes] =
          await Promise.all([
            supabase
              .from("fo_attendance")
              .select("*")
              .gte("attendance_date", selectedRange.fromDate)
              .lte("attendance_date", selectedRange.toDate)
              .order("login_time", { ascending: false })
              .limit(500),
            fetchFoSiteVisitRows(fromIso, toIso),
            fetchFoLiveStatusRows(),
            supabase
              .from("profiles")
              .select(
                "id, full_name, display_name, employee_code, username, mobile, email, role, department, designation, business, state, status, is_active, metadata",
              )
              .eq("is_active", true)
              .limit(5000),
          ]);
        const errors = [attendanceRes, profilesRes]
          .map((res) => res?.error)
          .filter(Boolean);
        console.debug("FO_SUPABASE_QUERY_RESULTS", {
          attendanceCount: attendanceRes.data?.length || 0,
          attendanceError: attendanceRes.error || null,
          liveStatusCount: liveStatusRows.length,
          profilesCount: profilesRes.data?.length || 0,
          profilesError: profilesRes.error || null,
        });
        if (errors.length) {
          console.warn("FO_SUPABASE_ERRORS", {
            attendance: attendanceRes.error || null,
            profiles: profilesRes.error || null,
          });
        }
        if (errors.length) {
          throw errors[0];
        }
        const profileRows = profilesRes.data || [];
        const profilesByCode = profileByEmployeeCode(profileRows);
        console.debug("FO_PROFILES_LOADED", profileRows.length);
        liveStatusRows.forEach((row) => {
          const foId = normalizeFoKey(row?.fo_user_id);
          if (foId && !profilesByCode.has(foId)) {
            console.debug("FO_INCLUDED_LIVE_WITHOUT_PROFILE", foId);
          }
        });
        const officersFromSupabase = buildLiveFoData({
          attendance: attendanceRes.data || [],
          visits: siteVisits,
          liveStatus: liveStatusRows,
          profiles: profileRows,
          logs: [],
          statusDate: toDateInputValue(new Date()),
          currentUser: user,
        });
        console.debug("FO_ATTENDANCE_LOADED", attendanceRes.data?.length || 0);
        console.debug("FO_SITE_VISITS_LOADED", siteVisits.length);
        console.debug("FO_LIVE_STATUS_LOADED", liveStatusRows.length);
        console.debug("FO_OFFICERS_BUILT", officersFromSupabase.length);
        if (!cancelled) {
          profileRowsRef.current = profileRows;
          setAttendanceKpiRows(attendanceRes.data || []);
          setSiteVisitRows(siteVisits);
          setLiveOfficers(officersFromSupabase);
        }
      } catch (error) {
        console.warn("[myQPMS FO] Supabase FO fetch failed.", error);
        const authInvalidated = await invalidateAuthOnUnauthorized(error);
        if (!cancelled && !authInvalidated) {
          setAttendanceKpiRows([]);
          setSiteVisitRows([]);
          setLiveOfficers([]);
        }
      }
    }
    loadFoOperations();
    return () => {
      cancelled = true;
    };
  }, [businessFilter, hasActiveSession, hasDemoBackendReadSession, refreshToken, selectedRange.from, selectedRange.fromDate, selectedRange.to, selectedRange.toDate, stateFilter, statusFilter, user]);

  useEffect(() => {
    if (!hasActiveSession || hasDemoBackendReadSession) return undefined;
    const interval = window.setInterval(() => {
      setRefreshToken((value) => value + 1);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [hasActiveSession, hasDemoBackendReadSession]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !hasActiveSession || hasDemoBackendReadSession) return undefined;
    const channel = supabase
      .channel("fo-operations-live-status")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "fo_live_status" },
        (payload) => {
          console.debug("FO_REALTIME_UPDATE", payload.new?.fo_user_id);
          setLiveOfficers((officers) =>
            mergeRealtimeOfficer(officers, payload.new, profileRowsRef.current, user),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fo_live_status" },
        (payload) => {
          console.debug("FO_REALTIME_UPDATE", payload.new?.fo_user_id);
          setLiveOfficers((officers) =>
            mergeRealtimeOfficer(officers, payload.new, profileRowsRef.current, user),
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("REALTIME_CONNECTED");
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          console.log("REALTIME_STATUS", status);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hasActiveSession, hasDemoBackendReadSession, user]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !hasActiveSession || hasDemoBackendReadSession) return undefined;
    const channel = supabase
      .channel("fo-operations-site-visits")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fo_site_visits" },
        (payload) => {
          console.debug("FO_SITE_VISIT_REALTIME_UPDATE", payload.new?.fo_user_id);
          setRefreshToken((value) => value + 1);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hasActiveSession, hasDemoBackendReadSession]);

  const officers = useMemo(
    () =>
      liveOfficers.filter(
        (officer) =>
          !isHiddenEmployeeRecord(officer) &&
          isOperationsCommandVisibleRecord(officer, user),
      ),
    [liveOfficers, user],
  );

  useEffect(() => {
    if (!hasDemoBackendReadSession) return undefined;
    let cancelled = false;
    async function loadDemoDateRange() {
      try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/fo/operations/demo-date-range`);
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.message || "Demo date range failed.");
        if (cancelled || !payload.latest_demo_date) return;
        setDemoDateRange(payload);
        setCustomFromDate(payload.latest_demo_date);
        setCustomToDate(payload.latest_demo_date);
        setDraftFromDate(payload.latest_demo_date);
        setDraftToDate(payload.latest_demo_date);
        setDetailDraftFromDate(payload.latest_demo_date);
        setDetailDraftToDate(payload.latest_demo_date);
      } catch (error) {
        console.warn("[myQPMS FO] Demo date resolver failed.", error);
      }
    }
    loadDemoDateRange();
    return () => {
      cancelled = true;
    };
  }, [hasDemoBackendReadSession]);

  useEffect(() => {
    const controller = new AbortController();
    const requestSequence = summaryRequestSequenceRef.current + 1;
    summaryRequestSequenceRef.current = requestSequence;

    async function loadFilteredSummary() {
      if (!hasActiveSession) {
        setFilteredSummaryLoading(false);
        setFilteredSummaryError(authError || SESSION_EXPIRED_MESSAGE);
        return;
      }
      setFilteredSummaryLoading(true);
      setFilteredSummaryError("");
      try {
        const query = operationsSummaryQuery({
          dateFrom: selectedRange.fromDate,
          dateTo: selectedRange.toDate,
          state: stateFilter,
          business: businessFilter,
          status: statusFilter,
        });
        const response = await authenticatedFetch(`${API_BASE_URL}/api/fo/operations/summary?${query}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Filtered summary failed.");
        }
        if (!shouldAcceptSummaryResponse(requestSequence, summaryRequestSequenceRef.current)) return;
        setFilteredSummary({
          payable_km: Number(payload.payable_km) || 0,
          petrol_amount: Number(payload.petrol_amount) || 0,
          matching_attendance_count: Number(payload.matching_attendance_count) || 0,
          matching_employee_count: Number(payload.matching_employee_count) || 0,
          applied_filters: payload.applied_filters || null,
        });
      } catch (error) {
        if (error.name === "AbortError") return;
        if (!shouldAcceptSummaryResponse(requestSequence, summaryRequestSequenceRef.current)) return;
        console.warn("[myQPMS FO] Filtered summary failed.", error);
        setFilteredSummaryError(error.message || "Filtered summary failed.");
      } finally {
        if (shouldAcceptSummaryResponse(requestSequence, summaryRequestSequenceRef.current)) {
          setFilteredSummaryLoading(false);
        }
      }
    }

    if (isSupabaseConfigured && supabase) loadFilteredSummary();
    return () => controller.abort();
  }, [authError, businessFilter, hasActiveSession, selectedRange.fromDate, selectedRange.toDate, stateFilter, statusFilter, summaryRefreshToken]);
  const operationalOfficerKeys = useMemo(() => {
    const keys = new Set();
    officers.forEach((officer) => {
      [
        officer.foId,
        officer.employeeCode,
        officer.username,
        officer.profile?.employee_code,
        officer.profile?.username,
      ].forEach((value) => {
        const key = normalizeFoKey(value);
        if (key) keys.add(key);
      });
    });
    return keys;
  }, [officers]);
  const visibleAttendanceKpiRows = useMemo(
    () =>
      attendanceKpiRows.filter(
        (row) =>
          !isHiddenEmployeeRecord(row) &&
          recordMatchesOfficerKeys(row, operationalOfficerKeys),
      ),
    [attendanceKpiRows, operationalOfficerKeys],
  );
  const visibleSiteVisitRows = useMemo(
    () =>
      siteVisitRows.filter(
        (visit) =>
          !isHiddenEmployeeRecord(visit) &&
          recordMatchesOfficerKeys(visit, operationalOfficerKeys),
      ),
    [operationalOfficerKeys, siteVisitRows],
  );

  const structurallyFilteredOfficers = useMemo(
    () =>
      officers.filter((officer) => {
        const stateMatches =
          stateFilter === "All States" || officer.state === stateFilter;
        const businessLabel = officer.business || "--";
        const businessMatches =
          businessFilter === "All Business" ||
          businessLabel === businessFilter;
        const searchText = search.trim().toLowerCase();
        const searchableFields = [
          officer.name,
          officer.employeeCode,
          officer.foId,
          officer.username,
          officer.phone,
          officer.email,
          officer.role,
          officer.designation,
          officer.department,
          officer.state,
          officer.business,
          officer.operationalStatus,
          officer.operationalStatusLabel,
          operationalStatusLabel(officer.operationalStatus),
          officer.assignedSite,
          officer.branch,
        ];
        const searchMatches =
          !searchText ||
          searchableFields
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(searchText);
        return stateMatches && businessMatches && searchMatches;
      }),
    [businessFilter, officers, search, stateFilter],
  );

  const businessOptions = useMemo(
    () =>
      Array.from(
        new Set(
          officers
            .map((officer) => String(officer.business || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [officers],
  );

  const filteredOfficers = useMemo(
    () =>
      structurallyFilteredOfficers.filter((officer) =>
        statusFilterMatches(officer, statusFilter),
      ),
    [statusFilter, structurallyFilteredOfficers],
  );

  function applyDashboardFilters() {
    if (!draftFromDate || !draftToDate || draftFromDate > draftToDate) {
      window.alert("Select a valid From Date and To Date.");
      return;
    }
    if (hasDemoBackendReadSession && demoDateRange?.earliest_demo_date && demoDateRange?.latest_demo_date) {
      if (draftFromDate < demoDateRange.earliest_demo_date || draftToDate > demoDateRange.latest_demo_date) {
        window.alert("Demo dates must stay within the prepared sample data range.");
        return;
      }
    }
    setCustomFromDate(draftFromDate);
    setCustomToDate(draftToDate);
    setStateFilter(draftStateFilter);
    setBusinessFilter(draftBusinessFilter);
    setStatusFilter(draftStatusFilter);
    setSummaryRefreshToken((value) => value + 1);
  }

  function resetDashboardFilters() {
    const today = toDateInputValue(new Date());
    setDraftFromDate(today);
    setDraftToDate(today);
    setDraftStateFilter("All States");
    setDraftBusinessFilter("All Business");
    setDraftStatusFilter("All Status");
    setCustomFromDate(today);
    setCustomToDate(today);
    setStateFilter("All States");
    setBusinessFilter("All Business");
    setStatusFilter("All Status");
    setSummaryRefreshToken((value) => value + 1);
  }

  async function exportDashboardExcel() {
    if (dashboardExportBusy) return;
    setDashboardExportBusy(true);
    try {
      await exportHistoricalOperationsDashboardExcel({
        from: selectedRange.from,
        to: selectedRange.to,
        currentUser: user,
        filters: {
          state: stateFilter,
          business: businessFilter,
          status: statusFilter,
          search,
        },
      });
    } catch (error) {
      console.warn("[myQPMS FO] Historical dashboard export failed.", error);
      window.alert("Unable to export Operations report for the selected date range. Please retry.");
    } finally {
      setDashboardExportBusy(false);
    }
  }

  async function recalculateAllKmForSelectedRange() {
    if (batchKmRecalcBusy) return;
    try {
      assertDemoWriteAllowed(user);
    } catch (error) {
      window.alert(error.message);
      return;
    }
    const batchKey = JSON.stringify({
      fromDate: selectedRange.fromDate,
      toDate: selectedRange.toDate,
      state: stateFilter,
      business: businessFilter,
      status: statusFilter,
    });
    const resumable = batchKmRecalcResume?.batchKey === batchKey
      ? batchKmRecalcResume
      : null;
    const confirmed = window.confirm(resumable
      ? `Resume Recalculate All KM after ${resumable.totals.processed} processed attendances?`
      : "This will recalculate payable KM from eligible GPS travel windows for completed attendances in the selected date range. Continue?");
    if (!confirmed) return;

    setBatchKmRecalcBusy(true);
    const totals = resumable
      ? {
          ...resumable.totals,
          counters: { ...resumable.totals.counters },
          results: [...resumable.totals.results],
        }
      : {
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          counters: {},
          results: [],
        };
    let cursor = resumable?.cursor || null;
    let completed = false;
    setBatchKmRecalcProgress({
      processed: totals.processed,
      updated: totals.updated,
      skipped: totals.skipped,
      failed: totals.failed,
    });
    try {
      let done = false;
      while (!done) {
        let page = null;
        let pageError = null;
        for (let attempt = 1; attempt <= 3 && !page; attempt += 1) {
          try {
            const response = await authenticatedFetch(`${API_BASE_URL}/api/fo/km/recalculate-batch`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fromDate: selectedRange.fromDate,
                toDate: selectedRange.toDate,
                state: stateFilter,
                business: businessFilter,
                status: statusFilter,
                batchSize: 50,
                cursor,
                dryRun: false,
              }),
            });
            const responseBody = await response.json();
            if (!response.ok || responseBody.ok === false) {
              throw new Error(responseBody.message || "Batch KM recalculation failed.");
            }
            page = responseBody;
          } catch (error) {
            pageError = error;
            if (isAuthSessionError(error)) throw error;
            if (attempt < 3) {
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 500));
            }
          }
        }
        if (!page) {
          throw pageError || new Error("Batch KM recalculation failed after 3 attempts.");
        }
        totals.processed += Number(page.processed || 0);
        totals.updated += Number(page.updated || 0);
        totals.skipped += Number(page.skipped || 0);
        totals.failed += Number(page.failed || 0);
        totals.results.push(...(page.results || []));
        Object.entries(page.counters || {}).forEach(([key, value]) => {
          totals.counters[key] = Number(totals.counters[key] || 0) + Number(value || 0);
        });
        setBatchKmRecalcProgress({
          processed: totals.processed,
          updated: totals.updated,
          skipped: totals.skipped,
          failed: totals.failed,
        });
        cursor = page.nextCursor || null;
        done = page.done === true || !cursor;
        if (done) {
          setBatchKmRecalcResume(null);
        } else {
          setBatchKmRecalcResume({
            batchKey,
            cursor,
            totals: {
              ...totals,
              counters: { ...totals.counters },
              results: [...totals.results],
            },
          });
        }
      }
      completed = true;
      window.alert(
        [
          "Recalculate All KM completed.",
          `Processed: ${totals.processed}`,
          `Updated: ${totals.updated}`,
          `Skipped: ${totals.skipped}`,
          `Failed: ${totals.failed}`,
        ].join("\n"),
      );
      setKmRecalcResult(totals);
      setRefreshToken((value) => value + 1);
      setSummaryRefreshToken((value) => value + 1);
    } catch (error) {
      console.warn("[myQPMS FO] Batch KM recalculation failed.", error);
      setKmRecalcResult(totals);
      setBatchKmRecalcResume({
        batchKey,
        cursor,
        totals: {
          ...totals,
          counters: { ...totals.counters },
          results: [...totals.results],
        },
      });
      window.alert(
        [
          error.message || "Batch KM recalculation failed after 3 attempts.",
          "Progress was preserved and can be resumed.",
          `Processed: ${totals.processed}`,
          `Updated: ${totals.updated}`,
          `Skipped: ${totals.skipped}`,
          `Failed: ${totals.failed}`,
        ].join("\n"),
      );
    } finally {
      setBatchKmRecalcBusy(false);
      if (completed) setBatchKmRecalcProgress(null);
    }
  }

  const stateSummaryRows = useMemo(() => {
    if (!officers.length) return [];
    const byState = new Map();
    officers.forEach((officer) => {
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
      if (!isOperationallyActive(officer)) current.status = "Critical";
      byState.set(officer.state, current);
    });
    return Array.from(byState.values());
  }, [officers]);

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

  const selectedOfficerBase =
    filteredOfficers.find((officer) => officer.id === selectedOfficerId) ||
    null;
  const selectedEmployeeIdentifier =
    selectedOfficerBase?.employeeCode || selectedOfficerBase?.foId || null;

  const loadSelectedEmployeeRange = useCallback(async () => {
    const requestSequence = employeeRangeRequestSequenceRef.current + 1;
    employeeRangeRequestSequenceRef.current = requestSequence;

    if (!selectedEmployeeIdentifier || !hasActiveSession) {
      setEmployeeRangeDataset(null);
      setEmployeeRangeError("");
      setEmployeeRangeLoading(false);
      return null;
    }
    if (hasDemoBackendReadSession) {
      setEmployeeRangeDataset(null);
      setEmployeeRangeError(
        "Complete employee reports require an authenticated production session.",
      );
      setEmployeeRangeLoading(false);
      return null;
    }

    setEmployeeRangeLoading(true);
    setEmployeeRangeError("");
    try {
      const query = employeeRangeQuery({
        employeeIdentifier: selectedEmployeeIdentifier,
        fromDate: selectedRange.fromDate,
        toDate: selectedRange.toDate,
      });
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/fo/operations/employee-range?${query}`,
      );
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Employee period report failed.");
      }
      if (requestSequence !== employeeRangeRequestSequenceRef.current) {
        return null;
      }
      setEmployeeRangeDataset(payload);
      return payload;
    } catch (error) {
      if (requestSequence === employeeRangeRequestSequenceRef.current) {
        setEmployeeRangeError(
          error?.message || "Employee period report could not be loaded.",
        );
      }
      return null;
    } finally {
      if (requestSequence === employeeRangeRequestSequenceRef.current) {
        setEmployeeRangeLoading(false);
      }
    }
  }, [
    hasActiveSession,
    hasDemoBackendReadSession,
    selectedEmployeeIdentifier,
    selectedRange.fromDate,
    selectedRange.toDate,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      loadSelectedEmployeeRange();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadSelectedEmployeeRange]);

  const selectedOfficer = useMemo(() => {
    if (!selectedOfficerBase) return null;
    if (employeeRangeDataset) {
      const rangeAttendances = employeeRangeDataset.attendance_days || [];
      const latestAttendance = rangeAttendances[rangeAttendances.length - 1] || null;
      const summary = employeeRangeDataset.period_summary || {};
      return {
        ...selectedOfficerBase,
        attendance: latestAttendance || selectedOfficerBase.attendance,
        attendances: rangeAttendances,
        visits: employeeRangeDataset.site_visits || [],
        eligibleKm: Number(summary.canonical_payable_km || 0),
        routeKmToday: Number(summary.canonical_payable_km || 0),
        petrolAmount: Number(summary.canonical_petrol_amount || 0),
        petrolAmountPending: Boolean(summary.canonical_pending_count),
      };
    }
    const selectedKey = normalizeFoKey(
      selectedOfficerBase.foId || selectedOfficerBase.employeeCode,
    );
    const rangeAttendances = visibleAttendanceKpiRows
      .filter(
        (row) =>
          normalizeFoKey(row.fo_user_id || row.employee_code) === selectedKey,
      )
      .sort(
        (a, b) =>
          new Date(a.login_time || 0) - new Date(b.login_time || 0),
      );
    const payableKm = rangeAttendances.reduce(
      (sum, row) => sum + payableKmFromAttendance(row),
      0,
    );
    return {
      ...selectedOfficerBase,
      attendances: rangeAttendances,
      eligibleKm: rangeAttendances.length
        ? payableKm
        : selectedOfficerBase.eligibleKm,
      routeKmToday: rangeAttendances.length
        ? payableKm
        : selectedOfficerBase.routeKmToday,
      petrolAmount: rangeAttendances.length
        ? sumAttendancePetrolAmount(rangeAttendances)
        : selectedOfficerBase.petrolAmount,
      petrolAmountPending: rangeAttendances.some(isCanonicalPetrolPending),
    };
  }, [employeeRangeDataset, selectedOfficerBase, visibleAttendanceKpiRows]);
  const mapRouteOfficer =
    filteredOfficers.find((officer) => officer.id === mapRouteOfficerId) ||
    officers.find((officer) => officer.id === mapRouteOfficerId) ||
    null;
  const routeOfficer = selectedOfficer || mapRouteOfficer;
  const shouldLoadRouteLogs = Boolean(
    mapRouteOfficer || (selectedOfficer && selectedRouteEvidenceOfficerId === selectedOfficer.id),
  );
  const supportOfficer =
    filteredOfficers.find((officer) => officer.id === supportOfficerId) ||
    officers.find((officer) => officer.id === supportOfficerId) ||
    null;
  const animatedMarkers = useAnimatedOfficerMarkers(
    filteredOfficers,
    selectedOfficerId,
    selectedRouteLogs,
  );
  const visualFilteredOfficers = useMemo(
    () =>
      filteredOfficers.map((officer) => {
        const animatedMarker = animatedMarkers[officer.id];
        if (!animatedMarker) return officer;
        return {
          ...officer,
          coordinates: animatedMarker.coordinates,
          heading: animatedMarker.heading ?? officer.heading,
          movementStatusLabel: animatedMarker.movementStatusLabel,
          isMarkerAnimating: animatedMarker.isAnimating,
        };
      }),
    [animatedMarkers, filteredOfficers],
  );
  const directorySearchPlaceholder =
    "Search by name, employee ID, state, business";

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedRouteLogs() {
      if (hasDemoBackendReadSession || !shouldLoadRouteLogs || !routeOfficer || !isSupabaseConfigured || !supabase) {
        setSelectedRouteLogs([]);
        return;
      }
      const fromIso = formatDateForDb(selectedRange.from);
      const toIso = formatDateForDb(selectedRange.to);
      const operationalFoId = operationalFoIdForOfficer(routeOfficer);
      const attendanceId =
        selectedRange.fromDate === selectedRange.toDate
          ? routeOfficer.attendance?.id || null
          : null;
      const fetchedRows = [];
      const timeColumns = ["captured_at", "logged_at", "created_at"];
      let source = "employee_code_date";

      try {
        if (attendanceId) {
          try {
            fetchedRows.push(...(await fetchLocationLogsByAttendanceId(attendanceId, { fromIso, toIso })));
          } catch (attendanceError) {
            console.warn("[myQPMS FO] Attendance GPS lookup failed; using employee/date fallback.", attendanceError);
          }
          if (fetchedRows.length) source = "attendance_id";
        }
        if (!fetchedRows.length && operationalFoId) {
          for (const idColumn of ["fo_user_id", "employee_code", "username"]) {
            for (const timeColumn of timeColumns) {
              const rows = await fetchLocationLogsByColumn({
                idColumn,
                idValue: operationalFoId,
                timeColumn,
                fromIso,
                toIso,
              });
              fetchedRows.push(...rows);
              if (fetchedRows.length) {
                source = `${idColumn}_${timeColumn}`;
                break;
              }
            }
            if (fetchedRows.length) break;
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[myQPMS FO] Selected FO route logs fetch failed.", error);
          setSelectedRouteLogs([]);
        }
        return;
      }
      if (cancelled) return;
      const routeRowsById = new Map();
      fetchedRows.forEach((row, index) => {
        routeRowsById.set(
          row.id ||
            `${row.captured_at || row.logged_at || row.created_at || index}-${row.latitude}-${row.longitude}`,
          row,
        );
      });
      const selectedLogs = Array.from(routeRowsById.values()).sort(
        (a, b) => routePointTime(a) - routePointTime(b),
      );
      console.debug("FO_GPS_AUDIT_DIAGNOSTICS", {
        "profile.id": routeOfficer.profile?.id || null,
        employee_code: routeOfficer.profile?.employee_code || routeOfficer.employeeCode || null,
        operationalFoId,
        attendance_id: attendanceId,
        gps_logs_count_result: selectedLogs.length,
        source,
        dateRange: `${selectedRange.fromDate} to ${selectedRange.toDate}`,
      });
      setSelectedRouteLogs(selectedLogs);
    }
    loadSelectedRouteLogs();
    return () => {
      cancelled = true;
    };
  }, [hasDemoBackendReadSession, routeOfficer, selectedRange.from, selectedRange.fromDate, selectedRange.to, selectedRange.toDate, shouldLoadRouteLogs]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedActivityUploads() {
      if (hasDemoBackendReadSession || !selectedOfficer || !isSupabaseConfigured || !supabase) {
        setSelectedActivitySubmissions([]);
        setSelectedActivityUploads([]);
        return;
      }
      const selectedFoId = normalizeFoKey(selectedOfficer.foId || selectedOfficer.employeeCode);
      if (!selectedFoId) {
        setSelectedActivitySubmissions([]);
        setSelectedActivityUploads([]);
        return;
      }
      const fromIso = formatDateForDb(selectedRange.from);
      const toIso = formatDateForDb(selectedRange.to);
      const attendanceId =
        selectedRange.fromDate === selectedRange.toDate && selectedOfficer.attendance?.id
          ? String(selectedOfficer.attendance.id)
          : null;
      const siteVisitIds = new Set(
        (selectedOfficer.visits || []).map((visit) => String(visit.id || "")).filter(Boolean),
      );
      const siteVisitIdList = Array.from(siteVisitIds);

      try {
        const [
          submissionsRes,
          uploadsRes,
          visitSubmissionsRes,
          visitUploadsRes,
        ] = await Promise.all([
          supabase
            .from("fo_activity_submissions")
            .select("*")
            .or(`fo_user_id.eq.${selectedFoId},employee_code.eq.${selectedFoId}`)
            .gte("submitted_at", fromIso)
            .lte("submitted_at", toIso)
            .order("submitted_at", { ascending: false })
            .limit(1000),
          supabase
            .from("fo_activity_uploads")
            .select("*")
            .or(`fo_user_id.eq.${selectedFoId},employee_code.eq.${selectedFoId}`)
            .gte("uploaded_at", fromIso)
            .lte("uploaded_at", toIso)
            .order("uploaded_at", { ascending: false })
            .limit(1000),
          siteVisitIdList.length
            ? supabase
                .from("fo_activity_submissions")
                .select("*")
                .or(`fo_user_id.eq.${selectedFoId},employee_code.eq.${selectedFoId}`)
                .in("site_visit_id", siteVisitIdList)
                .order("submitted_at", { ascending: false })
                .limit(1000)
            : Promise.resolve({ data: [], error: null }),
          siteVisitIdList.length
            ? supabase
                .from("fo_activity_uploads")
                .select("*")
                .or(`fo_user_id.eq.${selectedFoId},employee_code.eq.${selectedFoId}`)
                .in("site_visit_id", siteVisitIdList)
                .order("uploaded_at", { ascending: false })
                .limit(1000)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (submissionsRes.error) throw submissionsRes.error;
        if (uploadsRes.error) throw uploadsRes.error;
        if (visitSubmissionsRes.error) throw visitSubmissionsRes.error;
        if (visitUploadsRes.error) throw visitUploadsRes.error;
        if (cancelled) return;

        const submissionRows = [
          ...(submissionsRes.data || []),
          ...(visitSubmissionsRes.data || []),
        ];
        const submissionsByUniqueId = new Map();
        submissionRows.forEach((row, index) => {
          submissionsByUniqueId.set(String(row.id || row.local_id || index), row);
        });
        const uploadRows = [
          ...(uploadsRes.data || []),
          ...(visitUploadsRes.data || []),
        ];
        const uploadsByUniqueId = new Map();
        uploadRows.forEach((row, index) => {
          uploadsByUniqueId.set(String(row.id || row.local_id || row.file_url || index), row);
        });

        const submissions = Array.from(submissionsByUniqueId.values()).filter((submission) =>
          uploadMatchesSelectedContext(submission, { attendanceId, siteVisitIds }),
        );
        const submissionsById = new Map(submissions.map((submission) => [String(submission.id), submission]));
        const uploads = Array.from(uploadsByUniqueId.values()).filter((upload) => {
          if (upload.submission_id && submissionsById.has(String(upload.submission_id))) return true;
          return uploadMatchesSelectedContext(upload, { attendanceId, siteVisitIds });
        });
        const coverUploadIds = new Set();
        const coveredGroups = new Set();
        uploads.forEach((upload, index) => {
          const groupKey = upload.submission_id
            ? `submission:${upload.submission_id}`
            : `upload:${upload.id || upload.local_id || upload.file_url || index}`;
          if (coveredGroups.has(groupKey)) return;
          coveredGroups.add(groupKey);
          coverUploadIds.add(String(upload.id || upload.local_id || upload.file_url || index));
        });
        const hydratedUploads = await Promise.all(
          uploads.map(async (upload, index) => {
            const submission = upload.submission_id ? submissionsById.get(String(upload.submission_id)) : null;
            const activityType = upload.activity_type || submission?.activity_type || upload.upload_role;
            const uploadKey = String(upload.id || upload.local_id || upload.file_url || index);
            return {
              ...upload,
              submission,
              activityGroup: normalizeActivityGroup(activityType, upload.upload_role),
              displayUrl: coverUploadIds.has(uploadKey) ? await signedActivityUploadUrl(upload) : null,
            };
          }),
        );
        if (cancelled) return;
        setSelectedActivitySubmissions(submissions);
        setSelectedActivityUploads(hydratedUploads);
      } catch (error) {
        console.warn("[myQPMS FO] Activity uploads fetch failed.", error);
        if (!cancelled) {
          setSelectedActivitySubmissions([]);
          setSelectedActivityUploads([]);
        }
      }
    }
    loadSelectedActivityUploads();
    return () => {
      cancelled = true;
    };
  }, [hasDemoBackendReadSession, selectedActivityReloadToken, selectedOfficer, selectedRange.from, selectedRange.fromDate, selectedRange.to, selectedRange.toDate]);

  async function loadSupportContext(officer) {
    if (!officer || !isSupabaseConfigured || !supabase) {
      setSupportContext({ attendanceRows: [], visitRows: [], date: toDateInputValue(new Date()) });
      return;
    }
    const foId = normalizeFoKey(officer.foId || officer.employeeCode);
    if (!foId) {
      setSupportContext({ attendanceRows: [], visitRows: [], date: toDateInputValue(new Date()) });
      return;
    }
    setSupportLoading(true);
    setSupportMessage("");
    try {
      const today = toDateInputValue(new Date());
      const todayStart = startOfIndiaDayFromInput(today).getTime();
      const todayEnd = endOfIndiaDayFromInput(today).getTime();
      const todayStartIso = startOfIndiaDayFromInput(today).toISOString();
      const todayEndIso = endOfIndiaDayFromInput(today).toISOString();
      const [attendanceRes, visitsRes] = await Promise.all([
        supabase
          .from("fo_attendance")
          .select("*")
          .eq("fo_user_id", foId)
          .eq("attendance_date", today)
          .order("login_time", { ascending: false })
          .limit(20),
        supabase
          .from("fo_site_visits")
          .select("*")
          .or(`fo_user_id.eq.${foId},employee_code.eq.${foId}`)
          .gte("check_in_time", todayStartIso)
          .lte("check_in_time", todayEndIso)
          .order("check_in_time", { ascending: false })
          .limit(100),
      ]);
      if (attendanceRes.error) {
        logSupabaseError("[myQPMS FO] Support attendance query failed.", attendanceRes.error);
        throw attendanceRes.error;
      }
      if (visitsRes.error) {
        logSupabaseError("[myQPMS FO] Support fo_site_visits query failed.", visitsRes.error);
        throw visitsRes.error;
      }
      const attendanceRows = attendanceRes.data || [];
      const attendanceIds = new Set(attendanceRows.map((row) => String(row.id || "")).filter(Boolean));
      const visitRows = (visitsRes.data || []).filter((visit) => {
        if (visit.attendance_id && attendanceIds.has(String(visit.attendance_id))) return true;
        const checkInMs = new Date(visit.check_in_time || 0).getTime();
        return checkInMs >= todayStart && checkInMs <= todayEnd;
      });
      setSupportContext({ attendanceRows, visitRows, date: today });
    } catch (error) {
      logSupabaseError("[myQPMS FO] Support action context failed.", error);
      console.warn("[myQPMS FO] Support action context failed.", error);
      setSupportContext({ attendanceRows: [], visitRows: [], date: toDateInputValue(new Date()) });
      setSupportMessage(error?.message || "Unable to load today's support state.");
    } finally {
      setSupportLoading(false);
    }
  }

  function openSupportActions(officerId) {
    const officer =
      filteredOfficers.find((item) => item.id === officerId) ||
      officers.find((item) => item.id === officerId);
    if (!officer) return;
    setMapRouteOfficerId(officerId);
    const coordinates = normalizeCoordinates(officer.coordinates);
    if (coordinates) {
      setMapCommand({
        type: "current-location",
        coordinates,
        employeeCode: officer.employeeCode || officer.foId,
        source: officer.locationSource || "officer_card",
        at: Date.now(),
      });
    } else {
      warnSkippedInvalidCoordinate({
        employeeCode: officer.employeeCode || officer.foId,
        source: officer.locationSource || "officer_card",
        lat: officer.coordinates?.[0],
        lng: officer.coordinates?.[1],
      });
    }
    setSupportOfficerId(officerId);
    setSupportPendingAction(null);
    setSupportRemarks("");
    setSupportMessage("");
    setSupportContext({
      attendanceRows: officer.attendance ? [officer.attendance] : [],
      visitRows: officer.visits || [],
      date: toDateInputValue(new Date()),
    });
    loadSupportContext(officer);
  }

  function closeSupportActions() {
    if (supportBusy) return;
    setSupportOfficerId(null);
    setSupportPendingAction(null);
    setSupportRemarks("");
    setSupportMessage("");
  }

  function supportMetadata(row, action, remarks) {
    const metadata =
      row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    return {
      ...metadata,
      admin_support_last_action: action,
      admin_support_last_remarks: remarks.trim(),
      admin_support_last_at: new Date().toISOString(),
      admin_support_source: "fo_operations_dashboard",
    };
  }

  async function confirmSupportAction() {
    if (!supportOfficer || !supportPendingAction || !supportRemarks.trim()) return;
    try {
      assertDemoWriteAllowed(user);
    } catch (error) {
      setSupportMessage(error.message);
      setSupportPendingAction(null);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setSupportMessage("Supabase is not configured.");
      return;
    }
    const availability = supportActionAvailability(supportContext);
    const now = new Date();
    const nowIso = now.toISOString();
    const today = toDateInputValue(now);
    const foId = normalizeFoKey(supportOfficer.foId || supportOfficer.employeeCode);
    const coordinates = normalizeCoordinates(supportOfficer.coordinates);
    setSupportBusy(true);
    setSupportMessage("");
    try {
      if (!foId) throw new Error("FO employee ID is missing.");
      if (supportPendingAction === "check_out") {
        const visit = availability.activeVisit;
        if (!visit?.id) throw new Error("No active site visit found for Check Out.");
        await authenticatedApiRequest({
          method: "POST",
          url: `/api/fo/site-visits/${visit.id}/force-checkout`,
          data: {
            remarks: supportRemarks.trim(),
            checkout_latitude: coordinates?.[0] ?? null,
            checkout_longitude: coordinates?.[1] ?? null,
          },
        });
        setSupportMessage("Active site visit checked out.");
      }

      if (supportPendingAction === "end_day") {
        const attendance = availability.attendance;
        if (!attendance?.id || !isAttendanceActive(attendance)) {
          throw new Error("No active attendance found for End Day.");
        }
        const payload = {
          logout_time: nowIso,
          end_latitude: coordinates?.[0] ?? numberOrNull(attendance.end_latitude ?? attendance.start_latitude),
          end_longitude: coordinates?.[1] ?? numberOrNull(attendance.end_longitude ?? attendance.start_longitude),
          status: "Completed",
          metadata: supportMetadata(attendance, "end_day", supportRemarks),
          updated_at: nowIso,
        };
        const { error } = await supabase.from("fo_attendance").update(payload).eq("id", attendance.id);
        if (error) throw error;
        setSupportMessage("Attendance day ended.");
      }

      if (supportPendingAction === "start_day") {
        if (availability.attendance) throw new Error("Today's attendance already exists.");
        const payload = {
          fo_user_id: foId,
          username: supportOfficer.employeeCode || foId,
          display_name: supportOfficer.name,
          attendance_date: today,
          login_time: nowIso,
          start_latitude: coordinates?.[0] ?? null,
          start_longitude: coordinates?.[1] ?? null,
          status: "Active",
          metadata: supportMetadata(null, "start_day", supportRemarks),
        };
        const { error } = await supabase.from("fo_attendance").insert(payload);
        if (error) throw error;
        setSupportMessage("Attendance day started.");
      }

      if (supportPendingAction === "reopen_attendance") {
        const attendance = availability.attendance;
        if (!attendance?.id || !isAttendanceEnded(attendance)) {
          throw new Error("No ended attendance found to reopen.");
        }
        const payload = {
          logout_time: null,
          status: "Active",
          metadata: supportMetadata(attendance, "reopen_attendance", supportRemarks),
          updated_at: nowIso,
        };
        const { error } = await supabase.from("fo_attendance").update(payload).eq("id", attendance.id);
        if (error) throw error;
        setSupportMessage("Attendance reopened.");
      }

      setSupportPendingAction(null);
      setSupportRemarks("");
      setRefreshToken((value) => value + 1);
      await loadSupportContext(supportOfficer);
    } catch (error) {
      console.warn("[myQPMS FO] Support action failed.", error);
      await invalidateAuthOnUnauthorized(error);
      setSupportMessage(error?.message || "Support action failed.");
    } finally {
      setSupportBusy(false);
    }
  }

  function focusOfficer(officerId) {
    setDetailDraftFromDate(selectedRange.fromDate);
    setDetailDraftToDate(selectedRange.toDate);
    setSelectedOfficerId(officerId);
    setKmRecalcResult(null);
    const officer =
      filteredOfficers.find((item) => item.id === officerId) ||
      officers.find((item) => item.id === officerId);
    const coordinates = normalizeCoordinates(officer?.coordinates);
    if (coordinates) {
      setMapCommand({
        type: "current-location",
        coordinates,
        employeeCode: officer?.employeeCode || officer?.foId,
        source: officer?.locationSource || "selected_officer",
        at: Date.now(),
      });
    } else {
      warnSkippedInvalidCoordinate({
        employeeCode: officer?.employeeCode || officer?.foId,
        source: officer?.locationSource || "selected_officer",
        lat: officer?.coordinates?.[0],
        lng: officer?.coordinates?.[1],
      });
    }
  }

  function focusCurrentOfficerOnMap(source) {
    const coordinates = normalizeCoordinates(routeOfficer?.coordinates);
    if (!coordinates) {
      warnSkippedInvalidCoordinate({
        employeeCode: routeOfficer?.employeeCode || routeOfficer?.foId,
        source,
        lat: routeOfficer?.coordinates?.[0],
        lng: routeOfficer?.coordinates?.[1],
      });
      return;
    }
    setMapCommand({
      type: "current-location",
      coordinates,
      employeeCode: routeOfficer?.employeeCode || routeOfficer?.foId,
      source,
      at: Date.now(),
    });
  }

  function openSupportDetailedView() {
    const officer = supportOfficer || routeOfficer;
    if (!officer) return;
    const officerId = officer.id;
    closeSupportActions();
    focusOfficer(officerId);
  }

  function applyDetailDateRange() {
    setCustomFromDate(detailDraftFromDate);
    setCustomToDate(detailDraftToDate);
  }

  function selectedOfficerKmRecalcKey() {
    if (!selectedOfficer) return null;
    const foId = normalizeFoKey(
      selectedOfficer.foId ||
        selectedOfficer.employeeCode ||
        selectedOfficer.attendance?.fo_user_id ||
        selectedOfficer.attendance?.employee_code ||
        selectedOfficer.id,
    );
    return foId
      ? `${foId}|${selectedRange.fromDate}|${selectedRange.toDate}`
      : null;
  }

  async function recalculateSelectedOfficerKm() {
    if (!selectedOfficer) return;
    try {
      assertDemoWriteAllowed(user);
    } catch (error) {
      setKmRecalcResult({ ok: false, message: error.message, confidence: "BLOCKED" });
      return;
    }
    const recalcKey = selectedOfficerKmRecalcKey();
    const now = Date.now();
    const lastStartedAt = recalcKey ? kmRecalcCooldownRef.current.get(recalcKey) : null;
    if (
      kmRecalcBusy ||
      (recalcKey && kmRecalcInFlightRef.current.has(recalcKey)) ||
      (lastStartedAt && now - lastStartedAt < KM_RECALC_COOLDOWN_MS)
    ) {
      setKmRecalcResult({
        ok: false,
        message: KM_RECALC_RUNNING_MESSAGE,
        confidence: "BLOCKED",
      });
      return;
    }

    if (recalcKey) {
      kmRecalcInFlightRef.current.add(recalcKey);
      kmRecalcCooldownRef.current.set(recalcKey, now);
    }

    setKmRecalcBusy(true);
    setKmRecalcResult(null);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/fo/km/recalculate-employee-range`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee:
              selectedOfficer.employeeCode ||
              selectedOfficer.foId ||
              selectedOfficer.attendance?.employee_code,
            date_from: selectedRange.fromDate,
            date_to: selectedRange.toDate,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "KM recalculation failed.");
      }
      const refreshedDataset = await loadSelectedEmployeeRange();
      if (refreshedDataset) {
        setEmployeeRangeDataset({
          ...refreshedDataset,
          recalculation_results: payload.results || [],
        });
      }
      setKmRecalcResult({
        ...payload,
        message: `${payload.updated || 0} of ${payload.eligible || 0} eligible attendance records recalculated. ${payload.failed || 0} failed.`,
      });
      setRefreshToken((value) => value + 1);
      setSummaryRefreshToken((value) => value + 1);
    } catch (error) {
      setKmRecalcResult({ ok: false, message: error.message, confidence: "ERROR" });
      console.warn("[myQPMS FO] KM recalculation failed.", error);
    } finally {
      if (recalcKey) {
        kmRecalcInFlightRef.current.delete(recalcKey);
      }
      setKmRecalcBusy(false);
    }
  }

  async function recalculateTemporarySwitchKmForOfficer(officer = selectedOfficer) {
    if (!officer || !canRunTemporarySwitchKm) return;
    try {
      assertDemoWriteAllowed(user);
    } catch (error) {
      const message = error.message || "Temporary Switch KM is blocked.";
      setKmRecalcResult({ ok: false, message, confidence: "BLOCKED" });
      setSupportMessage(message);
      return;
    }
    const confirmed = window.confirm(
      "This temporary recalculation is only for Bike ↔ Non-bike switch days. Continue?",
    );
    if (!confirmed) return;

    const attendanceId = officer.attendance?.id || officer.attendance?.attendance_id;
    const employeeCode =
      officer.employeeCode ||
      officer.attendance?.employee_code ||
      officer.foId;
    if (!attendanceId && !employeeCode) {
      const message = "Temporary Switch KM needs a selected attendance or employee.";
      setKmRecalcResult({ ok: false, message, confidence: "BLOCKED" });
      setSupportMessage(message);
      return;
    }

    setSwitchKmRecalcBusy(true);
    setKmRecalcResult(null);
    setSupportMessage("");
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/fo/km/recalculate-switch-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attendance_id: attendanceId,
          employee_code: employeeCode,
          date: selectedRange.fromDate,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Temporary Switch KM failed.");
      }
      const message = payload.manual_review_required
        ? `Temporary Switch KM marked manual review: ${payload.manual_review_reason || "review required"}`
        : `Temporary Switch KM completed. Payable KM: ${Number(payload.total_route_km || payload.approved_km || 0).toFixed(2)}`;
      setKmRecalcResult({ ...payload, message });
      setSupportMessage(message);
      setRefreshToken((value) => value + 1);
      setSummaryRefreshToken((value) => value + 1);
    } catch (error) {
      const message = error.message || "Temporary Switch KM failed.";
      setKmRecalcResult({ ok: false, message, confidence: "ERROR" });
      setSupportMessage(message);
      console.warn("[myQPMS FO] Temporary Switch KM failed.", error);
    } finally {
      setSwitchKmRecalcBusy(false);
    }
  }

  async function submitCheckoutMissingKmReview(visit, action) {
    if (!visit?.id || !canApproveCheckoutMissingKmReviews) return;
    try {
      assertDemoWriteAllowed(user);
    } catch (error) {
      window.alert(error.message);
      return;
    }

    const normalizedAction = String(action || "").toLowerCase();
    const evidence = missingCheckoutEvidence(visit);
    let approvedKm = null;
    let remarks = "";
    let adminOverride = false;

    if (normalizedAction === "approve") {
      const defaultKm =
        evidence.suggestedKm !== null
          ? evidence.suggestedKm.toFixed(2)
          : evidence.detectedKm !== null
            ? evidence.detectedKm.toFixed(2)
            : "";
      const input = window.prompt("Approve missing checkout KM", defaultKm);
      if (input === null) return;
      approvedKm = Number(input);
      if (!Number.isFinite(approvedKm) || approvedKm < 0) {
        window.alert("Approved KM must be a number greater than or equal to 0.");
        return;
      }
      if (
        evidence.suggestedKm !== null &&
        approvedKm > evidence.suggestedKm + 2
      ) {
        adminOverride = window.confirm(
          "Approved KM is more than 2 km above suggested KM. Continue as Admin override?",
        );
        if (!adminOverride) return;
      }
      remarks = window.prompt("Approval remarks (optional)", "") || "";
    } else if (normalizedAction === "reject") {
      remarks = window.prompt("Rejection reason is required", "") || "";
      if (!remarks.trim()) {
        window.alert("Rejection reason is required.");
        return;
      }
    } else {
      return;
    }

    setCheckoutReviewBusyVisitId(visit.id);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/fo/site-visits/${visit.id}/checkout-missing-km-review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: normalizedAction,
            approved_km: approvedKm,
            remarks,
            review_source: "fo_activities_dashboard",
            admin_override: adminOverride,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Checkout review update failed.");
      }
      window.alert(payload.message || "Checkout review updated.");
      setRefreshToken((value) => value + 1);
    } catch (error) {
      console.warn("[myQPMS FO] Checkout missing KM review failed.", error);
      window.alert(error.message || "Checkout review update failed.");
    } finally {
      setCheckoutReviewBusyVisitId(null);
    }
  }

  const pins = useMemo(() => {
    const markerOfficers = visualFilteredOfficers.filter((officer) => {
      const canShow = canShowOfficerMarker(officer);
      if (!canShow) {
        warnSkippedInvalidCoordinate({
          employeeCode: officer.employeeCode || officer.foId,
          source: officer.locationSource || "officer_marker",
          lat: officer.coordinates?.[0],
          lng: officer.coordinates?.[1],
        });
      }
      return canShow;
    });
    const builtPins = markerOfficers
      .map((officer) => {
        const lat = Number(officer.coordinates[0]);
        const lng = Number(officer.coordinates[1]);
        const markerOfficer =
          routeOfficer?.id === officer.id
            ? { ...officer, isSelected: true }
            : officer;
        const state = filteredStates.find(
          (item) => item.state === officer.state,
        ) || {
          id: officer.state,
          state: officer.state,
          tickets: 0,
          visits: officer.visits?.length || 0,
          status: isOperationallyActive(officer) ? "Stable" : "Critical",
        };
        const stateOfficers = [markerOfficer];
        return {
          id: `fo-${officer.id}`,
          state,
          officers: stateOfficers,
          coordinates: [lat, lng],
          activeOfficers: stateOfficers.filter(
            (officer) => isOperationallyActive(officer),
          ).length,
          offlineOfficers: stateOfficers.filter(
            (officer) => !isOperationallyActive(officer),
          ).length,
          lowBattery: stateOfficers.filter(
            (officer) => officer.battery !== null && officer.battery < 20,
          ).length,
          color: markerTone(state, stateOfficers),
        };
      })
      .sort((a, b) => {
        if (a.officers.some((officer) => officer.id === routeOfficer?.id))
          return -1;
        if (b.officers.some((officer) => officer.id === routeOfficer?.id))
          return 1;
        return b.activeOfficers - a.activeOfficers;
      });
    console.debug("FO_MARKERS_WITH_VALID_COORDS", builtPins.length);
    console.debug("FO_MARKERS_BUILT", builtPins.length);
    return builtPins;
  }, [filteredStates, routeOfficer, visualFilteredOfficers]);

  const sitePins = useMemo(() => {
    const officersByFoId = new Map();
    filteredOfficers.forEach((officer) => {
      [officer.foId, officer.employeeCode].forEach((id) => {
        const key = normalizeFoKey(id);
        if (key) officersByFoId.set(key, officer);
      });
    });
    const selectedFoId = routeOfficer
      ? normalizeFoKey(routeOfficer.foId || routeOfficer.employeeCode)
      : null;
    const pinsForVisits = visibleSiteVisitRows
      .filter((visit) => {
        if (!selectedFoId) return true;
        return siteVisitFoId(visit) === selectedFoId;
      })
      .map((visit, index) => buildSiteVisitPin(visit, officersByFoId, index))
      .filter(Boolean);
    console.debug("FO_SITE_MARKERS_BUILT", pinsForVisits.length);
    return pinsForVisits;
  }, [filteredOfficers, routeOfficer, visibleSiteVisitRows]);

  useEffect(() => {
    let cancelled = false;
    async function rebuildMainRouteLines() {
      if (!routeOfficer) {
        setMainMapRouteLines([]);
        setMainMapRouteMessage(null);
        return;
      }
      const result = await buildMainMapRouteLines({
        logs: selectedRouteLogs,
        color: foMarkerColor(routeOfficer),
        idPrefix: `route-${routeOfficer.id}`,
      });
      if (!cancelled) {
        setMainMapRouteLines(result.lines);
        setMainMapRouteMessage(result.message);
      }
    }
    rebuildMainRouteLines();
    return () => {
      cancelled = true;
    };
  }, [routeOfficer, selectedRouteLogs]);

  const routeLines = mainMapRouteLines;

  useEffect(() => {
    if (!mapRouteOfficer || !routeLines.length) return;
    const routeKey = [
      mapRouteOfficer.id,
      selectedRange.fromDate,
      selectedRange.toDate,
      selectedRouteLogs.length,
    ].join("|");
    if (mainRouteFitKeyRef.current === routeKey) return;
    mainRouteFitKeyRef.current = routeKey;
    setMapCommand({ type: "fit-route", at: Date.now() });
  }, [mapRouteOfficer, routeLines.length, selectedRange.fromDate, selectedRange.toDate, selectedRouteLogs.length]);

  const selectedActualTravelMetrics = useMemo(() => {
    if (!routeOfficer) return null;
    return actualTravelKmFromAttendanceOrLogs(
      routeOfficer.attendance,
      selectedRouteLogs,
      routeOfficer.visits || [],
    );
  }, [routeOfficer, selectedRouteLogs]);

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
  const kpiOfficers = structurallyFilteredOfficers;
  const totalFieldUsers = kpiOfficers.length;
  const activeOfficers = kpiOfficers.filter(isOperationallyActive).length;
  const offlineOfficers = kpiOfficers.filter(
    (officer) => ["NOT_STARTED", "ENDED"].includes(officer.operationalStatus),
  ).length;
  const onTravelOfficers = kpiOfficers.filter(
    (officer) => officer.operationalStatus === "ON_TRAVEL",
  ).length;
  const onSiteOfficers = kpiOfficers.filter(
    (officer) => officer.operationalStatus === "ON_SITE",
  ).length;
  const liveRouteKm = Number(filteredSummary.payable_km) || 0;
  const liveActualTravelKm = filteredOfficers.reduce(
    (sum, officer) =>
      sum + Number(officer.actualTravelKm ?? officer.actualKm ?? 0),
    0,
  );
  const totalPetrolAmount = Number(filteredSummary.petrol_amount) || 0;
  const distanceTravelled = `${liveRouteKm.toFixed(1)} km`;
  const actualTravelled = `${liveActualTravelKm.toFixed(1)} km`;
  const routeVsActual = `${(liveRouteKm - liveActualTravelKm).toFixed(1)} km`;
  const avgRouteKm = totalFieldUsers
    ? `${(liveRouteKm / totalFieldUsers).toFixed(1)} km`
    : "0.0 km";

  if (selectedOfficer) {
    return (
      <FieldOfficerDetailsView
        key={selectedOfficer.id}
        officer={selectedOfficer}
        rangeDataset={employeeRangeDataset}
        rangeDatasetLoading={employeeRangeLoading}
        rangeDatasetError={employeeRangeError}
        generatedByUser={user}
        routeLogs={selectedRouteLogs}
        activitySubmissions={selectedActivitySubmissions}
        activityUploads={selectedActivityUploads}
        fromDate={selectedRange.from}
        toDate={selectedRange.to}
        draftFromDate={detailDraftFromDate}
        draftToDate={detailDraftToDate}
        onDraftFromDate={setDetailDraftFromDate}
        onDraftToDate={setDetailDraftToDate}
        onApplyDate={applyDetailDateRange}
        onBack={() => setSelectedOfficerId(null)}
        onExport={() => exportEmployeeRangeExcel(employeeRangeDataset)}
        onRecalculateKm={recalculateSelectedOfficerKm}
        onTemporarySwitchKm={
          canRunTemporarySwitchKm
            ? () => recalculateTemporarySwitchKmForOfficer(selectedOfficer)
            : null
        }
        recalculatingKm={kmRecalcBusy}
        recalculatingSwitchKm={switchKmRecalcBusy}
        recalculationResult={kmRecalcResult}
        fullTechnicalAccess={fullTechnicalAccess}
        canReviewCheckoutExceptions={canReviewCheckoutExceptions}
        canApproveCheckoutMissingKmReviews={canApproveCheckoutMissingKmReviews}
        onCheckoutReviewAction={submitCheckoutMissingKmReview}
        checkoutReviewBusyVisitId={checkoutReviewBusyVisitId}
        onActivityUploadSaved={() =>
          setSelectedActivityReloadToken((value) => value + 1)
        }
        onRouteGpsEvidenceActive={setSelectedRouteEvidenceOfficerId}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-black tracking-normal text-slate-950 dark:text-white sm:text-2xl">
          Operations Command Center
        </h1>
        <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setRefreshToken((value) => value + 1);
                setSummaryRefreshToken((value) => value + 1);
              }}
              className="focus-ring grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-qpms-700"
              aria-label="Refresh operations data"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <span className="command-pill">
              <RadioTower className="h-3.5 w-3.5 text-emerald-500" /> Live
              every 12s
            </span>
        </div>
      </div>
      {hasDemoBackendReadSession ? (
        <div className="rounded-xl border border-qpms-100 bg-qpms-50 px-4 py-3 text-sm font-bold text-qpms-800">
          Sample Demo Data
          {demoDateRange?.latest_demo_date ? ` - showing latest prepared date ${demoDateRange.latest_demo_date}` : ''}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-900">
        <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto_auto]">
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">
              From Date
            </span>
            <input
              type="date"
              value={draftFromDate}
              onChange={(event) => setDraftFromDate(event.target.value)}
              min={hasDemoBackendReadSession ? demoDateRange?.earliest_demo_date || undefined : undefined}
              max={hasDemoBackendReadSession ? demoDateRange?.latest_demo_date || undefined : undefined}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">
              To Date
            </span>
            <input
              type="date"
              value={draftToDate}
              onChange={(event) => setDraftToDate(event.target.value)}
              min={hasDemoBackendReadSession ? demoDateRange?.earliest_demo_date || undefined : undefined}
              max={hasDemoBackendReadSession ? demoDateRange?.latest_demo_date || undefined : undefined}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">
              State
            </span>
            <select
              value={draftStateFilter}
              onChange={(event) => setDraftStateFilter(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            >
              <option>All States</option>
              {stateSummaryRows.map((item) => (
                <option key={item.id}>{item.state}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">
              Business
            </span>
            <select
              value={draftBusinessFilter}
              onChange={(event) => setDraftBusinessFilter(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            >
              <option>All Business</option>
              {businessOptions.map((business) => (
                <option key={business}>{business}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase text-slate-500">
              Status
            </span>
            <select
              value={draftStatusFilter}
              onChange={(event) => setDraftStatusFilter(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            >
              <option>All Status</option>
              <option value="Active">Active</option>
              <option value="ON_TRAVEL">On Travel</option>
              <option value="ON_SITE">On Site</option>
              <option value="ACTIVE_STATIONARY">Active / Stationary</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="ENDED">Ended</option>
              <option>Offline</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={applyDashboardFilters}
              className="focus-ring h-10 w-full rounded-xl bg-qpms-700 px-4 text-sm font-black text-white hover:bg-qpms-800"
            >
              Apply
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetDashboardFilters}
              className="focus-ring h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-600 hover:bg-slate-100"
            >
              Reset
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={exportDashboardExcel}
              disabled={dashboardExportBusy}
              className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700 hover:bg-emerald-100"
            >
              <FileSpreadsheet className="h-4 w-4" /> {dashboardExportBusy ? "Exporting..." : "Export Excel"}
            </button>
          </div>
          {canRunBatchKmRecalculation ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={recalculateAllKmForSelectedRange}
                disabled={batchKmRecalcBusy}
                className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${batchKmRecalcBusy ? "animate-spin" : ""}`} />
                {batchKmRecalcBusy
                  ? `Recalculating${batchKmRecalcProgress ? ` (${batchKmRecalcProgress.processed})` : ""}...`
                  : "Recalculate All KM"}
              </button>
            </div>
          ) : null}
          {canUseTemporarySwitchKm ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => recalculateTemporarySwitchKmForOfficer(selectedOfficer)}
                disabled={switchKmRecalcBusy}
                className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-orange-200 bg-orange-50 px-3 text-sm font-black text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                title="Temporary Bike to non-bike switch KM recalculation"
              >
                <RefreshCw className={`h-4 w-4 ${switchKmRecalcBusy ? "animate-spin" : ""}`} />
                {switchKmRecalcBusy ? "Temporary Switch KM..." : "Temporary Switch KM"}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <FleetKpi
          label="Total Field Users"
          value={totalFieldUsers}
          icon={UserRoundCheck}
          tone="blue"
        />
        <FleetKpi
          label="Active Today"
          value={activeOfficers}
          hint={
            totalFieldUsers
              ? `${Math.round((activeOfficers / totalFieldUsers) * 100)}%`
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
          label="On Site"
          value={onSiteOfficers}
          icon={MapPin}
          tone="purple"
        />
        <FleetKpi
          label="Not Started"
          value={offlineOfficers}
          icon={ShieldAlert}
          tone={offlineOfficers ? "red" : "slate"}
        />
        <FleetKpi
          label="Payable KM"
          value={filteredSummaryError ? "--" : distanceTravelled}
          icon={Route}
          tone="green"
          hint={filteredSummaryLoading ? null : "Filtered"}
          loading={filteredSummaryLoading}
          error={Boolean(filteredSummaryError)}
        />
        <FleetKpi
          label="Petrol Amount"
          value={filteredSummaryError ? "--" : formatInr(totalPetrolAmount)}
          icon={CircleGauge}
          tone="amber"
          hint={filteredSummaryLoading ? null : "Filtered"}
          loading={filteredSummaryLoading}
          error={Boolean(filteredSummaryError)}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
        <div className="grid min-h-[700px] xl:grid-cols-[minmax(0,2.15fr)_minmax(360px,0.85fr)]">
          <div className="order-2 min-w-0 xl:order-1">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">
                Field Operations Map
              </h2>
              <button
                type="button"
                onClick={() => setExpandedMap(true)}
                className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:text-qpms-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              >
                <Maximize2 className="h-4 w-4" /> Full Screen Map
              </button>
            </div>
          <div className="relative isolate h-[500px] overflow-hidden bg-sky-50 sm:h-[560px] lg:h-[640px] xl:h-[655px]">
            <OperationsMap
              pins={pins}
              sitePins={sitePins}
              routeLines={routeLines}
              routeTrailMessage={mainMapRouteMessage}
              expanded={false}
              showSites={showSiteMarkers}
              showRoutes={showRouteTrail}
              mapTheme={mapTheme}
              command={mapCommand}
              onSelectOfficer={openSupportActions}
              onCloseSelection={() => setSelectedOfficerId(null)}
            />
            {routeOfficer && !routeLines.length ? (
              <div className="absolute left-5 top-5 z-[540] rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-semibold text-slate-600 shadow-xl backdrop-blur">
                No route data available for selected date.
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setMapCommand({ type: "fit-all", at: Date.now() })}
              className="focus-ring absolute right-5 top-5 z-[520] inline-flex items-center gap-2 rounded-lg border border-white/70 bg-white/95 px-4 py-2.5 text-xs font-black text-slate-700 shadow-lg backdrop-blur hover:text-qpms-700"
            >
              <Maximize2 className="h-4 w-4" /> Fit All
            </button>

            <div className="hidden">
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
                onClick={() => focusCurrentOfficerOnMap("map_location_button")}
                className="grid h-12 w-12 place-items-center text-slate-700"
              >
                <LocateFixed className="h-5 w-5" />
              </button>
            </div>

            <div className="absolute bottom-5 left-5 z-[520] flex max-w-[calc(100%-40px)] flex-wrap items-center gap-4 rounded-xl border border-white/80 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
              <LegendItem color="#10b981" label="Active / On Site" />
              <LegendItem color="#10b981" label="On Travel" />
              <LegendItem color="#64748b" label="Not Started / Offline" />
              <LegendItem color="#2563eb" label="Site / Office" site />
            </div>

            <div className="hidden">
              <div className="grid gap-3 md:grid-cols-4">
                <label>
                  <span className="sr-only">Region</span>
                  <select
                    value={draftStateFilter}
                    onChange={(event) => setDraftStateFilter(event.target.value)}
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
                    value={draftStatusFilter}
                    onChange={(event) => setDraftStatusFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-qpms-400"
                  >
                    <option>All Status</option>
                    <option value="Active">Active</option>
                    <option value="ON_TRAVEL">On Travel</option>
                    <option value="ON_SITE">On Site Visit</option>
                    <option value="ACTIVE_STATIONARY">Active / Stationary</option>
                    <option value="NOT_STARTED">Not Started</option>
                    <option value="ENDED">Ended Day</option>
                    <option>Offline</option>
                  </select>
                </label>
                <label className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={directorySearchPlaceholder}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-qpms-400"
                  />
                </label>
              </div>
            </div>

            <div className="hidden">
              <button
                type="button"
                onClick={() => setMapControlsCollapsed((value) => !value)}
                aria-expanded={!mapControlsCollapsed}
                className={`focus-ring flex w-full items-center justify-between text-left ${mapControlsCollapsed ? "" : "mb-3"}`}
              >
                <span className="text-base font-black text-slate-950 dark:text-white">
                  Map Controls
                </span>
                <ChevronRight
                  className={`h-4 w-4 text-slate-400 transition-transform ${mapControlsCollapsed ? "rotate-90" : "-rotate-90"}`}
                />
              </button>
              {!mapControlsCollapsed ? (
                <>
                  <div className="space-y-2">
                    <ControlButton
                      icon={Route}
                      label="Fit Route"
                      onClick={() =>
                        setMapCommand({ type: "fit-route", at: Date.now() })
                      }
                    />
                    <ControlButton
                      icon={LocateFixed}
                      label="Current Location"
                      onClick={() => focusCurrentOfficerOnMap("map_controls")}
                    />
                    <ControlButton
                      icon={Maximize2}
                      label="Fit All"
                      onClick={() =>
                        setMapCommand({ type: "fit-all", at: Date.now() })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowSiteMarkers((value) => !value)}
                      className="focus-ring flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    >
                      Show Site Markers{" "}
                      <ToggleSwitch checked={showSiteMarkers} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRouteTrail((value) => !value)}
                      className="focus-ring flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    >
                      Show Route Trails{" "}
                      <ToggleSwitch checked={showRouteTrail} />
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
                </>
              ) : null}
            </div>

            <div className="hidden">
              <h2 className="mb-3 text-base font-black text-slate-950 dark:text-white">
                Legend
              </h2>
              <div className="space-y-3">
                <LegendItem
                  color="#10b981"
                  label="Started Day / Active"
                />
                <LegendItem
                  color="#64748b"
                  label="Not Started or Ended Day"
                />
                <LegendItem color="#2563eb" label="Site / Office" site />
                <LegendItem
                  color="#16a34a"
                  label="Route Trail"
                  helper="(Active)"
                  dashed
                />
              </div>
            </div>
          </div>
          </div>

          <aside className="order-1 flex min-h-0 flex-col border-b border-slate-200 bg-white xl:order-2 xl:border-b-0 xl:border-l dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">
                  Operations Directory
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {filteredOfficers.length} field users
                </p>
              </div>
              <Filter className="h-4 w-4 text-slate-400" />
            </div>
            <label className="relative block min-w-0 border-b border-slate-100 p-4 dark:border-slate-800">
              <Search className="absolute left-7 top-7 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={directorySearchPlaceholder}
                className="w-full min-w-0 rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            {fullTechnicalAccess ? (
              <FoSupportActionPanel
                officer={supportOfficer || routeOfficer}
                context={supportContext}
                loading={supportLoading}
                busy={supportBusy}
                pendingAction={supportPendingAction}
                remarks={supportRemarks}
                message={supportMessage}
                onRemarksChange={setSupportRemarks}
                onBeginAction={(action) => {
                  setSupportPendingAction(action);
                  setSupportRemarks("");
                  setSupportMessage("");
                }}
                onCancelAction={() => {
                  setSupportPendingAction(null);
                  setSupportRemarks("");
                }}
                onConfirmAction={confirmSupportAction}
                onDetailedView={openSupportDetailedView}
                onClose={() => {
                  setMapRouteOfficerId(null);
                  closeSupportActions();
                }}
                onRecalculateKm={recalculateSelectedOfficerKm}
                onTemporarySwitchKm={
                  canRunTemporarySwitchKm
                    ? () => recalculateTemporarySwitchKmForOfficer(supportOfficer || routeOfficer)
                    : null
                }
                recalculatingKm={kmRecalcBusy}
                recalculatingSwitchKm={switchKmRecalcBusy}
                recalculationResult={kmRecalcResult}
                foSafeKm={selectedActualTravelMetrics}
                siteVisitCount={(supportOfficer || routeOfficer)?.visits?.length || 0}
              />
            ) : (
              <ExecutiveOfficerPanel
                officer={supportOfficer || routeOfficer}
                onDetailedView={openSupportDetailedView}
                onClose={() => {
                  setMapRouteOfficerId(null);
                  closeSupportActions();
                }}
                siteVisitCount={(supportOfficer || routeOfficer)?.visits?.length || 0}
              />
            )}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 xl:max-h-[540px]">
              {visualFilteredOfficers.map((officer) => (
                <OfficerDirectoryRow
                  key={officer.id}
                  officer={officer}
                  selected={routeOfficer?.id === officer.id}
                  onSelect={() => openSupportActions(officer.id)}
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
              View all employees <ChevronRight className="h-4 w-4" />
            </button>
          </aside>
        </div>
      </section>

      <div className="hidden">
        <MetricTile
          label="Payable KM"
          value={distanceTravelled}
          icon={Route}
          tone="green"
        />
        <MetricTile
          label="GPS Audit KM"
          value={actualTravelled}
          icon={Navigation2}
          tone="blue"
        />
        <MetricTile
          label="Payable vs GPS Delta"
          value={routeVsActual}
          icon={CircleGauge}
          tone={Math.abs(liveRouteKm - liveActualTravelKm) > 2 ? "amber" : "green"}
        />
        <MetricTile
          label="Avg. Route KM / FO"
          value={avgRouteKm}
          icon={Navigation2}
        />
        <MetricTile
          label="Petrol Amount"
          value={formatInr(totalPetrolAmount)}
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
        <div className="fixed inset-0 z-[1200] bg-slate-950/70 p-3 backdrop-blur-sm">
          <div className="grid h-full overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h2 className="text-base font-black text-slate-950 dark:text-white">
                  Field Operations Map
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setMapCommand({ type: "fit-all", at: Date.now() })
                    }
                    className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:text-qpms-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <Maximize2 className="h-4 w-4" /> Fit All
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedMap(false)}
                    className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-rose-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    aria-label="Close full screen map"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-sky-50">
                <OperationsMap
                  pins={pins}
                  sitePins={sitePins}
                  routeLines={routeLines}
                  routeTrailMessage={mainMapRouteMessage}
                  expanded
                  showSites={showSiteMarkers}
                  showRoutes={showRouteTrail}
                  mapTheme={mapTheme}
                  command={mapCommand}
                  onSelectOfficer={openSupportActions}
                  onCloseSelection={() => setSelectedOfficerId(null)}
                />
                {routeOfficer && !routeLines.length ? (
                  <div className="absolute left-5 top-5 z-[540] rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm font-semibold text-slate-600 shadow-xl backdrop-blur">
                    No route data available for selected date.
                  </div>
                ) : null}
                <div className="absolute bottom-5 left-5 z-[520] flex max-w-[calc(100%-40px)] flex-wrap items-center gap-4 rounded-xl border border-white/80 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
                  <LegendItem color="#10b981" label="Active / On Site" />
                  <LegendItem color="#10b981" label="On Travel" />
                  <LegendItem color="#64748b" label="Not Started / Offline" />
                  <LegendItem color="#2563eb" label="Site / Office" site />
                </div>
              </div>
            </div>
            <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0 dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950 dark:text-white">
                      Operations Directory
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {filteredOfficers.length} field users
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedMap(false)}
                    className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 dark:border-slate-700"
                    aria-label="Exit full screen map"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <label className="relative block min-w-0 border-b border-slate-100 p-4 dark:border-slate-800">
                <Search className="absolute left-7 top-7 h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={directorySearchPlaceholder}
                  className="w-full min-w-0 rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {visualFilteredOfficers.map((officer) => (
                  <OfficerDirectoryRow
                    key={officer.id}
                    officer={officer}
                    selected={routeOfficer?.id === officer.id}
                    onSelect={() => openSupportActions(officer.id)}
                  />
                ))}
                {!filteredOfficers.length ? (
                  <div className="m-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-800">
                    No field officers match these filters.
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}
