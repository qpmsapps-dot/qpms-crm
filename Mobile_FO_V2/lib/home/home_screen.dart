import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../build_info.dart';
import '../models/fo_models.dart';
import '../services/app_state_sync_service.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/performance_log_service.dart';
import '../services/permission_service.dart';
import '../services/supabase_service.dart';
import '../services/tracking_health_service.dart';
import '../services/travel_leg_lifecycle_service.dart';
import '../theme/app_theme.dart';
import '../tracking/route_km_calculator.dart';
import '../tracking/tracking_service.dart';
import '../ui/fo_ui.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';
import '../utils/mobile_roles.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _DebugGpsCounts {
  const _DebugGpsCounts({this.localToday, this.syncedToday});

  final int? localToday;
  final int? syncedToday;
}

class _EndLocationResolution {
  const _EndLocationResolution({
    this.latitude,
    this.longitude,
    this.accuracy,
    this.capturedAt,
    required this.source,
    this.missingReason,
    this.warningAcknowledged = false,
  });

  final double? latitude;
  final double? longitude;
  final double? accuracy;
  final DateTime? capturedAt;
  final String source;
  final String? missingReason;
  final bool warningAcknowledged;

  bool get hasCoordinate => latitude != null && longitude != null;

  Map<String, dynamic> toMetadata() {
    final savedAt = DateTime.now().toUtc().toIso8601String();
    return {
      'end_location_source': source,
      'end_location_saved_at': savedAt,
      'end_location_required_for_final_km': true,
      if (accuracy != null) 'end_location_accuracy': accuracy,
      if (capturedAt != null)
        'end_location_captured_at': capturedAt!.toUtc().toIso8601String(),
      if (missingReason?.trim().isNotEmpty == true)
        'end_location_missing_reason': missingReason!.trim(),
      if (warningAcknowledged) 'final_km_warning_acknowledged': true,
      if (warningAcknowledged) 'final_km_warning_acknowledged_at': savedAt,
    };
  }
}

class _HomeScreenState extends State<HomeScreen>
    with AutomaticKeepAliveClientMixin<HomeScreen>, WidgetsBindingObserver {
  TravelLegLifecycleService get _travelLegLifecycle =>
      TravelLegLifecycleService(gateway: SupabaseTravelLegGateway(widget.user));

  Attendance? _attendance;
  bool _busy = false;
  String? _busyMessage;
  bool _endDayKmRefreshInFlight = false;
  bool _finalKmAwaitingBackend = false;
  int? _battery;
  double _km = 0;
  int _sitesToday = 0;
  String? _currentSite;
  bool _firstGpsPingLogged = false;
  String _buildNumber = '--';
  bool _manualSyncing = false;
  TrackingHealthSnapshot? _trackingHealth;
  int? _localGpsLogsToday;
  int? _syncedGpsLogsToday;

  static const List<Duration> _endDayKmRecalculationRetryDelays = [
    Duration(seconds: 5),
    Duration(seconds: 15),
    Duration(seconds: 30),
  ];

  bool get _showTrackingDebug {
    return isMobileDebugVisible(
      role: widget.user.role,
      designation: widget.user.designation,
      department: widget.user.department,
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _loadBuildInfo();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _load();
    }
  }

  Future<void> _loadBuildInfo() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() {
        _buildNumber = info.buildNumber.isEmpty ? '--' : info.buildNumber;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _buildNumber = '--');
    }
  }

  String _attendanceDateKey(Attendance attendance) {
    final value = attendance.attendanceDate?.trim();
    if (value != null && value.isNotEmpty) return value;
    return indiaDateKey(attendance.startTime);
  }

  Future<void> _load() async {
    unawaited(SupabaseService.refreshStoresWithGpsCache());
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: 'REMOTE_ATTENDANCE_RECOVERY_STARTED',
    );
    var attendance = await LocalStore.getAttendance();
    var visits = await LocalStore.getVisits();
    final today = startOfToday();
    final todayKey = indiaDateKey(DateTime.now());
    var activeVisit = await LocalStore.activeVisit(
      user: widget.user,
      attendance: attendance,
    );
    if (attendance != null) {
      final attendanceDate = _attendanceDateKey(attendance);
      final employeeMismatch =
          attendance.employeeCode.trim() != widget.user.employeeCode.trim();
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'RECOVERY_ATTENDANCE_DATE_CHECK',
        error:
            'source=local attendance_id=${attendance.remoteId ?? attendance.id} attendance_date=$attendanceDate today=$todayKey active=${attendance.isActive} employee_mismatch=$employeeMismatch',
      );
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
        visits = await LocalStore.getVisits();
      }
    }
    var hasActiveAttendanceToday =
        attendance?.isActive == true &&
        _attendanceDateKey(attendance!) == todayKey;
    var liveKm = 0.0;
    if (SupabaseService.isReady) {
      try {
        final remoteActive = await SupabaseService.findActiveAttendanceForToday(
          widget.user,
        );
        if (remoteActive != null) {
          final attendanceDate = _attendanceDateKey(remoteActive);
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'RECOVERY_ATTENDANCE_DATE_CHECK',
            error:
                'source=remote_active attendance_id=${remoteActive.remoteId} attendance_date=$attendanceDate today=$todayKey',
          );
          if (attendanceDate != todayKey) {
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'home',
              action: 'RECOVERY_PREVIOUS_DAY_COMPLETED_IGNORED',
              error:
                  'unexpected_active_attendance_id=${remoteActive.remoteId} attendance_date=$attendanceDate today=$todayKey',
            );
            attendance = null;
            hasActiveAttendanceToday = false;
          } else {
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'home',
              action: 'REMOTE_ACTIVE_ATTENDANCE_FOUND',
              error: 'attendance_id=${remoteActive.remoteId}',
            );
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'home',
              action: 'ATTENDANCE_ACTIVE_LOADED',
              error: 'attendance_id=${remoteActive.remoteId}',
            );
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'home',
              action: 'RECOVERY_TODAY_ACTIVE_RESTORED',
              error: 'attendance_id=${remoteActive.remoteId}',
            );
            attendance = remoteActive;
            hasActiveAttendanceToday = true;
            await LocalStore.saveAttendance(remoteActive);
            final remoteVisit =
                await SupabaseService.findActiveSiteVisitForAttendance(
                  user: widget.user,
                  attendance: remoteActive,
                );
            if (remoteVisit != null) {
              await CrashLogService.record(
                employeeCode: widget.user.employeeCode,
                screen: 'home',
                action: 'REMOTE_ACTIVE_SITE_VISIT_FOUND',
                error:
                    'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
              );
              await CrashLogService.record(
                employeeCode: widget.user.employeeCode,
                screen: 'home',
                action: 'ACTIVE_SITE_VISIT_LOADED',
                error:
                    'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
              );
              remoteVisit.synced = true;
              await LocalStore.saveVisit(remoteVisit);
              activeVisit = remoteVisit;
            } else {
              await _clearLocalActiveVisitCache(remoteActive);
              activeVisit = null;
            }
            visits = await LocalStore.getVisits();
          }
        } else {
          final completed =
              await SupabaseService.findCompletedAttendanceForToday(
                widget.user,
              ) ??
              await SupabaseService.findClosedAttendanceForToday(widget.user);
          if (completed != null) {
            final attendanceDate = _attendanceDateKey(completed);
            await CrashLogService.record(
              employeeCode: widget.user.employeeCode,
              screen: 'home',
              action: 'RECOVERY_ATTENDANCE_DATE_CHECK',
              error:
                  'source=remote_completed attendance_id=${completed.remoteId} attendance_date=$attendanceDate today=$todayKey',
            );
            if (attendanceDate != todayKey) {
              await CrashLogService.record(
                employeeCode: widget.user.employeeCode,
                screen: 'home',
                action: 'RECOVERY_PREVIOUS_DAY_COMPLETED_IGNORED',
                error:
                    'attendance_id=${completed.remoteId} attendance_date=$attendanceDate today=$todayKey',
              );
              attendance = null;
              hasActiveAttendanceToday = false;
              await LocalStore.saveAttendance(null);
            } else {
              await CrashLogService.record(
                employeeCode: widget.user.employeeCode,
                screen: 'home',
                action: 'REMOTE_COMPLETED_ATTENDANCE_FOUND',
                error: 'attendance_id=${completed.remoteId}',
              );
              await CrashLogService.record(
                employeeCode: widget.user.employeeCode,
                screen: 'home',
                action: 'RECOVERY_TODAY_COMPLETED_RESTORED',
                error: 'attendance_id=${completed.remoteId}',
              );
              attendance = completed;
              hasActiveAttendanceToday = false;
              await LocalStore.saveAttendance(completed);
              if (activeVisit != null) {
                await _clearLocalActiveVisitCache(completed);
                activeVisit = null;
              }
              visits = await LocalStore.getVisits();
            }
          } else if (attendance?.isActive == true) {
            final localAttendance = attendance!;
            await _clearPreviousDayLocalSession(
              attendance: localAttendance,
              attendanceDate: _attendanceDateKey(localAttendance),
              todayKey: todayKey,
              cleanupAction: 'REMOTE_NO_ACTIVE_ATTENDANCE_LOCAL_CLEANUP',
              message:
                  'Previous day was auto-closed. You can start a new day now.',
            );
            attendance = null;
            activeVisit = null;
            hasActiveAttendanceToday = false;
            visits = await LocalStore.getVisits();
          }
        }
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'REMOTE_ATTENDANCE_RECOVERY_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
    if (hasActiveAttendanceToday && attendance != null) {
      liveKm = await _calculateContinuedKm(attendance);
      final routeKm = await _routeKmFromVisits(attendance);
      attendance
        ..actualKm = liveKm
        ..totalRouteKm = routeKm
        ..eligibleKm = routeKm;
      await LocalStore.saveAttendance(attendance);
    }
    if (!mounted) return;
    setState(() {
      _attendance = attendance;
      final eligibleKm = attendance?.eligibleKm ?? 0;
      final totalRouteKm = attendance?.totalRouteKm ?? 0;
      _km = eligibleKm > 0 ? eligibleKm : totalRouteKm;
      _finalKmAwaitingBackend = false;
      _sitesToday = visits
          .where((visit) => visit.checkInTime.isAfter(today))
          .length;
      _currentSite =
          activeVisit?.storeName ??
          visits
              .where(
                (visit) => visit.isActive && visit.checkInTime.isAfter(today),
              )
              .map((visit) => visit.storeName)
              .firstOrNull;
    });
    if (hasActiveAttendanceToday && attendance != null) {
      if (activeVisit != null) {
        await TrackingService.pauseForSiteVisit(
          user: widget.user,
          visit: activeVisit,
        );
      } else if (!TrackingService.isActive) {
        await TrackingService.start(
          user: widget.user,
          attendance: attendance,
          onLog: _onLog,
        );
      }
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: 'REMOTE_ATTENDANCE_RECOVERY_COMPLETE',
      error:
          'attendance_id=${attendance?.remoteId ?? '--'} active=$hasActiveAttendanceToday active_visit=${activeVisit?.remoteId ?? activeVisit?.id ?? '--'}',
    );
    await _loadTrackingHealth();
  }

  Future<void> _loadTrackingHealth() async {
    final health = await TrackingHealthService.load(user: widget.user);
    final counts = _showTrackingDebug
        ? await _loadDebugGpsCounts(_attendance)
        : const _DebugGpsCounts();
    if (!mounted) return;
    setState(() {
      _trackingHealth = health;
      _localGpsLogsToday = counts.localToday;
      _syncedGpsLogsToday = counts.syncedToday;
    });
  }

  Future<_DebugGpsCounts> _loadDebugGpsCounts(Attendance? attendance) async {
    if (attendance == null) return const _DebugGpsCounts();
    final attendanceId = _remoteOrLocalAttendanceId(attendance);
    if (attendanceId.isEmpty) return const _DebugGpsCounts();
    final todayKey = indiaDateKey(DateTime.now());
    int? localToday;
    try {
      final localLogs = await LocalStore.getLocationLogs(
        attendanceId: attendanceId,
      );
      localToday = localLogs
          .where(
            (log) =>
                log.employeeCode.trim() == widget.user.employeeCode.trim() &&
                log.attendanceId.trim() == attendanceId &&
                indiaDateKey(log.capturedAt) == todayKey,
          )
          .length;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'DEBUG_LOCAL_GPS_COUNT_REFRESH_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }

    int? syncedToday;
    final remoteAttendanceId = attendance.remoteId?.trim() ?? '';
    if (SupabaseService.isReady &&
        SupabaseService.isValidUuid(remoteAttendanceId)) {
      try {
        final remoteLogs = await SupabaseService.fetchLocationLogsForAttendance(
          user: widget.user,
          attendanceId: remoteAttendanceId,
        );
        syncedToday = remoteLogs
            .where((log) => indiaDateKey(log.capturedAt) == todayKey)
            .length;
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'DEBUG_GPS_COUNT_REFRESH_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
    return _DebugGpsCounts(localToday: localToday, syncedToday: syncedToday);
  }

  String _remoteOrLocalAttendanceId(Attendance attendance) {
    final remoteId = attendance.remoteId?.trim() ?? '';
    if (remoteId.isNotEmpty) return remoteId;
    return attendance.id.trim();
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
      screen: 'home',
      action: 'CHECKOUT_CACHE_CLEARED',
      error: 'attendance_id=${attendance.remoteId ?? attendance.id}',
    );
  }

  Future<void> _clearPreviousDayLocalSession({
    required Attendance attendance,
    required String attendanceDate,
    required String todayKey,
    String cleanupAction = 'PREVIOUS_DAY_LOCAL_SESSION_CLEANUP',
    String? message,
  }) async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
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
        screen: 'home',
        action: 'PREVIOUS_DAY_TRACKING_STOPPED',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'PREVIOUS_DAY_TRACKING_STOP_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
    await _clearLocalActiveVisitCache(attendance);
    await LocalStore.clearBackgroundTrackingSession();
    await LocalStore.saveAttendance(null);
    _firstGpsPingLogged = false;
    if (mounted) {
      setState(() {
        _attendance = null;
        _battery = null;
        _km = 0;
        _finalKmAwaitingBackend = false;
        _sitesToday = 0;
        _currentSite = null;
      });
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: '${cleanupAction}_COMPLETE',
    );
    if (message != null && mounted) {
      _toast(message);
    }
  }

  Future<void> _syncNow() async {
    if (_manualSyncing || _busy) return;
    setState(() => _manualSyncing = true);
    try {
      final result = await AppStateSyncService.syncNow(widget.user);
      if (!mounted) return;
      _toast(result.message);
      await _load();
      await _loadTrackingHealth();
    } catch (error) {
      if (!mounted) return;
      _toast('Sync failed. Please check internet and try again.');
    } finally {
      if (mounted) setState(() => _manualSyncing = false);
    }
  }

  Future<_TravelModeSelection?> _selectTravelMode({
    String initialMode = travelModeBike,
    String? initialNote,
  }) {
    return showDialog<_TravelModeSelection>(
      context: context,
      barrierDismissible: false,
      builder: (_) =>
          _TravelModeDialog(initialMode: initialMode, initialNote: initialNote),
    );
  }

  Future<void> _changeTravelMode() async {
    final current = _attendance;
    if (_busy || current?.isActive != true) return;
    final selection = await _selectTravelMode(
      initialMode: current!.travelMode,
      initialNote: current.travelModeNote,
    );
    if (selection == null) return;
    final selectedMode = normalizeTravelMode(selection.travelMode);
    if (selectedMode == current.travelMode) {
      _toast('${travelModeLabel(selectedMode)} is already selected.');
      return;
    }
    final selectedPayable = payableKmAllowedForTravelMode(selectedMode);
    if (!selectedPayable && selection.claim == null) return;
    final now = DateTime.now().toUtc().toIso8601String();
    final metadata = Map<String, dynamic>.from(current.metadata);
    metadata['travel_mode_changed_at'] = now;
    metadata['previous_travel_mode'] = current.travelMode;
    metadata['travel_mode'] = selectedMode;
    metadata['payable_km_allowed'] = selectedPayable;
    // Phase 2: replace attendance-level mode switching with travel-leg based segmented calculation.
    metadata['phase2_travel_leg_todo'] = true;
    if (!selectedPayable) {
      metadata['payable_km_preserved_before_mode_change'] =
          _payableKmToPreserve(current);
    }
    final updated = current.copyWithTravelMode(
      travelMode: selectedMode,
      payableKmAllowed: selectedPayable,
      travelModeNote: selection.note,
      metadata: metadata,
    );
    setState(() => _busy = true);
    try {
      await TrackingService.flushForTransition('travel_mode_change');
      final transitionPosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      final transitionBoundary = TravelLegBoundary(
        at: DateTime.now().toUtc(),
        latitude: transitionPosition.latitude,
        longitude: transitionPosition.longitude,
      );
      if (!selectedPayable) {
        final claimSaved = await _saveTravelExpenseClaim(
          current,
          selection,
          travelMode: selectedMode,
        );
        if (!claimSaved) return;
      }
      final remote = SupabaseService.isReady
          ? await SupabaseService.updateAttendanceTravelMode(
              user: widget.user,
              attendance: updated,
              travelMode: updated.travelMode,
              payableKmAllowed: updated.payableKmAllowed,
              travelModeNote: updated.travelModeNote,
              metadata: metadata,
            )
          : null;
      final saved = remote ?? updated;
      try {
        await _travelLegLifecycle.changeMode(
          attendanceId: saved.remoteId!,
          employeeCode: widget.user.employeeCode,
          oldMode: current.travelMode,
          newMode: saved.travelMode,
          boundary: transitionBoundary,
        );
      } catch (_) {
        await SupabaseService.updateAttendanceTravelMode(
          user: widget.user,
          attendance: current,
          travelMode: current.travelMode,
          payableKmAllowed: current.payableKmAllowed,
          travelModeNote: current.travelModeNote,
          metadata: current.metadata,
        );
        await _travelLegLifecycle.checkOut(
          attendanceId: current.remoteId!,
          employeeCode: widget.user.employeeCode,
          mode: current.travelMode,
          boundary: transitionBoundary,
        );
        rethrow;
      }
      await LocalStore.saveAttendance(saved);
      if (!mounted) return;
      setState(() {
        _attendance = saved;
        _km = saved.eligibleKm > 0 ? saved.eligibleKm : saved.totalRouteKm;
        _finalKmAwaitingBackend = false;
      });
      if (saved.payableKmAllowed) {
        _toast(
          'Travel mode changed to ${travelModeLabel(saved.travelMode)}. '
          'Rate: ₹${travelModeRatePerKm(saved.travelMode).toStringAsFixed(0)}/KM',
        );
      } else {
        _toast('Travel mode and claim saved.');
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'TRAVEL_MODE_UPDATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (mounted) _toast('Travel mode update failed. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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

  Future<bool> _saveTravelExpenseClaim(
    Attendance attendance,
    _TravelModeSelection selection, {
    String? travelMode,
  }) async {
    final claim = selection.claim;
    if (claim == null) return true;
    if (!SupabaseService.isReady ||
        !SupabaseService.isValidUuid(attendance.remoteId)) {
      _toast('Bill/Ticket upload requires internet.');
      return false;
    }
    try {
      final connectivity = await Connectivity().checkConnectivity();
      if (connectivity.contains(ConnectivityResult.none)) {
        _toast('Bill/Ticket upload requires internet.');
        return false;
      }
      final proofPath = await SupabaseService.uploadTravelClaimProof(
        user: widget.user,
        attendance: attendance,
        fileName: claim.proof.fileName,
        bytes: claim.proof.bytes,
        contentType: claim.proof.contentType,
        extension: claim.proof.extension,
      );
      await SupabaseService.submitTravelExpenseClaim(
        user: widget.user,
        attendance: attendance,
        travelMode: travelMode ?? selection.travelMode,
        fromLocation: claim.fromLocation,
        toLocation: claim.toLocation,
        fareAmount: claim.fareAmount,
        remarks: claim.remarks,
        proofFileUrl: proofPath,
        storageBucket: SupabaseService.travelClaimProofBucket,
      );
      return true;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'TRAVEL_EXPENSE_CLAIM_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      _toast('Bill/Ticket upload failed. Please check internet and retry.');
      return false;
    }
  }

  Future<void> _startDay() async {
    if (_busy) return;
    final perf = Stopwatch()..start();
    setState(() => _busy = true);
    try {
      final authValidation = SupabaseService.validateStartDayAuth(widget.user);
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'auth_validation',
        stopwatch: perf,
      );
      if (!authValidation.isValid) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: authValidation.action,
          error: authValidation.diagnostics(),
        );
        await _showErrorDialog('Start Day failed', authValidation.message!);
        await widget.onLogout();
        return;
      }
      final employeeCode = widget.user.employeeCode.trim();
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'home',
        action: 'START_DAY_CLICKED',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'SAME_DAY_ATTENDANCE_CONTINUE_CHECK',
      );
      try {
        final existing = SupabaseService.isReady
            ? await SupabaseService.findActiveAttendanceForToday(widget.user)
            : null;
        PerformanceLogService.step(
          operation: 'start_day',
          step: 'active_attendance_check',
          stopwatch: perf,
        );
        if (existing != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'DUPLICATE_START_DAY_BLOCKED',
            error: 'attendance_id=${existing.remoteId}',
          );
          await _resumeAttendance(existing);
          _toast('Day already started. Tracking resumed.');
          return;
        }
        final completed = SupabaseService.isReady
            ? await SupabaseService.findClosedAttendanceForToday(widget.user)
            : null;
        PerformanceLogService.step(
          operation: 'start_day',
          step: 'closed_attendance_check',
          stopwatch: perf,
        );
        if (completed != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'REMOTE_COMPLETED_ATTENDANCE_FOUND',
            error: 'attendance_id=${completed.remoteId}',
          );
          final restart = await _confirmRestartDay();
          if (restart != true) {
            await LocalStore.saveAttendance(completed);
            if (mounted) {
              setState(() {
                _attendance = completed;
                _km = completed.eligibleKm;
                _finalKmAwaitingBackend = false;
              });
            }
            return;
          }
          final travelModeSelection = await _selectTravelMode();
          if (travelModeSelection == null) return;
          await _restartCompletedAttendance(
            completed,
            travelModeSelection: travelModeSelection,
          );
          return;
        }
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'START_DAY_ACTIVE_ATTENDANCE_CHECK_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        _toast(
          'Unable to verify today’s attendance. Please check internet and try again.',
        );
        return;
      }
      final ok = await PermissionService.ensureLocation();
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'permission_check',
        stopwatch: perf,
      );
      if (!ok) {
        _toast(PermissionService.message);
        return;
      }
      if (_shouldShowBatteryAdvisory()) {
        final continueStart = await _confirmBatteryAdvisory();
        if (continueStart != true) return;
      }
      final travelModeSelection = await _selectTravelMode();
      if (travelModeSelection == null) return;
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'gps_capture',
        stopwatch: perf,
      );
      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
        battery = null;
      }
      final attendance = Attendance(
        id: newLocalId('attendance'),
        employeeCode: widget.user.employeeCode,
        startTime: DateTime.now(),
        attendanceDate: indiaDateKey(DateTime.now()),
        startLat: position.latitude,
        startLng: position.longitude,
        batteryStart: battery,
        travelMode: travelModeSelection.travelMode,
        payableKmAllowed: payableKmAllowedForTravelMode(
          travelModeSelection.travelMode,
        ),
        travelModeNote: travelModeSelection.note,
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_CREATED',
        error:
            'local_id=${attendance.id} attendance_date=${attendance.attendanceDate} active=${attendance.isActive} remote_id=${attendance.remoteId ?? '--'}',
      );
      try {
        attendance.remoteId = await SupabaseService.createAttendance(
          attendance,
          widget.user,
        );
        PerformanceLogService.step(
          operation: 'start_day',
          step: 'attendance_create',
          stopwatch: perf,
        );
      } catch (error, stackTrace) {
        final failureValidation = SupabaseService.validateStartDayAuth(
          widget.user,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'ATTENDANCE_CREATE_FAILED',
          error: failureValidation.diagnostics(error: error),
          stackTrace: stackTrace,
        );
        if (failureValidation.isValid) {
          final restored = await _restoreSameDayAttendanceAfterCreateFailure();
          if (restored) return;
        }
        await _showErrorDialog(
          'Start Day failed',
          failureValidation.isValid
              ? 'Attendance sync failed. GPS tracking not started.'
              : failureValidation.message!,
        );
        return;
      }
      if (!SupabaseService.isValidUuid(attendance.remoteId)) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'ATTENDANCE_CREATE_FAILED',
          error: 'createAttendance returned invalid id: ${attendance.remoteId}',
        );
        await _showErrorDialog(
          'Start Day failed',
          'Attendance sync failed. GPS tracking not started.',
        );
        return;
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'SAME_DAY_NEW_ATTENDANCE_CREATED',
        error:
            'attendance_id=${attendance.remoteId} local_id=${attendance.id} active=${attendance.isActive}',
      );
      await LocalStore.saveAttendance(attendance);
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'attendance_local_save',
        stopwatch: perf,
      );
      await _travelLegLifecycle.startDay(
        attendanceId: attendance.remoteId!,
        employeeCode: widget.user.employeeCode,
        mode: attendance.travelMode,
        boundary: TravelLegBoundary(
          at: attendance.startTime.toUtc(),
          latitude: attendance.startLat,
          longitude: attendance.startLng,
        ),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_SAVED_LOCAL',
        error:
            'attendance_id=${attendance.remoteId ?? attendance.id} remote_id=${attendance.remoteId ?? '--'} active=${attendance.isActive}',
      );
      if (!attendance.payableKmAllowed) {
        final claimSaved = await _saveTravelExpenseClaim(
          attendance,
          travelModeSelection,
        );
        if (!claimSaved) return;
      }
      await TrackingService.saveRouteAnchor(
        user: widget.user,
        attendance: attendance,
        position: position,
        action: 'ROUTE_ANCHOR_START_DAY_SAVED',
        capturedAt: attendance.startTime,
      );
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'route_anchor_save',
        stopwatch: perf,
      );
      setState(() {
        _attendance = attendance;
        _battery = battery;
        _km = 0;
        _finalKmAwaitingBackend = false;
      });
      _firstGpsPingLogged = false;
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'BACKGROUND_TRACKING_STARTING',
      );
      final trackingStarted = await TrackingService.start(
        user: widget.user,
        attendance: attendance,
        onLog: _onLog,
      );
      PerformanceLogService.step(
        operation: 'start_day',
        step: 'tracking_start',
        stopwatch: perf,
      );
      if (!trackingStarted) {
        throw StateError('Background tracking failed to start.');
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'BACKGROUND_TRACKING_STARTED',
      );
      _toast('Attendance marked present. Tracking active.');
      await _showPendingActivityUploadReminder();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'START_DAY_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      await _showErrorDialog('Start Day failed', error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _shouldShowBatteryAdvisory() {
    final status = PermissionService.batteryOptimizationStatus.toLowerCase();
    return status == 'unknown' || status == 'restricted';
  }

  Future<void> _showPendingActivityUploadReminder() async {
    if (!SupabaseService.isReady) return;
    try {
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      final pending = await SupabaseService.fetchPendingActivityImageReminders(
        user: widget.user,
        day: yesterday,
      );
      if (!mounted || pending.isEmpty) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text("Yesterday's activity images/proofs are pending."),
          content: SizedBox(
            width: double.maxFinite,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Please upload them from Site Visit / Recent Visits.',
                ),
                const SizedBox(height: 12),
                for (final submission in pending.take(8))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      '${_activityReminderStoreName(submission)} - ${_activityReminderType(submission)}',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                if (pending.length > 8)
                  Text('+${pending.length - 8} more pending activity item(s)'),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Later'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(context).pop();
                _toast('Open Site Visit > Recent Visits to upload proofs.');
              },
              child: const Text('Upload Now'),
            ),
          ],
        ),
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'ACTIVITY_IMAGE_REMINDER_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  String _activityReminderStoreName(Map<String, dynamic> submission) {
    final metadata = submission['metadata'];
    if (metadata is Map && metadata['store_name'] != null) {
      return metadata['store_name'].toString();
    }
    return submission['store_code']?.toString() ?? 'Selected store';
  }

  String _activityReminderType(Map<String, dynamic> submission) {
    final type = submission['activity_type']?.toString() ?? '';
    switch (type) {
      case 'deep_cleaning':
        return 'Deep Cleaning';
      case 'training':
        return 'Training';
      case 'inspection':
      default:
        return 'Inspection';
    }
  }

  Future<bool?> _confirmBatteryAdvisory() async {
    final brandHelp = await PermissionService.batteryGuidanceText();
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Battery setting not confirmed'),
        content: Text(
          'Battery setting is not confirmed. Tracking may pause in background on some phones. Continue after enabling background activity.\n\n$brandHelp',
        ),
        actions: [
          TextButton(
            onPressed: () async {
              await PermissionService.openBatterySettings();
              if (context.mounted) Navigator.pop(context, false);
            },
            child: const Text('Open Settings'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }

  Future<void> _resumeAttendance(Attendance attendance) async {
    final existingKm = await _calculateContinuedKm(attendance);
    final routeKm = await _routeKmFromVisits(attendance);
    attendance
      ..actualKm = existingKm
      ..totalRouteKm = routeKm
      ..eligibleKm = routeKm;
    await LocalStore.saveAttendance(attendance);
    if (mounted) {
      setState(() {
        _attendance = attendance;
        _battery = attendance.batteryStart ?? _battery;
        _km = attendance.eligibleKm;
        _finalKmAwaitingBackend = false;
      });
    }
    final remoteVisit = SupabaseService.isReady
        ? await SupabaseService.findActiveSiteVisitForAttendance(
            user: widget.user,
            attendance: attendance,
          )
        : null;
    if (remoteVisit != null) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'REMOTE_ACTIVE_SITE_VISIT_FOUND',
        error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'ACTIVE_SITE_VISIT_LOADED',
        error: 'site_visit_id=${remoteVisit.remoteId ?? remoteVisit.id}',
      );
      remoteVisit.synced = true;
      await LocalStore.saveVisit(remoteVisit);
      if (mounted) setState(() => _currentSite = remoteVisit.storeName);
      await TrackingService.pauseForSiteVisit(
        user: widget.user,
        visit: remoteVisit,
      );
    } else {
      await _clearLocalActiveVisitCache(attendance);
      if (mounted) setState(() => _currentSite = null);
      await TrackingService.start(
        user: widget.user,
        attendance: attendance,
        onLog: _onLog,
      );
    }
  }

  Future<void> _restartCompletedAttendance(
    Attendance completed, {
    required _TravelModeSelection travelModeSelection,
  }) async {
    final reopened = await SupabaseService.reopenAttendanceForToday(
      user: widget.user,
      attendance: completed,
      travelMode: travelModeSelection.travelMode,
      payableKmAllowed: payableKmAllowedForTravelMode(
        travelModeSelection.travelMode,
      ),
      travelModeNote: travelModeSelection.note,
    );
    if (!SupabaseService.isValidUuid(reopened.remoteId)) {
      throw StateError('Restart Day failed. Attendance sync is missing.');
    }
    if (!reopened.payableKmAllowed) {
      final claimSaved = await _saveTravelExpenseClaim(
        reopened,
        travelModeSelection,
      );
      if (!claimSaved) return;
    }
    final restartPosition = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
    await _travelLegLifecycle.reopen(
      attendanceId: reopened.remoteId!,
      employeeCode: widget.user.employeeCode,
      mode: reopened.travelMode,
      boundary: TravelLegBoundary(
        at: DateTime.now().toUtc(),
        latitude: restartPosition.latitude,
        longitude: restartPosition.longitude,
      ),
    );
    await SupabaseService.updateLiveStatus(
      user: widget.user,
      isTracking: true,
      status: 'Active',
      isOnline: true,
      routeKm: reopened.eligibleKm,
      attendanceId: reopened.remoteId,
      clearActiveSiteVisit: true,
      travelMode: reopened.travelMode,
      ratePerKm: reopened.ratePerKm,
    );
    await _resumeAttendance(reopened);
    _toast('Day restarted. Tracking resumed.');
  }

  Future<double> _calculateContinuedKm(Attendance attendance) async {
    final attendanceId = attendance.remoteId ?? attendance.id;
    final logs = (await LocalStore.getLocationLogs())
        .where((log) => log.attendanceId == attendanceId)
        .toList();
    final visits = (await LocalStore.getVisits())
        .where(
          (visit) =>
              visit.attendanceId == null ||
              visit.attendanceId!.isEmpty ||
              visit.attendanceId == attendanceId ||
              visit.attendanceId == attendance.remoteId,
        )
        .toList();
    return RouteKmCalculator.calculateKm(logs, visits: visits);
  }

  bool _isCleanEndDayPosition(Position position) {
    return position.latitude.isFinite &&
        position.longitude.isFinite &&
        position.latitude >= -90 &&
        position.latitude <= 90 &&
        position.longitude >= -180 &&
        position.longitude <= 180 &&
        position.accuracy <= 50;
  }

  bool _isValidEndDayLog(LocationLog log, DateTime endTime) {
    final accuracy = log.accuracy;
    final age = endTime.difference(log.capturedAt).abs();
    return log.employeeCode.trim() == widget.user.employeeCode.trim() &&
        log.latitude.isFinite &&
        log.longitude.isFinite &&
        log.latitude >= -90 &&
        log.latitude <= 90 &&
        log.longitude >= -180 &&
        log.longitude <= 180 &&
        (accuracy == null || accuracy <= 50) &&
        age <= const Duration(hours: 1);
  }

  Future<_EndLocationResolution?> _captureFreshEndDayLocation() async {
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_FINAL_GPS_FETCH_START',
      );
      final currentPosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (_isCleanEndDayPosition(currentPosition)) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_FINAL_GPS_FETCH_SUCCESS',
        );
        return _EndLocationResolution(
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
          accuracy: currentPosition.accuracy,
          capturedAt: DateTime.now(),
          source: 'fresh_gps',
        );
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_FINAL_GPS_FETCH_FAILED',
        error: 'End Day GPS accuracy/coordinate rejected.',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_FINAL_GPS_FETCH_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
    return null;
  }

  Future<_EndLocationResolution?> _latestLocalEndDayLocation(
    String attendanceId,
    DateTime endTime,
  ) async {
    final logs =
        (await LocalStore.getLocationLogs())
            .where((log) => log.attendanceId == attendanceId)
            .where((log) => _isValidEndDayLog(log, endTime))
            .toList()
          ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    if (logs.isEmpty) return null;
    final log = logs.last;
    return _EndLocationResolution(
      latitude: log.latitude,
      longitude: log.longitude,
      accuracy: log.accuracy,
      capturedAt: log.capturedAt,
      source: 'local_latest_log',
    );
  }

  Future<_EndLocationResolution?> _latestRemoteEndDayLocation(
    String attendanceId,
    DateTime endTime,
  ) async {
    final log = await SupabaseService.fetchLatestLocationLogForAttendance(
      user: widget.user,
      attendanceId: attendanceId,
    );
    if (log == null || !_isValidEndDayLog(log, endTime)) return null;
    return _EndLocationResolution(
      latitude: log.latitude,
      longitude: log.longitude,
      accuracy: log.accuracy,
      capturedAt: log.capturedAt,
      source: 'remote_latest_log',
    );
  }

  Future<_EndLocationResolution> _resolveEndDayLocation({
    required Attendance attendance,
    required DateTime endTime,
  }) async {
    final attendanceId = attendance.remoteId ?? attendance.id;
    final fresh = await _captureFreshEndDayLocation();
    if (fresh != null) return fresh;

    final local = await _latestLocalEndDayLocation(attendanceId, endTime);
    if (local != null) return local;

    final remote = await _latestRemoteEndDayLocation(attendanceId, endTime);
    if (remote != null) return remote;

    while (mounted) {
      final retry = await _confirmMissingEndDayLocation();
      if (retry == null || retry == true) {
        final retryFresh = await _captureFreshEndDayLocation();
        if (retryFresh != null) return retryFresh;
        continue;
      }
      return _EndLocationResolution(
        source: 'missing',
        missingReason:
            'Fresh GPS, local latest GPS log, and remote latest GPS log were unavailable or not clean at End Day.',
        warningAcknowledged: true,
      );
    }

    return const _EndLocationResolution(
      source: 'missing',
      missingReason: 'End Day location confirmation dialog was unavailable.',
      warningAcknowledged: true,
    );
  }

  Future<void> _endDay() async {
    if (_busy) return;
    final perf = Stopwatch()..start();
    final attendance = _attendance;
    if (attendance == null) return;
    setState(() {
      _busy = true;
      _busyMessage = 'Ending your day...';
    });
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_STARTED',
        error: 'attendance_id=${attendance.remoteId ?? attendance.id}',
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_VALIDATION_STARTED',
        error: 'attendance_id=${attendance.remoteId ?? attendance.id}',
      );
      if (!SupabaseService.isReady) {
        _toast('End Day sync failed. Please check internet and try again.');
        return;
      }
      final resolvedAttendance = await SupabaseService.resolveEndDayAttendance(
        user: widget.user,
        attendance: attendance,
      );
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'attendance_resolution',
        stopwatch: perf,
      );
      if (resolvedAttendance == null ||
          !SupabaseService.isValidUuid(
            resolvedAttendance.attendance.remoteId,
          )) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_FAILED',
          error: 'No active attendance found for today.',
        );
        _toast('End Day failed. Today\'s active attendance was not found.');
        return;
      }
      attendance.remoteId = resolvedAttendance.attendance.remoteId;
      if (resolvedAttendance.alreadyCompleted) {
        attendance
          ..endTime = resolvedAttendance.attendance.endTime ?? DateTime.now()
          ..endLat = resolvedAttendance.attendance.endLat
          ..endLng = resolvedAttendance.attendance.endLng
          ..batteryEnd = resolvedAttendance.attendance.batteryEnd
          ..actualKm = resolvedAttendance.attendance.actualKm
          ..eligibleKm = resolvedAttendance.attendance.eligibleKm
          ..totalRouteKm = resolvedAttendance.attendance.totalRouteKm
          ..endRouteKm = resolvedAttendance.attendance.endRouteKm;
        await _travelLegLifecycle.endDay(
          attendanceId: attendance.remoteId!,
          boundary: TravelLegBoundary(
            at: attendance.endTime!.toUtc(),
            latitude: attendance.endLat,
            longitude: attendance.endLng,
          ),
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ALREADY_COMPLETED_CLEANUP_STARTED',
          error: 'attendance_id=${attendance.remoteId}',
        );
        try {
          await TrackingService.stop(
            user: widget.user,
            routeKm: attendance.eligibleKm,
            updateRemoteLiveStatus: false,
            reason: 'end_day_already_completed',
          );
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_TRACKING_STOPPED',
          );
        } catch (error, stackTrace) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_TRACKING_STOP_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
        await _clearLocalActiveVisitCache(attendance);
        await LocalStore.saveAttendance(attendance);
        if (mounted) {
          setState(() {
            _attendance = attendance;
            _finalKmAwaitingBackend = SupabaseService.isValidUuid(
              attendance.remoteId,
            );
            _battery = attendance.batteryEnd;
            _currentSite = null;
          });
        }
        _toast(
          'End Day was already completed. App status has been synchronized.',
        );
        if (SupabaseService.isValidUuid(attendance.remoteId)) {
          unawaited(
            _refreshEndDayKmFromBackend(
              attendanceId: attendance.remoteId!,
              attendanceDate: attendance.attendanceDate,
              fallbackBattery: attendance.batteryEnd,
            ),
          );
        }
        return;
      }
      final openSiteVisit =
          await SupabaseService.findActiveSiteVisitForAttendance(
            user: widget.user,
            attendance: resolvedAttendance.attendance,
          );
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'active_visit_lookup',
        stopwatch: perf,
      );
      final openVisitsCount = openSiteVisit == null ? 0 : 1;
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_OPEN_VISITS_COUNT',
        error:
            'count=$openVisitsCount attendance_id=${resolvedAttendance.attendance.remoteId}',
      );
      var endDayWithOpenSite = false;
      if (openSiteVisit != null) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_OPEN_SITE_WARNING_SHOWN',
          error:
              'site_visit_id=${openSiteVisit.remoteId ?? openSiteVisit.id} attendance_id=${resolvedAttendance.attendance.remoteId}',
        );
        final continueEndDay = await _confirmEndDayWithOpenSiteVisit();
        if (continueEndDay != true) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_OPEN_SITE_WARNING_CANCELLED',
            error:
                'site_visit_id=${openSiteVisit.remoteId ?? openSiteVisit.id} attendance_id=${resolvedAttendance.attendance.remoteId}',
          );
          return;
        }
        endDayWithOpenSite = true;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_OPEN_SITE_WARNING_ACCEPTED',
          error:
              'site_visit_id=${openSiteVisit.remoteId ?? openSiteVisit.id} attendance_id=${resolvedAttendance.attendance.remoteId}',
        );
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: endDayWithOpenSite
            ? 'END_DAY_ALLOWED_WITH_OPEN_SITE'
            : 'END_DAY_ALLOWED_NO_OPEN_VISITS',
        error:
            'attendance_id=${resolvedAttendance.attendance.remoteId} end_day_with_open_site=$endDayWithOpenSite',
      );
      final endTime = DateTime.now();
      final endLocation = await _resolveEndDayLocation(
        attendance: attendance,
        endTime: endTime,
      );
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'end_location_resolution',
        stopwatch: perf,
      );
      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
        battery = null;
      }
      final endLatitude = endLocation.latitude;
      final endLongitude = endLocation.longitude;
      final endAccuracy = endLocation.accuracy;
      const endSpeed = 0.0;
      await TrackingService.syncQueuedLogs(force: true);
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'queued_log_sync',
        stopwatch: perf,
      );
      final actualKm = await _calculateContinuedKm(attendance);
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'continued_km_calculation',
        stopwatch: perf,
      );
      final autoCloseResult = endDayWithOpenSite
          ? await SupabaseService.autoCloseOpenSiteVisitsForEndDay(
              user: widget.user,
              attendance: attendance,
              closedAt: endTime,
            )
          : (firstClosedVisitId: null, closedCount: 0);
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'open_visit_autoclose',
        stopwatch: perf,
      );
      final routeKm = await _routeKmFromVisits(attendance);
      PerformanceLogService.step(
        operation: 'end_day',
        step: 'route_km_from_visits',
        stopwatch: perf,
      );
      attendance
        ..endTime = endTime
        ..endLat = endLatitude
        ..endLng = endLongitude
        ..batteryEnd = battery
        ..actualKm = actualKm
        ..endRouteKm = 0
        ..totalRouteKm = routeKm
        ..eligibleKm = routeKm;
      try {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_STARTED',
        );
        final completedAttendance =
            await SupabaseService.endCurrentActiveAttendance(
              user: widget.user,
              attendance: attendance,
              endDayWithOpenSite: endDayWithOpenSite,
              openSiteAutoClosed: autoCloseResult.closedCount > 0,
              autoClosedSiteVisitId: autoCloseResult.firstClosedVisitId,
              endLocationMetadata: endLocation.toMetadata(),
            );
        PerformanceLogService.step(
          operation: 'end_day',
          step: 'attendance_close',
          stopwatch: perf,
        );
        attendance
          ..remoteId = completedAttendance.attendance.remoteId
          ..endTime = completedAttendance.attendance.endTime ?? endTime
          ..endLat = completedAttendance.attendance.endLat ?? endLatitude
          ..endLng = completedAttendance.attendance.endLng ?? endLongitude
          ..metadata = completedAttendance.attendance.metadata;
        await _travelLegLifecycle.endDay(
          attendanceId: attendance.remoteId!,
          boundary: TravelLegBoundary(
            at: endTime.toUtc(),
            latitude: endLatitude,
            longitude: endLongitude,
          ),
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: completedAttendance.alreadyCompleted
              ? 'END_DAY_ATTENDANCE_ALREADY_COMPLETED'
              : 'END_DAY_ATTENDANCE_UPDATE_SUCCESS',
        );
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        _toast('End Day failed. Please try again.');
        return;
      }
      var secondarySyncPending = false;
      try {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_LIVE_STATUS_UPDATE_STARTED',
          error: 'attendance_id=${attendance.remoteId}',
        );
        await SupabaseService.updateEndDayLiveStatus(
          user: widget.user,
          latitude: endLatitude,
          longitude: endLongitude,
          accuracy: endAccuracy,
          speed: endSpeed,
          routeKm: attendance.eligibleKm,
          attendanceId: attendance.remoteId,
        );
        PerformanceLogService.step(
          operation: 'end_day',
          step: 'live_status_update',
          stopwatch: perf,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_LIVE_STATUS_UPDATED',
          error: 'attendance_id=${attendance.remoteId}',
        );
      } catch (error, stackTrace) {
        secondarySyncPending = true;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_SECONDARY_SYNC_PENDING',
          error: error,
          stackTrace: stackTrace,
        );
      }
      try {
        await TrackingService.stop(
          user: widget.user,
          latitude: endLatitude,
          longitude: endLongitude,
          accuracy: endAccuracy,
          speed: endSpeed,
          routeKm: attendance.eligibleKm,
          updateRemoteLiveStatus: false,
          reason: 'end_day',
        );
        PerformanceLogService.step(
          operation: 'end_day',
          step: 'tracking_stop',
          stopwatch: perf,
        );
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_TRACKING_STOPPED',
        );
      } catch (error, stackTrace) {
        secondarySyncPending = true;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_TRACKING_STOP_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
      await _clearLocalActiveVisitCache(attendance);
      await LocalStore.saveAttendance(attendance);
      if (mounted) {
        setState(() {
          _attendance = attendance;
          _finalKmAwaitingBackend = SupabaseService.isValidUuid(
            attendance.remoteId,
          );
          _battery = battery;
          _currentSite = null;
        });
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_CACHE_CLEARED',
        error: 'attendance_id=${attendance.remoteId ?? attendance.id}',
      );
      if (secondarySyncPending) {
        _toast('Day ended successfully. Status synchronization pending.');
      } else {
        _toast('Day ended successfully.');
      }
      if (SupabaseService.isValidUuid(attendance.remoteId)) {
        unawaited(
          _refreshEndDayKmFromBackend(
            attendanceId: attendance.remoteId!,
            attendanceDate: attendance.attendanceDate,
            fallbackBattery: battery,
          ),
        );
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      _toast('End Day failed. Please try again.');
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyMessage = null;
        });
      }
    }
  }

  bool _recalculationResultBelongsToAttendance(
    Map<String, dynamic> result,
    String attendanceId,
  ) {
    final resultAttendanceId = result['attendance_id']?.toString().trim();
    return resultAttendanceId == null ||
        resultAttendanceId.isEmpty ||
        resultAttendanceId == attendanceId.trim();
  }

  void _applyBackendAttendance({
    required Attendance target,
    required Attendance source,
    int? fallbackBattery,
  }) {
    target
      ..remoteId = source.remoteId ?? target.remoteId
      ..endTime = source.endTime ?? target.endTime
      ..endLat = source.endLat ?? target.endLat
      ..endLng = source.endLng ?? target.endLng
      ..batteryEnd = source.batteryEnd ?? fallbackBattery ?? target.batteryEnd
      ..actualKm = source.actualKm
      ..eligibleKm = source.eligibleKm
      ..totalRouteKm = source.totalRouteKm
      ..petrolAmount = source.petrolAmount
      ..metadata = source.metadata;
  }

  Future<void> _refreshEndDayKmFromBackend({
    required String attendanceId,
    String? attendanceDate,
    int? fallbackBattery,
  }) async {
    final id = attendanceId.trim();
    if (_endDayKmRefreshInFlight ||
        !SupabaseService.isReady ||
        !SupabaseService.isValidUuid(id)) {
      return;
    }
    _endDayKmRefreshInFlight = true;
    try {
      for (
        var attempt = 0;
        attempt <= _endDayKmRecalculationRetryDelays.length;
        attempt += 1
      ) {
        if (attempt > 0) {
          await Future<void>.delayed(
            _endDayKmRecalculationRetryDelays[attempt - 1],
          );
        }
        try {
          final recalcResult = await SupabaseService.triggerFoKmRecalculation(
            attendanceId: id,
            foUserId: widget.user.employeeCode,
            date: attendanceDate,
          );
          if (!_recalculationResultBelongsToAttendance(recalcResult, id)) {
            throw StateError('KM recalculation returned a different record.');
          }
          final refreshedAttendance = await SupabaseService.findAttendanceById(
            user: widget.user,
            attendanceId: id,
          );
          if (refreshedAttendance == null) {
            throw StateError('KM recalculation attendance refresh failed.');
          }
          final current = _attendance;
          if (current != null &&
              (current.remoteId ?? current.id).trim() == id) {
            _applyBackendAttendance(
              target: current,
              source: refreshedAttendance,
              fallbackBattery: fallbackBattery ?? _battery,
            );
            await LocalStore.saveAttendance(current);
            if (!mounted) return;
            setState(() {
              _attendance = current;
              _km = current.eligibleKm;
              _battery = current.batteryEnd ?? _battery;
              _finalKmAwaitingBackend = false;
            });
          } else {
            await LocalStore.saveAttendance(refreshedAttendance);
            if (!mounted) return;
            setState(() {
              _attendance = refreshedAttendance;
              _km = refreshedAttendance.eligibleKm;
              _battery = refreshedAttendance.batteryEnd ?? _battery;
              _finalKmAwaitingBackend = false;
            });
          }
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_KM_RECALCULATION_REFRESHED',
            error: 'attendance_id=$id route_km=$_km',
          );
          return;
        } catch (error, stackTrace) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_KM_RECALCULATION_RETRY_PENDING',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
    } finally {
      _endDayKmRefreshInFlight = false;
    }
  }

  Future<bool> _restoreSameDayAttendanceAfterCreateFailure() async {
    if (!SupabaseService.isReady) return false;
    try {
      final existing = await SupabaseService.findActiveAttendanceForToday(
        widget.user,
      );
      if (existing != null) {
        await _resumeAttendance(existing);
        _toast('Day already started. Tracking resumed.');
        return true;
      }
      final completed = await SupabaseService.findCompletedAttendanceForToday(
        widget.user,
      );
      if (completed != null) {
        await LocalStore.saveAttendance(completed);
        if (mounted) {
          setState(() {
            _attendance = completed;
            _km = completed.eligibleKm;
            _finalKmAwaitingBackend = false;
          });
        }
        _toast('Today\'s duty is already completed.');
        return true;
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'START_DAY_CREATE_FAILURE_RESTORE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
    return false;
  }

  Future<bool?> _confirmRestartDay() async {
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Restart Day?'),
        content: const Text(
          'You have already ended your day today. If this was accidental, you can restart duty and GPS tracking will continue for the same attendance day.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Restart Day'),
          ),
        ],
      ),
    );
  }

  void _onLog(LocationLog log, double liveKm) {
    if (!mounted) return;
    if (!_firstGpsPingLogged) {
      _firstGpsPingLogged = true;
      CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'FIRST_GPS_PING_SAVED',
      );
    }
    _attendance?.actualKm = liveKm;
    final activeVisitFuture = LocalStore.activeVisit(
      user: widget.user,
      attendance: _attendance,
    );
    activeVisitFuture.then((visit) {
      if (!mounted) return;
      setState(() => _currentSite = visit?.storeName);
    });
    setState(() {
      if (!_finalKmAwaitingBackend) {
        _km = _attendance?.eligibleKm ?? 0;
      }
      _battery = log.battery;
    });
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

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool?> _confirmEndDayWithOpenSiteVisit() async {
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Site visit not checked out'),
        content: const Text(
          'One site visit is still not checked out. If you continue End Day, this site visit will be auto-closed, but any KM travelled after site Check-In will not be added for petrol/KM calculation. Please continue only if you forgot to check out or have completed the day.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Continue & End Day'),
          ),
        ],
      ),
    );
  }

  Future<bool?> _confirmMissingEndDayLocation() async {
    if (!mounted) return false;
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('End location not available'),
        content: const Text(
          'End Day GPS location could not be captured. Final return KM may not be calculated. Please move to open sky, enable location, and retry.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('End Day Without Final KM'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Retry GPS'),
          ),
        ],
      ),
    );
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

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final active = _attendance?.isActive == true;
    return Scaffold(
      body: FoPage(
        children: [
          _homeHeader(),
          const SizedBox(height: 22),
          _overviewCard(),
          const SizedBox(height: 16),
          if (active) ...[_travelModeCard(), const SizedBox(height: 16)],
          if (_showTrackingDebug) ...[
            _trackingHealthCard(),
            const SizedBox(height: 14),
            _debugIdentityCard(),
          ] else
            _employeeTrackingStatusCard(),
          const SizedBox(height: 16),
          _dutyCard(active),
          const SizedBox(height: 16),
          _recentActivityCard(active),
        ],
      ),
    );
  }

  Widget _homeHeader() {
    final active = _attendance?.isActive == true;
    final completed = _attendance?.endTime != null;
    final now = DateTime.now();
    final statusLabel = active
        ? 'Tracking Active'
        : completed
        ? 'Completed'
        : 'Not Started';
    final statusColor = active
        ? foGreen
        : completed
        ? foPurple
        : qpmsBlue;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            IconButton(
              onPressed: () {},
              icon: const Icon(Icons.menu_rounded, color: qpmsBlue, size: 30),
            ),
            const Spacer(),
            const FoNotificationButton(),
          ],
        ),
        const SizedBox(height: 18),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 52,
              height: 52,
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x120A43D1),
                    blurRadius: 16,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              child: Image.asset('assets/qpms-logo.png', fit: BoxFit.contain),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Good Morning,',
                    style: TextStyle(
                      color: foNavy,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    widget.user.fullName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 30,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    widget.user.employeeCode,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${now.day.toString().padLeft(2, '0')} ${_month(now.month)} ${now.year}',
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  formatTime(now),
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 14),
        FoStatusBadge(label: statusLabel, color: statusColor, showDot: active),
      ],
    );
  }

  Widget _overviewCard() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(title: "Today's Overview"),
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = (constraints.maxWidth - 12) / 2;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _metricTile(
                    width: width,
                    icon: Icons.route_rounded,
                    color: qpmsBlue,
                    label: 'Today KM',
                    value: _todayKmLabel(),
                  ),
                  _metricTile(
                    width: width,
                    icon: Icons.location_on_outlined,
                    color: foGreen,
                    label: 'Sites Visited',
                    value: '$_sitesToday',
                  ),
                  _metricTile(
                    width: width,
                    icon: Icons.schedule_rounded,
                    color: foOrange,
                    label: 'Duty Hours',
                    value: _dutyHoursLabel(),
                  ),
                  _metricTile(
                    width: width,
                    icon: Icons.battery_charging_full_rounded,
                    color: foPurple,
                    label: 'Battery',
                    value: _battery == null ? '--' : '$_battery%',
                  ),
                  _metricTile(
                    width: width,
                    icon: Icons.sync_rounded,
                    color: const Color(0xFF303A6B),
                    label: 'Sync Status',
                    value: _syncStatusLabel(),
                  ),
                  _metricTile(
                    width: width,
                    icon: Icons.gps_fixed_rounded,
                    color: qpmsBlue,
                    label: 'GPS Status',
                    value: TrackingService.lastTrackingError == null
                        ? 'OK'
                        : 'Check',
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: _busy || _manualSyncing ? null : _syncNow,
            icon: _manualSyncing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync_rounded),
            label: Text(
              _manualSyncing
                  ? 'Syncing app state...'
                  : 'Sync Now • Refresh app state from server',
            ),
          ),
        ],
      ),
    );
  }

  Widget _travelModeCard() {
    final attendance = _attendance;
    final mode = attendance == null ? travelModeBike : attendance.travelMode;
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const FoSectionTitle(title: 'Travel Mode'),
          const SizedBox(height: 14),
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: qpmsBlue.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.swap_horiz_rounded, color: qpmsBlue),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Current Travel Mode: ${travelModeLabel(mode)}',
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: _busy ? null : _changeTravelMode,
            icon: const Icon(Icons.swap_horiz_rounded),
            label: const Text('Change Travel Mode'),
          ),
        ],
      ),
    );
  }

  Widget _metricTile({
    required double width,
    required IconData icon,
    required Color color,
    required String label,
    required String value,
  }) {
    return SizedBox(
      width: width,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: foBorder),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0C0A43D1),
              blurRadius: 14,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          children: [
            FoIconCircle(icon: icon, color: color, size: 52, iconSize: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: Color(0xFF4D5A7A),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _trackingHealthCard() {
    final health = _trackingHealth;
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoSectionTitle(
            title: 'Tracking Health',
            trailing: FoStatusBadge(
              label: health == null ? 'Loading' : _overallHealthLabel(health),
              color: health == null || !_requiredPermissionsReady(health)
                  ? foOrange
                  : foGreen,
            ),
          ),
          const SizedBox(height: 14),
          if (health == null)
            const Text(
              'Checking app health...',
              style: TextStyle(color: Color(0xFF53607D)),
            )
          else ...[
            _healthRow(
              'Location permission (Required)',
              health.locationPermissionLabel,
              health.locationPermission,
            ),
            _healthRow(
              'Location service / GPS (Required)',
              health.locationServiceLabel,
              health.locationServiceEnabled
                  ? HealthLevel.ok
                  : HealthLevel.needsAction,
            ),
            _healthRow(
              'Battery / background activity (Recommended)',
              health.batteryLabel,
              health.battery,
            ),
            _healthRow('Tracking', health.trackingLabel, health.tracking),
            _plainHealthRow(
              'Last GPS',
              health.lastGpsAt == null
                  ? 'Not available'
                  : formatTime(health.lastGpsAt),
            ),
            _plainHealthRow('Pending GPS Logs', '${health.pendingGpsLogs}'),
            _plainHealthRow(
              'Pilot GPS C / Q / U',
              '${health.dailyMetrics['gps_collected'] ?? 0} / '
                  '${health.dailyMetrics['gps_queued'] ?? 0} / '
                  '${health.dailyMetrics['gps_uploaded'] ?? 0}',
            ),
            _plainHealthRow(
              'Pilot batches OK / failed',
              '${health.dailyMetrics['batch_successes'] ?? 0} / '
                  '${health.dailyMetrics['batch_failures'] ?? 0}',
            ),
            _plainHealthRow(
              'Last Sync',
              health.lastSyncAt == null
                  ? 'Not available'
                  : formatTime(health.lastSyncAt),
            ),
            if (health.guidance.isNotEmpty) ...[
              const SizedBox(height: 10),
              ...health.guidance.map(
                (message) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.info_outline_rounded,
                        size: 18,
                        color: foOrange,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          message,
                          style: const TextStyle(
                            color: Color(0xFF53607D),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _busy ? null : _loadTrackingHealth,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Refresh permission status'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () async => PermissionService.openBatterySettings(),
                  icon: const Icon(Icons.settings_rounded),
                  label: const Text('Open Battery Settings'),
                ),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () async => PermissionService.openAppSettings(),
                  child: const Text('Open App Settings'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _employeeTrackingStatusCard() {
    final health = _trackingHealth;
    final permissionOk = health == null || _requiredPermissionsReady(health);
    final lastSync = health?.lastSyncAt ?? TrackingService.lastSuccessfulSync;
    return FoCard(
      child: Row(
        children: [
          FoIconCircle(
            icon: Icons.verified_rounded,
            color: permissionOk ? foGreen : foOrange,
            size: 48,
            iconSize: 26,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  permissionOk ? 'App is ready' : 'App not ready',
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  permissionOk
                      ? 'Required location settings OK'
                      : 'Allow all the time location and turn GPS on',
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Last synced: ${lastSync == null ? '--' : formatTime(lastSync)}',
                  style: const TextStyle(
                    color: qpmsMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _healthRow(String label, String value, HealthLevel level) {
    return _plainHealthRow(
      label,
      value,
      valueColor: switch (level) {
        HealthLevel.ok => foGreen,
        HealthLevel.needsAction => foOrange,
        HealthLevel.unknown => qpmsMuted,
      },
    );
  }

  Widget _plainHealthRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF53607D),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: valueColor ?? foNavy,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  String _overallHealthLabel(TrackingHealthSnapshot health) {
    return _requiredPermissionsReady(health) ? 'App ready' : 'Needs Action';
  }

  bool _requiredPermissionsReady(TrackingHealthSnapshot health) {
    return health.locationPermission == HealthLevel.ok &&
        health.locationServiceEnabled;
  }

  Widget _dutyCard(bool active) {
    final completed = _attendance?.endTime != null;
    final statusLabel = active
        ? 'Tracking Active'
        : completed
        ? 'Completed'
        : 'Not Started';
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FoSectionTitle(
            title: "Today's Duty",
            trailing: FoStatusBadge(
              label: statusLabel,
              color: active
                  ? foGreen
                  : completed
                  ? foPurple
                  : qpmsBlue,
            ),
          ),
          const SizedBox(height: 18),
          Icon(
            active
                ? Icons.check_circle_outline_rounded
                : completed
                ? Icons.verified_rounded
                : Icons.assignment_outlined,
            size: 82,
            color: qpmsBlue.withValues(alpha: 0.25),
          ),
          const SizedBox(height: 12),
          Text(
            active
                ? 'Your day is active and tracking is running.'
                : completed
                ? 'Your duty is completed for today.'
                : "You haven't started your day yet.",
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: foNavy,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            active
                ? 'End your day only after completing all visits.'
                : completed
                ? 'Today KM and visit history are available below.'
                : 'Tap the button below to start your duty and begin tracking.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF53607D),
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 22),
          if (active)
            FoPrimaryButton(
              label: 'End Day',
              icon: Icons.stop_rounded,
              onPressed: _busy ? null : _endDay,
            )
          else
            FoPrimaryButton(
              label: 'Start Day',
              icon: Icons.play_arrow_rounded,
              onPressed: _busy ? null : _startDay,
            ),
          if (_busyMessage != null) ...[
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    _busyMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF53607D),
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _todayKmLabel() {
    if (_finalKmAwaitingBackend) return '--';
    return '${_km.toStringAsFixed(2)} km';
  }

  Widget _recentActivityCard(bool active) {
    final rows = [
      _TimelineRow(
        time: formatTime(_attendance?.startTime),
        title: 'Start Day',
        subtitle: _attendance == null ? 'Duty not started' : 'Duty started',
        color: foGreen,
        badge: _attendance == null ? 'Pending' : 'Completed',
        badgeColor: _attendance == null ? qpmsMuted : foGreen,
      ),
      _TimelineRow(
        time: _currentSite == null ? '--' : 'Now',
        title: 'Check-In',
        subtitle: _currentSite ?? 'No active site',
        color: qpmsBlue,
        badge: _currentSite == null ? 'Pending' : 'In Progress',
        badgeColor: _currentSite == null ? qpmsMuted : qpmsBlue,
      ),
      _TimelineRow(
        time: '--',
        title: 'Check-Out',
        subtitle: _currentSite ?? 'Awaiting site visit',
        color: const Color(0xFF303A6B),
        badge: 'Pending',
        badgeColor: qpmsMuted,
      ),
      _TimelineRow(
        time: active ? 'Now' : '--',
        title: 'Travelling',
        subtitle: active ? 'Tracking active' : 'Not travelling',
        color: foOrange,
        badge: active ? 'In Progress' : 'Pending',
        badgeColor: active ? qpmsBlue : qpmsMuted,
      ),
    ];
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(title: 'Recent Activity'),
          const SizedBox(height: 18),
          for (final row in rows) _timelineItem(row),
        ],
      ),
    );
  }

  Widget _timelineItem(_TimelineRow row) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 16,
                height: 16,
                decoration: BoxDecoration(
                  color: row.color,
                  shape: BoxShape.circle,
                ),
              ),
              Container(width: 2, height: 34, color: foBorder),
            ],
          ),
          const SizedBox(width: 18),
          SizedBox(
            width: 68,
            child: Text(
              row.time,
              style: const TextStyle(
                color: Color(0xFF53607D),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.title,
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  row.subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          FoStatusBadge(label: row.badge, color: row.badgeColor),
        ],
      ),
    );
  }

  String _dutyHoursLabel() {
    final attendance = _attendance;
    if (attendance == null) return '00h 00m';
    final end = attendance.endTime ?? DateTime.now();
    return formatDurationShort(end.difference(attendance.startTime));
  }

  String _syncStatusLabel() {
    if (TrackingService.queueLength > 0) return 'Pending';
    if (TrackingService.lastTrackingError != null) return 'Offline';
    return 'Synced';
  }

  String _month(int month) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return months[month - 1];
  }

  Widget _debugIdentityCard() {
    final attendance = _attendance;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Tracking Debug',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            _debugRow('Auth user id', widget.user.authUserId),
            _debugRow('Employee code', widget.user.employeeCode),
            _debugRow('Attendance remoteId', attendance?.remoteId ?? '--'),
            _debugRow('Tracking fo_user_id', widget.user.employeeCode),
            _debugRow('App Build Time', appBuildTime),
            _debugRow('Git Commit', appGitCommit),
            _debugRow('Build Number', _buildNumber),
            _debugRow('Tracking mode', TrackingService.trackingMode),
            _debugRow('GPS permission', PermissionService.locationStatus),
            _debugRow(
              'Background GPS',
              PermissionService.backgroundLocationStatus,
            ),
            _debugRow('Notifications', PermissionService.notificationStatus),
            _debugRow(
              'Battery optimization',
              PermissionService.batteryOptimizationStatus,
            ),
            _debugRow('Last GPS sync', formatTime(TrackingService.lastGpsSync)),
            _debugRow(
              'Last remote sync',
              formatTime(TrackingService.lastSuccessfulSync),
            ),
            _debugRow(
              'Last lat/lng',
              _formatLatLng(
                TrackingService.lastLatitude,
                TrackingService.lastLongitude,
              ),
            ),
            _debugRow(
              'GPS accuracy',
              _formatMeters(TrackingService.lastAccuracy),
            ),
            _debugRow(
              'Local GPS logs today',
              (_localGpsLogsToday ?? TrackingService.gpsLogsToday).toString(),
            ),
            _debugRow(
              'Synced GPS logs today',
              _syncedGpsLogsToday?.toString() ?? '--',
            ),
            _debugRow(
              'Pending GPS logs',
              (_trackingHealth?.pendingGpsLogs ?? TrackingService.queueLength)
                  .toString(),
            ),
            _debugRow('Accepted KM today', _km.toStringAsFixed(2)),
            _debugRow(
              'Last tracking error',
              TrackingService.lastTrackingError ??
                  PermissionService.warning ??
                  '--',
            ),
          ],
        ),
      ),
    );
  }

  String _formatLatLng(double? latitude, double? longitude) {
    if (latitude == null || longitude == null) return '--';
    return '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}';
  }

  String _formatMeters(double? meters) {
    if (meters == null) return '--';
    return '${meters.toStringAsFixed(1)} m';
  }

  Widget _debugRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        '$label: ${value.isEmpty ? '--' : value}',
        style: const TextStyle(
          color: qpmsMuted,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}

class _TimelineRow {
  const _TimelineRow({
    required this.time,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.badge,
    required this.badgeColor,
  });

  final String time;
  final String title;
  final String subtitle;
  final Color color;
  final String badge;
  final Color badgeColor;
}

class _TravelModeSelection {
  const _TravelModeSelection({required this.travelMode, this.note, this.claim});

  final String travelMode;
  final String? note;
  final _TravelExpenseClaimDraft? claim;
}

const _maxTravelClaimProofBytes = 5 * 1024 * 1024;
const _travelClaimImageMaxWidth = 1280.0;
const _travelClaimImageQuality = 70;

class _TravelModeDialog extends StatefulWidget {
  const _TravelModeDialog({
    this.initialMode = travelModeBike,
    this.initialNote,
  });

  final String initialMode;
  final String? initialNote;

  @override
  State<_TravelModeDialog> createState() => _TravelModeDialogState();
}

class _TravelModeDialogState extends State<_TravelModeDialog> {
  final _picker = ImagePicker();
  final _fromController = TextEditingController();
  final _toController = TextEditingController();
  final _amountController = TextEditingController();
  final _remarksController = TextEditingController();
  String _selectedMode = travelModeBike;
  String? _claimError;
  _TravelClaimProofDraft? _proof;

  @override
  void initState() {
    super.initState();
    final initialMode = normalizeTravelMode(widget.initialMode);
    _selectedMode = initialMode == travelModeOwnVehicle
        ? travelModeBike
        : initialMode;
    _remarksController.text = widget.initialNote?.trim() ?? '';
  }

  @override
  void dispose() {
    _fromController.dispose();
    _toController.dispose();
    _amountController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const options = [
      travelModeBike,
      travelModeCar,
      travelModeAuto,
      travelModeBus,
      travelModeTrain,
      travelModeOther,
    ];
    final payable = payableKmAllowedForTravelMode(_selectedMode);
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      insetPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
      title: const Text('Select Travel Mode'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _selectedMode,
              decoration: const InputDecoration(
                labelText: 'Travel Mode',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final mode in options)
                  DropdownMenuItem(
                    value: mode,
                    child: Text(travelModeLabel(mode)),
                  ),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() {
                  _selectedMode = value;
                  _claimError = null;
                });
              },
            ),
            if (!payable) ...[
              const SizedBox(height: 18),
              const Text(
                'Travel Claim',
                style: TextStyle(fontWeight: FontWeight.w900, color: foNavy),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _fromController,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'From',
                  hintText: 'Enter from location',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _toController,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'To',
                  hintText: 'Enter to location',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amountController,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Amount',
                  hintText: 'Enter amount',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _remarksController,
                minLines: 2,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Remarks',
                  hintText: 'Enter remarks (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Bill/Ticket',
                style: TextStyle(fontWeight: FontWeight.w900, color: foNavy),
              ),
              const SizedBox(height: 8),
              InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: _pickProof,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 18,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: foBorder),
                    color: const Color(0xFFF8FAFF),
                  ),
                  child: _proof == null
                      ? const Column(
                          children: [
                            Icon(Icons.cloud_upload_outlined, color: qpmsBlue),
                            SizedBox(height: 6),
                            Text(
                              'Tap to upload',
                              style: TextStyle(
                                color: qpmsBlue,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 4),
                            Text(
                              'JPG, PNG, PDF (Max 5 MB)',
                              style: TextStyle(
                                color: Color(0xFF53607D),
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        )
                      : Row(
                          children: [
                            Icon(
                              _proof!.isPdf
                                  ? Icons.picture_as_pdf_rounded
                                  : Icons.image_rounded,
                              color: qpmsBlue,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _proof!.fileName,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: foNavy,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: 'Remove',
                              onPressed: () => setState(() => _proof = null),
                              icon: const Icon(Icons.close_rounded),
                            ),
                          ],
                        ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: _pickProof,
                    icon: const Icon(Icons.attach_file_rounded),
                    label: Text(_proof == null ? 'Choose file' : 'Change'),
                  ),
                  if (_proof != null)
                    TextButton(
                      onPressed: () => setState(() => _proof = null),
                      child: const Text('Remove'),
                    ),
                ],
              ),
              if (_claimError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _claimError!,
                  style: const TextStyle(
                    color: Colors.redAccent,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _continue,
          child: Text(payable ? 'Continue' : 'Save & Continue'),
        ),
      ],
    );
  }

  Future<void> _pickProof() async {
    final source = await showModalBottomSheet<_TravelClaimProofSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Take photo'),
              onTap: () =>
                  Navigator.pop(context, _TravelClaimProofSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Choose image'),
              onTap: () =>
                  Navigator.pop(context, _TravelClaimProofSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.picture_as_pdf_rounded),
              title: const Text('Choose PDF'),
              onTap: () => Navigator.pop(context, _TravelClaimProofSource.pdf),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      switch (source) {
        case _TravelClaimProofSource.camera:
          final file = await _picker.pickImage(
            source: ImageSource.camera,
            maxWidth: _travelClaimImageMaxWidth,
            imageQuality: _travelClaimImageQuality,
            requestFullMetadata: false,
          );
          if (file != null) await _setProofFromXFile(file);
          break;
        case _TravelClaimProofSource.gallery:
          final file = await _picker.pickImage(
            source: ImageSource.gallery,
            maxWidth: _travelClaimImageMaxWidth,
            imageQuality: _travelClaimImageQuality,
            requestFullMetadata: false,
          );
          if (file != null) await _setProofFromXFile(file);
          break;
        case _TravelClaimProofSource.pdf:
          await _setProofFromPdf();
          break;
      }
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _claimError = source == _TravelClaimProofSource.pdf
            ? 'Bill/Ticket file could not be selected.'
            : 'Bill/Ticket image compression failed. Please try another file.',
      );
    }
  }

  Future<void> _setProofFromXFile(XFile file) async {
    final size = await file.length();
    if (!_validateProofSize(size)) return;
    final extension = _proofExtension(file.name);
    if (extension != 'jpg' && extension != 'jpeg' && extension != 'png') {
      setState(() => _claimError = 'Only JPG, PNG, or PDF files are allowed.');
      return;
    }
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    setState(() {
      _proof = _TravelClaimProofDraft(
        fileName: _cleanProofFileName(file.name, fallbackExtension: extension),
        bytes: bytes,
        extension: extension,
        contentType: _proofContentType(extension),
      );
      _claimError = null;
    });
  }

  Future<void> _setProofFromPdf() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    if (!_validateProofSize(file.size)) return;
    Uint8List? bytes = file.bytes;
    if (bytes == null && file.path != null) {
      bytes = await File(file.path!).readAsBytes();
    }
    if (bytes == null) {
      setState(() => _claimError = 'Bill/Ticket file could not be selected.');
      return;
    }
    if (!mounted) return;
    setState(() {
      _proof = _TravelClaimProofDraft(
        fileName: _cleanProofFileName(file.name, fallbackExtension: 'pdf'),
        bytes: bytes!,
        extension: 'pdf',
        contentType: 'application/pdf',
      );
      _claimError = null;
    });
  }

  bool _validateProofSize(int size) {
    if (size > _maxTravelClaimProofBytes) {
      setState(() => _claimError = 'Bill/Ticket must be 5 MB or less.');
      return false;
    }
    return true;
  }

  String _proofExtension(String fileName) {
    final name = fileName.trim().toLowerCase();
    final dot = name.lastIndexOf('.');
    if (dot < 0 || dot == name.length - 1) return 'jpg';
    final extension = name.substring(dot + 1);
    return extension == 'jpeg' ? 'jpeg' : extension;
  }

  String _proofContentType(String extension) {
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'pdf':
        return 'application/pdf';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  String _cleanProofFileName(
    String fileName, {
    required String fallbackExtension,
  }) {
    final clean = fileName
        .trim()
        .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '_')
        .replaceAll(RegExp(r'_+'), '_');
    if (clean.isEmpty || !clean.contains('.')) {
      return 'claim_proof.$fallbackExtension';
    }
    return clean;
  }

  void _continue() {
    final payable = payableKmAllowedForTravelMode(_selectedMode);
    if (payable) {
      Navigator.of(
        context,
      ).pop(_TravelModeSelection(travelMode: _selectedMode));
      return;
    }
    final from = _fromController.text.trim();
    final to = _toController.text.trim();
    final amount = double.tryParse(_amountController.text.trim());
    if (from.isEmpty) {
      setState(() => _claimError = 'From is required.');
      return;
    }
    if (to.isEmpty) {
      setState(() => _claimError = 'To is required.');
      return;
    }
    if (amount == null || amount <= 0) {
      setState(() => _claimError = 'Enter a valid amount.');
      return;
    }
    final proof = _proof;
    if (proof == null) {
      setState(() => _claimError = 'Bill/Ticket is required.');
      return;
    }
    final remarks = _remarksController.text.trim();
    Navigator.of(context).pop(
      _TravelModeSelection(
        travelMode: _selectedMode,
        note: remarks.isEmpty ? null : remarks,
        claim: _TravelExpenseClaimDraft(
          fromLocation: from,
          toLocation: to,
          fareAmount: amount,
          remarks: remarks.isEmpty ? null : remarks,
          proof: proof,
        ),
      ),
    );
  }
}

enum _TravelClaimProofSource { camera, gallery, pdf }

class _TravelExpenseClaimDraft {
  const _TravelExpenseClaimDraft({
    required this.fromLocation,
    required this.toLocation,
    required this.fareAmount,
    required this.remarks,
    required this.proof,
  });

  final String fromLocation;
  final String toLocation;
  final double fareAmount;
  final String? remarks;
  final _TravelClaimProofDraft proof;
}

class _TravelClaimProofDraft {
  const _TravelClaimProofDraft({
    required this.fileName,
    required this.bytes,
    required this.extension,
    required this.contentType,
  });

  final String fileName;
  final Uint8List bytes;
  final String extension;
  final String contentType;

  bool get isPdf => extension == 'pdf';
}
