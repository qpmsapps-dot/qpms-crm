import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/crash_log_service.dart';
import 'package:myqpms_fo_v2/tracking/route_km_calculator.dart';
import 'package:myqpms_fo_v2/tracking/tracking_flags.dart';

LocationLog point(
  int n, {
  double? latitude,
  double accuracy = 5,
  int? seconds,
}) => LocationLog(
  id: 'synthetic-$n',
  employeeCode: 'SYNTHETIC-FO',
  attendanceId: 'synthetic-attendance',
  latitude: latitude ?? 11 + n * 0.0002,
  longitude: 76,
  accuracy: accuracy,
  speed: 2,
  capturedAt: DateTime.utc(
    2026,
    11,
    23,
  ).add(Duration(seconds: seconds ?? n * 10)),
);

void main() {
  test('logging changes preserve GPS thresholds and all batching flags', () {
    expect(RouteKmCalculator.minSegmentMeters, 8);
    expect(RouteKmCalculator.maxSegmentMeters, 1000);
    expect(RouteKmCalculator.maxAccuracyMeters, 50);
    expect(RouteKmCalculator.maxSpeedMetersPerSecond, 33.33);
    expect(RouteKmCalculator.maxSecondsDiff, 600);
    expect(TrackingFlags.gpsBatchInterval, const Duration(seconds: 60));
    expect(TrackingFlags.gpsBatchPointThreshold, 8);
    expect(TrackingFlags.enableAndroidForegroundLocationService, isTrue);
  });
  test(
    'accepted route output and original coordinates/timestamps remain unchanged',
    () {
      final logs = [point(2), point(0), point(1)];
      final evidence = logs.map((p) => p.toJson()).toList();
      expect(RouteKmCalculator.calculateKm(logs), 0.04);
      expect(logs.map((p) => p.toJson()).toList(), evidence);
      expect(
        CrashLogService.diagnosticSummaries['GPS_ACCEPTED_FOR_KM']!['count'],
        greaterThanOrEqualTo(2),
      );
    },
  );
  test(
    'tiny noise, accuracy, speed, long gaps and time-order rejection rules remain unchanged',
    () {
      expect(
        RouteKmCalculator.calculateKm([
          point(0),
          point(1, latitude: 11.000001),
        ]),
        0,
      );
      expect(
        RouteKmCalculator.calculateKm([
          point(0),
          point(1, accuracy: 100),
          point(2),
        ]),
        0.04,
      );
      expect(
        RouteKmCalculator.calculateKm([
          point(0),
          point(1, latitude: 11.002, seconds: 1),
        ]),
        0,
      );
      expect(
        RouteKmCalculator.calculateKm([point(0), point(1, latitude: 11.02)]),
        0,
      );
      expect(
        RouteKmCalculator.calculateKm([point(0), point(1, seconds: 601)]),
        0,
      );
      expect(
        RouteKmCalculator.calculateKm([point(0), point(1, seconds: 0)]),
        0,
      );
      for (final action in [
        'GPS_REJECTED_TINY_NOISE',
        'GPS_REJECTED_LOW_ACCURACY',
        'GPS_REJECTED_SPEED_SPIKE',
      ]) {
        expect(
          CrashLogService.diagnosticSummaries[action]!['count'],
          greaterThan(0),
        );
      }
    },
  );
  test(
    'site-visit exclusion and latest usable point selection remain unchanged',
    () {
      final logs = [point(0), point(1), point(2)];
      final visit = SiteVisit(
        id: 'synthetic-visit',
        employeeCode: 'SYNTHETIC-FO',
        storeName: 'Synthetic',
        clientName: 'Synthetic',
        storeCode: 'TEST',
        state: 'TEST',
        checkInTime: logs.first.capturedAt,
        checkOutTime: logs.last.capturedAt,
        currentLatitude: 11,
        currentLongitude: 76,
      );
      expect(RouteKmCalculator.calculateKm(logs, visits: [visit]), 0);
      expect(
        RouteKmCalculator.latestValidLog([
          ...logs,
          point(3, accuracy: 100),
        ])?.id,
        logs.last.id,
      );
    },
  );
}
