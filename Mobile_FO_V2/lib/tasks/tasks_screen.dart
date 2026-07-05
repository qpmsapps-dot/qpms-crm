import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../models/fo_models.dart';
import '../services/app_state_sync_service.dart';
import '../services/crash_log_service.dart';
import '../services/local_db_service.dart';
import '../services/local_store.dart';
import '../services/permission_service.dart';
import '../services/route_distance_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../tracking/tracking_service.dart';
import '../ui/fo_ui.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';

enum _CheckoutRecoveryAction { retry, fixState }

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
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_CLICKED',
      );
      final attendance = await LocalStore.getAttendance();
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
      if (!locationReadiness.allowed) {
        _toast(
          locationReadiness.message ??
              'Location/GPS is required before checking in.',
        );
        return;
      }

      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_GPS_FETCH_START',
      );
      late final Position position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 15),
          ),
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_GPS_FETCH_SUCCESS',
          error:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'SITE_VISIT_CHECKIN_GPS_CAPTURED',
          error:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
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
      if (position.accuracy > 100) {
        throw StateError(
          'GPS accuracy is weak. Please move to an open area and try again.',
        );
      }

      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_MATCH_START',
      );
      final stores = await SupabaseService.fetchStoresWithGps();
      final nearby =
          stores
              .where(
                (store) => store.latitude != null && store.longitude != null,
              )
              .map(
                (store) => _NearbyStore(
                  store: store,
                  distanceMeters: Geolocator.distanceBetween(
                    position.latitude,
                    position.longitude,
                    store.latitude!,
                    store.longitude!,
                  ),
                ),
              )
              .where((match) => match.distanceMeters <= 100)
              .toList()
            ..sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));

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
        if (!mounted) return;
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
        if (selected == null || !mounted) return;
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (_) =>
              _WelcomeSiteDialog(match: selected, accuracy: position.accuracy),
        );
        if (confirmed != true || !mounted) return;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_EXISTING_SITE_CONFIRMED',
        );
        store = selected.store;
      } else {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_SITE_MATCH_NOT_FOUND',
        );
        if (!mounted) return;
        final addNew = await showDialog<bool>(
          context: context,
          builder: (_) => const _NoSiteFoundDialog(),
        );
        if (addNew != true || !mounted) return;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'FO_ADD_SITE_OPENED',
        );
        if (!mounted) return;
        store = await showDialog<Store?>(
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
      await TrackingService.pauseForSiteVisit(
        user: widget.user,
        visit: visit,
        finalPosition: position,
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

  Future<void> _checkOut() async {
    var visit = _activeVisit;
    final attendance = await LocalStore.getAttendance();
    if (attendance?.isActive != true) return;
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
                    subtitle: 'Coming Soon',
                    icon: Icons.content_paste_search_rounded,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
                  ),
                  _activityCard(
                    width: width,
                    title: 'Deep Cleaning',
                    subtitle: 'Coming Soon',
                    icon: Icons.cleaning_services_rounded,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
                  ),
                  _activityCard(
                    width: width,
                    title: 'Training',
                    subtitle: 'Coming Soon',
                    icon: Icons.co_present_rounded,
                    color: qpmsMuted,
                    enabled: false,
                    onTap: _showComingSoon,
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
                    child: const Text(
                      'Coming Soon',
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

  // ignore: unused_element
  void _openActivity(_ActivityType type) {
    final visit = _activeVisit;
    if (visit == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ActivityFormScreen(type: type, visit: visit),
      ),
    );
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

enum _ActivityType { inspection, deepCleaning, training }

class _ActivityFormScreen extends StatefulWidget {
  const _ActivityFormScreen({required this.type, required this.visit});

  final _ActivityType type;
  final SiteVisit visit;

  @override
  State<_ActivityFormScreen> createState() => _ActivityFormScreenState();
}

class _ActivityFormScreenState extends State<_ActivityFormScreen> {
  final _picker = ImagePicker();
  final _remarks = TextEditingController();
  final List<XFile> _photos = [];
  final List<_CleaningArea> _areas = [_CleaningArea()];
  PlatformFile? _pdf;

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  _ActivitySpec get _spec {
    switch (widget.type) {
      case _ActivityType.inspection:
        return const _ActivitySpec(
          title: 'Inspection',
          subtitle: 'Record site inspection details',
          icon: Icons.content_paste_search_rounded,
          color: qpmsBlue,
        );
      case _ActivityType.deepCleaning:
        return const _ActivitySpec(
          title: 'Deep Cleaning',
          subtitle: 'Record before & after cleaning photos',
          icon: Icons.cleaning_services_rounded,
          color: foGreen,
        );
      case _ActivityType.training:
        return const _ActivitySpec(
          title: 'Training',
          subtitle: 'Record training details & upload documents',
          icon: Icons.co_present_rounded,
          color: foPurple,
        );
    }
  }

  Future<void> _addPhotos() async {
    final files = await _picker.pickMultiImage(imageQuality: 80);
    if (files.isEmpty || !mounted) return;
    setState(() => _photos.addAll(files));
  }

  Future<void> _pickAreaImage(
    _CleaningArea area, {
    required bool before,
  }) async {
    final file = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 80,
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

  @override
  Widget build(BuildContext context) {
    final spec = _spec;
    return Scaffold(
      body: FoPage(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => Navigator.of(context).pop(),
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
          if (widget.type == _ActivityType.inspection) _inspectionBody(),
          if (widget.type == _ActivityType.deepCleaning) _cleaningBody(),
          if (widget.type == _ActivityType.training) _trainingBody(),
          const SizedBox(height: 14),
          _remarksCard(optional: widget.type == _ActivityType.training),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: FoOutlinedButton(
                  label: 'Save as Draft',
                  onPressed: () =>
                      _snack('Draft saved locally for this session.'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FoPrimaryButton(
                  label: 'Submit',
                  icon: Icons.check_rounded,
                  onPressed: () => _snack(
                    'Activity submission UI is ready. Storage upload is not connected.',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
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
                  const FoStatusBadge(label: 'Checked In', color: foGreen),
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
    return Column(
      children: [
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(
                title: 'Training Photos',
                subtitle: 'Upload photos from the training session',
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
        ),
        const SizedBox(height: 14),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(
                title: 'Training Document (PDF)',
                subtitle: 'Upload training attendance sheet or material',
              ),
              const SizedBox(height: 14),
              if (_pdf != null) _pdfCard(),
              if (_pdf != null) const SizedBox(height: 12),
              _uploadBox(
                title: 'Upload PDF',
                subtitle: 'Tap to upload',
                icon: Icons.upload_file_outlined,
                onTap: _pickPdf,
              ),
            ],
          ),
        ),
      ],
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
  const _NearbyStore({required this.store, required this.distanceMeters});

  final Store store;
  final double distanceMeters;
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
  const _NoSiteFoundDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('No registered site found within 100 meters.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Add New Site'),
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
