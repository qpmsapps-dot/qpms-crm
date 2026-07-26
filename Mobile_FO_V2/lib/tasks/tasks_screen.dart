import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../models/fo_models.dart';
import '../services/app_state_sync_service.dart';
import '../services/checkin_store_matcher.dart';
import '../services/crash_log_service.dart';
import '../services/local_db_service.dart';
import '../services/local_store.dart';
import '../services/performance_log_service.dart';
import '../services/permission_service.dart';
import '../services/route_distance_service.dart';
import '../services/supabase_service.dart';
import '../services/travel_leg_lifecycle_service.dart';
import '../theme/app_theme.dart';
import '../tracking/tracking_service.dart';
import '../ui/fo_ui.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';

enum _CheckoutRecoveryAction { retry, fixState }

enum _NoSiteFoundAction { cancel, refresh, retryGps }

const double _activityImageMaxDimension = 1600;
const int _activityImageQuality = 78;
const int _activityUploadMaxBytes = 5 * 1024 * 1024;

String _fileExtensionFromName(String fileName) {
  final clean = fileName.trim().toLowerCase();
  final extension = clean.contains('.') ? clean.split('.').last : 'jpg';
  switch (extension) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'jpg':
    default:
      return 'jpg';
  }
}

class TasksScreen extends StatefulWidget {
  const TasksScreen({
    required this.user,
    required this.onLogout,
    this.isSelected = true,
    super.key,
  });

  final FoUser user;
  final Future<void> Function() onLogout;
  final bool isSelected;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen>
    with AutomaticKeepAliveClientMixin<TasksScreen>, WidgetsBindingObserver {
  TravelLegLifecycleService get _travelLegLifecycle =>
      TravelLegLifecycleService(gateway: SupabaseTravelLegGateway(widget.user));

  Attendance? _attendance;
  SiteVisit? _activeVisit;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _load();
    }
  }

  @override
  void didUpdateWidget(covariant TasksScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSelected && !oldWidget.isSelected) {
      _load();
    }
  }

  Future<void> _load() async {
    var attendance = await LocalStore.getAttendance();
    var activeVisit = await LocalStore.activeVisit(
      user: widget.user,
      attendance: attendance,
    );
    final todayKey = indiaDateKey(DateTime.now());
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'ATTENDANCE_LOADED_MYTASKS',
      error:
          'source=local attendance_id=${attendance?.remoteId ?? attendance?.id ?? '--'} active=${attendance?.isActive == true} remote_id=${attendance?.remoteId ?? '--'} end_time=${attendance?.endTime?.toIso8601String() ?? '--'}',
    );
    if (attendance != null) {
      final attendanceDate = _attendanceDateKey(attendance);
      final employeeMismatch =
          attendance.employeeCode.trim() != widget.user.employeeCode.trim();
      if (attendanceDate != todayKey || employeeMismatch) {
        await _clearPreviousDayLocalSession(
          attendance: attendance,
          attendanceDate: attendanceDate,
          todayKey: todayKey,
          cleanupAction: employeeMismatch
              ? 'DIFFERENT_EMPLOYEE_LOCAL_SESSION_CLEANUP'
              : 'PREVIOUS_DAY_LOCAL_SESSION_CLEANUP',
        );
        attendance = null;
        activeVisit = null;
      }
    }
    if (SupabaseService.isReady) {
      final remoteAttendance =
          await SupabaseService.findActiveAttendanceForToday(widget.user);
      if (remoteAttendance != null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'REMOTE_ACTIVE_ATTENDANCE_FOUND',
          error: 'attendance_id=${remoteAttendance.remoteId}',
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'ATTENDANCE_ACTIVE_LOADED',
          error: 'attendance_id=${remoteAttendance.remoteId}',
        );
        attendance = remoteAttendance;
        await LocalStore.saveAttendance(remoteAttendance);
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'ATTENDANCE_SAVED_LOCAL',
          error:
              'source=remote_active attendance_id=${remoteAttendance.remoteId ?? remoteAttendance.id} active=${remoteAttendance.isActive} remote_id=${remoteAttendance.remoteId ?? '--'}',
        );
        final remoteVisit =
            await SupabaseService.findActiveSiteVisitForAttendance(
              user: widget.user,
              attendance: remoteAttendance,
            );
        if (remoteVisit != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'REMOTE_ACTIVE_SITE_VISIT_FOUND',
            error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
          );
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'ACTIVE_SITE_VISIT_LOADED',
            error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
          );
          remoteVisit.synced = true;
          await LocalStore.saveVisit(remoteVisit);
          activeVisit = remoteVisit;
          await _closeTravelLegForCheckedInVisit(
            attendance: remoteAttendance,
            visit: remoteVisit,
          );
          await TrackingService.pauseForSiteVisit(
            user: widget.user,
            visit: remoteVisit,
          );
        } else {
          await _clearLocalActiveVisitCache(remoteAttendance);
          activeVisit = null;
        }
      }
    }
    if (!mounted) return;
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'ATTENDANCE_ACTIVE_CHECK',
      error:
          'source=load attendance_id=${attendance?.remoteId ?? attendance?.id ?? '--'} active=${attendance?.isActive == true} remote_id=${attendance?.remoteId ?? '--'} button_enabled=${attendance?.isActive == true}',
    );
    setState(() {
      _attendance = attendance;
      _activeVisit = activeVisit;
    });
  }

  Future<SiteVisit?> _restoreRemoteActiveVisit(Attendance attendance) async {
    if (!SupabaseService.isReady) return null;
    final remoteVisit = await SupabaseService.findActiveSiteVisitForAttendance(
      user: widget.user,
      attendance: attendance,
    );
    if (remoteVisit == null) {
      await _clearLocalActiveVisitCache(attendance);
      if (mounted) setState(() => _activeVisit = null);
      return null;
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'REMOTE_ACTIVE_SITE_VISIT_FOUND',
      error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
    );
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'ACTIVE_SITE_VISIT_LOADED',
      error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
    );
    remoteVisit.synced = true;
    await LocalStore.saveVisit(remoteVisit);
    await _closeTravelLegForCheckedInVisit(
      attendance: attendance,
      visit: remoteVisit,
    );
    await TrackingService.pauseForSiteVisit(
      user: widget.user,
      visit: remoteVisit,
    );
    if (mounted) setState(() => _activeVisit = remoteVisit);
    return remoteVisit;
  }

  Future<void> _clearLocalActiveVisitCache(Attendance attendance) async {
    final attendanceIds = {
      if (attendance.remoteId?.trim().isNotEmpty == true)
        attendance.remoteId!.trim(),
      if (attendance.id.trim().isNotEmpty) attendance.id.trim(),
    };
    for (final attendanceId in attendanceIds) {
      await LocalStore.clearActiveVisitsForAttendance(attendanceId);
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'CHECKOUT_CACHE_CLEARED',
      error: 'attendance_id=${attendance.remoteId ?? attendance.id}',
    );
  }

  String _attendanceDateKey(Attendance attendance) {
    final value = attendance.attendanceDate?.trim();
    if (value != null && value.isNotEmpty) return value;
    return indiaDateKey(attendance.startTime);
  }

  Future<void> _clearPreviousDayLocalSession({
    required Attendance attendance,
    required String attendanceDate,
    required String todayKey,
    String cleanupAction = 'PREVIOUS_DAY_LOCAL_SESSION_CLEANUP',
  }) async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: '${cleanupAction}_STARTED',
      error:
          'attendance_id=${attendance.remoteId ?? attendance.id} attendance_date=$attendanceDate today=$todayKey active=${attendance.isActive}',
    );
    try {
      await TrackingService.stop(
        user: widget.user,
        updateRemoteLiveStatus: false,
        reason: 'attendance_date_mismatch',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'PREVIOUS_DAY_TRACKING_STOPPED',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'PREVIOUS_DAY_TRACKING_STOP_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
    await _clearLocalActiveVisitCache(attendance);
    await LocalStore.clearBackgroundTrackingSession();
    await LocalStore.saveAttendance(null);
    if (mounted) {
      setState(() {
        _attendance = null;
        _activeVisit = null;
      });
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: '${cleanupAction}_COMPLETE',
    );
  }

  Future<void> _checkIn() async {
    if (_busy) return;
    final perf = Stopwatch()..start();
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_CLICKED',
      );
      final attendance = await LocalStore.getAttendance();
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'attendance_load',
        stopwatch: perf,
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_ATTENDANCE_LOADED',
        error: 'remote_id=${attendance?.remoteId ?? '--'}',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'ATTENDANCE_ACTIVE_CHECK',
        error:
            'source=checkin attendance_id=${attendance?.remoteId ?? attendance?.id ?? '--'} active=${attendance?.isActive == true} remote_id=${attendance?.remoteId ?? '--'} end_time=${attendance?.endTime?.toIso8601String() ?? '--'}',
      );
      if (attendance?.isActive != true) {
        throw StateError('Please Start Day before checking into a store.');
      }
      if (!SupabaseService.isValidUuid(attendance?.remoteId)) {
        throw StateError('Attendance sync missing. Please restart Start Day.');
      }
      final activeAttendance = attendance!;
      _attendance = activeAttendance;
      final remoteActiveVisit = await _restoreRemoteActiveVisit(
        activeAttendance,
      );
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'active_visit_lookup',
        stopwatch: perf,
      );
      if (remoteActiveVisit != null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_OPEN_ACTIVE_VISIT_FOUND',
          error:
              'site_visit_id=${remoteActiveVisit.remoteId ?? remoteActiveVisit.id}',
        );
        _toast(
          'Already checked in at ${remoteActiveVisit.storeName}. Please check out before checking in again.',
        );
        return;
      }
      final localActiveVisit = await LocalStore.activeVisit(
        user: widget.user,
        attendance: activeAttendance,
      );
      if (localActiveVisit != null) {
        await _clearLocalActiveVisitCache(activeAttendance);
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_CACHE_CLEARED',
          error: 'stale_local_active_visit_id=${localActiveVisit.id}',
        );
      }

      final locationReadiness =
          await PermissionService.ensureForegroundLocation(
            employeeCode: widget.user.employeeCode,
            action: 'CHECKIN_LOCATION_READINESS',
          );
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'permission_check',
        stopwatch: perf,
      );
      if (!locationReadiness.allowed) {
        _toast(
          locationReadiness.message ??
              'Location/GPS is required before checking in.',
        );
        return;
      }

      late final Position position;
      try {
        position = await _captureCheckInPosition(perf);
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        await _showErrorDialog('Check In failed', error);
        return;
      }

      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_MATCH_START',
      );
      var nearby = await _loadNearbyStoresForCheckIn(
        position,
        forceRefresh: false,
      );
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'store_load',
        stopwatch: perf,
      );

      Store? store;
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_GEOFENCE_VALIDATE_START',
      );
      if (nearby.isNotEmpty) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_SITE_MATCH_FOUND',
        );
        final selected = await _selectNearbyStore(nearby, position);
        if (selected == null) return;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_EXISTING_SITE_CONFIRMED',
        );
        store = selected;
      } else {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_SITE_MATCH_NOT_FOUND',
        );
        nearby = await _loadNearbyStoresForCheckIn(
          position,
          forceRefresh: true,
        );
        PerformanceLogService.step(
          operation: 'check_in',
          step: 'store_forced_refresh',
          stopwatch: perf,
        );
        if (nearby.isNotEmpty) {
          final selected = await _selectNearbyStore(nearby, position);
          if (selected == null) return;
          store = selected;
        } else {
          final stores = await SupabaseService.fetchStoresWithGps();
          final diagnostic = _storeMatchResult(stores, position);
          if (!mounted) return;
          final action = await showDialog<_NoSiteFoundAction>(
            context: context,
            builder: (_) => _NoSiteFoundDialog(
              accuracyMeters: position.accuracy,
              nearest: diagnostic.diagnostics.nearestStore == null
                  ? null
                  : _NearbyStore.fromMatch(
                      diagnostic.diagnostics.nearestStore!,
                    ),
            ),
          );
          if (action == _NoSiteFoundAction.retryGps) {
            final retryPosition = await _captureCheckInPosition(perf);
            nearby = await _loadNearbyStoresForCheckIn(
              retryPosition,
              forceRefresh: false,
            );
            if (nearby.isEmpty) {
              nearby = await _loadNearbyStoresForCheckIn(
                retryPosition,
                forceRefresh: true,
              );
            }
            final selected = nearby.isEmpty
                ? null
                : await _selectNearbyStore(nearby, retryPosition);
            if (selected == null) return;
            store = selected;
          } else if (action == _NoSiteFoundAction.refresh) {
            nearby = await _loadNearbyStoresForCheckIn(
              position,
              forceRefresh: true,
            );
            if (nearby.isEmpty) return;
            final selected = await _selectNearbyStore(nearby, position);
            if (selected == null) return;
            store = selected;
          } else {
            return;
          }
        }
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_SITE_SELECTED_FOR_CHECKIN',
        error: 'store_id=${store.id} store=${store.storeName}',
      );
      await _recordRepeatSiteAllowedIfNeeded(store, activeAttendance);
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_SELECTED',
        error: 'store_id=${store.id} store=${store.storeName}',
      );
      if (store.latitude == null || store.longitude == null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_GEOFENCE_VALIDATE_SUCCESS',
          error: 'Site has no lat/lng; using current GPS as check-in point.',
        );
      } else {
        final distanceMeters = Geolocator.distanceBetween(
          position.latitude,
          position.longitude,
          store.latitude!,
          store.longitude!,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_GEOFENCE_VALIDATE_SUCCESS',
          error: 'distance_m=$distanceMeters',
        );
      }

      final visit = await _createVisit(store, position, activeAttendance);
      await _closeTravelLegForCheckedInVisit(
        attendance: activeAttendance,
        visit: visit,
        latitude: position.latitude,
        longitude: position.longitude,
      );
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'visit_create',
        stopwatch: perf,
      );
      await TrackingService.pauseForSiteVisit(
        user: widget.user,
        visit: visit,
        finalPosition: position,
      );
      PerformanceLogService.step(
        operation: 'check_in',
        step: 'tracking_pause',
        stopwatch: perf,
      );
      setState(() => _activeVisit = visit);
      _toast(
        nearby.isEmpty
            ? 'New site added and checked in: ${store.storeName}'
            : 'Checked in at ${store.storeName}',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (_isSessionExpiredError(error)) {
        _toast('Session expired. Please login again.');
        await widget.onLogout();
        return;
      }
      await _showErrorDialog('Check In failed', error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addSiteFromCheckIn() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final attendance = await LocalStore.getAttendance();
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'ATTENDANCE_ACTIVE_CHECK',
        error:
            'source=add_site attendance_id=${attendance?.remoteId ?? attendance?.id ?? '--'} active=${attendance?.isActive == true} remote_id=${attendance?.remoteId ?? '--'} end_time=${attendance?.endTime?.toIso8601String() ?? '--'}',
      );
      if (attendance?.isActive != true) {
        throw StateError('Please Start Day before adding a site.');
      }
      if (!SupabaseService.isValidUuid(attendance?.remoteId)) {
        throw StateError('Attendance sync missing. Please restart Start Day.');
      }
      final activeAttendance = attendance!;
      final remoteActiveVisit = await _restoreRemoteActiveVisit(
        activeAttendance,
      );
      if (remoteActiveVisit != null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_OPEN_ACTIVE_VISIT_FOUND',
          error:
              'site_visit_id=${remoteActiveVisit.remoteId ?? remoteActiveVisit.id}',
        );
        _toast(
          'Already checked in at ${remoteActiveVisit.storeName}. Please check out before adding another site.',
        );
        return;
      }
      final localActiveVisit = await LocalStore.activeVisit(
        user: widget.user,
        attendance: activeAttendance,
      );
      if (localActiveVisit != null) {
        await _clearLocalActiveVisitCache(activeAttendance);
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_CACHE_CLEARED',
          error: 'stale_local_active_visit_id=${localActiveVisit.id}',
        );
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_ADD_SITE_OPENED',
      );
      if (!mounted) return;
      final store = await showDialog<Store?>(
        context: context,
        builder: (_) => _AddStoreDialog(
          user: widget.user,
          attendance: activeAttendance,
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
        ),
      );
      if (store == null || !mounted) return;
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_SITE_SELECTED_FOR_CHECKIN',
        error: 'store_id=${store.id} store=${store.storeName}',
      );
      await _recordRepeatSiteAllowedIfNeeded(store, activeAttendance);
      final visit = await _createVisit(store, position, activeAttendance);
      await _closeTravelLegForCheckedInVisit(
        attendance: activeAttendance,
        visit: visit,
        latitude: position.latitude,
        longitude: position.longitude,
      );
      await TrackingService.pauseForSiteVisit(
        user: widget.user,
        visit: visit,
        finalPosition: position,
      );
      if (!mounted) return;
      setState(() => _activeVisit = visit);
      _toast('Added and checked in at ${store.storeName}');
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (_isSessionExpiredError(error)) {
        _toast('Session expired. Please login again.');
        await widget.onLogout();
        return;
      }
      await _showErrorDialog('Add Site failed', error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<SiteVisit> _createVisit(
    Store store,
    Position position,
    Attendance attendance,
  ) async {
    final origin = await _routeOriginForVisit(attendance);
    final destinationLat = store.latitude ?? position.latitude;
    final destinationLng = store.longitude ?? position.longitude;
    final isPayableTravel = attendance.payableKmAllowed;
    final routeDistance = !isPayableTravel || origin == null
        ? null
        : await RouteDistanceService.roadDistanceKm(
            employeeCode: widget.user.employeeCode,
            originLat: origin.lat,
            originLng: origin.lng,
            destinationLat: destinationLat,
            destinationLng: destinationLng,
          );
    final routeKm = isPayableTravel ? routeDistance?.routeKm : 0.0;
    if (routeKm != null && origin != null) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tracking',
        action: origin.source == 'start_day'
            ? 'ROUTE_LEG_CALCULATED_START_TO_SITE'
            : 'ROUTE_LEG_CALCULATED_SITE_TO_SITE',
        error:
            'attendance_id=${attendance.remoteId} origin=${origin.lat},${origin.lng} destination=$destinationLat,$destinationLng route_km=$routeKm',
      );
    } else if (origin != null && routeDistance != null) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tracking',
        action: 'ROUTE_LEG_NEEDS_REVIEW',
        error:
            'attendance_id=${attendance.remoteId} origin=${origin.lat},${origin.lng} destination=$destinationLat,$destinationLng status=${routeDistance.status}',
      );
    }
    final visit = SiteVisit(
      id: newLocalId('site-visit'),
      employeeCode: widget.user.employeeCode,
      attendanceId: attendance.remoteId,
      storeId: store.id,
      fullName: widget.user.fullName,
      storeName: store.storeName,
      clientName: store.clientName,
      storeCode: store.storeCode,
      state: store.state,
      business: store.business,
      checkInTime: DateTime.now(),
      currentLatitude: position.latitude,
      currentLongitude: position.longitude,
      currentGpsAccuracy: position.accuracy,
      checkInAccuracy: position.accuracy,
      originLatitude: origin?.lat,
      originLongitude: origin?.lng,
      destinationLatitude: destinationLat,
      destinationLongitude: destinationLng,
      routeKm: routeKm,
      metadata: !isPayableTravel
          ? {
              'distance_source': 'non_payable_travel_mode',
              'travel_mode': attendance.travelMode,
              'payable_km_allowed': false,
              'route_provider': 'none',
              'route_request_status': 'skipped_non_payable_travel_mode',
              'route_calculated_at': DateTime.now().toUtc().toIso8601String(),
              'route_origin_source': origin?.source ?? 'missing',
              'destination_lat': destinationLat,
              'destination_lng': destinationLng,
              'needs_review': false,
            }
          : routeDistance?.toMetadata(
                  routeOriginSource: origin?.source ?? 'missing',
                ) ??
                {
                  'distance_source': 'unavailable',
                  'route_provider': 'google',
                  'route_api': 'distance_matrix',
                  'route_request_status': 'missing_origin',
                  'route_calculated_at': DateTime.now()
                      .toUtc()
                      .toIso8601String(),
                  'route_origin_source': 'missing',
                  'destination_lat': destinationLat,
                  'destination_lng': destinationLng,
                  'needs_review': true,
                },
      status: 'Checked In',
    );
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'CHECKIN_SITE_VISIT_CREATE_START',
      error: 'attendance_id=${attendance.remoteId} store_id=${store.id}',
    );
    await LocalStore.saveVisit(visit);
    try {
      visit.remoteId = await SupabaseService.insertVisit(
        user: widget.user,
        visit: visit,
      );
      if (!SupabaseService.isValidUuid(visit.remoteId)) {
        throw StateError('Site visit sync failed. Check-in was not completed.');
      }
      visit.synced = true;
      await LocalStore.saveVisit(visit);
      await LocalDbService.saveRouteLeg(
        id: newLocalId('route-leg'),
        attendanceId: attendance.remoteId ?? attendance.id,
        siteVisitId: visit.remoteId ?? visit.id,
        originLat: origin?.lat,
        originLng: origin?.lng,
        destinationLat: destinationLat,
        destinationLng: destinationLng,
        routeKm: routeKm,
        source: !isPayableTravel
            ? 'check_in_non_payable_travel_mode'
            : origin == null
            ? 'check_in_no_origin'
            : 'check_in',
        calculatedAt: visit.checkInTime,
        syncStatus: routeKm == null ? 'pending' : 'synced',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_VISIT_CREATE_SUCCESS',
        error: 'site_visit_id=${visit.remoteId ?? '--'}',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_NEW_VISIT_CREATED',
        error: 'site_visit_id=${visit.remoteId ?? '--'}',
      );
    } catch (error, stackTrace) {
      await LocalStore.removeVisit(visit.id);
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'VISIT_INSERT_FAILED_LOCAL_ROLLBACK',
        error: 'local_visit_id=${visit.id}',
      );
      rethrow;
    }
    try {
      await _updateConveyanceKm(attendance, visit);
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tracking',
        action: 'CONVEYANCE_KM_UPDATE_FAILED',
        error: 'failed attendance_id=${attendance.remoteId}: $error',
        stackTrace: stackTrace,
      );
    }
    return visit;
  }

  Future<bool> _closeTravelLegForCheckedInVisit({
    required Attendance attendance,
    required SiteVisit visit,
    double? latitude,
    double? longitude,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!SupabaseService.isValidUuid(attendanceId)) return false;
    try {
      await _travelLegLifecycle.checkIn(
        attendanceId: attendanceId!,
        boundary: TravelLegBoundary(
          at: visit.checkInTime.toUtc(),
          latitude: latitude ?? visit.currentLatitude,
          longitude: longitude ?? visit.currentLongitude,
        ),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_TRAVEL_LEG_BOUNDARY_SYNCED',
        error:
            'attendance_id=$attendanceId site_visit_id=${visit.remoteId ?? visit.id}',
      );
      return true;
    } catch (error, stackTrace) {
      // The persisted active visit is the durable retry marker. _load() and
      // active-visit restoration retry this same idempotent leg boundary.
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_TRAVEL_LEG_BOUNDARY_PENDING',
        error:
            'attendance_id=$attendanceId site_visit_id=${visit.remoteId ?? visit.id} error=$error',
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  Future<void> _recordRepeatSiteAllowedIfNeeded(
    Store store,
    Attendance attendance,
  ) async {
    final attendanceId = attendance.remoteId?.trim().isNotEmpty == true
        ? attendance.remoteId!.trim()
        : attendance.id.trim();
    if (attendanceId.isEmpty) return;
    final storeId = store.id.trim();
    final storeCode = store.storeCode.trim().toLowerCase();
    final storeName = store.storeName.trim().toLowerCase();
    final hasCompletedVisit = (await LocalStore.getVisits()).any((visit) {
      if (visit.isActive || visit.attendanceId?.trim() != attendanceId) {
        return false;
      }
      final visitStoreId = visit.storeId?.trim();
      if (storeId.isNotEmpty && visitStoreId == storeId) return true;
      final visitStoreCode = visit.storeCode.trim().toLowerCase();
      if (storeCode.isNotEmpty && visitStoreCode == storeCode) return true;
      final visitStoreName = visit.storeName.trim().toLowerCase();
      return storeName.isNotEmpty && visitStoreName == storeName;
    });
    if (!hasCompletedVisit) return;
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'CHECKIN_REPEAT_SITE_ALLOWED_AFTER_CHECKOUT',
      error:
          'attendance_id=$attendanceId store_id=${store.id} store_code=${store.storeCode}',
    );
  }

  Future<void> _updateConveyanceKm(
    Attendance attendance,
    SiteVisit visit,
  ) async {
    if (!attendance.payableKmAllowed) {
      final preservedKm = _payableKmToPreserve(attendance);
      attendance
        ..totalRouteKm = preservedKm
        ..eligibleKm = preservedKm;
      await LocalStore.saveAttendance(attendance);
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tracking',
        action: 'CONVEYANCE_KM_SKIPPED_NON_PAYABLE_TRAVEL_MODE',
        error:
            'attendance_id=${attendance.remoteId} travel_mode=${attendance.travelMode}',
      );
      if (SupabaseService.isReady) {
        await SupabaseService.updateLiveStatus(
          user: widget.user,
          isTracking: false,
          status: 'On Site Visit',
          latitude: visit.currentLatitude,
          longitude: visit.currentLongitude,
          accuracy: visit.currentGpsAccuracy,
          routeKm: 0,
          attendanceId: attendance.remoteId,
          activeSiteVisitId: visit.remoteId,
        );
      }
      return;
    }
    final routeKm = await _routeKmFromVisits(attendance);
    attendance
      ..totalRouteKm = routeKm
      ..eligibleKm = routeKm;
    await LocalStore.saveAttendance(attendance);
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tracking',
      action: 'CONVEYANCE_KM_UPDATED',
      error: 'attendance_id=${attendance.remoteId} route_km=$routeKm',
    );
    if (SupabaseService.isReady) {
      await SupabaseService.updateAttendanceKm(attendance);
      await SupabaseService.updateLiveStatus(
        user: widget.user,
        isTracking: false,
        status: 'On Site Visit',
        latitude: visit.currentLatitude,
        longitude: visit.currentLongitude,
        accuracy: visit.currentGpsAccuracy,
        routeKm: attendance.eligibleKm,
        attendanceId: attendance.remoteId,
        activeSiteVisitId: visit.remoteId,
      );
    }
  }

  Future<double> _routeKmFromVisits(Attendance attendance) async {
    if (!attendance.payableKmAllowed) return _payableKmToPreserve(attendance);
    final attendanceId = attendance.remoteId?.trim().isNotEmpty == true
        ? attendance.remoteId!.trim()
        : attendance.id;
    final visits = await LocalStore.getVisits();
    var total = 0.0;
    for (final visit in visits) {
      final visitAttendanceId = visit.attendanceId?.trim();
      if (visitAttendanceId == null || visitAttendanceId.isEmpty) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tracking',
          action: 'ROUTE_KM_ORPHAN_VISIT_SKIPPED',
          error: 'visit_id=${visit.id}',
        );
        continue;
      }
      if (visitAttendanceId == attendanceId) {
        total += visit.routeKm ?? 0;
      }
    }
    return total;
  }

  double _payableKmToPreserve(Attendance attendance) {
    final existing =
        attendance.metadata['payable_km_preserved_before_mode_change'];
    if (existing is num && existing.isFinite && existing >= 0) {
      return double.parse(existing.toDouble().toStringAsFixed(2));
    }
    final km = attendance.eligibleKm > 0
        ? attendance.eligibleKm
        : attendance.totalRouteKm;
    return double.parse(km.clamp(0, double.infinity).toStringAsFixed(2));
  }

  Future<({double lat, double lng, String source})?> _routeOriginForVisit(
    Attendance attendance,
  ) async {
    final attendanceId = attendance.remoteId?.trim().isNotEmpty == true
        ? attendance.remoteId!.trim()
        : attendance.id;
    final visits =
        (await LocalStore.getVisits())
            .where((visit) => visit.attendanceId?.trim() == attendanceId)
            .toList()
          ..sort((a, b) => a.checkInTime.compareTo(b.checkInTime));
    for (final visit in visits.reversed) {
      final lat = visit.checkOutLatitude ?? visit.currentLatitude;
      final lng = visit.checkOutLongitude ?? visit.currentLongitude;
      if (_isValidLatLng(lat, lng)) {
        return (
          lat: lat!,
          lng: lng!,
          source: visit.checkOutLatitude == null ? 'site_checkin' : 'checkout',
        );
      }
    }
    if (_isValidLatLng(attendance.startLat, attendance.startLng)) {
      return (
        lat: attendance.startLat!,
        lng: attendance.startLng!,
        source: 'start_day',
      );
    }
    return null;
  }

  bool _isValidLatLng(double? latitude, double? longitude) {
    return latitude != null &&
        longitude != null &&
        latitude.isFinite &&
        longitude.isFinite &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
  }

  Future<Position> _captureCheckInPosition(Stopwatch perf) async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'CHECKIN_GPS_FETCH_START',
    );
    Position? bestReading;
    for (var attempt = 1; attempt <= 3; attempt += 1) {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      final sample = CheckInLocationSample(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracy,
        timestamp: position.timestamp,
      );
      final usable = CheckInStoreMatcher.hasUsableFreshLocation(
        sample,
        now: DateTime.now().toUtc(),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_GPS_READING',
        error:
            'attempt=$attempt accuracy=${position.accuracy.toStringAsFixed(1)} '
            'timestamp=${position.timestamp.toUtc().toIso8601String()} '
            'usable=$usable',
      );
      if (usable) {
        PerformanceLogService.step(
          operation: 'check_in',
          step: 'gps_capture',
          stopwatch: perf,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_GPS_FETCH_SUCCESS',
          error:
              'lat=${position.latitude} lng=${position.longitude} '
              'accuracy=${position.accuracy}',
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'SITE_VISIT_CHECKIN_GPS_CAPTURED',
          error:
              'lat=${position.latitude} lng=${position.longitude} '
              'accuracy=${position.accuracy}',
        );
        return position;
      }
      if (bestReading == null || position.accuracy < bestReading.accuracy) {
        bestReading = position;
      }
    }
    final accuracy = bestReading?.accuracy;
    final accuracyText = accuracy == null
        ? 'unavailable'
        : '${accuracy.toStringAsFixed(0)} m';
    throw StateError(
      'GPS accuracy is weak ($accuracyText). Please move to an open area and retry GPS.',
    );
  }

  Future<List<_NearbyStore>> _loadNearbyStoresForCheckIn(
    Position position, {
    required bool forceRefresh,
  }) async {
    final cacheSavedAt = await SupabaseService.storesWithGpsCacheSavedAt();
    final stores = await SupabaseService.fetchStoresWithGps(
      forceRefresh: forceRefresh,
    );
    final result = _storeMatchResult(stores, position);
    await _recordStoreMatchDiagnostics(
      result,
      forceRefresh: forceRefresh,
      cacheSavedAt: cacheSavedAt,
    );
    return result.nearby.map(_NearbyStore.fromMatch).toList();
  }

  CheckInStoreResult _storeMatchResult(
    Iterable<Store> stores,
    Position position,
  ) {
    return CheckInStoreMatcher.findNearbyStores(
      stores: stores,
      latitude: position.latitude,
      longitude: position.longitude,
    );
  }

  Future<void> _recordStoreMatchDiagnostics(
    CheckInStoreResult result, {
    required bool forceRefresh,
    required DateTime? cacheSavedAt,
  }) async {
    final diagnostics = result.diagnostics;
    final nearest = diagnostics.nearestStore;
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'CHECKIN_STORE_MATCH_DIAGNOSTICS',
      error:
          'source=${forceRefresh ? 'remote_force_refresh' : 'cache_or_remote'} '
          'cache_saved_at=${cacheSavedAt?.toIso8601String() ?? '--'} '
          'loaded=${diagnostics.totalLoaded} '
          'valid_gps=${diagnostics.validGpsStores} '
          'excluded_invalid_gps=${diagnostics.excludedInvalidCoordinates} '
          'nearby=${result.nearby.length} '
          'nearest_code=${nearest?.store.storeCode ?? '--'} '
          'nearest_distance=${nearest?.distanceMeters.toStringAsFixed(1) ?? '--'} '
          'nearest_radius=${nearest?.radiusMeters.toStringAsFixed(0) ?? '--'} '
          'forced_refresh=$forceRefresh',
    );
  }

  Future<Store?> _selectNearbyStore(
    List<_NearbyStore> nearby,
    Position position,
  ) async {
    if (!mounted) return null;
    final selected = nearby.length == 1
        ? nearby.first
        : await showModalBottomSheet<_NearbyStore?>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            backgroundColor: Colors.transparent,
            builder: (_) => _NearbySitesSheet(
              matches: nearby,
              isLoading: false,
              errorMessage: null,
            ),
          );
    if (selected == null || !mounted) return null;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _WelcomeSiteDialog(match: selected, accuracy: position.accuracy),
    );
    if (confirmed != true || !mounted) return null;
    return selected.store;
  }

  Future<void> _checkOut() async {
    if (_busy) return;
    final perf = Stopwatch()..start();
    var visit = _activeVisit;
    final attendance = await LocalStore.getAttendance();
    if (attendance?.isActive != true) return;
    PerformanceLogService.step(
      operation: 'check_out',
      step: 'attendance_load',
      stopwatch: perf,
    );
    setState(() => _busy = true);
    try {
      if (SupabaseService.isReady) {
        await SupabaseService.requireAuthenticatedSession(
          widget.user,
          screen: 'tasks',
          action: 'CHECKOUT_AUTH_SESSION_INVALID',
        );
        final remoteVisit =
            await SupabaseService.findActiveSiteVisitForAttendance(
              user: widget.user,
              attendance: attendance!,
            );
        PerformanceLogService.step(
          operation: 'check_out',
          step: 'active_visit_lookup',
          stopwatch: perf,
        );
        if (remoteVisit != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_ACTIVE_VISIT_FOUND',
            error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
          );
          remoteVisit.synced = true;
          await LocalStore.saveVisit(remoteVisit);
          visit = remoteVisit;
        } else {
          await _clearLocalActiveVisitCache(attendance);
          if (mounted) setState(() => _activeVisit = null);
          _toast('No active site visit found. Please refresh and try again.');
          return;
        }
      }
      if (visit == null) return;
      final locationReadiness =
          await PermissionService.ensureForegroundLocation(
            employeeCode: widget.user.employeeCode,
            action: 'CHECKOUT_LOCATION_READINESS',
          );
      PerformanceLogService.step(
        operation: 'check_out',
        step: 'permission_check',
        stopwatch: perf,
      );
      if (!locationReadiness.allowed) {
        _toast(
          locationReadiness.message ??
              'Location/GPS is required before checking out.',
        );
        return;
      }
      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 15),
          ),
        );
        PerformanceLogService.step(
          operation: 'check_out',
          step: 'gps_capture',
          stopwatch: perf,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'SITE_VISIT_CHECKOUT_GPS_CAPTURED',
          error:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_GPS_CAPTURED',
          error:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'SITE_VISIT_CHECKOUT_GPS_CAPTURE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        position = null;
      }
      if (position == null) {
        throw StateError('Current GPS is required before checking out.');
      }
      final checkoutDistance = _checkoutDistanceMeters(visit, position);
      if (checkoutDistance != null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_DISTANCE_CALCULATED',
          error:
              'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
        );
        if (checkoutDistance <= 100) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_WITHIN_GEOFENCE',
            error:
                'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
          );
        } else if (checkoutDistance <= 1000) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_AWAY_LOCATION_WARNING_SHOWN',
            error:
                'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
          );
          final confirmed = await _showNearWrongCheckoutDialog(
            visit,
            checkoutDistance,
          );
          if (confirmed != true) {
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'tasks',
              action: 'CHECKOUT_AWAY_LOCATION_CANCELLED',
              error:
                  'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
            );
            return;
          }
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_AWAY_LOCATION_CONFIRMED',
            error:
                'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
          );
        } else {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_FAR_WRONG_LOCATION_WARNING_SHOWN',
            error:
                'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
          );
          final confirmed = await _confirmFarWrongCheckout(
            visit,
            checkoutDistance,
          );
          if (confirmed != true) {
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'tasks',
              action: 'CHECKOUT_FAR_WRONG_LOCATION_CANCELLED',
              error:
                  'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
            );
            return;
          }
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'tasks',
            action: 'CHECKOUT_FAR_WRONG_LOCATION_CONFIRMED',
            error:
                'site_visit_id=${visit.remoteId ?? visit.id} distance_m=$checkoutDistance',
          );
        }
      }
      final previousCheckOutTime = visit.checkOutTime;
      final previousCheckOutLatitude = visit.checkOutLatitude;
      final previousCheckOutLongitude = visit.checkOutLongitude;
      final previousCheckOutAccuracy = visit.checkOutAccuracy;
      final previousCheckOutDistanceMeters = visit.checkOutDistanceMeters;
      final previousCheckOutLocationStatus = visit.checkOutLocationStatus;
      final previousCheckOutNote = visit.checkOutNote;
      final previousPetrolEligibleAfterCheckout =
          visit.petrolEligibleAfterCheckout;
      final previousPetrolPenaltyDistanceMeters =
          visit.petrolPenaltyDistanceMeters;
      final previousDurationMinutes = visit.durationMinutes;
      final previousStatus = visit.status;
      final awayCheckout = checkoutDistance != null && checkoutDistance > 100;
      final end = DateTime.now();
      visit
        ..checkOutTime = end
        ..checkOutLatitude = position.latitude
        ..checkOutLongitude = position.longitude
        ..checkOutAccuracy = position.accuracy
        ..checkOutDistanceMeters = checkoutDistance
        ..checkOutLocationStatus = awayCheckout ? 'wrong_location' : 'valid'
        ..checkOutNote = awayCheckout
            ? 'FO checked out more than 100 m away from checked-in site'
            : null
        ..petrolEligibleAfterCheckout = !awayCheckout
        ..petrolPenaltyDistanceMeters = awayCheckout ? checkoutDistance : 0
        ..durationMinutes = end.difference(visit.checkInTime).inMinutes
        ..status = 'Checked Out';
      try {
        await SupabaseService.updateVisitCheckout(
          user: widget.user,
          visit: visit,
        );
        PerformanceLogService.step(
          operation: 'check_out',
          step: 'visit_checkout_update',
          stopwatch: perf,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_UPDATE_SUCCESS',
          error: 'site_visit_id=${visit.remoteId ?? visit.id}',
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: awayCheckout
              ? 'CHECKOUT_WRONG_LOCATION_UPDATE_SUCCESS'
              : 'CHECKOUT_VALID_UPDATE_SUCCESS',
          error:
              'site_visit_id=${visit.remoteId ?? visit.id} distance_m=${checkoutDistance ?? 0}',
        );
      } catch (error, stackTrace) {
        visit
          ..checkOutTime = previousCheckOutTime
          ..checkOutLatitude = previousCheckOutLatitude
          ..checkOutLongitude = previousCheckOutLongitude
          ..checkOutAccuracy = previousCheckOutAccuracy
          ..checkOutDistanceMeters = previousCheckOutDistanceMeters
          ..checkOutLocationStatus = previousCheckOutLocationStatus
          ..checkOutNote = previousCheckOutNote
          ..petrolEligibleAfterCheckout = previousPetrolEligibleAfterCheckout
          ..petrolPenaltyDistanceMeters = previousPetrolPenaltyDistanceMeters
          ..durationMinutes = previousDurationMinutes
          ..status = previousStatus;
        await LocalStore.saveVisit(visit);
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_SYNC_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        if (_isSessionExpiredError(error)) {
          _toast('Session expired. Please login again.');
          await widget.onLogout();
          return;
        }
        _toast(
          'Checkout sync failed. Please check internet and tap Retry Checkout.',
        );
        final action = await _showCheckoutSyncFailureDialog();
        if (action == _CheckoutRecoveryAction.fixState) {
          try {
            final result = await AppStateSyncService.syncNow(widget.user);
            _toast(result.message);
            await _load();
          } catch (_) {
            _toast('Sync failed. Please check internet and try again.');
          }
        } else if (action == _CheckoutRecoveryAction.retry) {
          Future<void>.delayed(const Duration(milliseconds: 250), () {
            if (mounted) _checkOut();
          });
        }
        return;
      }
      await LocalStore.saveVisit(visit);
      await _clearLocalActiveVisitCache(attendance!);
      await _travelLegLifecycle.checkOut(
        attendanceId: attendance.remoteId!,
        employeeCode: widget.user.employeeCode,
        mode: attendance.travelMode,
        boundary: TravelLegBoundary(
          at: visit.checkOutTime!.toUtc(),
          latitude: position.latitude,
          longitude: position.longitude,
        ),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKOUT_ACTIVE_STATE_CLEARED',
        error: 'site_visit_id=${visit.remoteId ?? visit.id}',
      );
      if (_isValidLatLng(visit.checkOutLatitude, visit.checkOutLongitude)) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tracking',
          action: 'ROUTE_ORIGIN_UPDATED_ON_CHECKOUT',
          error:
              'site_visit_id=${visit.remoteId ?? visit.id} origin=${visit.checkOutLatitude},${visit.checkOutLongitude}',
        );
      }
      if (attendance.isActive) {
        final activeAttendance = attendance;
        await TrackingService.resumeAfterSiteCheckout(
          user: widget.user,
          attendance: activeAttendance,
          checkoutPosition: position,
          checkoutCapturedAt: visit.checkOutTime?.add(
            const Duration(milliseconds: 1),
          ),
          onLog: (_, _) {},
        );
        PerformanceLogService.step(
          operation: 'check_out',
          step: 'tracking_resume',
          stopwatch: perf,
        );
      }
      setState(() => _activeVisit = null);
      _toast('Checked out successfully');
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKOUT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (_isSessionExpiredError(error)) {
        _toast('Session expired. Please login again.');
        await widget.onLogout();
        return;
      }
      _toast('Check Out failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _isSessionExpiredError(Object error) {
    return error.toString().contains('Session expired. Please login again.');
  }

  double? _checkoutDistanceMeters(SiteVisit visit, Position position) {
    final siteLatitude =
        _isValidLatLng(visit.destinationLatitude, visit.destinationLongitude)
        ? visit.destinationLatitude
        : visit.currentLatitude;
    final siteLongitude =
        _isValidLatLng(visit.destinationLatitude, visit.destinationLongitude)
        ? visit.destinationLongitude
        : visit.currentLongitude;
    if (!_isValidLatLng(siteLatitude, siteLongitude)) return null;
    return Geolocator.distanceBetween(
      siteLatitude!,
      siteLongitude!,
      position.latitude,
      position.longitude,
    );
  }

  Future<bool?> _showNearWrongCheckoutDialog(
    SiteVisit visit,
    double distanceMeters,
  ) async {
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Checkout Away From Site'),
        content: Text(
          'You are ${(distanceMeters / 1000).toStringAsFixed(2)} km away from the checked-in site. This distance from site to your current location will not be added to payable KM/petrol. Continue checkout?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Continue Checkout'),
          ),
        ],
      ),
    );
  }

  Future<bool?> _confirmFarWrongCheckout(
    SiteVisit visit,
    double distanceMeters,
  ) async {
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Wrong Checkout Location'),
        content: Text(
          'You are ${(distanceMeters / 1000).toStringAsFixed(2)} km away from the checked-in site. You can continue checkout, but this distance from site to your current location will not be added to payable KM/petrol.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Continue Checkout'),
          ),
        ],
      ),
    );
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showErrorDialog(String title, Object error) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: SelectableText(error.toString()),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<_CheckoutRecoveryAction?> _showCheckoutSyncFailureDialog() async {
    if (!mounted) return null;
    return showDialog<_CheckoutRecoveryAction>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Checkout Sync Failed'),
        content: const Text(
          'Your checkout was not saved to the server. The active visit is kept safely. Please check internet and retry, or refresh app state from the server.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
          TextButton(
            onPressed: () =>
                Navigator.of(context).pop(_CheckoutRecoveryAction.fixState),
            child: const Text('Fix App State'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(context).pop(_CheckoutRecoveryAction.retry),
            child: const Text('Retry Checkout'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final activeDay = _attendance?.isActive == true;
    return Scaffold(
      body: FoPage(
        children: [
          const FoHeader(
            title: 'My Tasks',
            subtitle: 'Perform tasks at the site',
          ),
          const SizedBox(height: 18),
          _currentSiteCard(activeDay),
          const SizedBox(height: 18),
          _activitySection(),
          const SizedBox(height: 18),
          _howItWorksCard(),
        ],
      ),
    );
  }

  Widget _currentSiteCard(bool activeDay) {
    final visit = _activeVisit;
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: const [
              FoIconCircle(
                icon: Icons.location_on_outlined,
                color: qpmsBlue,
                size: 34,
                iconSize: 22,
              ),
              SizedBox(width: 10),
              Text(
                'Current Site',
                style: TextStyle(
                  color: foNavy,
                  fontWeight: FontWeight.w900,
                  fontSize: 16,
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              FoIconCircle(
                icon: visit == null
                    ? Icons.storefront_outlined
                    : Icons.storefront_rounded,
                color: qpmsBlue,
                size: 70,
                iconSize: 38,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      visit?.storeName ?? 'No Site Selected',
                      style: const TextStyle(
                        color: foNavy,
                        fontSize: 21,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      visit == null
                          ? 'Check-in to a site to start your task'
                          : '${visit.clientName} • ${visit.state}',
                      style: const TextStyle(
                        color: Color(0xFF53607D),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.location_on_outlined,
                          color: qpmsBlue,
                          size: 18,
                        ),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            visit == null
                                ? 'Select a site to view address'
                                : 'Checked in ${formatTime(visit.checkInTime)}',
                            style: const TextStyle(
                              color: Color(0xFF53607D),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (visit?.routeKm != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Last Site Travel KM: ${visit!.routeKm!.toStringAsFixed(2)} km',
                        style: const TextStyle(
                          color: qpmsBlue,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (visit != null)
                const FoStatusBadge(label: 'Checked In', color: foGreen),
            ],
          ),
          const SizedBox(height: 22),
          if (!activeDay)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Text(
                'Please Start Day before checking into a store.',
                textAlign: TextAlign.center,
                style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
              ),
            ),
          if (visit == null) ...[
            FoPrimaryButton(
              label: 'Check-In to Site',
              icon: Icons.qr_code_scanner_rounded,
              onPressed: _busy || !activeDay ? null : _checkIn,
            ),
            const SizedBox(height: 10),
            FoOutlinedButton(
              label: '+ Add Site',
              icon: Icons.add_location_alt_outlined,
              onPressed: _busy || !activeDay ? null : _addSiteFromCheckIn,
            ),
            const SizedBox(height: 12),
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.shield_outlined, color: qpmsMuted, size: 18),
                SizedBox(width: 6),
                Flexible(
                  child: Text(
                    'You need to check-in to perform any activity',
                    style: TextStyle(
                      color: qpmsMuted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ] else
            FoOutlinedButton(
              label: 'Check-Out',
              icon: Icons.logout_rounded,
              onPressed: _busy ? null : _checkOut,
            ),
        ],
      ),
    );
  }

  Widget _activitySection() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(
            title: 'Select Activity',
            subtitle: 'Choose the activity you will be performing at the site',
          ),
          const SizedBox(height: 18),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = (constraints.maxWidth - 12) / 2;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _activityCard(
                    width: width,
                    title: 'Inspection',
                    subtitle: _activeVisit == null
                        ? 'Check-in required'
                        : 'Upload photos',
                    icon: Icons.content_paste_search_rounded,
                    color: _activeVisit == null ? qpmsMuted : qpmsBlue,
                    enabled: _activeVisit != null,
                    disabledBadgeLabel: 'Check-In Required',
                    onTap: _activeVisit == null
                        ? () => _toast('Please check-in to a site first.')
                        : () => _openActivity(FoActivityType.inspection),
                  ),
                  _activityCard(
                    width: width,
                    title: 'Deep Cleaning',
                    subtitle: _activeVisit == null
                        ? 'Check-in required'
                        : 'Add cleaning details',
                    icon: Icons.cleaning_services_rounded,
                    color: _activeVisit == null ? qpmsMuted : foGreen,
                    enabled: _activeVisit != null,
                    disabledBadgeLabel: 'Check-In Required',
                    onTap: _activeVisit == null
                        ? () => _toast('Please check-in to a site first.')
                        : () => _openActivity(FoActivityType.deepCleaning),
                  ),
                  _activityCard(
                    width: width,
                    title: 'Training',
                    subtitle: _activeVisit == null
                        ? 'Check-in required'
                        : 'Add training proof',
                    icon: Icons.co_present_rounded,
                    color: _activeVisit == null ? qpmsMuted : foPurple,
                    enabled: _activeVisit != null,
                    disabledBadgeLabel: 'Check-In Required',
                    onTap: _activeVisit == null
                        ? () => _toast('Please check-in to a site first.')
                        : () => _openActivity(FoActivityType.training),
                  ),
                  _activityCard(
                    width: width,
                    title: 'Pest Control',
                    subtitle: 'Coming Soon',
                    icon: Icons.shield_outlined,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
                  ),
                  _activityCard(
                    width: width,
                    title: 'Maintenance',
                    subtitle: 'Coming Soon',
                    icon: Icons.build_outlined,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
                  ),
                  _activityCard(
                    width: width,
                    title: 'Audit',
                    subtitle: 'Coming Soon',
                    icon: Icons.assignment_turned_in_outlined,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: qpmsBlue.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, color: qpmsBlue),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Check-in to a site to enable activity selection and task execution.',
                    style: TextStyle(
                      color: Color(0xFF445174),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _activityCard({
    required double width,
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required bool enabled,
    String disabledBadgeLabel = 'Coming Soon',
    VoidCallback? onTap,
  }) {
    return SizedBox(
      width: width,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Opacity(
          opacity: enabled ? 1 : 0.55,
          child: Container(
            height: 192,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: foBorder),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0B0A43D1),
                  blurRadius: 14,
                  offset: Offset(0, 7),
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                FoIconCircle(icon: icon, color: color, size: 66, iconSize: 34),
                const SizedBox(height: 12),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 7),
                Flexible(
                  child: Text(
                    subtitle,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: enabled ? const Color(0xFF53607D) : qpmsMuted,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                      height: 1.25,
                    ),
                  ),
                ),
                if (enabled)
                  const Align(
                    alignment: Alignment.centerRight,
                    child: Icon(Icons.chevron_right_rounded, color: foNavy),
                  )
                else
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: qpmsMuted.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: qpmsMuted.withValues(alpha: 0.28),
                      ),
                    ),
                    child: Text(
                      disabledBadgeLabel,
                      style: TextStyle(
                        color: qpmsMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _howItWorksCard() {
    const steps = [
      (Icons.location_on_outlined, 'Check-In', 'Check-in to a site to start'),
      (Icons.assignment_outlined, 'Select Activity', 'Choose the activity'),
      (Icons.camera_alt_outlined, 'Complete Task', 'Add details and photos'),
      (Icons.check_circle_outline, 'Check-Out', 'Review and check-out'),
    ];
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(title: 'How It Works'),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var index = 0; index < steps.length; index += 1) ...[
                Expanded(
                  child: Column(
                    children: [
                      FoIconCircle(
                        icon: steps[index].$1,
                        color: qpmsBlue,
                        size: 58,
                        iconSize: 29,
                      ),
                      const SizedBox(height: 8),
                      CircleAvatar(
                        radius: 11,
                        backgroundColor: qpmsBlue,
                        child: Text(
                          '${index + 1}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        steps[index].$2,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: foNavy,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        steps[index].$3,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF53607D),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (index != steps.length - 1)
                  const Padding(
                    padding: EdgeInsets.only(top: 28),
                    child: Icon(Icons.arrow_forward_rounded, color: qpmsBlue),
                  ),
              ],
            ],
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: qpmsBlue.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, color: qpmsBlue),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Check-out once all activities at the site are completed.',
                    style: TextStyle(
                      color: Color(0xFF445174),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openActivity(FoActivityType type) async {
    final visit = _activeVisit;
    final attendance = _attendance ?? await LocalStore.getAttendance();
    if (visit == null || attendance?.isActive != true) {
      _toast('Please check-in to a site first.');
      return;
    }
    if (!mounted) return;
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ActivityFormScreen(
          type: type,
          visit: visit,
          attendance: attendance!,
          user: widget.user,
        ),
      ),
    );
    if (submitted == true && mounted) {
      _toast('Activity submitted successfully.');
    }
  }

  void _showComingSoon() {
    _toast('Coming Soon');
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  bool get wantKeepAlive => true;
}

enum FoActivityType { inspection, deepCleaning, training }

class ActivityFormScreen extends StatefulWidget {
  const ActivityFormScreen({
    required this.type,
    required this.visit,
    required this.attendance,
    required this.user,
    this.requireActiveVisit = true,
    super.key,
  });

  final FoActivityType type;
  final SiteVisit visit;
  final Attendance attendance;
  final FoUser user;
  final bool requireActiveVisit;

  @override
  State<ActivityFormScreen> createState() => _ActivityFormScreenState();
}

class _ActivityFormScreenState extends State<ActivityFormScreen> {
  final _picker = ImagePicker();
  final _remarks = TextEditingController();
  final _hkEmpId = TextEditingController();
  final _hkName = TextEditingController();
  final List<XFile> _photos = [];
  final List<_CleaningArea> _areas = [_CleaningArea()];
  final List<_TrainingStaff> _hkStaff = [];
  final Map<String, List<XFile>> _trainingPhotos = {};
  final Map<String, List<_ExistingActivityUpload>> _existingTrainingUploads =
      {};
  PlatformFile? _pdf;
  bool _submitting = false;
  String? _submitStep;
  int _uploadedCount = 0;
  int _uploadTotal = 0;
  int _nextUploadKey = 1;
  String? _lastSubmissionId;
  bool _loadingExistingTraining = false;
  bool _draftSaved = false;
  bool _existingTrainingDocument = false;
  final Expando<String> _uploadObjectKeys = Expando<String>(
    'activity_upload_object_keys',
  );
  final Set<String> _completedUploadKeys = <String>{};

  static const List<_TrainingCategory> _trainingCategories = [
    _TrainingCategory(
      key: 'fo_briefing',
      label: 'FO Briefing',
      icon: Icons.record_voice_over_rounded,
      color: Color(0xFF10B981),
    ),
    _TrainingCategory(
      key: 'glass_cleaning',
      label: 'Glass Cleaning',
      icon: Icons.cleaning_services_rounded,
      color: Color(0xFF3B82F6),
    ),
    _TrainingCategory(
      key: 'floor_cleaning_mop',
      label: 'Floor Cleaning with Mop',
      icon: Icons.cleaning_services_rounded,
      color: foPurple,
    ),
    _TrainingCategory(
      key: 'floor_cleaning_ec_mop',
      label: 'Floor Cleaning with EC Mop',
      icon: Icons.cleaning_services_rounded,
      color: Color(0xFFF97316),
    ),
    _TrainingCategory(
      key: 'toilet_cleaning',
      label: 'Toilet Cleaning',
      icon: Icons.wc_rounded,
      color: Color(0xFFEC4899),
    ),
    _TrainingCategory(
      key: 'cobweb_cleaning',
      label: 'Cobweb Cleaning',
      icon: Icons.cyclone_rounded,
      color: Color(0xFF0891B2),
    ),
  ];

  @override
  void initState() {
    super.initState();
    if (widget.type == FoActivityType.training) {
      _loadExistingTraining();
    }
  }

  @override
  void dispose() {
    _remarks.dispose();
    _hkEmpId.dispose();
    _hkName.dispose();
    super.dispose();
  }

  _ActivitySpec get _spec {
    switch (widget.type) {
      case FoActivityType.inspection:
        return const _ActivitySpec(
          title: 'Inspection',
          subtitle: 'Record site inspection details',
          icon: Icons.content_paste_search_rounded,
          color: qpmsBlue,
        );
      case FoActivityType.deepCleaning:
        return const _ActivitySpec(
          title: 'Deep Cleaning',
          subtitle: 'Record before & after cleaning photos',
          icon: Icons.cleaning_services_rounded,
          color: foGreen,
        );
      case FoActivityType.training:
        return const _ActivitySpec(
          title: 'Training',
          subtitle: 'Complete training tasks and upload proofs',
          icon: Icons.co_present_rounded,
          color: foPurple,
        );
    }
  }

  Future<void> _addPhotos() async {
    final files = await _picker.pickMultiImage(
      maxWidth: _activityImageMaxDimension,
      maxHeight: _activityImageMaxDimension,
      imageQuality: _activityImageQuality,
    );
    if (files.isEmpty || !mounted) return;
    setState(() => _photos.addAll(files));
  }

  Future<void> _pickAreaImage(
    _CleaningArea area, {
    required bool before,
  }) async {
    final file = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: _activityImageMaxDimension,
      maxHeight: _activityImageMaxDimension,
      imageQuality: _activityImageQuality,
    );
    if (file == null || !mounted) return;
    setState(() {
      if (before) {
        area.before = file;
      } else {
        area.after = file;
      }
    });
  }

  Future<void> _pickPdf() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: false,
    );
    if (result == null || result.files.isEmpty || !mounted) return;
    setState(() => _pdf = result.files.first);
  }

  Future<void> _pickTrainingCategoryPhoto(_TrainingCategory category) async {
    final files = await _picker.pickMultiImage(
      maxWidth: _activityImageMaxDimension,
      maxHeight: _activityImageMaxDimension,
      imageQuality: _activityImageQuality,
    );
    if (files.isEmpty || !mounted) return;
    setState(() {
      final rows = _trainingPhotos.putIfAbsent(category.key, () => []);
      rows.addAll(files);
    });
  }

  Future<void> _loadExistingTraining() async {
    if (!SupabaseService.isReady) return;
    setState(() => _loadingExistingTraining = true);
    try {
      final existing = await SupabaseService.findActivitySubmission(
        user: widget.user,
        visit: widget.visit,
        activityType: 'training',
      );
      if (!mounted) return;
      _existingTrainingUploads.clear();
      _existingTrainingDocument = false;
      _hkStaff.clear();

      final metadata = existing?['metadata'];
      if (metadata is Map) {
        final rows = metadata['hk_staff_attended'];
        if (rows is List) {
          for (final row in rows) {
            if (row is! Map) continue;
            final empId = row['emp_id']?.toString().trim() ?? '';
            final name = row['name']?.toString().trim() ?? '';
            if (empId.isEmpty && name.isEmpty) continue;
            _hkStaff.add(_TrainingStaff(empId: empId, name: name));
          }
        }
      }

      final submissionId = existing?['id']?.toString();
      if (SupabaseService.isValidUuid(submissionId)) {
        final uploads = await SupabaseService.fetchActivityUploadsForSubmission(
          submissionId!,
        );
        for (final upload in uploads) {
          final uploadMetadata = upload['metadata'];
          final metadataMap = uploadMetadata is Map ? uploadMetadata : const {};
          final role = upload['upload_role']?.toString() ?? '';
          final isDocument =
              role == 'training_document' ||
              metadataMap['training_document'] == true;
          if (isDocument) {
            _existingTrainingDocument = true;
          }
          final categoryKey = isDocument
              ? 'training_document'
              : (metadataMap['training_category']
                            ?.toString()
                            .trim()
                            .isNotEmpty ==
                        true
                    ? metadataMap['training_category'].toString().trim()
                    : 'training_photo');
          final fileUrl = upload['file_url']?.toString() ?? '';
          final signedUrl = fileUrl.isEmpty
              ? null
              : await SupabaseService.signedActivityUploadUrl(fileUrl);
          final row = _ExistingActivityUpload(
            id: upload['id']?.toString() ?? fileUrl,
            fileUrl: fileUrl,
            fileName: upload['file_name']?.toString() ?? 'Training upload',
            fileType: upload['file_type']?.toString() ?? '',
            signedUrl: signedUrl,
          );
          _existingTrainingUploads.putIfAbsent(categoryKey, () => []).add(row);
        }
      }
      if (!mounted) return;
      setState(() {
        _draftSaved = existing?['status']?.toString().toLowerCase() == 'draft';
      });
    } catch (_) {
      if (mounted) {
        _snack('Unable to load existing training draft right now.');
      }
    } finally {
      if (mounted) setState(() => _loadingExistingTraining = false);
    }
  }

  int get _trainingCompletedCategoryCount {
    var count = 0;
    for (final category in _trainingCategories) {
      final localCount = _trainingPhotos[category.key]?.length ?? 0;
      final existingCount = _existingTrainingUploads[category.key]?.length ?? 0;
      if (localCount + existingCount > 0) count += 1;
    }
    return count;
  }

  int get _trainingDocumentCount =>
      (_pdf == null ? 0 : 1) + (_existingTrainingDocument ? 1 : 0);

  bool get _hasExistingTrainingEvidence =>
      _trainingCompletedCategoryCount > 0 || _trainingDocumentCount > 0;

  Map<String, dynamic> _trainingMetadata({required bool pendingImages}) {
    final completedCategories = _trainingCategories
        .where(
          (category) =>
              (_trainingPhotos[category.key]?.isNotEmpty == true) ||
              (_existingTrainingUploads[category.key]?.isNotEmpty == true),
        )
        .map((category) => category.key)
        .toList();
    return {
      'hk_staff_attended': _hkStaff.map((row) => row.toJson()).toList(),
      'training_categories_total': _trainingCategories.length,
      'training_categories_completed': completedCategories,
      'training_categories_completed_count': completedCategories.length,
      'training_document_uploaded': _trainingDocumentCount > 0,
      'pending_images': pendingImages,
      'training_pending_category_keys': _trainingCategories
          .where((category) => !completedCategories.contains(category.key))
          .map((category) => category.key)
          .toList(),
    };
  }

  void _addHkStaff() {
    final empId = _hkEmpId.text.trim();
    final name = _hkName.text.trim();
    if (empId.isEmpty && name.isEmpty) {
      _snack('Enter HK staff ID or name to add.');
      return;
    }
    setState(() {
      _hkStaff.add(_TrainingStaff(empId: empId, name: name));
      _hkEmpId.clear();
      _hkName.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final spec = _spec;
    return PopScope(
      canPop: !_submitting,
      child: Scaffold(
        body: FoPage(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: _submitting
                      ? null
                      : () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back_rounded, color: qpmsBlue),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        spec.title,
                        style: const TextStyle(
                          color: foNavy,
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        spec.subtitle,
                        style: const TextStyle(
                          color: Color(0xFF53607D),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(spec.icon, color: spec.color, size: 34),
              ],
            ),
            const SizedBox(height: 18),
            _siteInfo(),
            const SizedBox(height: 14),
            if (widget.type == FoActivityType.inspection) _inspectionBody(),
            if (widget.type == FoActivityType.deepCleaning) _cleaningBody(),
            if (widget.type == FoActivityType.training) _trainingBody(),
            if (widget.type != FoActivityType.training) ...[
              const SizedBox(height: 14),
              _remarksCard(optional: true),
            ],
            const SizedBox(height: 20),
            if (widget.type == FoActivityType.training) ...[
              _trainingSubmitNote(),
              const SizedBox(height: 14),
            ],
            if (_submitting) ...[_submitProgress(), const SizedBox(height: 14)],
            Row(
              children: [
                Expanded(
                  child: FoOutlinedButton(
                    label: widget.type == FoActivityType.training
                        ? 'Save Draft'
                        : 'Save as Draft',
                    onPressed: _submitting
                        ? null
                        : widget.type == FoActivityType.training
                        ? _saveTrainingDraft
                        : () => _snack('Draft saved locally for this session.'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FoPrimaryButton(
                    label: _submitting
                        ? 'Submitting...'
                        : widget.type == FoActivityType.training
                        ? 'Submit Training'
                        : 'Submit',
                    icon: Icons.check_rounded,
                    onPressed: _submitting ? null : _submitActivity,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitActivity() async {
    await _persistActivity(
      targetStatus: 'submitted',
      requireTrainingEvidence: widget.type == FoActivityType.training,
      popOnSuccess: true,
    );
  }

  Widget _submitProgress() {
    final step = _submitStep ?? 'Submitting activity';
    final suffix = _uploadTotal > 0 && !step.contains(' of ')
        ? ' ($_uploadedCount/$_uploadTotal)'
        : '';
    return Row(
      children: [
        const SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '$step$suffix',
            style: const TextStyle(
              color: qpmsMuted,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  void _setSubmitStep(String step, {int? uploadedCount, int? uploadTotal}) {
    if (!mounted) return;
    setState(() {
      _submitStep = step;
      if (uploadedCount != null) _uploadedCount = uploadedCount;
      if (uploadTotal != null) _uploadTotal = uploadTotal;
    });
  }

  Future<void> _saveTrainingDraft() async {
    await _persistActivity(
      targetStatus: 'draft',
      requireTrainingEvidence: false,
      popOnSuccess: false,
    );
  }

  Future<void> _persistActivity({
    required String targetStatus,
    required bool requireTrainingEvidence,
    required bool popOnSuccess,
  }) async {
    if (_submitting) return;
    final perf = Stopwatch()..start();
    final remarks = _remarks.text.trim();
    if (!SupabaseService.isReady) {
      _snack(
        'Activity submission requires internet. Please try again once online.',
      );
      return;
    }
    if (!SupabaseService.isValidUuid(widget.attendance.remoteId)) {
      _snack('Please Start Day before submitting activity.');
      return;
    }
    if (!SupabaseService.isValidUuid(widget.visit.remoteId)) {
      _snack('Site visit sync missing. Please refresh and try again.');
      return;
    }
    if (widget.requireActiveVisit && widget.visit.isActive != true) {
      _snack('Please check-in to a site before submitting activity.');
      return;
    }

    setState(() {
      _submitting = true;
      _submitStep = 'Preparing activity';
      _uploadedCount = 0;
      _uploadTotal = 0;
    });
    String? submissionId;
    final orphanedUploadUrls = <String>[];
    var successfulUploads = 0;
    var failedUploads = 0;
    try {
      final activityType = _activityTypeValue(widget.type);
      final uploadSources = _activityUploadSources()
          .where((source) => !_completedUploadKeys.contains(source.key))
          .toList();
      _setSubmitStep('Capturing location', uploadTotal: uploadSources.length);
      PerformanceLogService.step(
        operation: 'activity_submission',
        step: 'upload_plan',
        stopwatch: perf,
      );
      final hasExistingTrainingEvidence = widget.type == FoActivityType.training
          ? _hasExistingTrainingEvidence
          : false;
      if (requireTrainingEvidence &&
          widget.type == FoActivityType.training &&
          uploadSources.isEmpty &&
          !hasExistingTrainingEvidence) {
        _snack(
          'Please upload at least one training photo or document before submitting.',
        );
        return;
      }
      final hasCompletedUploadsThisSession = _completedUploadKeys.isNotEmpty;
      final pendingImages = widget.type == FoActivityType.training
          ? _trainingCompletedCategoryCount == 0
          : uploadSources.isEmpty && !hasCompletedUploadsThisSession;
      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 10),
          ),
        );
      } catch (_) {
        position = null;
      }
      PerformanceLogService.step(
        operation: 'activity_submission',
        step: 'gps_capture',
        stopwatch: perf,
      );

      _setSubmitStep('Saving activity');
      final existing = await SupabaseService.findActivitySubmission(
        user: widget.user,
        visit: widget.visit,
        activityType: activityType,
      );
      PerformanceLogService.step(
        operation: 'activity_submission',
        step: 'submission_lookup',
        stopwatch: perf,
      );
      submissionId = SupabaseService.isValidUuid(_lastSubmissionId)
          ? _lastSubmissionId
          : existing?['id']?.toString();
      final metadata = Map<String, dynamic>.from(
        existing?['metadata'] is Map ? existing!['metadata'] as Map : const {},
      );
      final existingStatus = existing?['status']
          ?.toString()
          .trim()
          .toLowerCase();
      final statusToSave =
          targetStatus == 'draft' && existingStatus == 'submitted'
          ? 'submitted'
          : targetStatus;
      metadata['store_name'] = widget.visit.storeName;
      metadata['client_name'] = widget.visit.clientName;
      metadata['state'] = widget.visit.state;
      metadata['activity_date'] = indiaDateKey(widget.visit.checkInTime);
      metadata['pending_images'] = pendingImages;
      if (widget.type == FoActivityType.training) {
        metadata.addAll(_trainingMetadata(pendingImages: pendingImages));
      }
      metadata['last_mobile_activity_submit_at'] = DateTime.now()
          .toUtc()
          .toIso8601String();

      if (!SupabaseService.isValidUuid(submissionId)) {
        submissionId = await SupabaseService.createActivitySubmission(
          user: widget.user,
          attendance: widget.attendance,
          visit: widget.visit,
          activityType: activityType,
          remarks: widget.type == FoActivityType.training
              ? ''
              : remarks.isEmpty
              ? '${_spec.title} submitted; images/proofs pending.'
              : remarks,
          latitude: position?.latitude,
          longitude: position?.longitude,
          accuracy: position?.accuracy,
          pendingImages: pendingImages,
          metadata: metadata,
          localId: newLocalId('activity-submission'),
          status: statusToSave,
        );
        PerformanceLogService.step(
          operation: 'activity_submission',
          step: 'submission_create',
          stopwatch: perf,
        );
      } else {
        await SupabaseService.updateActivitySubmissionMetadata(
          submissionId: submissionId!,
          metadata: metadata,
          remarks: widget.type == FoActivityType.training ? null : remarks,
          status: statusToSave,
        );
        PerformanceLogService.step(
          operation: 'activity_submission',
          step: 'submission_update',
          stopwatch: perf,
        );
      }
      if (!SupabaseService.isValidUuid(submissionId)) {
        throw StateError('Activity submission could not be created.');
      }
      _lastSubmissionId = submissionId;

      for (var index = 0; index < uploadSources.length; index += 1) {
        final source = uploadSources[index];
        _setSubmitStep(
          'Preparing image ${index + 1} of ${uploadSources.length}',
          uploadedCount: index,
          uploadTotal: uploadSources.length,
        );
        final item = await source.prepare();
        PerformanceLogService.step(
          operation: 'activity_submission',
          step: 'image_prepare',
          stopwatch: perf,
        );
        _setSubmitStep(
          'Uploading image ${index + 1} of ${uploadSources.length}',
          uploadedCount: index,
          uploadTotal: uploadSources.length,
        );
        final fileSize = item.bytes.length;
        String? fileUrl;
        try {
          fileUrl = await SupabaseService.uploadActivityFile(
            user: widget.user,
            attendance: widget.attendance,
            activityType: activityType,
            submissionId: submissionId!,
            fileName: item.fileName,
            bytes: item.bytes,
            contentType: item.contentType,
            extension: item.extension,
          );
          orphanedUploadUrls.add(fileUrl);
          _setSubmitStep(
            'Linking attachment ${index + 1} of ${uploadSources.length}',
            uploadedCount: index,
            uploadTotal: uploadSources.length,
          );
          await SupabaseService.createActivityUpload(
            user: widget.user,
            attendance: widget.attendance,
            visit: widget.visit,
            submissionId: submissionId,
            activityType: activityType,
            uploadRole: item.uploadRole,
            fileUrl: fileUrl,
            fileName: item.fileName,
            fileType: item.contentType,
            fileSize: fileSize,
            localId: newLocalId('activity-upload'),
            metadata: item.metadata,
          );
          item.releaseBytes();
          _completedUploadKeys.add(source.key);
          successfulUploads += 1;
          _setSubmitStep(
            'Uploading image ${index + 1} of ${uploadSources.length}',
            uploadedCount: index + 1,
            uploadTotal: uploadSources.length,
          );
          orphanedUploadUrls.remove(fileUrl);
        } catch (_) {
          failedUploads += 1;
          item.releaseBytes();
          if (fileUrl != null && orphanedUploadUrls.contains(fileUrl)) {
            await SupabaseService.deleteActivityFile(fileUrl);
            orphanedUploadUrls.remove(fileUrl);
          }
          rethrow;
        }
      }
      PerformanceLogService.step(
        operation: 'activity_submission',
        step: 'file_uploads',
        stopwatch: perf,
      );
      if (uploadSources.isNotEmpty) {
        _setSubmitStep('Completing submission');
        metadata['pending_images'] = widget.type == FoActivityType.training
            ? _trainingCompletedCategoryCount == 0
            : false;
        metadata['last_activity_upload_at'] = DateTime.now()
            .toUtc()
            .toIso8601String();
        if (widget.type == FoActivityType.training) {
          metadata.addAll(
            _trainingMetadata(
              pendingImages: metadata['pending_images'] == true,
            ),
          );
        }
        await SupabaseService.updateActivitySubmissionMetadata(
          submissionId: submissionId!,
          metadata: metadata,
          remarks: widget.type == FoActivityType.training ? null : remarks,
          status: statusToSave,
        );
        PerformanceLogService.step(
          operation: 'activity_submission',
          step: 'submission_finalize',
          stopwatch: perf,
        );
      }

      if (!mounted) return;
      if (widget.type == FoActivityType.training) {
        if (!popOnSuccess) {
          _setSubmitStep('Completing submission');
          await _loadExistingTraining();
          if (!mounted) return;
        }
        setState(() {
          _draftSaved = statusToSave == 'draft';
          _trainingPhotos.clear();
          _pdf = null;
        });
      }
      _completedUploadKeys.clear();
      _lastSubmissionId = null;
      if (popOnSuccess) {
        Navigator.of(context).pop(true);
      } else {
        _snack('Training draft saved.');
      }
    } catch (error) {
      for (final fileUrl in orphanedUploadUrls) {
        try {
          await SupabaseService.deleteActivityFile(fileUrl);
        } catch (_) {
          // Best-effort cleanup only; the user-facing error below remains the source of truth.
        }
      }
      if (!mounted) return;
      final pendingUploads = _activityUploadSources()
          .where((source) => !_completedUploadKeys.contains(source.key))
          .length;
      failedUploads = failedUploads == 0 && pendingUploads > 0
          ? pendingUploads
          : failedUploads;
      _snack(
        successfulUploads > 0
            ? '$successfulUploads file(s) uploaded. $failedUploads file(s) still pending. Please retry.'
            : _activitySubmitErrorMessage(error),
      );
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submitStep = null;
          _uploadedCount = 0;
          _uploadTotal = 0;
        });
      }
    }
  }

  String _imageContentType(String extension) {
    return extension == 'png' ? 'image/png' : 'image/jpeg';
  }

  String _activityTypeValue(FoActivityType type) {
    switch (type) {
      case FoActivityType.inspection:
        return 'inspection';
      case FoActivityType.deepCleaning:
        return 'deep_cleaning';
      case FoActivityType.training:
        return 'training';
    }
  }

  String _uploadObjectKey(Object object) {
    final existing = _uploadObjectKeys[object];
    if (existing != null) return existing;
    final value = 'activity_upload_${_nextUploadKey++}';
    _uploadObjectKeys[object] = value;
    return value;
  }

  List<_ActivityUploadSource> _activityUploadSources() {
    final items = <_ActivityUploadSource>[];
    if (widget.type == FoActivityType.deepCleaning) {
      for (var index = 0; index < _areas.length; index += 1) {
        final area = _areas[index];
        if (area.before != null) {
          items.add(
            _ActivityUploadSource.xFile(
              key: _uploadObjectKey(area.before!),
              file: area.before!,
              uploadRole: 'deep_cleaning_before',
              fallbackName: 'area_${index + 1}_before',
              contentTypeForExtension: _imageContentType,
            ),
          );
        }
        if (area.after != null) {
          items.add(
            _ActivityUploadSource.xFile(
              key: _uploadObjectKey(area.after!),
              file: area.after!,
              uploadRole: 'deep_cleaning_after',
              fallbackName: 'area_${index + 1}_after',
              contentTypeForExtension: _imageContentType,
            ),
          );
        }
      }
      return items;
    }
    if (widget.type == FoActivityType.training) {
      for (final category in _trainingCategories) {
        final files = _trainingPhotos[category.key] ?? const <XFile>[];
        for (var index = 0; index < files.length; index += 1) {
          items.add(
            _ActivityUploadSource.xFile(
              key: _uploadObjectKey(files[index]),
              file: files[index],
              uploadRole: 'training_photo',
              fallbackName: '${category.key}_${index + 1}',
              contentTypeForExtension: _imageContentType,
              metadata: {
                'training_category': category.key,
                'training_category_label': category.label,
                'training_photo': true,
              },
            ),
          );
        }
      }
      if (_pdf != null) {
        items.add(
          _ActivityUploadSource.platformFile(
            key: _uploadObjectKey(_pdf!),
            file: _pdf!,
            uploadRole: 'training_document',
            fallbackName: 'training_document',
            metadata: {
              'training_document': true,
              'training_category': 'training_document',
              'training_category_label': 'Training Document',
            },
          ),
        );
      }
      return items;
    }
    final uploadRole = widget.type == FoActivityType.training
        ? 'training_photo'
        : 'inspection_photo';
    for (var index = 0; index < _photos.length; index += 1) {
      items.add(
        _ActivityUploadSource.xFile(
          key: _uploadObjectKey(_photos[index]),
          file: _photos[index],
          uploadRole: uploadRole,
          fallbackName: '${_activityTypeValue(widget.type)}_${index + 1}',
          contentTypeForExtension: _imageContentType,
        ),
      );
    }
    if (widget.type == FoActivityType.training && _pdf != null) {
      items.add(
        _ActivityUploadSource.platformFile(
          key: _uploadObjectKey(_pdf!),
          file: _pdf!,
          uploadRole: 'training_document',
          fallbackName: 'training_document',
        ),
      );
    }
    return items;
  }

  String _activitySubmitErrorMessage(Object error) {
    final text = error.toString();
    final lower = text.toLowerCase();
    if (lower.contains('socket') ||
        lower.contains('network') ||
        lower.contains('failed host lookup') ||
        lower.contains('connection')) {
      return 'Activity submission requires internet. Please try again once online.';
    }
    if (lower.contains('5 mb')) {
      return 'Inspection photo must be 5 MB or less.';
    }
    if (lower.contains('session expired')) {
      return 'Session expired. Please login again.';
    }
    return 'Activity submission failed. Please retry.';
  }

  Widget _siteInfo() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Site Information',
            style: TextStyle(color: foNavy, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(Icons.location_on_outlined, color: foNavy),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.visit.storeName,
                      style: const TextStyle(
                        color: foNavy,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      '${widget.visit.state} • ${widget.visit.clientName}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF53607D),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  FoStatusBadge(
                    label: widget.visit.isActive ? 'Checked In' : 'Checked Out',
                    color: widget.visit.isActive ? qpmsBlue : foGreen,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    formatTime(widget.visit.checkInTime),
                    style: const TextStyle(
                      color: Color(0xFF53607D),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _inspectionBody() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(
            title: 'Inspection Photos',
            subtitle: 'Upload clear photos of the site condition',
          ),
          const SizedBox(height: 16),
          _photoGrid(
            _photos,
            onRemove: (index) {
              setState(() => _photos.removeAt(index));
            },
          ),
          const SizedBox(height: 12),
          _uploadBox(
            title: 'Add More Photos',
            subtitle: 'Tap to upload',
            icon: Icons.camera_alt_outlined,
            onTap: _addPhotos,
          ),
        ],
      ),
    );
  }

  Widget _cleaningBody() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(
            title: 'Before & After Photos',
            subtitle: 'Add before and after photos for each area cleaned',
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < _areas.length; i += 1) _areaRow(i + 1, _areas[i]),
          const SizedBox(height: 10),
          _uploadBox(
            title: 'Add More Area',
            subtitle: 'Tap to add new area',
            icon: Icons.add_circle_outline,
            onTap: () => setState(() => _areas.add(_CleaningArea())),
          ),
        ],
      ),
    );
  }

  Widget _trainingBody() {
    final completed = _trainingCompletedCategoryCount;
    final progress = completed / _trainingCategories.length;
    return Column(
      children: [
        _hkStaffCard(),
        const SizedBox(height: 14),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: foPurple.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.trending_up_rounded,
                      color: foPurple,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Text(
                              'Training Progress',
                              style: TextStyle(
                                color: foNavy,
                                fontSize: 17,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              '$completed of ${_trainingCategories.length} completed',
                              style: const TextStyle(
                                color: qpmsBlue,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(99),
                          child: LinearProgressIndicator(
                            value: progress,
                            minHeight: 8,
                            color: foPurple,
                            backgroundColor: const Color(0xFFE8ECF7),
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'You can save as draft and upload pending photos later.',
                          style: TextStyle(
                            color: Color(0xFF53607D),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_draftSaved)
                    const FoStatusBadge(label: 'Draft Saved', color: qpmsBlue),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(
                title: 'Required Training Activities',
                subtitle:
                    'Upload photos for the activities completed during this training.',
              ),
              const SizedBox(height: 14),
              if (_loadingExistingTraining)
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: LinearProgressIndicator(minHeight: 3),
                ),
              for (final category in _trainingCategories)
                _trainingCategoryRow(category),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _trainingDocumentCard(),
      ],
    );
  }

  Widget _hkStaffCard() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(
            title: 'HK Staff Attended',
            subtitle: 'Add the housekeeping staff who attended this training',
          ),
          const SizedBox(height: 14),
          for (var index = 0; index < _hkStaff.length; index += 1)
            _hkStaffRow(index, _hkStaff[index]),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _hkEmpId,
                  decoration: const InputDecoration(
                    labelText: 'HK Scrum ID / Emp ID',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _hkName,
                  decoration: const InputDecoration(labelText: 'HK Name'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _addHkStaff,
            icon: const Icon(Icons.add_rounded),
            label: const Text('+ Add Another Staff'),
            style: OutlinedButton.styleFrom(
              foregroundColor: qpmsBlue,
              side: BorderSide(
                color: qpmsBlue.withValues(alpha: 0.45),
                style: BorderStyle.solid,
              ),
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              textStyle: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
        ],
      ),
    );
  }

  Widget _hkStaffRow(int index, _TrainingStaff staff) {
    final initials = (staff.name.isNotEmpty ? staff.name : staff.empId)
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .take(2)
        .map((part) => part[0].toUpperCase())
        .join();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: foBorder),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: foPurple.withValues(alpha: 0.12),
            child: Text(
              initials.isEmpty ? 'HK' : initials,
              style: const TextStyle(
                color: foPurple,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Row(
              children: [
                Expanded(
                  child: _compactTrainingField(
                    'HK Scrum ID / Emp ID',
                    staff.empId.isEmpty ? '--' : staff.empId,
                  ),
                ),
                Container(width: 1, height: 36, color: foBorder),
                const SizedBox(width: 12),
                Expanded(
                  child: _compactTrainingField(
                    'HK Name',
                    staff.name.isEmpty ? '--' : staff.name,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => setState(() => _hkStaff.removeAt(index)),
            icon: const Icon(Icons.delete_outline_rounded, color: qpmsMuted),
          ),
        ],
      ),
    );
  }

  Widget _compactTrainingField(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFF53607D),
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: foNavy, fontWeight: FontWeight.w900),
        ),
      ],
    );
  }

  Widget _trainingCategoryRow(_TrainingCategory category) {
    final local = _trainingPhotos[category.key] ?? const <XFile>[];
    final existing = _existingTrainingUploads[category.key] ?? const [];
    final total = local.length + existing.length;
    final hasPhoto = total > 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: foBorder),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: category.color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(category.icon, color: category.color, size: 21),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              category.label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: foNavy,
                fontSize: 14,
                height: 1.16,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 8),
          _trainingPreview(category, local, existing),
          const SizedBox(width: 6),
          Tooltip(
            message: 'Upload photos',
            child: Semantics(
              button: true,
              label: 'Upload photos for ${category.label}',
              child: InkWell(
                onTap: () => _pickTrainingCategoryPhoto(category),
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: qpmsBlue),
                  ),
                  child: const Icon(
                    Icons.cloud_upload_outlined,
                    size: 20,
                    color: qpmsBlue,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          _trainingStatusIndicator(total: total, hasPhoto: hasPhoto),
        ],
      ),
    );
  }

  Widget _trainingPreview(
    _TrainingCategory category,
    List<XFile> local,
    List<_ExistingActivityUpload> existing,
  ) {
    _ExistingActivityUpload? existingImage;
    for (final row in existing) {
      if (row.isImage) {
        existingImage = row;
        break;
      }
    }
    Widget child;
    if (local.isNotEmpty) {
      child = Image.file(File(local.first.path), fit: BoxFit.cover);
    } else if (existingImage?.signedUrl != null) {
      child = Image.network(existingImage!.signedUrl!, fit: BoxFit.cover);
    } else {
      child = Text(
        local.isEmpty && existing.isEmpty ? '--' : '${existing.length}',
        style: const TextStyle(
          color: Color(0xFF53607D),
          fontWeight: FontWeight.w900,
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 48,
        height: 42,
        color: foSoftBlue,
        alignment: Alignment.center,
        child: child,
      ),
    );
  }

  Widget _trainingStatusIndicator({
    required int total,
    required bool hasPhoto,
  }) {
    if (!hasPhoto) {
      return const SizedBox(
        width: 34,
        child: Text(
          'No\nphoto',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF8A94AD),
            fontSize: 9,
            height: 1.05,
            fontWeight: FontWeight.w800,
          ),
        ),
      );
    }
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: foGreen.withValues(alpha: 0.12),
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          '$total',
          style: const TextStyle(
            color: foGreen,
            fontSize: 13,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _trainingDocumentCard() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: const Color(0xFFFF2D2D).withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.picture_as_pdf_rounded,
                  color: Color(0xFFFF2D2D),
                ),
              ),
              const SizedBox(width: 14),
              const Expanded(
                child: FoSectionTitle(
                  title: 'Training Document (PDF)',
                  subtitle: 'Attendance sheet or training material',
                ),
              ),
              SizedBox(
                width: 156,
                child: OutlinedButton.icon(
                  onPressed: _pickPdf,
                  icon: const Icon(Icons.upload_file_outlined),
                  label: const Text('Upload PDF'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: qpmsBlue,
                    side: const BorderSide(color: qpmsBlue),
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    textStyle: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
              ),
            ],
          ),
          if (_pdf != null || _existingTrainingDocument) ...[
            const SizedBox(height: 12),
            if (_pdf != null) _pdfCard(),
            if (_existingTrainingDocument && _pdf == null)
              const FoStatusBadge(label: 'PDF Uploaded', color: qpmsBlue),
          ],
        ],
      ),
    );
  }

  Widget _trainingSubmitNote() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: foSoftBlue,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: qpmsBlue.withValues(alpha: 0.18)),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_rounded, color: qpmsBlue),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'Save Draft anytime. Submit Training will be enabled when training evidence is ready.',
              style: TextStyle(color: foNavy, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _photoGrid(List<XFile> files, {required void Function(int) onRemove}) {
    if (files.isEmpty) {
      return const Text(
        'No photos selected yet.',
        style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
      );
    }
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: files.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 1.1,
      ),
      itemBuilder: (context, index) =>
          _imageThumb(files[index], onRemove: () => onRemove(index)),
    );
  }

  Widget _areaRow(int number, _CleaningArea area) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Area $number',
            style: const TextStyle(color: foNavy, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _areaImageBox(
                  label: 'Before',
                  file: area.before,
                  onTap: () => _pickAreaImage(area, before: true),
                  onRemove: () => setState(() => area.before = null),
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 10),
                child: Icon(Icons.arrow_forward_rounded, color: qpmsBlue),
              ),
              Expanded(
                child: _areaImageBox(
                  label: 'After',
                  file: area.after,
                  onTap: () => _pickAreaImage(area, before: false),
                  onRemove: () => setState(() => area.after = null),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _areaImageBox({
    required String label,
    required XFile? file,
    required VoidCallback onTap,
    required VoidCallback onRemove,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF53607D),
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        AspectRatio(
          aspectRatio: 1.25,
          child: file == null
              ? _emptyImageButton(onTap)
              : _imageThumb(file, onRemove: onRemove),
        ),
      ],
    );
  }

  Widget _imageThumb(XFile file, {required VoidCallback onRemove}) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.file(
            File(file.path),
            width: double.infinity,
            height: double.infinity,
            fit: BoxFit.cover,
          ),
        ),
        Positioned(
          top: 5,
          right: 5,
          child: InkWell(
            onTap: onRemove,
            child: Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close_rounded, size: 16, color: foNavy),
            ),
          ),
        ),
      ],
    );
  }

  Widget _emptyImageButton(VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color: foSoftBlue,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: foBorder),
        ),
        child: const Center(
          child: Icon(Icons.camera_alt_outlined, color: qpmsBlue),
        ),
      ),
    );
  }

  Widget _uploadBox({
    required String title,
    required String subtitle,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: qpmsBlue.withValues(alpha: 0.28)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: qpmsBlue),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: qpmsBlue,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: qpmsBlue,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _pdfCard() {
    final pdf = _pdf!;
    final sizeMb = pdf.size / (1024 * 1024);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: foBorder),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFFF2D2D),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Center(
              child: Text(
                'PDF',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 11,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pdf.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  '${sizeMb.toStringAsFixed(1)} MB',
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => setState(() => _pdf = null),
            icon: const Icon(Icons.close_rounded, color: foNavy),
          ),
        ],
      ),
    );
  }

  Widget _remarksCard({required bool optional}) {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoSectionTitle(
            title: optional ? 'Remarks (Optional)' : 'Remarks',
            subtitle: optional
                ? 'Enter any additional remarks'
                : 'Add your observations and remarks',
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _remarks,
            maxLines: 4,
            maxLength: 500,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'Enter your remarks here...',
              counterText: '',
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              '${_remarks.text.length}/500',
              style: const TextStyle(
                color: Color(0xFF53607D),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _snack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _ActivitySpec {
  const _ActivitySpec({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
}

class _CleaningArea {
  XFile? before;
  XFile? after;
}

class _ActivityUploadSource {
  const _ActivityUploadSource._({
    required this.key,
    required this.uploadRole,
    required this.fallbackName,
    required this.metadata,
    required this.contentTypeForExtension,
    this.xFile,
    this.platformFile,
  });

  factory _ActivityUploadSource.xFile({
    required String key,
    required XFile file,
    required String uploadRole,
    required String fallbackName,
    required String Function(String extension) contentTypeForExtension,
    Map<String, dynamic> metadata = const {},
  }) {
    return _ActivityUploadSource._(
      key: key,
      xFile: file,
      uploadRole: uploadRole,
      fallbackName: fallbackName,
      metadata: metadata,
      contentTypeForExtension: contentTypeForExtension,
    );
  }

  factory _ActivityUploadSource.platformFile({
    required String key,
    required PlatformFile file,
    required String uploadRole,
    required String fallbackName,
    Map<String, dynamic> metadata = const {},
  }) {
    return _ActivityUploadSource._(
      key: key,
      platformFile: file,
      uploadRole: uploadRole,
      fallbackName: fallbackName,
      metadata: metadata,
      contentTypeForExtension: (_) => 'application/pdf',
    );
  }

  final String key;
  final XFile? xFile;
  final PlatformFile? platformFile;
  final String uploadRole;
  final String fallbackName;
  final Map<String, dynamic> metadata;
  final String Function(String extension) contentTypeForExtension;

  Future<_ActivityUploadItem> prepare() async {
    final xFile = this.xFile;
    if (xFile != null) {
      final length = await xFile.length();
      if (length <= 0 || length > _activityUploadMaxBytes) {
        throw StateError('Inspection photo must be 5 MB or less.');
      }
      final bytes = await xFile.readAsBytes();
      if (bytes.isEmpty || bytes.length > _activityUploadMaxBytes) {
        throw StateError('Inspection photo must be 5 MB or less.');
      }
      final extension = _fileExtensionFromName(xFile.name);
      return _ActivityUploadItem(
        uploadRole: uploadRole,
        fileName: xFile.name.isEmpty ? '$fallbackName.$extension' : xFile.name,
        bytes: bytes,
        extension: extension,
        contentType: contentTypeForExtension(extension),
        metadata: metadata,
      );
    }

    final platformFile = this.platformFile;
    if (platformFile == null) {
      throw StateError('Selected file could not be prepared.');
    }
    if (platformFile.size <= 0 || platformFile.size > _activityUploadMaxBytes) {
      throw StateError('Inspection photo must be 5 MB or less.');
    }
    final filePath = platformFile.path;
    final bytes =
        platformFile.bytes ??
        (filePath == null ? null : await File(filePath).readAsBytes());
    if (bytes == null) {
      throw StateError('Training document could not be selected.');
    }
    if (bytes.isEmpty || bytes.length > _activityUploadMaxBytes) {
      throw StateError('Inspection photo must be 5 MB or less.');
    }
    const extension = 'pdf';
    return _ActivityUploadItem(
      uploadRole: uploadRole,
      fileName: platformFile.name.isEmpty
          ? '$fallbackName.$extension'
          : platformFile.name,
      bytes: bytes,
      extension: extension,
      contentType: 'application/pdf',
      metadata: metadata,
    );
  }
}

class _ActivityUploadItem {
  _ActivityUploadItem({
    required this.uploadRole,
    required this.fileName,
    required this.bytes,
    required this.extension,
    required this.contentType,
    this.metadata = const {},
  });

  final String uploadRole;
  final String fileName;
  Uint8List bytes;
  final String extension;
  final String contentType;
  final Map<String, dynamic> metadata;

  void releaseBytes() {
    bytes = Uint8List(0);
  }
}

class _TrainingCategory {
  const _TrainingCategory({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
  });

  final String key;
  final String label;
  final IconData icon;
  final Color color;
}

class _TrainingStaff {
  const _TrainingStaff({required this.empId, required this.name});

  final String empId;
  final String name;

  Map<String, dynamic> toJson() => {'emp_id': empId, 'name': name};
}

class _ExistingActivityUpload {
  const _ExistingActivityUpload({
    required this.id,
    required this.fileUrl,
    required this.fileName,
    required this.fileType,
    this.signedUrl,
  });

  final String id;
  final String fileUrl;
  final String fileName;
  final String fileType;
  final String? signedUrl;

  bool get isImage => fileType.toLowerCase().startsWith('image/');
}

class _StoreSearchDialog extends StatefulWidget {
  const _StoreSearchDialog({required this.user, required this.attendance});

  final FoUser user;
  final Attendance attendance;

  @override
  State<_StoreSearchDialog> createState() => _StoreSearchDialogState();
}

class _StoreSearchDialogState extends State<_StoreSearchDialog> {
  final _query = TextEditingController();
  List<Store> _stores = [];
  bool _busy = false;

  Future<void> _search() async {
    setState(() => _busy = true);
    try {
      _stores = await SupabaseService.searchStores(_query.text);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Search Store'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _query,
              decoration: const InputDecoration(
                labelText: 'Store Name / Code / Client',
              ),
              onSubmitted: (_) => _search(),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _busy ? null : _search,
              child: const Text('Search'),
            ),
            const SizedBox(height: 10),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final store in _stores)
                    ListTile(
                      title: Text(store.storeName),
                      subtitle: Text(
                        '${store.clientName} • ${store.storeCode}',
                      ),
                      onTap: () => Navigator.of(context).pop(store),
                    ),
                  if (!_busy && _stores.isEmpty)
                    TextButton(
                      onPressed: _addStore,
                      child: const Text('Store not found - Add New Store'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addStore() async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'tasks',
      action: 'FO_ADD_SITE_OPENED',
    );
    if (!mounted) return;
    final store = await showDialog<Store?>(
      context: context,
      builder: (_) =>
          _AddStoreDialog(user: widget.user, attendance: widget.attendance),
    );
    if (store != null && mounted) Navigator.of(context).pop(store);
  }
}

class _NearbyStore {
  const _NearbyStore({
    required this.store,
    required this.distanceMeters,
    this.radiusMeters = defaultCheckInRadiusMeters,
  });

  factory _NearbyStore.fromMatch(CheckInStoreMatch match) => _NearbyStore(
    store: match.store,
    distanceMeters: match.distanceMeters,
    radiusMeters: match.radiusMeters,
  );

  final Store store;
  final double distanceMeters;
  final double radiusMeters;
}

// ignore: unused_element
class _LegacyNearbySitesDialog extends StatelessWidget {
  const _LegacyNearbySitesDialog({required this.matches});

  final List<_NearbyStore> matches;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Nearby Sites'),
      content: SizedBox(
        width: 360,
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final match in matches)
              ListTile(
                title: Text(match.store.storeName),
                subtitle: Text(
                  '${match.store.clientName} • ${match.store.storeCode}\n'
                  '${match.distanceMeters.toStringAsFixed(1)} m away',
                ),
                onTap: () => Navigator.of(context).pop(match),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}

class _NearbySitesSheet extends StatefulWidget {
  const _NearbySitesSheet({
    required this.matches,
    required this.isLoading,
    required this.errorMessage,
  });

  final List<_NearbyStore> matches;
  final bool isLoading;
  final String? errorMessage;

  @override
  State<_NearbySitesSheet> createState() => _NearbySitesSheetState();
}

class _NearbySitesSheetState extends State<_NearbySitesSheet> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<_NearbyStore> get _filteredMatches {
    final query = _query.trim().toLowerCase();
    final sorted = [...widget.matches]
      ..sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));
    if (query.isEmpty) return sorted;
    return sorted.where((match) {
      final store = match.store;
      return store.storeName.toLowerCase().contains(query) ||
          store.storeCode.toLowerCase().contains(query) ||
          store.clientName.toLowerCase().contains(query) ||
          (store.business ?? '').toLowerCase().contains(query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final matches = _filteredMatches;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.88,
      ),
      padding: EdgeInsets.fromLTRB(
        20,
        10,
        20,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 42,
            height: 4,
            margin: const EdgeInsets.only(bottom: 18),
            decoration: BoxDecoration(
              color: const Color(0xFFD6DBE7),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Select Site',
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: qpmsText,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Choose the site you are visiting today',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: qpmsMuted,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _searchController,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search site or store code',
              prefixIcon: const Icon(Icons.search_rounded),
              filled: true,
              fillColor: const Color(0xFFF6F8FC),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 14,
              ),
            ),
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: 14),
          Flexible(
            child: _NearbySitesContent(
              matches: matches,
              isLoading: widget.isLoading,
              errorMessage: widget.errorMessage,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
          ),
        ],
      ),
    );
  }
}

class _NearbySitesContent extends StatelessWidget {
  const _NearbySitesContent({
    required this.matches,
    required this.isLoading,
    this.errorMessage,
  });

  final List<_NearbyStore> matches;
  final bool isLoading;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const _NearbySitesState(
        icon: Icons.near_me_rounded,
        message: 'Finding nearby sites...',
        showSpinner: true,
      );
    }

    if (errorMessage != null && errorMessage!.trim().isNotEmpty) {
      return _NearbySitesState(
        icon: Icons.location_off_rounded,
        message: 'We could not load nearby sites. Please try again.',
        detail: errorMessage,
      );
    }

    if (matches.isEmpty) {
      return const _NearbySitesState(
        icon: Icons.location_off_rounded,
        message: 'No nearby sites found',
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      itemCount: matches.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final match = matches[index];
        return _NearbySiteTile(match: match, isNearest: index == 0);
      },
    );
  }
}

class _NearbySiteTile extends StatelessWidget {
  const _NearbySiteTile({required this.match, required this.isNearest});

  final _NearbyStore match;
  final bool isNearest;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = match.store;
    final business = (store.business?.trim().isNotEmpty ?? false)
        ? store.business!.trim()
        : store.clientName;

    return Material(
      color: const Color(0xFFF8FAFE),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => Navigator.of(context).pop(match),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: qpmsBlue.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.location_pin, color: qpmsBlue),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            store.storeName.isEmpty
                                ? 'Unnamed site'
                                : store.storeName,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleSmall?.copyWith(
                              color: qpmsText,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        _DistanceChip(label: _distanceLabel(match)),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      business.isEmpty
                          ? 'Client details unavailable'
                          : business,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: qpmsMuted,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        _StoreCodeChip(
                          label: store.storeCode.isEmpty
                              ? 'No store code'
                              : store.storeCode,
                        ),
                        if (isNearest) const _NearestBadge(),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _distanceLabel(_NearbyStore match) {
    final distance = match.distanceMeters;
    if (!distance.isFinite) return '--';
    if (distance >= 1000) return '${(distance / 1000).toStringAsFixed(1)} km';
    return '${distance.round()} m';
  }
}

class _DistanceChip extends StatelessWidget {
  const _DistanceChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: qpmsBlue,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _StoreCodeChip extends StatelessWidget {
  const _StoreCodeChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE1E7F0)),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: qpmsText,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _NearestBadge extends StatelessWidget {
  const _NearestBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF7EF),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        'Nearest',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: const Color(0xFF16703A),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _NearbySitesState extends StatelessWidget {
  const _NearbySitesState({
    required this.icon,
    required this.message,
    this.detail,
    this.showSpinner = false,
  });

  final IconData icon;
  final String message;
  final String? detail;
  final bool showSpinner;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (showSpinner)
              const CircularProgressIndicator()
            else
              Icon(icon, size: 42, color: qpmsMuted),
            const SizedBox(height: 14),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleSmall?.copyWith(
                color: qpmsText,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (detail != null && detail!.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                detail!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: qpmsMuted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WelcomeSiteDialog extends StatelessWidget {
  const _WelcomeSiteDialog({required this.match, required this.accuracy});

  final _NearbyStore match;
  final double accuracy;

  @override
  Widget build(BuildContext context) {
    final store = match.store;
    return AlertDialog(
      title: const Text('Confirm Site Check-In'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Site: ${store.storeName}'),
          Text('Client: ${store.clientName}'),
          Text('Site ID: ${store.storeCode}'),
          const SizedBox(height: 10),
          Text('Distance: ${match.distanceMeters.round()}m'),
          Text('GPS Accuracy: ${accuracy.round()}m'),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Check In'),
        ),
      ],
    );
  }
}

class _NoSiteFoundDialog extends StatelessWidget {
  const _NoSiteFoundDialog({required this.accuracyMeters, this.nearest});

  final double accuracyMeters;
  final _NearbyStore? nearest;

  @override
  Widget build(BuildContext context) {
    final nearest = this.nearest;
    return AlertDialog(
      title: const Text('No eligible store found'),
      content: Text(
        [
          'No eligible store was found within the allowed Check-In radius.',
          '',
          'Current GPS accuracy: ${accuracyMeters.toStringAsFixed(0)} m',
          if (nearest != null) ...[
            'Nearest store: ${nearest.store.storeCode} - ${nearest.store.storeName}',
            'Distance: ${nearest.distanceMeters.toStringAsFixed(0)} m',
            'Allowed radius: ${nearest.radiusMeters.toStringAsFixed(0)} m',
          ] else
            'Nearest store: Not available',
        ].join('\n'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(_NoSiteFoundAction.cancel),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () =>
              Navigator.of(context).pop(_NoSiteFoundAction.refresh),
          child: const Text('Refresh Stores'),
        ),
        FilledButton(
          onPressed: () =>
              Navigator.of(context).pop(_NoSiteFoundAction.retryGps),
          child: const Text('Retry GPS'),
        ),
      ],
    );
  }
}

class _AddStoreDialog extends StatefulWidget {
  const _AddStoreDialog({
    required this.user,
    required this.attendance,
    this.latitude,
    this.longitude,
    this.accuracy,
  });

  final FoUser user;
  final Attendance attendance;
  final double? latitude;
  final double? longitude;
  final double? accuracy;

  @override
  State<_AddStoreDialog> createState() => _AddStoreDialogState();
}

class _AddStoreDialogState extends State<_AddStoreDialog> {
  static const _businessOptions = [
    'Standalone',
    'Retail',
    'TN Government',
    'DME',
    'Airport',
    'Osmania Hospital',
    'Private Hospital',
    'AP DSH',
  ];

  final _name = TextEditingController();
  final _siteId = TextEditingController();
  final _client = TextEditingController();
  String? _business;
  double? _latitude;
  double? _longitude;
  double? _accuracy;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final profileBusiness = widget.user.business?.trim();
    if (profileBusiness != null && _businessOptions.contains(profileBusiness)) {
      _business = profileBusiness;
    }
    _setCoordinates(widget.latitude, widget.longitude, widget.accuracy);
    if (widget.latitude != null && widget.longitude != null) {
      Future.microtask(
        () => CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'FO_SITE_GPS_CAPTURED',
          error:
              'lat=${widget.latitude} lng=${widget.longitude} accuracy=${widget.accuracy}',
        ),
      );
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _siteId.dispose();
    _client.dispose();
    super.dispose();
  }

  void _setCoordinates(double? latitude, double? longitude, double? accuracy) {
    _latitude = latitude ?? _latitude;
    _longitude = longitude ?? _longitude;
    _accuracy = accuracy;
  }

  Future<void> _captureGps() async {
    setState(() => _busy = true);
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      _setCoordinates(position.latitude, position.longitude, position.accuracy);
      if (mounted) setState(() {});
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_SITE_GPS_CAPTURED',
        error:
            'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_NEW_SITE_CREATE_START',
      );
      double? latitude = _latitude;
      double? longitude = _longitude;
      double? accuracy = _accuracy;
      if (_name.text.trim().isEmpty ||
          _siteId.text.trim().isEmpty ||
          _client.text.trim().isEmpty) {
        throw StateError('Site name, Site ID and Client Name are required.');
      }
      if (_business == null || _business!.trim().isEmpty) {
        throw StateError('Business is required.');
      }
      final profile = SupabaseService.isReady
          ? await SupabaseService.fetchCurrentProfile()
          : widget.user;
      final profileState = profile.state.trim();
      if (profileState.isEmpty) {
        throw StateError(
          'State is missing in your profile. Please contact admin.',
        );
      }
      if (latitude == null || longitude == null) {
        await _captureGps();
        latitude = _latitude;
        longitude = _longitude;
        accuracy = _accuracy;
      }
      if (latitude == null || longitude == null) {
        throw StateError('Current GPS is required before saving a site.');
      }
      final similar = await _similarSiteWithin100m(latitude, longitude);
      if (similar != null && mounted) {
        final proceed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Similar site found. Continue anyway?'),
            content: Text(
              '${similar.store.storeName}\n${similar.distanceMeters.toStringAsFixed(1)} m away',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Continue'),
              ),
            ],
          ),
        );
        if (proceed != true) return;
      }
      final id = await SupabaseService.createStore(
        user: profile,
        attendance: widget.attendance,
        storeName: _name.text.trim(),
        clientName: _client.text.trim(),
        storeCode: _siteId.text.trim(),
        state: profileState,
        business: _business ?? profile.business,
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_SITE_CREATED_PENDING_APPROVAL',
        error: 'store_id=${id ?? '--'}',
      );
      if (!mounted) return;
      Navigator.of(context).pop(
        Store(
          id: id ?? '',
          storeName: _name.text.trim(),
          clientName: _client.text.trim(),
          storeCode: _siteId.text.trim(),
          state: profileState,
          business: _business,
          latitude: latitude,
          longitude: longitude,
          gpsAccuracy: accuracy,
        ),
      );
    } on StoreCreateException catch (error) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'FO_ADD_SITE_ERROR_SHOWN',
        error: 'store_error_code=${error.code ?? '--'}',
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } on StateError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<_NearbyStore?> _similarSiteWithin100m(
    double latitude,
    double longitude,
  ) async {
    final stores = await SupabaseService.fetchStoresWithGps();
    _NearbyStore? nearest;
    for (final store in stores) {
      final storeLat = store.latitude;
      final storeLng = store.longitude;
      if (storeLat == null || storeLng == null) continue;
      final distance = Geolocator.distanceBetween(
        latitude,
        longitude,
        storeLat,
        storeLng,
      );
      if (distance > 100) continue;
      if (nearest == null || distance < nearest.distanceMeters) {
        nearest = _NearbyStore(store: store, distanceMeters: distance);
      }
    }
    return nearest;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add Site'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Site Name *'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _siteId,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Site ID *'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _client,
                decoration: const InputDecoration(labelText: 'Client Name *'),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _business,
                decoration: const InputDecoration(labelText: 'Business *'),
                items: _businessOptions
                    .map(
                      (value) =>
                          DropdownMenuItem(value: value, child: Text(value)),
                    )
                    .toList(),
                onChanged: _busy
                    ? null
                    : (value) {
                        if (value == null) return;
                        setState(() => _business = value);
                      },
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  onPressed: _busy ? null : _captureGps,
                  child: const Text('Capture Current GPS'),
                ),
              ),
              if (_latitude != null && _longitude != null) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'GPS Captured ✓\nAccuracy: ${(_accuracy ?? 0).round()} m',
                    style: const TextStyle(
                      color: foGreen,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Save & Check In'),
        ),
      ],
    );
  }
}
