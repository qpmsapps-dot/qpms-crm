import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import 'app.dart';
import 'hospital_housekeeping/hospital_push_service.dart';
import 'services/background_tracking_service.dart';
import 'services/crash_log_service.dart';
import 'tracking/tracking_flags.dart';

Future<void> main() async {
  await runZonedGuarded<Future<void>>(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      if (TrackingFlags.enableAndroidForegroundLocationService) {
        // Configure only; GPS starts after login + Start Day.
        await BackgroundTrackingService.configure();
      }
      try {
        await HospitalPushService.configure();
      } catch (error, stackTrace) {
        debugPrint('Hospital push startup skipped: $error');
        debugPrint('$stackTrace');
        unawaited(
          CrashLogService.record(
            screen: 'global',
            action: 'HOSPITAL_PUSH_STARTUP_ERROR',
            error: error,
            stackTrace: stackTrace,
          ),
        );
      }
      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        unawaited(
          CrashLogService.record(
            screen: 'global',
            action: 'FLUTTER_ERROR',
            error: details.exception,
            stackTrace: details.stack,
          ),
        );
      };
      PlatformDispatcher.instance.onError = (error, stackTrace) {
        unawaited(
          CrashLogService.record(
            screen: 'global',
            action: 'PLATFORM_ERROR',
            error: error,
            stackTrace: stackTrace,
          ),
        );
        return true;
      };
      runApp(const MyQpmsFoApp());
    },
    (error, stackTrace) {
      unawaited(
        CrashLogService.record(
          screen: 'global',
          action: 'ZONE_ERROR',
          error: error,
          stackTrace: stackTrace,
        ),
      );
    },
  );
}
