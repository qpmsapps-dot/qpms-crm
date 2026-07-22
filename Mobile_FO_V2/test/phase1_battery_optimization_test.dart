import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/background_tracking_service.dart';
import 'package:myqpms_fo_v2/tracking/phase1_tracking_policy.dart';
import 'package:myqpms_fo_v2/tracking/route_km_calculator.dart';
import 'package:myqpms_fo_v2/tracking/tracking_flags.dart';
import 'package:myqpms_fo_v2/tracking/tracking_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test(
    'moving, stationary, and checked-in collection intervals are unchanged',
    () {
      expect(TrackingService.movingInterval, const Duration(seconds: 10));
      expect(TrackingService.stationaryInterval, const Duration(seconds: 75));
      expect(
        BackgroundTrackingService.siteAwayCheckInterval,
        const Duration(minutes: 4),
      );
    },
  );

  test('scheduled batch flushes at 60 seconds', () {
    final scheduler = GpsBatchScheduler();
    final start = DateTime.utc(2026, 7, 15, 6);
    scheduler.markAttempt(start);

    expect(
      scheduler
          .decision(
            now: start.add(const Duration(seconds: 59)),
            queuedPoints: 1,
          )
          .shouldFlush,
      isFalse,
    );
    expect(
      scheduler
          .decision(
            now: start.add(const Duration(seconds: 60)),
            queuedPoints: 1,
          )
          .reason,
      'scheduled_interval',
    );
  });

  test('scheduled batch flushes at eight queued points', () {
    final scheduler = GpsBatchScheduler()
      ..markAttempt(DateTime.utc(2026, 7, 15, 6));
    final decision = scheduler.decision(
      now: DateTime.utc(2026, 7, 15, 6, 0, 10),
      queuedPoints: 8,
    );
    expect(decision.shouldFlush, isTrue);
    expect(decision.reason, 'point_threshold');
  });

  test('forced checkout and End Day flush bypass schedule and backoff', () {
    final scheduler = GpsBatchScheduler();
    final now = DateTime.utc(2026, 7, 15, 6);
    scheduler.markFailure(now);
    expect(
      scheduler.decision(now: now, queuedPoints: 1, force: true).shouldFlush,
      isTrue,
    );
  });

  test('failed uploads follow capped backoff and success resets it', () {
    final scheduler = GpsBatchScheduler();
    final now = DateTime.utc(2026, 7, 15, 6);
    expect(scheduler.markFailure(now), const Duration(seconds: 15));
    expect(scheduler.markFailure(now), const Duration(seconds: 30));
    expect(scheduler.markFailure(now), const Duration(seconds: 60));
    expect(scheduler.markFailure(now), const Duration(seconds: 120));
    expect(scheduler.markFailure(now), const Duration(seconds: 300));
    expect(scheduler.markFailure(now), const Duration(seconds: 300));
    scheduler.markSuccess();
    expect(scheduler.consecutiveFailures, 0);
    expect(scheduler.retryAfter, isNull);
    expect(scheduler.markFailure(now), const Duration(seconds: 15));
  });

  test(
    'backoff blocks tick retries while local collection remains independent',
    () {
      final scheduler = GpsBatchScheduler();
      final now = DateTime.utc(2026, 7, 15, 6);
      scheduler.markAttempt(now);
      scheduler.markFailure(now);
      final decision = scheduler.decision(
        now: now.add(const Duration(seconds: 10)),
        queuedPoints: 8,
      );
      expect(decision.shouldFlush, isFalse);
      expect(decision.reason, 'retry_backoff');

      final source = File(
        'lib/services/background_tracking_service.dart',
      ).readAsStringSync();
      expect(
        source.indexOf('LocalStore.addLocationLog(log'),
        lessThan(
          source.indexOf("flushQueue(reason: 'scheduled_tracking_tick')"),
        ),
      );
    },
  );

  test('live-status and attendance write cadences are coalesced', () {
    expect(
      WriteCadence.liveStatus(TrackingMotionState.moving),
      const Duration(seconds: 60),
    );
    expect(
      WriteCadence.liveStatus(TrackingMotionState.stationary),
      const Duration(seconds: 180),
    );
    expect(
      WriteCadence.liveStatus(TrackingMotionState.checkedIn),
      const Duration(seconds: 240),
    );
    expect(
      WriteCadence.attendanceKm(TrackingMotionState.moving),
      const Duration(seconds: 60),
    );
    expect(
      WriteCadence.attendanceKm(TrackingMotionState.stationary),
      const Duration(seconds: 180),
    );
  });

  test('current-attendance optimization preserves KM for identical inputs', () {
    final start = DateTime.utc(2026, 7, 15, 6);
    final current = <LocationLog>[
      _log('a1', 'attendance-a', 11.0000, 76.0000, start),
      _log(
        'a2',
        'attendance-a',
        11.0002,
        76.0000,
        start.add(const Duration(seconds: 10)),
      ),
      _log(
        'a3',
        'attendance-a',
        11.0004,
        76.0000,
        start.add(const Duration(seconds: 20)),
      ),
    ];
    final retainedHistory = <LocationLog>[
      _log('old', 'attendance-old', 9, 74, start),
      ...current,
    ];
    final previousOutput = RouteKmCalculator.calculateKm(
      retainedHistory
          .where((log) => log.attendanceId == 'attendance-a')
          .toList(),
    );
    final optimizedOutput = RouteKmCalculator.calculateKm(current);
    expect(optimizedOutput, previousOutput);
  });

  test('background GPS uses only queued batch upload path', () {
    final source = File(
      'lib/services/background_tracking_service.dart',
    ).readAsStringSync();
    expect(source, isNot(contains('SupabaseService.insertLocation(log)')));
    expect(source, contains('SupabaseService.insertLocationBatch(logs)'));
    expect(source, contains('attendanceId: attendanceId'));
  });

  test('shutdown and stale-session safeguards remain wired', () {
    final background = File(
      'lib/services/background_tracking_service.dart',
    ).readAsStringSync();
    final app = File('lib/app.dart').readAsStringSync();
    expect(background, contains("reason: 'backend_attendance_closed'"));
    expect(background, contains("reason: 'attendance_date_mismatch'"));
    expect(
      background,
      contains("'service_recovery_without_active_attendance'"),
    );
    expect(app, contains("reason: 'logout'"));
    expect(
      app.indexOf('TrackingService.stop('),
      lessThan(app.indexOf('signOut()')),
    );
    expect(app, isNot(contains('LocalStore.saveAttendance(null)')));
  });

  test(
    'Phase 1 adds no migration, backend, floating bubble, or permission dependency',
    () {
      expect(TrackingFlags.enableFloatingBubble, isFalse);
      expect(TrackingFlags.enableGpsBatching, isTrue);
      expect(TrackingFlags.enableLiveStatusCoalescing, isTrue);
      expect(TrackingFlags.enableAttendanceKmCoalescing, isTrue);
      final manifest = File(
        'android/app/src/main/AndroidManifest.xml',
      ).readAsStringSync();
      expect(manifest, isNot(contains('ACTIVITY_RECOGNITION')));
      expect(manifest, isNot(contains('GEOFENCE')));
      final validation = File(
        'lib/services/supabase_service.dart',
      ).readAsStringSync();
      expect(validation, contains('isAttendanceConfirmedActive'));
      expect(
        validation,
        contains("select('id, attendance_date, status, logout_time')"),
      );
    },
  );
}

LocationLog _log(
  String id,
  String attendanceId,
  double latitude,
  double longitude,
  DateTime capturedAt,
) {
  return LocationLog(
    id: id,
    employeeCode: 'QPMS-TEST',
    attendanceId: attendanceId,
    latitude: latitude,
    longitude: longitude,
    accuracy: 5,
    speed: 2,
    capturedAt: capturedAt,
  );
}
