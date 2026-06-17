import { useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  Bike,
  Building2,
  CalendarDays,
  CircleGauge,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Eye,
  Filter,
  FileSpreadsheet,
  Fuel,
  Image,
  LocateFixed,
  MapPin,
  MapPinned,
  Maximize2,
  Minimize2,
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
  User,
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
import { api } from "../services/api.js";

const SOUTH_INDIA_CENTER = [13.0827, 80.2707];
const INDIA_TIME_ZONE = "Asia/Kolkata";
const RATE_PER_KM = 4;
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
const FO_SITE_VISIT_SELECT =
  "id,fo_user_id,employee_code,fo_name,display_name,attendance_id,store_id,store_name,site_name,client_name,store_code,site_code,business,state,check_in_time,checkout_time,check_out_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,current_latitude,current_longitude,origin_lat,origin_lng,destination_lat,destination_lng,route_km,google_route_polyline,visit_duration_minutes,status,visit_status,checkout_note,metadata";
const FO_LIVE_STATUS_SELECT =
  "fo_user_id,latitude,longitude,last_seen_at,updated_at,route_km_today,is_online,is_tracking,current_status,display_name,username,accuracy,battery_percentage";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
const MARKER_ANIMATION_MIN_MS = 15000;
const MARKER_ANIMATION_MAX_MS = 180000;
const MARKER_ANIMATION_DEFAULT_MS = 45000;
const MARKER_ANIMATION_RECENT_THRESHOLD_MS = 10 * 60 * 1000;
const ACTIVITY_PHOTO_TABS = ["All", "Inspection", "Training", "Deep Cleaning", "Documents", "Others"];
const SNAP_TO_ROADS_MAX_POINTS_PER_REQUEST = 100;
const SNAP_TO_ROADS_MAX_INPUT_POINTS = 500;
const ROUTE_MAP_SEGMENT_MAX_GAP_SECONDS = 10 * 60;
const ROUTE_MAP_SEGMENT_MAX_DISTANCE_KM = 2;
const ROUTE_MAP_SEGMENT_MAX_SPEED_KMPH = 120;
const MAIN_ROUTE_GAP_DISTANCE_METERS = 500;
const MAIN_ROUTE_GAP_SECONDS = 120;
const KM_RECALC_COOLDOWN_MS = 60 * 1000;
const KM_RECALC_RUNNING_MESSAGE = "Recalculation already running. Please wait.";
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
  return "#10b981";
}

function foMarkerIcon(officer) {
  const color = foMarkerColor(officer);
  const isActive = officer.status === "Active";
  const isSelected = officer.isSelected === true;
  const rotation = Number(officer.heading || 0);
  return L.divIcon({
    className: "",
    html: `
      <div class="fo-bike-marker ${isSelected ? "fo-bike-marker-selected" : ""}" style="--marker-color:${color};">
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
  const accuracy = Number(log?.accuracy);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    Number.isFinite(accuracy) &&
    accuracy <= MAX_GPS_ACCURACY_METERS
  );
}

function isValidGpsLog(log) {
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

function locationTimestampMs(log) {
  return new Date(log?.captured_at || log?.recorded_at || log?.logged_at || log?.created_at || log?.last_seen_at || 0).getTime();
}

function routePointTime(log) {
  return new Date(log?.captured_at || log?.recorded_at || log?.logged_at || log?.created_at || 0);
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

function routePointCoordinates(log) {
  if (!isValidRoutePoint(log)) return null;
  return [Number(log.latitude), Number(log.longitude)];
}

function mainRouteGap(previous, current) {
  const secondsDiff = (routePointTime(current) - routePointTime(previous)) / 1000;
  const distanceMeters = distanceKmBetween(previous, current) * 1000;
  return {
    hasGap:
      distanceMeters > MAIN_ROUTE_GAP_DISTANCE_METERS ||
      secondsDiff > MAIN_ROUTE_GAP_SECONDS,
    secondsDiff,
    distanceMeters,
  };
}

async function buildMainMapRouteLines({ logs = [], visits = [], color = "#2563eb", idPrefix = "route" }) {
  const ordered = logs
    .filter(isValidRoutePoint)
    .slice()
    .sort((a, b) => routePointTime(a) - routePointTime(b));
  if (ordered.length < 2) return [];

  const lines = [];
  let currentGpsSegment = [routePointCoordinates(ordered[0])].filter(Boolean);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const currentPoint = routePointCoordinates(current);
    if (!currentPoint) continue;
    const gap = mainRouteGap(previous, current);
    const sameSiteDrift = isSameSiteDrift(previous, current, visits);

    if (gap.hasGap || sameSiteDrift) {
      if (currentGpsSegment.length > 1) {
        lines.push({
          id: `${idPrefix}-gps-${lines.length}`,
          positions: currentGpsSegment,
          color,
          source: "gps",
        });
      }

      // Frontend Directions disabled for billing protection.
      const filledPath = null;
      lines.push({
        id: `${idPrefix}-gap-${index}`,
        positions:
          filledPath && filledPath.length > 1
            ? filledPath
            : [routePointCoordinates(previous), currentPoint].filter(Boolean),
        color,
        source: filledPath ? "reconstructed/google_filled" : "fallback/straight_line",
      });
      currentGpsSegment = [currentPoint];
    } else {
      currentGpsSegment.push(currentPoint);
    }
  }

  if (currentGpsSegment.length > 1) {
    lines.push({
      id: `${idPrefix}-gps-${lines.length}`,
      positions: currentGpsSegment,
      color,
      source: "gps",
    });
  }
  return lines;
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
    petrolAmount: actualTravelKm * RATE_PER_KM,
    adjustmentApplied: adjustmentParts.join(", "),
  };
}

function actualTravelKmFromAttendanceOrLogs(attendance, logs = [], visits = []) {
  const storedRawGpsKm = Number(attendance?.raw_gps_km);
  const storedFilteredGpsKm = Number(attendance?.filtered_gps_km);
  const storedActualTravelKm = Number(attendance?.actual_travel_km);
  if (
    Number.isFinite(storedRawGpsKm) &&
    Number.isFinite(storedFilteredGpsKm) &&
    Number.isFinite(storedActualTravelKm) &&
    (storedRawGpsKm > 0 || storedFilteredGpsKm > 0 || storedActualTravelKm > 0)
  ) {
    return {
      ...emptyFoSafeKmMetrics(storedActualTravelKm),
      rawGpsKm: storedRawGpsKm,
      filteredGpsKm: storedFilteredGpsKm,
      gapAdjustedKm: storedActualTravelKm,
      actualTravelKm: storedActualTravelKm,
      claimKm: storedActualTravelKm,
      adjustmentApplied: "Stored in fo_attendance",
    };
  }
  if (logs.length) return foSafeKmFromLogs(logs, visits);
  const fallbackKm = Number(attendance?.actual_km ?? attendance?.total_raw_km ?? 0);
  return {
    ...emptyFoSafeKmMetrics(fallbackKm),
    filteredGpsKm: fallbackKm,
    actualTravelKm: fallbackKm,
    claimKm: fallbackKm,
  };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function liveStatusFromRow(row) {
  const timestamp = liveStatusTimestamp(row);
  if (!timestamp) return "Offline";
  const ageMs = timestamp
    ? Date.now() - new Date(timestamp).getTime()
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ageMs)) return "Offline";
  const ageMinutes = ageMs / 60000;
  if (ageMinutes <= 2) return "Active";
  if (ageMinutes <= 10) return "Recent";
  return "Offline";
}

function hasFiniteCoordinates(coordinates) {
  return (
    Array.isArray(coordinates) &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1])) &&
    Number(coordinates[0]) >= -90 &&
    Number(coordinates[0]) <= 90 &&
    Number(coordinates[1]) >= -180 &&
    Number(coordinates[1]) <= 180
  );
}

function normalizeCoordinates(coordinates) {
  if (!hasFiniteCoordinates(coordinates)) return null;
  return [Number(coordinates[0]), Number(coordinates[1])];
}

function canShowOfficerMarker(officer) {
  return ["Active", "Recent", "Offline"].includes(officer.status) &&
    hasFiniteCoordinates(officer.coordinates);
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
  if (
    Number.isFinite(liveLat) &&
    Number.isFinite(liveLng) &&
    liveLat >= -90 &&
    liveLat <= 90 &&
    liveLng >= -180 &&
    liveLng <= 180 &&
    liveTimestamp
  ) {
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
  if (officer.status === "Offline") return false;
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
    if (response.error) throw response.error;
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
  return !visit?.checkout_time && !visit?.check_out_time;
}

function isAttendanceEnded(attendance) {
  return (
    Boolean(attendance?.logout_time) ||
    /completed|ended|closed|logout/i.test(String(attendance?.status || ""))
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
    petrolAmount: rawGpsKm * RATE_PER_KM,
    adjustmentApplied: "Supervisor review required",
  };
}

function sumSiteVisitRouteKm(visits = []) {
  return visits.reduce((sum, visit) => {
    const routeKm = Number(visit?.route_km);
    return Number.isFinite(routeKm) && routeKm > 0 ? sum + routeKm : sum;
  }, 0);
}

function logPayableKmSource(foId, source, km) {
  console.debug("FO_PAYABLE_KM_SOURCE_SELECTED", foId, source, km);
  console.debug("FO_ROUTE_KM_TODAY_VALUE", foId, km);
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
  return [...flags];
}

function officerFromRows({ foId, profile, live, attendance, visits, logs }) {
  const record = attendance || {};
  const foVisits = visits || [];
  const foLogs = logs || [];
  const gpsPoint = gpsPointFromLiveOrLogs(live, foLogs);
  const coordinates = gpsPoint?.coordinates ?? null;
  const sourceTimestamp =
    gpsPoint?.timestamp || liveStatusTimestamp(live) || record.login_time;
  const status = live ? liveStatusFromRow(live) : "Offline";
  const payableRouteKm = payableRouteKmForOfficer({
    foId,
    live,
    attendance: record,
    visits: foVisits,
  });
  const payableKm = payableRouteKm.km;
  const foSafeKm = actualTravelKmFromAttendanceOrLogs(record, foLogs, foVisits);
  const actualKm = Number(foSafeKm.actualTravelKm ?? record.actual_km ?? record.total_raw_km ?? 0);
  const eligibleKm = payableKm;
  const petrolAmount = eligibleKm * RATE_PER_KM;
  const reviewFlags = reviewFlagsForOfficer({
    systemKm: eligibleKm,
    attendance: record,
    visits: foVisits,
    logs: foLogs,
  });
  const name =
    profile?.full_name ||
    profile?.display_name ||
    live?.display_name ||
    live?.username ||
    live?.fo_user_id ||
    foId;
  const state = profile?.state || live?.state || record.state || "--";

  return {
    id: `live-${foId}`,
    foId,
    name,
    employeeCode: profile?.employee_code || live?.fo_user_id || foId,
    status,
    assignedSite:
      foVisits.find((visit) => isSiteVisitOpen(visit))?.store_name ||
      "No active store visit",
    branch: state,
    state,
    checkIn: formatTime(record.login_time),
    lastSeen: formatDateTime(sourceTimestamp),
    battery: batteryFromRow(live),
    action: live?.current_status || record.status || "Attendance captured",
    phone: profile?.mobile || profile?.phone || record.mobile || live?.mobile || "--",
    coordinates,
    heading: gpsPoint?.heading ?? null,
    speed: gpsPoint?.speed ?? null,
    accuracy: gpsPoint?.accuracy ?? null,
    actualKm,
    rawGpsKm: Number(foSafeKm.rawGpsKm || 0),
    filteredGpsKm: Number(foSafeKm.filteredGpsKm || 0),
    actualTravelKm: Number(foSafeKm.actualTravelKm || actualKm || 0),
    eligibleKm,
    ratePerKm: RATE_PER_KM,
    petrolAmount,
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
    attendance: record,
    tasks: [],
    visits: foVisits,
    logs: foLogs,
    conveyance: null,
  };
}

function buildLiveFoData({ attendance, visits, liveStatus, profiles, logs }) {
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
  const logsByFo = (logs || []).reduce((map, log) => {
    const id = normalizeFoKey(foIdFromRow(log));
    if (!id) return map;
    const list = map.get(id) || [];
    list.push(log);
    map.set(id, list);
    return map;
  }, new Map());

  const officerIds = new Set();
  profiles.filter(isRealFoProfile).forEach((profile) => {
    const code = normalizeFoKey(profile?.employee_code);
    if (code) {
      officerIds.add(code);
      return;
    }
    profileKeys(profile).forEach((key) => officerIds.add(key));
  });
  latestLiveStatus.forEach((_, foId) => officerIds.add(foId));
  latestAttendance.forEach((_, foId) => officerIds.add(foId));
  visitsByFo.forEach((_, foId) => officerIds.add(foId));
  logsByFo.forEach((_, foId) => officerIds.add(foId));
  return Array.from(officerIds).map((foId) =>
    officerFromRows({
      foId,
      profile: profilesByCode.get(foId),
      live: latestLiveStatus.get(foId),
      attendance: latestAttendance.get(foId),
      visits: visitsByFo.get(foId) || [],
      logs: logsByFo.get(foId) || [],
    }),
  );
}

function officerFromLiveStatus(row, profilesByCode, existing = {}) {
  const foId = normalizeFoKey(
    row?.fo_user_id || existing.foId || existing.employeeCode,
  );
  if (!foId) return null;
  const profile = profilesByCode.get(foId);
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
  const status = liveStatusFromRow(row);
  const battery = batteryFromRow(row);
  const actualKm = Number(existing.foSafeKm?.actualTravelKm ?? existing.actualKm ?? 0);
  const payableRouteKm = payableRouteKmForOfficer({
    foId,
    live: row,
    attendance: existing.attendance,
    visits: existing.visits || [],
  });
  const eligibleKm = payableRouteKm.km;
  const petrolAmount = eligibleKm * RATE_PER_KM;
  const reviewFlags = reviewFlagsForOfficer({
    systemKm: eligibleKm,
    attendance: existing.attendance,
    visits: existing.visits || [],
    logs: existing.logs || [],
  });
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
    branch: profile?.state || row?.state || existing.state || "--",
    state: profile?.state || row?.state || existing.state || "--",
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
    petrolAmount,
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
  const distanceToday = Number(
    officer.eligibleKm ?? officer.routeKmToday ?? 0,
  );
  const actualTravelKm = Number(officer.actualTravelKm ?? officer.actualKm ?? 0);
  const isLive = status.label === "Online";
  const isRecent =
    status.label === "Recently Active" || status.label === "Low Battery";
  const statusText =
    officer.movementStatusLabel ||
    (isLive ? "Live" : isRecent ? "Recent" : "Offline");
  const statusClass = officer.movementStatusLabel
    ? "bg-emerald-50 text-emerald-700"
    : isLive
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
              <Route className="h-3.5 w-3.5" />
              {distanceToday.toFixed(1)} km
            </span>
            <span>GPS audit {actualTravelKm.toFixed(1)} km</span>
            <span>{formatInr(officer.petrolAmount ?? distanceToday * RATE_PER_KM)}</span>
          </div>
          <p className="mt-1 truncate text-xs font-medium text-slate-500">
            <MapPin className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
            {hasFiniteCoordinates(officer.coordinates)
              ? `${Number(officer.coordinates[0]).toFixed(5)}, ${Number(officer.coordinates[1]).toFixed(5)}`
              : "No Location Available"}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-400">
            {officer.lastSeen}
          </p>
        </div>
      </div>
    </button>
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
  const workingMinutes = attendanceWorkingMinutes(officer.attendance || {});
  const roadKmLabel = roadKmEstimate
    ? `${Number(roadKmEstimate.roadKm || 0).toFixed(1)} km reference only${
        roadKmEstimate.usedFallback ? " fallback" : ""
      }`
    : "--";
  const claimKmLabel = hasClaimKm ? `${claimKm.toFixed(1)} km` : "--";
  const claimPetrol = Number(officer.petrolAmount ?? claimKm * RATE_PER_KM);
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
  return routeLines.flatMap((route) => route.positions || []).filter(hasFiniteCoordinates);
}

function MapViewport({ pins, sitePins, routeLines, expanded, command }) {
  const map = useMap();
  const didInitialFitRef = useRef(false);

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [expanded, map]);

  useEffect(() => {
    if (!pins.length && !didInitialFitRef.current) {
      map.setView(SOUTH_INDIA_CENTER, 6);
      didInitialFitRef.current = true;
      return;
    }

    if (!command && !didInitialFitRef.current && pins.length) {
      map.fitBounds(
        pins.map((pin) => pin.coordinates),
        { padding: [44, 44], maxZoom: 13 },
      );
      didInitialFitRef.current = true;
      return;
    }

    if (!command) return;

    if (command.type === "current-location" && hasFiniteCoordinates(command.coordinates)) {
      map.flyTo(command.coordinates, 15, { duration: 0.55 });
      return;
    }

    if (command.type === "fit-route") {
      const routePoints = flattenRouteLinePoints(routeLines);
      const sitePoints = sitePins.map((site) => site.coordinates).filter(hasFiniteCoordinates);
      const points = [...routePoints, ...sitePoints];
      if (points.length === 1) {
        map.flyTo(points[0], 14, { duration: 0.45 });
      } else if (points.length > 1) {
        map.fitBounds(points, { padding: [56, 56], maxZoom: 15 });
      }
      return;
    }

    if (command.type === "fit-all") {
      if (pins.length === 1) {
        map.flyTo(pins[0].coordinates, 13, { duration: 0.45 });
      } else if (pins.length > 1) {
        map.fitBounds(
          pins.map((pin) => pin.coordinates),
          { padding: [44, 44], maxZoom: 13 },
        );
      }
    }
  }, [command, map, pins, routeLines, sitePins]);

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
        pins={pins}
        sitePins={sitePins}
        routeLines={routeLines}
        expanded={expanded}
        command={command}
      />
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
                    Status:{" "}
                    {officer.movementStatusLabel ||
                      (officer.status === "Active"
                        ? "Live"
                        : officer.status === "Recent"
                          ? "Recent"
                          : "Offline")}
                  </p>
                  <p className="text-slate-600">
                    Last seen: {officer.lastSeen}
                  </p>
                  <p className="text-slate-600">
                    Accuracy:{" "}
                    {officer.accuracy === null || officer.accuracy === undefined
                      ? "--"
                      : `${Number(officer.accuracy).toFixed(1)} m`}
                  </p>
                  <p className="text-slate-600">
                    Lat/Lng:{" "}
                    {hasFiniteCoordinates(officer.coordinates)
                      ? `${Number(officer.coordinates[0]).toFixed(5)}, ${Number(officer.coordinates[1]).toFixed(5)}`
                      : "No Location Available"}
                  </p>
                  <p className="text-slate-600">
                    Payable KM:{" "}
                    {Number(
                      officer.eligibleKm ?? officer.routeKmToday ?? 0,
                    ).toFixed(1)}{" "}
                    km
                  </p>
                  <p className="text-slate-600">
                    GPS Audit KM:{" "}
                    {Number(officer.actualTravelKm ?? officer.actualKm ?? 0).toFixed(1)} km
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
    const eligibleKm = payableRouteKm;
    const petrolAmount = eligibleKm * RATE_PER_KM;
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
      Date: `${toDateInputValue(from)} to ${toDateInputValue(to)}`,
      "Start Time": formatDateTime(attendance.login_time),
      "End Time": formatDateTime(attendance.logout_time),
      "Attendance Status": attendance.status || officer.status || "",
      "Raw GPS KM": safeKm.rawGpsKm.toFixed(2),
      "Filtered GPS KM": safeKm.filteredGpsKm.toFixed(2),
      "Actual Travel KM": safeKm.actualTravelKm.toFixed(2),
      "Route KM": eligibleKm.toFixed(2),
      "Route vs Actual KM": (eligibleKm - safeKm.actualTravelKm).toFixed(2),
      "Claim KM": eligibleKm.toFixed(2),
      "Rate Per KM": RATE_PER_KM,
      "Petrol Amount": petrolAmount.toFixed(2),
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
    "Date",
    "Start Time",
    "End Time",
    "Attendance Status",
    "Raw GPS KM",
    "Filtered GPS KM",
    "Actual Travel KM",
    "Route KM",
    "Route vs Actual KM",
    "Claim KM",
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

function numberLabel(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(1)}${suffix}`;
}

function moneyLabel(value) {
  return formatInr(value);
}

function durationMinutesLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "--";
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

function visitLocation(visit) {
  const lat = numberOrNull(visit?.check_in_latitude ?? visit?.current_latitude ?? visit?.destination_lat);
  const lng = numberOrNull(visit?.check_in_longitude ?? visit?.current_longitude ?? visit?.destination_lng);
  if (lat !== null && lng !== null) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return visit?.state || "--";
}

function visitRemarks(visit) {
  return visit?.checkout_note || visit?.visit_status || visit?.status || "--";
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
  const lat = numberOrNull(attendance?.end_latitude ?? attendance?.logout_latitude ?? attendance?.end_lat);
  const lng = numberOrNull(attendance?.end_longitude ?? attendance?.logout_longitude ?? attendance?.end_lng);
  return lat !== null && lng !== null ? [lat, lng] : null;
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
  return !Number.isFinite(accuracy) || accuracy <= MAX_GPS_ACCURACY_METERS;
}

function gpsTrailGapReason(previous, current) {
  const secondsGap = (current.timestampMs - previous.timestampMs) / 1000;
  const distanceKm = distanceKmBetween(
    { latitude: previous.point[0], longitude: previous.point[1] },
    { latitude: current.point[0], longitude: current.point[1] },
  );
  const speedKmph = secondsGap > 0 ? distanceKm / (secondsGap / 3600) : Number.POSITIVE_INFINITY;
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
      `gps_log_${log.id || log.captured_at || log.recorded_at || log.created_at || normalizedPoints.length}`,
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
      source: log.id || log.captured_at || log.recorded_at || log.created_at || normalizedPoints.length,
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
    validPointsCount: ordered.length,
    duplicatesRemoved,
    gapBreakExamples,
    segmentsSkippedCount: normalizedPoints.length - segments.reduce((sum, segment) => sum + segment.length, 0),
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
  const fallbackTrail = anchors.map((anchor) => anchor.coordinates).filter(hasFiniteCoordinates);
  const hasGpsTrail = gpsTrail.segments.length > 0;
  const routeTrail = hasGpsTrail
    ? gpsTrail.trail
    : storedPolylines.length
      ? storedPolylines[0]
      : fallbackTrail;
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
    gpsValidPointsCount: gpsTrail.validPointsCount,
    gpsDuplicatesRemoved: gpsTrail.duplicatesRemoved,
    gpsSegmentCount: gpsTrail.segments.length,
    gpsSegmentPointCounts: gpsTrail.segments.map((segment) => segment.length),
    gpsSegmentsSkippedCount: gpsTrail.segmentsSkippedCount,
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
      return { paths: points.gpsSegments.length ? points.gpsSegments : [points.routeTrail], source: "raw_gps", label: "Raw GPS" };
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
    return { paths: [points.routeTrail], source: "anchors", label: "Anchors" };
  }, [points.routeSource, points.routeTrail, points.storedPolylines, routeViewMode, simplifiedGpsTrail, snapResult]);
  const renderedPolylinePointCount = selectedRoute.paths.reduce((sum, path) => sum + path.length, 0);
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
      rawGpsPoints: points.gpsValidPointsCount,
      downsampledGpsPoints: snapResult.downsampledGpsPoints,
      snapApiChunkCount: snapResult.snapApiChunkCount,
      snappedPointsReturned: snapResult.snappedPointsReturned,
      snapToRoadStatus: snapResult.status,
      finalPathSource: selectedRoute.source,
      selectedRouteViewMode: routeViewMode,
      renderedPolylinePointCount,
      renderedPolylineSegmentCount: selectedRoute.paths.filter((path) => path.length > 1).length,
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
  }, [fromDate, officer, points, renderedPolylinePointCount, routeViewMode, selectedRoute.source, snapResult, toDate]);

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
      {routeViewMode === "road" && ["failed", "partial"].includes(snapResult.status) ? (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-bold text-amber-800 shadow-sm">
          Road snapping unavailable — showing simplified GPS trail
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
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tones[tone] || tones.blue}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-600">{label}</p>
          <p className="mt-1 truncate text-base font-black text-slate-950">{value || "--"}</p>
          <p className="mt-1 truncate text-xs font-semibold text-slate-500">{hint || "--"}</p>
        </div>
        </div>
    </div>
  );
}

function FieldOfficerDetailsView({
  officer,
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
}) {
  const [selectedVisitIndex, setSelectedVisitIndex] = useState(0);
  const [photoFilter, setPhotoFilter] = useState("All");
  const [routeMapOpen, setRouteMapOpen] = useState(false);
  const visits = useMemo(() => sortedOfficerVisits(officer), [officer]);
  const attendance = useMemo(() => officer?.attendance || {}, [officer?.attendance]);
  const activeVisitIndex = visits.length
    ? Math.min(selectedVisitIndex, visits.length - 1)
    : 0;
  const selectedVisit = visits[activeVisitIndex] || null;
  const visibleActivityUploads = useMemo(() => {
    const selectedVisitId = selectedVisit?.id ? String(selectedVisit.id) : null;
    const siteScopedUploads = selectedVisitId
      ? activityUploads.filter((upload) => {
          const uploadVisitId = upload.site_visit_id || upload.submission?.site_visit_id;
          return !uploadVisitId || String(uploadVisitId) === selectedVisitId;
        })
      : activityUploads;
    return filteredActivityUploads(siteScopedUploads, photoFilter);
  }, [activityUploads, photoFilter, selectedVisit]);
  const status = officerStatus(officer);
  const isLive = status.label === "Online";
  const workingMinutes = attendanceWorkingMinutes(attendance);
  const totalVisitMinutes = visits.reduce((sum, visit) => sum + (visitMinutes(visit) || 0), 0);
  const totalKm = Number(officer?.eligibleKm ?? officer?.routeKmToday);
  const petrolAmount = Number(attendance?.petrol_amount ?? officer?.petrolAmount);
  const ratePerKm = Number(attendance?.rate_per_km);
  const timelineRows = useMemo(() => {
    const rows = [];
    if (attendance.login_time) {
      rows.push({
        key: "start",
        index: <PlayCircle className="h-4 w-4" />,
        site: "Start Day",
        location: pointFromAttendanceStart(attendance)
          ? `${pointFromAttendanceStart(attendance).latitude.toFixed(5)}, ${pointFromAttendanceStart(attendance).longitude.toFixed(5)}`
          : "--",
        checkIn: formatDateTime(attendance.login_time),
        checkOut: "--",
        duration: "--",
        travelFromPrevious: "--",
        distance: "--",
        activity: "Start Day",
      });
    }
    visits.forEach((visit, index) => {
      rows.push({
        key: visit.id || `${visit.check_in_time}-${index}`,
        index: index + 1,
        site: `${visitTitle(visit)} / ${visitClient(visit)}`,
        location: visitLocation(visit),
        checkIn: formatDateTime(visit.check_in_time),
        checkOut: formatDateTime(siteVisitCheckoutValue(visit)),
        duration: durationMinutesLabel(visitMinutes(visit)),
        travelFromPrevious: index === 0 ? "Start Day" : visitTitle(visits[index - 1]),
        distance: numberLabel(visit.route_km, ""),
        activity: siteVisitStatus(visit),
        visitIndex: index,
      });
    });
    if (attendance.logout_time) {
      rows.push({
        key: "end",
        index: <Square className="h-3.5 w-3.5" />,
        site: "End Day",
        location: routePointFromAttendanceEnd(attendance)
          ? `${routePointFromAttendanceEnd(attendance)[0].toFixed(5)}, ${routePointFromAttendanceEnd(attendance)[1].toFixed(5)}`
          : "--",
        checkIn: "--",
        checkOut: formatDateTime(attendance.logout_time),
        duration: durationMinutesLabel(workingMinutes),
        travelFromPrevious: visits.length ? visitTitle(visits.at(-1)) : "--",
        distance: "--",
        activity: "End Day",
      });
    }
    return rows;
  }, [attendance, visits, workingMinutes]);

  return (
    <div className="max-w-full overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <span>FO Operations</span>
            <ChevronRight className="h-4 w-4" />
            <span className="font-black text-slate-950">Field Officer Details</span>
          </div>
          <div className="mt-5 flex min-w-0 items-center gap-5">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-qpms-800">
              <User className="h-8 w-8" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="min-w-0 break-words text-3xl font-black tracking-normal text-slate-950">{officer?.name || "--"}</h1>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${isLive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {isLive ? "Live / Active" : displayValue(status.label)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-6 text-sm font-semibold text-slate-600">
                <span>Employee ID: {displayValue(officer?.employeeCode || officer?.foId)}</span>
                <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4 text-qpms-700" /> {displayValue(officer?.phone)}</span>
                <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-qpms-700" /> {displayValue(officer?.state)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="min-w-0 max-w-full grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="text-xs font-bold text-slate-600">From Date</span>
              <input type="date" value={draftFromDate} onChange={(event) => onDraftFromDate(event.target.value)} className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-qpms-500" />
            </label>
            <span className="pb-2 text-slate-400">to</span>
            <label>
              <span className="text-xs font-bold text-slate-600">To Date</span>
              <input type="date" value={draftToDate} onChange={(event) => onDraftToDate(event.target.value)} className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-qpms-500" />
            </label>
            <button type="button" onClick={onApplyDate} className="focus-ring rounded-lg border border-qpms-600 px-5 py-2 text-sm font-black text-qpms-700 hover:bg-qpms-50">Apply</button>
            <button type="button" onClick={onExport} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-qpms-700 px-5 py-2 text-sm font-black text-white hover:bg-qpms-800">
              <Download className="h-4 w-4" /> Export Report
            </button>
          </div>
          <button type="button" onClick={onBack} className="focus-ring ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-qpms-700 hover:bg-slate-50">
            <ChevronLeft className="h-4 w-4" /> Back to List
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        <DetailSummaryCard icon={PlayCircle} label="Start Day" value={formatTime(attendance.login_time)} hint={formatDateOnly(attendance.login_time)} tone="green" />
        <DetailSummaryCard icon={Square} label="End Day" value={formatTime(attendance.logout_time)} hint={formatDateOnly(attendance.logout_time)} tone="red" />
        <DetailSummaryCard icon={MapPin} label="Total Sites" value={visits.length ? visits.length : "--"} hint="--" tone="purple" />
        <DetailSummaryCard icon={Route} label="Payable KM" value={Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--"} hint="--" tone="blue" />
        <DetailSummaryCard icon={Clock} label="Working Hours" value={durationMinutesLabel(workingMinutes)} hint="--" tone="amber" />
        <DetailSummaryCard icon={Fuel} label="Petrol Amount" value={moneyLabel(petrolAmount)} hint={`@ ${formatInr(ratePerKm)} / km`} tone="green" />
        <DetailSummaryCard icon={ShieldCheck} label="Status" value={displayValue(attendance.status || status.label)} hint="--" tone="green" />
      </div>

      <section className="mt-3 min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-950">Route Map</h2>
            <p className="text-xs font-semibold text-slate-500">Visual route proof from GPS logs, stored map data, or route anchors.</p>
          </div>
          <button
            type="button"
            onClick={() => setRouteMapOpen((value) => !value)}
            className="focus-ring inline-flex items-center gap-2 rounded-lg border border-qpms-200 px-4 py-2 text-sm font-black text-qpms-700 hover:bg-qpms-50"
          >
            <MapPinned className="h-4 w-4" />
            {routeMapOpen ? "Hide Route Map" : "Show Route Map"}
          </button>
        </div>
        {routeMapOpen ? (
          <div className="mt-3">
            <GoogleRouteMap officer={officer} routeLogs={routeLogs} fromDate={fromDate} toDate={toDate} />
          </div>
        ) : null}
      </section>

      <div className="mt-3 grid min-w-0 gap-3 overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_minmax(390px,460px)]">
        <div className="grid min-w-0 content-start gap-3">
          <section className="min-h-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-black text-slate-950">Visit Timeline</h2>
              <span className="text-sm font-semibold text-slate-500">({formatDateOnly(fromDate)} - {formatDateOnly(toDate)})</span>
            </div>
            <div className="max-h-[390px] overflow-auto rounded-lg border border-slate-100">
              <table className="min-w-[900px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-black text-slate-600">
                  <tr>
                    {["#", "Site / Client", "Location", "Check-in", "Check-out", "Duration", "Travel From Previous", "Distance (km)", "Activity", "View"].map((heading) => (
                      <th key={heading} className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold text-slate-600">
                  {timelineRows.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black text-white ${row.key === "start" ? "bg-emerald-500" : row.key === "end" ? "bg-red-500" : "bg-blue-600"}`}>{row.index}</span>
                      </td>
                      <td className="min-w-40 px-3 py-2 text-slate-900">{row.site}</td>
                      <td className="min-w-28 px-3 py-2">{row.location}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.checkIn}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.checkOut}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.duration}</td>
                      <td className="min-w-36 px-3 py-2">{row.travelFromPrevious}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.distance}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.activity}</td>
                      <td className="px-3 py-2">
                        {row.visitIndex !== undefined ? (
                          <button type="button" onClick={() => setSelectedVisitIndex(row.visitIndex)} className="focus-ring grid h-8 w-8 place-items-center rounded-full text-qpms-700 hover:bg-qpms-50" aria-label="View site details">
                            <Eye className="h-4 w-4" />
                          </button>
                        ) : "--"}
                      </td>
                    </tr>
                  ))}
                  {!timelineRows.length ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">No visit timeline available for selected filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="grid min-w-0 content-start gap-3">
          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-black text-slate-950">Site Selector <span className="text-sm text-slate-500">({visits.length} Sites Visited)</span></h2>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={visits.length <= 1} onClick={() => setSelectedVisitIndex((value) => Math.max(0, value - 1))} className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-qpms-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" disabled={visits.length <= 1} onClick={() => setSelectedVisitIndex((value) => Math.min(visits.length - 1, value + 1))} className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-qpms-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1">
              {visits.map((visit, index) => (
                <button key={visit.id || `${visit.check_in_time}-${index}`} type="button" onClick={() => setSelectedVisitIndex(index)} className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black ${index === activeVisitIndex ? "border-qpms-600 bg-qpms-50 text-qpms-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[11px]">{index + 1}</span>
                  {visitTitle(visit)}
                </button>
              ))}
              {!visits.length ? <span className="text-sm font-semibold text-slate-500">No sites visited.</span> : null}
            </div>
            <div className="mt-5 grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.65fr)]">
              <div className="min-w-0">
                <h3 className="mb-3 text-base font-black text-slate-950">Site Details</h3>
                {[
                  ["Site / Client", `${visitTitle(selectedVisit)} / ${visitClient(selectedVisit)}`],
                  ["Client Name", visitClient(selectedVisit)],
                  ["Business Type", selectedVisit?.business],
                  ["Address", selectedVisit?.address || selectedVisit?.location_name],
                  ["Check-in", formatDateTime(selectedVisit?.check_in_time)],
                  ["Check-out", formatDateTime(siteVisitCheckoutValue(selectedVisit))],
                  ["Duration", durationMinutesLabel(visitMinutes(selectedVisit))],
                  ["Remarks", visitRemarks(selectedVisit)],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[120px_1fr] gap-2 py-1 text-xs font-semibold">
                    <span className="text-qpms-800">{label}</span>
                    <span className="truncate text-slate-700">{displayValue(value)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="grid h-44 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
                  <Image className="h-14 w-14" />
                </div>
                <p className="mt-2 text-center text-sm font-black text-qpms-800">{visits.length ? `${activeVisitIndex + 1} / ${visits.length}` : "--"}</p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="mt-3 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-950">Activity Photos <span className="text-sm text-slate-500">({visibleActivityUploads.length})</span></h2>
        <div className="mt-3 flex max-w-full flex-wrap gap-2 overflow-x-auto pb-1">
          {ACTIVITY_PHOTO_TABS.map((tab) => (
            <button key={tab} type="button" onClick={() => setPhotoFilter(tab)} className={`focus-ring shrink-0 rounded-lg border px-3 py-2 text-xs font-black ${photoFilter === tab ? "border-qpms-700 bg-qpms-700 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{tab}</button>
          ))}
        </div>
        <div className="mt-4 min-h-[165px] max-h-[260px] overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-white p-3">
          {visibleActivityUploads.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleActivityUploads.map((upload) => (
                <a
                  key={upload.id || upload.local_id || upload.file_url}
                  href={upload.displayUrl || upload.file_url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="group grid grid-cols-[56px_1fr] gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2 text-left hover:border-qpms-200 hover:bg-qpms-50"
                >
                  <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-md bg-white text-slate-300">
                    {activityUploadIsImage(upload) && upload.displayUrl ? (
                      <img src={upload.displayUrl} alt={activityUploadName(upload)} className="h-full w-full object-cover" />
                    ) : (
                      <Image className="h-7 w-7" />
                    )}
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
            <div className="grid min-h-[150px] place-items-center text-center">
              <div>
                <Image className="mx-auto h-12 w-12 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-500">No activity photos uploaded for selected filters.</p>
                {activitySubmissions.length && !activityUploads.length ? (
                  <p className="mt-1 text-xs font-semibold text-slate-400">Activity submissions found, but no upload files are linked.</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <DetailStripItem icon={UserRoundCheck} label="Total Sites Visited" value={visits.length ? visits.length : "--"} />
        <DetailStripItem icon={Route} label="Total Payable KM" value={Number.isFinite(totalKm) ? `${totalKm.toFixed(1)} km` : "--"} />
        <DetailStripItem icon={Clock} label="Total Working Hours" value={durationMinutesLabel(workingMinutes)} />
        <DetailStripItem icon={CalendarDays} label="Total Duration" value={durationMinutesLabel(totalVisitMinutes)} />
        <DetailStripItem icon={Fuel} label="Petrol Amount" value={moneyLabel(petrolAmount)} hint={`@ ${formatInr(ratePerKm)} / km`} />
      </div>
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

function activeSiteVisitFromRows(rows = []) {
  return rows
    .slice()
    .sort((a, b) => new Date(b.check_in_time || b.created_at || 0) - new Date(a.check_in_time || a.created_at || 0))
    .find(isSiteVisitOpen) || null;
}

function supportActionAvailability({ attendanceRows = [], visitRows = [] }) {
  const attendance = todayAttendanceFromRows(attendanceRows);
  const activeVisit = activeSiteVisitFromRows(visitRows);
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
  recalculatingKm = false,
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
  const claimKmLabel = hasClaimKm ? `${claimKm.toFixed(1)} km` : "--";
  const claimPetrol = Number(officer.petrolAmount ?? claimKm * RATE_PER_KM);
  const isLive = status.label === "Online";
  const isRecent = status.label === "Recently Active" || status.label === "Low Battery";
  const statusText = isLive ? "Live" : isRecent ? "Recent" : "Offline";
  const statusClass = isLive
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : isRecent
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
      : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200";
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
  const [stateFilter, setStateFilter] = useState("All States");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [search, setSearch] = useState("");
  const [expandedMap, setExpandedMap] = useState(false);
  const [selectedOfficerId, setSelectedOfficerId] = useState(null);
  const [mapRouteOfficerId, setMapRouteOfficerId] = useState(null);
  const [supportOfficerId, setSupportOfficerId] = useState(null);
  const [supportContext, setSupportContext] = useState({ attendanceRows: [], visitRows: [] });
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportPendingAction, setSupportPendingAction] = useState(null);
  const [supportRemarks, setSupportRemarks] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [liveOfficers, setLiveOfficers] = useState([]);
  const [siteVisitRows, setSiteVisitRows] = useState([]);
  const [selectedRouteLogs, setSelectedRouteLogs] = useState([]);
  const [mainMapRouteLines, setMainMapRouteLines] = useState([]);
  const [selectedActivitySubmissions, setSelectedActivitySubmissions] = useState([]);
  const [selectedActivityUploads, setSelectedActivityUploads] = useState([]);
  const [showSiteMarkers, setShowSiteMarkers] = useState(true);
  const [showRouteTrail, setShowRouteTrail] = useState(true);
  const [mapTheme, setMapTheme] = useState("light");
  const [mapControlsCollapsed, setMapControlsCollapsed] = useState(false);
  const [mapCommand, setMapCommand] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [kmRecalcBusy, setKmRecalcBusy] = useState(false);
  const [kmRecalcResult, setKmRecalcResult] = useState(null);
  const [datePreset, setDatePreset] = useState("today");
  const [customFromDate, setCustomFromDate] = useState(
    toDateInputValue(new Date()),
  );
  const [customToDate, setCustomToDate] = useState(
    toDateInputValue(new Date()),
  );
  const [detailDraftFromDate, setDetailDraftFromDate] = useState(customFromDate);
  const [detailDraftToDate, setDetailDraftToDate] = useState(customToDate);
  const profileRowsRef = useRef([]);
  const mainRouteFitKeyRef = useRef(null);
  const kmRecalcCooldownRef = useRef(new Map());
  const kmRecalcInFlightRef = useRef(new Set());

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
        const [attendanceRes, siteVisits, liveStatusRows, profilesRes, logsRes] =
          await Promise.all([
            supabase
              .from("fo_attendance")
              .select("*")
              .gte("login_time", fromIso)
              .lte("login_time", toIso)
              .order("login_time", { ascending: false })
              .limit(500),
            fetchFoSiteVisitRows(fromIso, toIso),
            fetchFoLiveStatusRows(),
            supabase
              .from("profiles")
              .select(
                "full_name, display_name, employee_code, username, mobile, role, state, status",
              )
              .or("role.ilike.FO,role.ilike.Field Officer")
              .limit(1000),
            supabase
              .from("fo_location_logs")
              .select("*")
              .gte("captured_at", fromIso)
              .lte("captured_at", toIso)
              .order("captured_at", { ascending: true })
              .limit(20000),
          ]);
        console.debug("FO_SUPABASE_QUERY_RESULTS", {
          attendanceCount: attendanceRes.data?.length || 0,
          attendanceError: attendanceRes.error || null,
          liveStatusCount: liveStatusRows.length,
          profilesCount: profilesRes.data?.length || 0,
          profilesError: profilesRes.error || null,
          locationLogsCount: logsRes.data?.length || 0,
          locationLogsError: logsRes.error || null,
        });
        console.warn("FO_SUPABASE_ERRORS", {
          attendance: attendanceRes.error || null,
          profiles: profilesRes.error || null,
          locationLogs: logsRes.error || null,
        });
        const errors = [attendanceRes, profilesRes, logsRes]
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
          visits: siteVisits,
          liveStatus: liveStatusRows,
          profiles: profileRows,
          logs: logsRes.data || [],
        });
        console.debug("FO_ATTENDANCE_LOADED", attendanceRes.data?.length || 0);
        console.debug("FO_SITE_VISITS_LOADED", siteVisits.length);
        console.debug("FO_LIVE_STATUS_LOADED", liveStatusRows.length);
        console.debug("FO_OFFICERS_BUILT", officersFromSupabase.length);
        if (!cancelled) {
          profileRowsRef.current = profileRows;
          setSiteVisitRows(siteVisits);
          setLiveOfficers(officersFromSupabase);
        }
      } catch (error) {
        console.warn("[myQPMS FO] Supabase FO fetch failed.", error);
        if (!cancelled) {
          setSiteVisitRows([]);
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
    }, 12000);
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

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
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
  const mapRouteOfficer =
    filteredOfficers.find((officer) => officer.id === mapRouteOfficerId) ||
    liveOfficers.find((officer) => officer.id === mapRouteOfficerId) ||
    null;
  const routeOfficer = selectedOfficer || mapRouteOfficer;
  const supportOfficer =
    filteredOfficers.find((officer) => officer.id === supportOfficerId) ||
    liveOfficers.find((officer) => officer.id === supportOfficerId) ||
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

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedRouteLogs() {
      if (!routeOfficer || !isSupabaseConfigured || !supabase) {
        setSelectedRouteLogs([]);
        return;
      }
      const fromIso = formatDateForDb(selectedRange.from);
      const toIso = formatDateForDb(selectedRange.to);
      const selectedFoKeys = Array.from(
        new Set(
          [
            routeOfficer.foId,
            routeOfficer.employeeCode,
            routeOfficer.attendance?.fo_user_id,
            routeOfficer.attendance?.employee_code,
          ]
            .map(normalizeFoKey)
            .filter(Boolean),
        ),
      );
      const fetchedRows = [];
      const idColumns = ["fo_user_id", "employee_code", "profile_id"];
      const timeColumns = ["captured_at", "recorded_at", "created_at", "logged_at"];

      try {
        for (const idValue of selectedFoKeys) {
          for (const idColumn of idColumns) {
            for (const timeColumn of timeColumns) {
              const rows = await fetchLocationLogsByColumn({
                idColumn,
                idValue,
                timeColumn,
                fromIso,
                toIso,
              });
              fetchedRows.push(...rows);
            }
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
            `${row.captured_at || row.recorded_at || row.logged_at || row.created_at || index}-${row.latitude}-${row.longitude}`,
          row,
        );
      });
      const selectedLogs = Array.from(routeRowsById.values()).sort(
        (a, b) => routePointTime(a) - routePointTime(b),
      );
      console.debug("FO_DRILLDOWN_GPS_LOGS_FETCHED", {
        officer_name: routeOfficer.name,
        officer_id: routeOfficer.foId || routeOfficer.employeeCode,
        date_range: `${selectedRange.fromDate} to ${selectedRange.toDate}`,
        gps_logs_fetched_count: selectedLogs.length,
      });
      setSelectedRouteLogs(selectedLogs);
    }
    loadSelectedRouteLogs();
    return () => {
      cancelled = true;
    };
  }, [routeOfficer, selectedRange.from, selectedRange.fromDate, selectedRange.to, selectedRange.toDate]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedActivityUploads() {
      if (!selectedOfficer || !isSupabaseConfigured || !supabase) {
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

      try {
        const [submissionsRes, uploadsRes] = await Promise.all([
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
        ]);
        if (submissionsRes.error) throw submissionsRes.error;
        if (uploadsRes.error) throw uploadsRes.error;
        if (cancelled) return;

        const submissions = (submissionsRes.data || []).filter((submission) =>
          uploadMatchesSelectedContext(submission, { attendanceId, siteVisitIds }),
        );
        const submissionsById = new Map(submissions.map((submission) => [String(submission.id), submission]));
        const uploads = (uploadsRes.data || []).filter((upload) => {
          if (upload.submission_id && submissionsById.has(String(upload.submission_id))) return true;
          return uploadMatchesSelectedContext(upload, { attendanceId, siteVisitIds });
        });
        const hydratedUploads = await Promise.all(
          uploads.map(async (upload) => {
            const submission = upload.submission_id ? submissionsById.get(String(upload.submission_id)) : null;
            const activityType = upload.activity_type || submission?.activity_type || upload.upload_role;
            return {
              ...upload,
              submission,
              activityGroup: normalizeActivityGroup(activityType, upload.upload_role),
              displayUrl: await signedActivityUploadUrl(upload),
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
  }, [selectedOfficer, selectedRange.from, selectedRange.fromDate, selectedRange.to, selectedRange.toDate]);

  async function loadSupportContext(officer) {
    if (!officer || !isSupabaseConfigured || !supabase) {
      setSupportContext({ attendanceRows: [], visitRows: [] });
      return;
    }
    const foId = normalizeFoKey(officer.foId || officer.employeeCode);
    if (!foId) {
      setSupportContext({ attendanceRows: [], visitRows: [] });
      return;
    }
    setSupportLoading(true);
    setSupportMessage("");
    try {
      const today = toDateInputValue(new Date());
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
          .order("check_in_time", { ascending: false })
          .limit(100),
      ]);
      if (attendanceRes.error) throw attendanceRes.error;
      if (visitsRes.error) throw visitsRes.error;
      const attendanceRows = attendanceRes.data || [];
      const attendanceIds = new Set(attendanceRows.map((row) => String(row.id || "")).filter(Boolean));
      const todayStart = startOfIndiaDayFromInput(today).getTime();
      const todayEnd = endOfIndiaDayFromInput(today).getTime();
      const visitRows = (visitsRes.data || []).filter((visit) => {
        if (isSiteVisitOpen(visit)) return true;
        if (visit.attendance_id && attendanceIds.has(String(visit.attendance_id))) return true;
        const checkInMs = new Date(visit.check_in_time || 0).getTime();
        return checkInMs >= todayStart && checkInMs <= todayEnd;
      });
      setSupportContext({ attendanceRows, visitRows });
    } catch (error) {
      console.warn("[myQPMS FO] Support action context failed.", error);
      setSupportContext({ attendanceRows: [], visitRows: [] });
      setSupportMessage(error?.message || "Unable to load today's support state.");
    } finally {
      setSupportLoading(false);
    }
  }

  function openSupportActions(officerId) {
    const officer =
      filteredOfficers.find((item) => item.id === officerId) ||
      liveOfficers.find((item) => item.id === officerId);
    if (!officer) return;
    setMapRouteOfficerId(officerId);
    if (hasFiniteCoordinates(officer.coordinates)) {
      setMapCommand({
        type: "current-location",
        coordinates: officer.coordinates,
        at: Date.now(),
      });
    }
    setSupportOfficerId(officerId);
    setSupportPendingAction(null);
    setSupportRemarks("");
    setSupportMessage("");
    setSupportContext({
      attendanceRows: officer.attendance ? [officer.attendance] : [],
      visitRows: officer.visits || [],
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
        await api.post(`/api/fo/site-visits/${visit.id}/force-checkout`, {
          remarks: supportRemarks.trim(),
          checkout_latitude: coordinates?.[0] ?? null,
          checkout_longitude: coordinates?.[1] ?? null,
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
    setMapCommand({ type: "recenter", at: Date.now() });
  }

  function openSupportDetailedView() {
    if (!supportOfficer) return;
    const officerId = supportOfficer.id;
    closeSupportActions();
    focusOfficer(officerId);
  }

  function applyDetailDateRange() {
    setCustomFromDate(detailDraftFromDate);
    setCustomToDate(detailDraftToDate);
    setDatePreset("custom");
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
    return foId ? `${foId}|${selectedRange.fromDate}` : null;
  }

  async function recalculateSelectedOfficerKm() {
    if (!selectedOfficer) return;
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
      const response = await fetch(`${API_BASE_URL}/api/fo/km/recalculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fo_user_id: selectedOfficer.foId || selectedOfficer.employeeCode,
          attendance_id: selectedOfficer.attendance?.id,
          date: selectedRange.fromDate,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "KM recalculation failed.");
      }
      setKmRecalcResult(payload);
      setRefreshToken((value) => value + 1);
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

  const pins = useMemo(() => {
    const markerOfficers = visualFilteredOfficers.filter((officer) => {
      const canShow = canShowOfficerMarker(officer);
      if (!canShow && !hasFiniteCoordinates(officer.coordinates)) {
        console.debug(
          "FO_MARKER_SKIPPED_NO_COORDINATES",
          officer.foId || officer.employeeCode,
        );
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
          status:
            officer.status === "Offline"
              ? "Critical"
              : officer.battery !== null && officer.battery < 20
                ? "Warning"
                : "Stable",
        };
        const stateOfficers = [markerOfficer];
        return {
          id: `fo-${officer.id}`,
          state,
          officers: stateOfficers,
          coordinates: [lat, lng],
          activeOfficers: stateOfficers.filter(
            (officer) => officer.status === "Active",
          ).length,
          offlineOfficers: stateOfficers.filter(
            (officer) => officer.status === "Offline",
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
    const pinsForVisits = siteVisitRows
      .filter((visit) => {
        if (!selectedFoId) return true;
        return siteVisitFoId(visit) === selectedFoId;
      })
      .map((visit, index) => buildSiteVisitPin(visit, officersByFoId, index))
      .filter(Boolean);
    console.debug("FO_SITE_MARKERS_BUILT", pinsForVisits.length);
    return pinsForVisits;
  }, [filteredOfficers, routeOfficer, siteVisitRows]);

  useEffect(() => {
    let cancelled = false;
    async function rebuildMainRouteLines() {
      if (!routeOfficer) {
        setMainMapRouteLines([]);
        return;
      }
      const lines = await buildMainMapRouteLines({
        logs: selectedRouteLogs,
        visits: routeOfficer.visits || [],
        color: foMarkerColor(routeOfficer),
        idPrefix: `route-${routeOfficer.id}`,
      });
      if (!cancelled) setMainMapRouteLines(lines);
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
  const liveRouteKm = filteredOfficers.reduce(
    (sum, officer) =>
      sum + Number(officer.eligibleKm ?? officer.routeKmToday ?? 0),
    0,
  );
  const liveActualTravelKm = filteredOfficers.reduce(
    (sum, officer) =>
      sum + Number(officer.actualTravelKm ?? officer.actualKm ?? 0),
    0,
  );
  const totalPetrolAmount = filteredOfficers.reduce(
    (sum, officer) => sum + Number(officer.petrolAmount || 0),
    0,
  );
  const distanceTravelled = `${liveRouteKm.toFixed(1)} km`;
  const actualTravelled = `${liveActualTravelKm.toFixed(1)} km`;
  const routeVsActual = `${(liveRouteKm - liveActualTravelKm).toFixed(1)} km`;
  const avgRouteKm = filteredOfficers.length
    ? `${(liveRouteKm / filteredOfficers.length).toFixed(1)} km`
    : "0.0 km";

  if (selectedOfficer) {
    return (
      <FieldOfficerDetailsView
        key={`${selectedOfficer.id}-${selectedRange.fromDate}-${selectedRange.toDate}`}
        officer={selectedOfficer}
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
        onExport={() =>
          exportFoOperationsExcel({
            officers: filteredOfficers,
            selectedOfficer,
            from: selectedRange.from,
            to: selectedRange.to,
          })
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Operations Command Center"
        actions={
          <span className="command-pill">
            <RadioTower className="h-3.5 w-3.5 text-emerald-500" /> Live
            updating every 12s
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
          label="Payable KM Today"
          value={distanceTravelled}
          icon={Route}
          tone="green"
        />
        <FleetKpi
          label="Total Petrol Amount Today"
          value={formatInr(totalPetrolAmount)}
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
                  setMapCommand({
                    type: "current-location",
                    coordinates: routeOfficer?.coordinates,
                    at: Date.now(),
                  })
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

            <div
              className={`absolute right-5 top-5 z-[540] w-[255px] rounded-xl border border-slate-200 bg-white/96 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/90 ${mapControlsCollapsed ? "p-3" : "p-4"}`}
            >
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
                      onClick={() =>
                        setMapCommand({
                          type: "current-location",
                          coordinates: routeOfficer?.coordinates,
                          at: Date.now(),
                        })
                      }
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
                  Operations ({filteredOfficers.length})
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
              recalculatingKm={kmRecalcBusy}
              recalculationResult={kmRecalcResult}
              foSafeKm={selectedActualTravelMetrics}
              siteVisitCount={(supportOfficer || routeOfficer)?.visits?.length || 0}
            />
            <div className="max-h-[584px] overflow-y-auto">
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
              View All Officers <ChevronRight className="h-4 w-4" />
            </button>
          </aside>
        </div>
      </section>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-9 dark:border-slate-800 dark:bg-slate-900">
        <MetricTile
          label="Payable KM Today"
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
                onSelectOfficer={openSupportActions}
                onCloseSelection={() => setSelectedOfficerId(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
