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
  "fo_user_id,employee_code,fo_name,display_name,store_name,site_name,client_name,store_code,site_code,check_in_time,checkout_time,check_out_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,visit_duration_minutes,status";
const FO_LIVE_STATUS_SELECT =
  "fo_user_id,latitude,longitude,last_seen_at,updated_at,route_km_today,is_online,is_tracking,current_status,display_name,username,accuracy,battery_percentage";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const MARKER_ANIMATION_MIN_MS = 15000;
const MARKER_ANIMATION_MAX_MS = 180000;
const MARKER_ANIMATION_DEFAULT_MS = 45000;
const MARKER_ANIMATION_RECENT_THRESHOLD_MS = 10 * 60 * 1000;

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
  return new Date(log?.captured_at || log?.logged_at || log?.last_seen_at || 0).getTime();
}

function routePointTime(log) {
  return new Date(log?.captured_at || log?.logged_at || 0);
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
  if (siteVisitRouteKm > 0) {
    logPayableKmSource(foId, "fo_site_visits.route_km_sum", siteVisitRouteKm);
    return {
      km: siteVisitRouteKm,
      source: "fo_site_visits.route_km_sum",
    };
  }

  const liveKm = Number(live?.route_km_today);
  if (Number.isFinite(liveKm) && liveKm >= 0.1) {
    logPayableKmSource(foId, "fo_live_status.route_km_today", liveKm);
    return {
      km: liveKm,
      source: "fo_live_status.route_km_today",
    };
  }

  const eligibleKm = Number(attendance?.eligible_km);
  if (Number.isFinite(eligibleKm) && eligibleKm > 0) {
    logPayableKmSource(foId, "fo_attendance.eligible_km", eligibleKm);
    return {
      km: eligibleKm,
      source: "fo_attendance.eligible_km",
    };
  }

  const totalRouteKm = Number(attendance?.total_route_km);
  if (Number.isFinite(totalRouteKm) && totalRouteKm > 0) {
    logPayableKmSource(foId, "fo_attendance.total_route_km", totalRouteKm);
    return {
      km: totalRouteKm,
      source: "fo_attendance.total_route_km",
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
  const state = profile?.state || live?.state || record.state || "Tamil Nadu";

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
    phone: "--",
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
    branch: profile?.state || row?.state || existing.state || "Tamil Nadu",
    state: profile?.state || row?.state || existing.state || "Tamil Nadu",
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
            <span>Actual {actualTravelKm.toFixed(1)} km</span>
            <span>₹{Number(officer.petrolAmount ?? distanceToday * RATE_PER_KM).toFixed(0)}</span>
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
            System KM
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
      {recalculationResult ? (
        <p className="mt-2 text-[11px] font-semibold text-slate-500">
          Approved {Number(recalculationResult.approved_km ?? recalculationResult.total_route_km ?? 0).toFixed(1)} km,
          points {recalculationResult.gps_points_used || 0}/{recalculationResult.gps_points_total || 0},
          confidence {recalculationResult.confidence || "--"}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
        <span>Raw GPS KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {Number(kmMetrics.rawGpsKm || 0).toFixed(1)} km
        </strong>
        <span>Filtered GPS KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {filteredGpsKm.toFixed(1)} km
        </strong>
        <span>Actual Travel KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {actualTravelKm.toFixed(1)} km
        </strong>
        <span>Route vs Actual</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {routeVsActualDelta.toFixed(1)} km
        </strong>
        <span>Claim KM</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {claimKmLabel}
        </strong>
        <span>Petrol Amount</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {claimPetrol === null ? "--" : `₹${claimPetrol.toFixed(0)}`}
        </strong>
        <span>KM Confidence</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {kmMetrics.kmConfidence || "REVIEW"}
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
        <span>Sites Visited Today / Selected Date</span>
        <strong className="text-right text-slate-800 dark:text-slate-100">
          {siteVisitCount ?? officer.visits?.length ?? 0}
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
                    Route KM:{" "}
                    {Number(
                      officer.eligibleKm ?? officer.routeKmToday ?? 0,
                    ).toFixed(1)}{" "}
                    km
                  </p>
                  <p className="text-slate-600">
                    Actual Travel KM:{" "}
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
  const [liveOfficers, setLiveOfficers] = useState([]);
  const [siteVisitRows, setSiteVisitRows] = useState([]);
  const [selectedRouteLogs, setSelectedRouteLogs] = useState([]);
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
                "full_name, display_name, employee_code, username, role, state, status",
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
    setKmRecalcResult(null);
    setMapCommand({ type: "recenter", at: Date.now() });
  }

  async function recalculateSelectedOfficerKm() {
    if (!selectedOfficer) return;
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
      setKmRecalcResult({ message: error.message, confidence: "ERROR" });
      console.warn("[myQPMS FO] KM recalculation failed.", error);
    } finally {
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
          selectedOfficer?.id === officer.id
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
        if (a.officers.some((officer) => officer.id === selectedOfficer?.id))
          return -1;
        if (b.officers.some((officer) => officer.id === selectedOfficer?.id))
          return 1;
        return b.activeOfficers - a.activeOfficers;
      });
    console.debug("FO_MARKERS_WITH_VALID_COORDS", builtPins.length);
    console.debug("FO_MARKERS_BUILT", builtPins.length);
    return builtPins;
  }, [filteredStates, selectedOfficer, visualFilteredOfficers]);

  const sitePins = useMemo(() => {
    const officersByFoId = new Map();
    filteredOfficers.forEach((officer) => {
      [officer.foId, officer.employeeCode].forEach((id) => {
        const key = normalizeFoKey(id);
        if (key) officersByFoId.set(key, officer);
      });
    });
    const selectedFoId = selectedOfficer
      ? normalizeFoKey(selectedOfficer.foId || selectedOfficer.employeeCode)
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
  }, [filteredOfficers, selectedOfficer, siteVisitRows]);

  const routeLines = useMemo(() => {
    if (!selectedOfficer) return [];
    return routeSegmentsFromLogs(selectedRouteLogs, selectedOfficer.visits).map((positions, index) => ({
      id: `route-${selectedOfficer.id}-${index}`,
      positions,
      color: foMarkerColor(selectedOfficer),
    }));
  }, [selectedOfficer, selectedRouteLogs]);

  const selectedActualTravelMetrics = useMemo(() => {
    if (!selectedOfficer) return null;
    return actualTravelKmFromAttendanceOrLogs(
      selectedOfficer.attendance,
      selectedRouteLogs,
      selectedOfficer.visits || [],
    );
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

  return (
    <div className="space-y-3">
      <PageHeader
        title="FO Operations Command Center"
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
                      icon={LocateFixed}
                      label="Recenter on Selected FO"
                      onClick={() =>
                        setMapCommand({ type: "recenter", at: Date.now() })
                      }
                    />
                    <ControlButton
                      icon={Maximize2}
                      label="Fit All Active Officers"
                      onClick={() =>
                        setMapCommand({ type: "fit", at: Date.now() })
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
              onRecalculateKm={recalculateSelectedOfficerKm}
              recalculatingKm={kmRecalcBusy}
              recalculationResult={kmRecalcResult}
              foSafeKm={selectedActualTravelMetrics}
              siteVisitCount={selectedOfficer?.visits?.length || 0}
            />
            <div className="max-h-[584px] overflow-y-auto">
              {visualFilteredOfficers.map((officer) => (
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

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-9 dark:border-slate-800 dark:bg-slate-900">
        <MetricTile
          label="Total Route KM Today"
          value={distanceTravelled}
          icon={Route}
          tone="green"
        />
        <MetricTile
          label="Actual Travel KM"
          value={actualTravelled}
          icon={Navigation2}
          tone="blue"
        />
        <MetricTile
          label="Route vs Actual"
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
