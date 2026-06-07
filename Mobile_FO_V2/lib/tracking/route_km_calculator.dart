import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';

class RouteKmCalculator {
  static const preferredAccuracyMeters = 30.0;
  static const maxAccuracyMeters = 50.0;
  static const minSegmentMeters = 8.0;
  static const maxSegmentMeters = 1000.0;
  static const maxSecondsDiff = 600;
  static const maxSpeedMetersPerSecond = 33.33;
  static const siteGeofenceMeters = 100.0;

  static double calculateKm(
    List<LocationLog> logs, {
    List<SiteVisit> visits = const [],
  }) {
    final ordered = <LocationLog>[];
    for (final log in logs) {
      if (_isUsablePoint(log)) {
        ordered.add(log);
      } else {
        unawaited(
          CrashLogService.record(
            employeeCode: log.employeeCode,
            screen: 'tracking',
            action: 'GPS_REJECTED_LOW_ACCURACY',
            error: 'attendance_id=${log.attendanceId} accuracy=${log.accuracy}',
          ),
        );
      }
    }
    ordered.sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    var meters = 0.0;
    var loggedSiteWindowExclusion = false;
    for (var index = 1; index < ordered.length; index += 1) {
      final previous = ordered[index - 1];
      final current = ordered[index];
      if (_isInsideSiteVisitWindow(previous, current, visits)) {
        if (!loggedSiteWindowExclusion) {
          loggedSiteWindowExclusion = true;
          unawaited(
            CrashLogService.record(
              employeeCode: current.employeeCode,
              screen: 'tracking',
              action: 'ROUTE_KM_EXCLUDED_SITE_VISIT_WINDOW',
              error: 'attendance_id=${current.attendanceId}',
            ),
          );
        }
        continue;
      }
      final segmentMeters = Geolocator.distanceBetween(
        previous.latitude,
        previous.longitude,
        current.latitude,
        current.longitude,
      );
      final secondsDiff = current.capturedAt
          .difference(previous.capturedAt)
          .inSeconds;
      if (segmentMeters < minSegmentMeters) {
        unawaited(
          CrashLogService.record(
            employeeCode: current.employeeCode,
            screen: 'tracking',
            action: 'GPS_REJECTED_TINY_NOISE',
            error:
                'attendance_id=${current.attendanceId} segment_m=$segmentMeters',
          ),
        );
        continue;
      }
      if (segmentMeters > maxSegmentMeters ||
          secondsDiff <= 0 ||
          secondsDiff > maxSecondsDiff ||
          segmentMeters / secondsDiff > maxSpeedMetersPerSecond) {
        unawaited(
          CrashLogService.record(
            employeeCode: current.employeeCode,
            screen: 'tracking',
            action: 'GPS_REJECTED_SPEED_SPIKE',
            error:
                'attendance_id=${current.attendanceId} segment_m=$segmentMeters seconds=$secondsDiff',
          ),
        );
        continue;
      }
      if (_isSameSiteDrift(previous, current, visits)) continue;
      meters += segmentMeters;
      unawaited(
        CrashLogService.record(
          employeeCode: current.employeeCode,
          screen: 'tracking',
          action: 'GPS_ACCEPTED_FOR_KM',
          error:
              'attendance_id=${current.attendanceId} segment_m=$segmentMeters',
        ),
      );
    }
    return double.parse((meters / 1000).toStringAsFixed(2));
  }

  static LocationLog? latestValidLog(List<LocationLog> logs) {
    final ordered = logs.where(_isUsablePoint).toList()
      ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    return ordered.isEmpty ? null : ordered.last;
  }

  static bool _isUsablePoint(LocationLog log) {
    final accuracy = log.accuracy;
    return log.latitude.isFinite &&
        log.longitude.isFinite &&
        log.latitude >= -90 &&
        log.latitude <= 90 &&
        log.longitude >= -180 &&
        log.longitude <= 180 &&
        accuracy != null &&
        accuracy <= maxAccuracyMeters;
  }

  static bool _isSameSiteDrift(
    LocationLog previous,
    LocationLog current,
    List<SiteVisit> visits,
  ) {
    for (final visit in visits) {
      final lat = visit.currentLatitude;
      final lng = visit.currentLongitude;
      if (lat == null || lng == null) continue;
      final checkout = visit.checkOutTime;
      final insideVisitWindow =
          !previous.capturedAt.isBefore(visit.checkInTime) &&
          (checkout == null || !current.capturedAt.isAfter(checkout));
      if (!insideVisitWindow) continue;
      final previousMeters = Geolocator.distanceBetween(
        previous.latitude,
        previous.longitude,
        lat,
        lng,
      );
      final currentMeters = Geolocator.distanceBetween(
        current.latitude,
        current.longitude,
        lat,
        lng,
      );
      if (previousMeters <= siteGeofenceMeters &&
          currentMeters <= siteGeofenceMeters) {
        return true;
      }
    }
    return false;
  }

  static bool _isInsideSiteVisitWindow(
    LocationLog previous,
    LocationLog current,
    List<SiteVisit> visits,
  ) {
    for (final visit in visits) {
      final checkout = visit.checkOutTime;
      if (checkout == null) {
        if (!current.capturedAt.isBefore(visit.checkInTime)) return true;
        continue;
      }
      final overlapsVisitWindow =
          !previous.capturedAt.isAfter(checkout) &&
          !current.capturedAt.isBefore(visit.checkInTime);
      if (overlapsVisitWindow) return true;
    }
    return false;
  }
}
