import 'dart:io';

import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import '../models/fo_models.dart';
import '../tracking/tracking_flags.dart';
import '../tracking/tracking_service.dart';
import '../tracking/tracking_health_metrics.dart';
import 'crash_log_service.dart';
import 'local_db_service.dart';
import 'local_store.dart';
import 'permission_service.dart';

enum HealthLevel { ok, needsAction, unknown }

class TrackingHealthSnapshot {
  const TrackingHealthSnapshot({
    required this.locationPermission,
    required this.backgroundLocation,
    required this.battery,
    required this.tracking,
    required this.locationServiceEnabled,
    required this.backgroundSessionExists,
    required this.pendingGpsLogs,
    this.lastGpsAt,
    this.lastSyncAt,
    this.guidance = const [],
    this.dailyMetrics = const {},
  });

  final HealthLevel locationPermission;
  final HealthLevel backgroundLocation;
  final HealthLevel battery;
  final HealthLevel tracking;
  final bool locationServiceEnabled;
  final bool backgroundSessionExists;
  final int pendingGpsLogs;
  final DateTime? lastGpsAt;
  final DateTime? lastSyncAt;
  final List<String> guidance;
  final Map<String, dynamic> dailyMetrics;

  String get locationPermissionLabel =>
      _label(locationPermission, ok: 'OK', needsAction: 'Needs Action');
  String get locationServiceLabel =>
      locationServiceEnabled ? 'OK' : 'Needs Action';
  String get backgroundLocationLabel =>
      _label(backgroundLocation, ok: 'OK', needsAction: 'Needs Action');
  String get batteryLabel => switch (battery) {
    HealthLevel.ok => 'OK',
    HealthLevel.needsAction => 'Needs attention',
    HealthLevel.unknown => 'Cannot verify on this phone',
  };
  String get trackingLabel =>
      _label(tracking, ok: 'Running', needsAction: 'Stopped');
  bool get requiredReady =>
      locationPermission == HealthLevel.ok && locationServiceEnabled;

  static String _label(
    HealthLevel level, {
    required String ok,
    required String needsAction,
  }) {
    return switch (level) {
      HealthLevel.ok => ok,
      HealthLevel.needsAction => needsAction,
      HealthLevel.unknown => 'Unknown',
    };
  }
}

class TrackingHealthService {
  static Future<TrackingHealthSnapshot> load({FoUser? user}) async {
    try {
      final guidance = <String>[];
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      final locationPermission = await _locationPermission(serviceEnabled);
      if (locationPermission == HealthLevel.needsAction) {
        guidance.add('Location permission must be set to Allow all the time.');
      }
      if (!serviceEnabled) {
        guidance.add('Location/GPS is turned off. Please enable it.');
      }

      final backgroundLocation = await _backgroundLocationPermission();
      if (backgroundLocation == HealthLevel.needsAction) {
        guidance.add('Allow location all the time for background tracking.');
      }

      final battery = await _batteryOptimizationStatus();
      if (battery == HealthLevel.needsAction) {
        guidance.add(await PermissionService.batteryGuidanceText());
      } else if (battery == HealthLevel.unknown && Platform.isAndroid) {
        guidance.add(PermissionService.batteryWarning);
        guidance.add(await PermissionService.batteryGuidanceText());
      }

      final backgroundSession =
          await LocalStore.getBackgroundTrackingSession() != null;
      final pendingGpsLogs = await LocalDbService.countUnsyncedGpsLogs();
      final latestLocalGps = await LocalDbService.latestGpsLogTime();
      final lastGpsAt = TrackingService.lastGpsSync ?? latestLocalGps;
      final lastSyncAt = TrackingService.lastSuccessfulSync;
      final dailyMetrics = await TrackingHealthMetrics.today();
      final tracking = TrackingService.isActive || backgroundSession
          ? HealthLevel.ok
          : HealthLevel.needsAction;

      PermissionService.locationStatus = serviceEnabled
          ? locationPermission.name
          : 'service disabled';
      PermissionService.backgroundLocationStatus = backgroundLocation.name;
      PermissionService.batteryOptimizationStatus = battery.name;

      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'tracking_health',
        action: 'tracking_health_loaded',
        error:
            'permission=${locationPermission.name} background=${backgroundLocation.name} battery=${battery.name} tracking=${tracking.name} pending_gps=$pendingGpsLogs',
      );

      return TrackingHealthSnapshot(
        locationPermission: locationPermission,
        backgroundLocation: backgroundLocation,
        battery: battery,
        tracking: tracking,
        locationServiceEnabled: serviceEnabled,
        backgroundSessionExists: backgroundSession,
        pendingGpsLogs: pendingGpsLogs,
        lastGpsAt: lastGpsAt,
        lastSyncAt: lastSyncAt,
        guidance: guidance,
        dailyMetrics: dailyMetrics,
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'tracking_health',
        action: 'tracking_health_failed',
        error: error,
        stackTrace: stackTrace,
      );
      return const TrackingHealthSnapshot(
        locationPermission: HealthLevel.unknown,
        backgroundLocation: HealthLevel.unknown,
        battery: HealthLevel.unknown,
        tracking: HealthLevel.unknown,
        locationServiceEnabled: false,
        backgroundSessionExists: false,
        pendingGpsLogs: 0,
        guidance: ['Unable to load app health. Please try Sync Now.'],
        dailyMetrics: {},
      );
    }
  }

  static Future<HealthLevel> _locationPermission(bool serviceEnabled) async {
    if (!serviceEnabled) return HealthLevel.needsAction;
    final permission = await Geolocator.checkPermission();
    return switch (permission) {
      LocationPermission.always => HealthLevel.ok,
      LocationPermission.whileInUse => HealthLevel.needsAction,
      LocationPermission.denied ||
      LocationPermission.deniedForever => HealthLevel.needsAction,
      LocationPermission.unableToDetermine => HealthLevel.unknown,
    };
  }

  static Future<HealthLevel> _backgroundLocationPermission() async {
    if (!Platform.isAndroid ||
        !TrackingFlags.enableAndroidForegroundLocationService) {
      return HealthLevel.ok;
    }
    final status = await ph.Permission.locationAlways.status;
    return status.isGranted || status.isLimited
        ? HealthLevel.ok
        : HealthLevel.needsAction;
  }

  static Future<HealthLevel> _batteryOptimizationStatus() async {
    if (!Platform.isAndroid) return HealthLevel.ok;
    try {
      final status = await ph.Permission.ignoreBatteryOptimizations.status;
      return status.isGranted ? HealthLevel.ok : HealthLevel.needsAction;
    } catch (_) {
      return HealthLevel.unknown;
    }
  }
}
