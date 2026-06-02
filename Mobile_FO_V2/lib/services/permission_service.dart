import 'dart:io';

import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import 'crash_log_service.dart';

class PermissionService {
  static const message =
      'For reliable field tracking, set Location permission to Allow all the time and Battery usage to Unrestricted.';

  static Future<bool> ensureLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      await CrashLogService.record(
        screen: 'permissions',
        action: 'BACKGROUND_PERMISSION_MISSING',
        error: 'Location permission denied.',
      );
      return false;
    }
    if (Platform.isAndroid) {
      final accuracy = await Geolocator.getLocationAccuracy();
      if (accuracy == LocationAccuracyStatus.reduced) {
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BACKGROUND_PERMISSION_MISSING',
          error: 'Precise location is disabled.',
        );
        return false;
      }
      final always = await ph.Permission.locationAlways.status;
      if (!always.isGranted && !always.isLimited) {
        await ph.Permission.locationAlways.request();
      }
      final alwaysAfterRequest = await ph.Permission.locationAlways.status;
      if (!alwaysAfterRequest.isGranted && !alwaysAfterRequest.isLimited) {
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BACKGROUND_PERMISSION_MISSING',
          error: 'Background location is not allowed.',
        );
        return false;
      }
      final notification = await ph.Permission.notification.status;
      if (!notification.isGranted) {
        await ph.Permission.notification.request();
      }
      if (!await ph.Permission.notification.isGranted) {
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BACKGROUND_PERMISSION_MISSING',
          error: 'Notification permission is not granted.',
        );
        return false;
      }
      final battery = await ph.Permission.ignoreBatteryOptimizations.status;
      if (!battery.isGranted) {
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BATTERY_OPTIMIZATION_WARNING',
        );
        await ph.Permission.ignoreBatteryOptimizations.request();
      }
    }
    return true;
  }
}
