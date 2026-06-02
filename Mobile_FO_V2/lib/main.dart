import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import 'app.dart';
import 'services/background_tracking_service.dart';
import 'services/crash_log_service.dart';

Future<void> main() async {
  await runZonedGuarded<Future<void>>(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      await BackgroundTrackingService.configure();
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
