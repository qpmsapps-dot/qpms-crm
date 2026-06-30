import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import 'crash_log_service.dart';
import '../tracking/tracking_flags.dart';

class LocationReadinessResult {
  const LocationReadinessResult._({required this.allowed, this.message});

  const LocationReadinessResult.allowed() : this._(allowed: true);

  const LocationReadinessResult.blocked(String message)
    : this._(allowed: false, message: message);

  final bool allowed;
  final String? message;
}

class PermissionService {
  static const message =
      'Location permission must be Allow all the time and GPS must be on.';
  static const batteryWarning =
      'Battery/background setting could not be verified on this phone. For reliable tracking, manually enable Allow background activity / Don\'t optimize battery for myQPMS.';
  static String locationStatus = 'unknown';
  static String batteryOptimizationStatus = 'unknown';
  static String notificationStatus = 'not required';
  static String backgroundLocationStatus = 'unknown';
  static String? warning;

  static Future<LocationReadinessResult> ensureForegroundLocation({
    String? employeeCode,
    String action = 'LOCATION_READINESS_CHECK',
  }) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        locationStatus = 'service disabled';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_SERVICE_DISABLED',
        );
        return const LocationReadinessResult.blocked(
          'Location/GPS is turned off. Please turn it on and try again.',
        );
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        locationStatus = 'denied forever';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PERMISSION_DENIED_FOREVER',
        );
        return const LocationReadinessResult.blocked(
          'Location permission is disabled. Enable Precise Location in app settings and try again.',
        );
      }
      if (permission == LocationPermission.denied) {
        locationStatus = 'denied';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PERMISSION_DENIED',
        );
        return const LocationReadinessResult.blocked(
          'Location permission is required. Please allow location access and try again.',
        );
      }

      locationStatus = permission.name;
      final accuracy = await Geolocator.getLocationAccuracy();
      if (accuracy == LocationAccuracyStatus.reduced) {
        locationStatus = 'reduced accuracy';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PRECISE_LOCATION_MISSING',
        );
        return const LocationReadinessResult.blocked(
          'Precise Location is required. Enable precise GPS access and try again.',
        );
      }

      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'permissions',
        action: '${action}_READY',
      );
      return const LocationReadinessResult.allowed();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'permissions',
        action: '${action}_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return const LocationReadinessResult.blocked(
        'Unable to verify GPS access. Please check location settings and try again.',
      );
    }
  }

  static Future<bool> ensureLocation() async {
    try {
      warning = null;
      final foreground = await ensureForegroundLocation(
        action: 'START_DAY_LOCATION_READINESS',
      );
      if (!foreground.allowed) return false;
      if (Platform.isAndroid) {
        final sdkInt = await _androidSdkInt();
        if (TrackingFlags.enableAndroidForegroundLocationService) {
          final always = await ph.Permission.locationAlways.status;
          if (!always.isGranted && !always.isLimited) {
            await ph.Permission.locationAlways.request();
          }
          final alwaysAfterRequest = await ph.Permission.locationAlways.status;
          backgroundLocationStatus = alwaysAfterRequest.isGranted
              ? 'granted'
              : 'permission required';
          if (!alwaysAfterRequest.isGranted) {
            await CrashLogService.record(
              screen: 'permissions',
              action: 'BACKGROUND_PERMISSION_MISSING',
              error: 'Background location is not allowed.',
            );
            return false;
          }
        } else {
          backgroundLocationStatus = 'not required';
        }
        if (sdkInt >= 33) {
          final notification = await ph.Permission.notification.status;
          if (!notification.isGranted) {
            await ph.Permission.notification.request();
          }
          final notificationAfterRequest =
              await ph.Permission.notification.status;
          notificationStatus = notificationAfterRequest.isGranted
              ? 'granted'
              : 'permission pending';
          if (!notificationAfterRequest.isGranted) {
            await CrashLogService.record(
              screen: 'permissions',
              action: 'NOTIFICATION_PERMISSION_WARNING',
              error: 'Notification permission is not granted.',
            );
          }
        } else {
          notificationStatus = 'not required';
        }
        await refreshBatteryOptimizationStatus();
      }
      return true;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'permissions',
        action: 'PERMISSION_CHECK_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  static Future<int> _androidSdkInt() async {
    if (!Platform.isAndroid) return 0;
    final info = await DeviceInfoPlugin().androidInfo;
    return info.version.sdkInt;
  }

  static Future<String> androidBrandKey() async {
    if (!Platform.isAndroid) return 'stock';
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      final raw = '${info.manufacturer} ${info.brand} ${info.model}'
          .toLowerCase();
      if (raw.contains('oppo') ||
          raw.contains('realme') ||
          raw.contains('oneplus')) {
        return 'oppo';
      }
      if (raw.contains('xiaomi') ||
          raw.contains('redmi') ||
          raw.contains('poco')) {
        return 'xiaomi';
      }
      if (raw.contains('vivo') || raw.contains('iqoo')) return 'vivo';
      if (raw.contains('samsung')) return 'samsung';
      if (raw.contains('motorola') ||
          raw.contains('moto') ||
          raw.contains('google')) {
        return 'stock';
      }
    } catch (_) {
      return 'default';
    }
    return 'default';
  }

  static Future<String> batteryGuidanceText() async {
    switch (await androidBrandKey()) {
      case 'oppo':
        return 'Enable Allow background activity and disable battery optimization for myQPMS.';
      case 'xiaomi':
        return 'Enable Autostart, set Battery saver to No restrictions, and allow background location for myQPMS.';
      case 'vivo':
        return 'Allow background power usage and disable battery optimization for myQPMS.';
      case 'samsung':
        return 'Set battery usage to Unrestricted and remove myQPMS from Sleeping apps.';
      case 'stock':
        return 'Set battery usage to Unrestricted or Don\'t optimize.';
      default:
        return 'Allow background activity and disable battery optimization for myQPMS.';
    }
  }

  static Future<void> refreshBatteryOptimizationStatus() async {
    if (!Platform.isAndroid) {
      batteryOptimizationStatus = 'not required';
      warning = null;
      return;
    }
    try {
      final status = await ph.Permission.ignoreBatteryOptimizations.status;
      if (status.isGranted) {
        batteryOptimizationStatus = 'unrestricted';
        warning = null;
      } else {
        batteryOptimizationStatus = 'restricted';
        warning =
            'Tracking may stop in background. Please keep battery/background activity enabled for myQPMS.';
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BATTERY_OPTIMIZATION_ADVISORY',
        );
      }
    } catch (error, stackTrace) {
      batteryOptimizationStatus = 'unknown';
      warning = batteryWarning;
      await CrashLogService.record(
        screen: 'permissions',
        action: 'BATTERY_OPTIMIZATION_UNKNOWN',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  static Future<void> openBatterySettings() async {
    try {
      await ph.Permission.ignoreBatteryOptimizations.request();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'permissions',
        action: 'OPEN_BATTERY_SETTINGS_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      await ph.openAppSettings();
    }
  }

  static Future<void> openAppSettings() => ph.openAppSettings();
}
