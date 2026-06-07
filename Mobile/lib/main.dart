import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import 'fo_app.dart';
import 'services/fo_crash_log_service.dart';

bool _startupFailureShown = false;

Future<void> main() async {
  await runZonedGuarded<Future<void>>(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        unawaited(
          FoCrashLogService.record(
            screen: 'global',
            action: 'FLUTTER_ERROR',
            error: details.exception,
            stackTrace: details.stack,
            syncNow: true,
          ),
        );
        Zone.current.handleUncaughtError(
          details.exception,
          details.stack ?? StackTrace.current,
        );
      };

      PlatformDispatcher.instance.onError = (error, stackTrace) {
        unawaited(
          FoCrashLogService.record(
            screen: 'global',
            action: 'PLATFORM_DISPATCHER_ERROR',
            error: error,
            stackTrace: stackTrace,
            syncNow: true,
          ),
        );
        Zone.current.handleUncaughtError(error, stackTrace);
        return true;
      };

      runApp(const MyQpmsFoApp());
    },
    (error, stackTrace) {
      unawaited(
        FoCrashLogService.record(
          screen: 'global',
          action: 'RUN_ZONED_GUARDED_ERROR',
          error: error,
          stackTrace: stackTrace,
          syncNow: true,
        ),
      );
      debugPrint('[myQPMS Mobile Startup] Unhandled startup error: $error');
      debugPrintStack(stackTrace: stackTrace);
      _showStartupFailure(error);
    },
  );
}

void _showStartupFailure(Object error) {
  if (_startupFailureShown) return;
  _startupFailureShown = true;
  runApp(_StartupFailureApp(message: error.toString()));
}

class _StartupFailureApp extends StatelessWidget {
  const _StartupFailureApp({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: Color(0xFFD8404F),
                    size: 36,
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'App startup failed',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  Text(message),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
