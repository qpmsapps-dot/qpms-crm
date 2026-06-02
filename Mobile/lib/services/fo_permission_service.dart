import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

class FoPermissionSnapshot {
  const FoPermissionSnapshot(this.statuses);

  final Map<String, bool> statuses;

  bool get allGranted =>
      statuses.isNotEmpty && statuses.values.every((status) => status);
}

class FoPermissionService {
  FoPermissionService._();

  static bool get _requiresBackgroundLocation =>
      defaultTargetPlatform == TargetPlatform.android;

  static Future<bool> _isGranted(Permission permission) async {
    try {
      return await permission.isGranted;
    } catch (error) {
      debugPrint('[myQPMS FO] Permission status unavailable: $error');
      return false;
    }
  }

  static Future<FoPermissionSnapshot> checkRequired() async {
    try {
      final statuses = {
        'Location': await _isGranted(Permission.locationWhenInUse),
      };
      if (_requiresBackgroundLocation) {
        statuses['Background Location'] = await _isGranted(
          Permission.locationAlways,
        );
      }
      return FoPermissionSnapshot(statuses);
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Required permission check failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return const FoPermissionSnapshot({});
    }
  }

  static Future<FoPermissionSnapshot> requestRequired() async {
    try {
      final foregroundGranted =
          await _isGranted(Permission.locationWhenInUse) ||
          await _isGranted(Permission.location);
      if (!foregroundGranted) {
        await Permission.locationWhenInUse.request();
      }
      final refreshedForegroundGranted =
          await _isGranted(Permission.locationWhenInUse) ||
          await _isGranted(Permission.location);
      if (_requiresBackgroundLocation &&
          refreshedForegroundGranted &&
          !await _isGranted(Permission.locationAlways)) {
        await Permission.locationAlways.request();
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Permission request failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
    return checkRequired();
  }
}
