import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../build_info.dart';
import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/permission_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../tracking/route_km_calculator.dart';
import '../tracking/tracking_service.dart';
import '../ui/fo_ui.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.user, super.key});

  final FoUser user;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with AutomaticKeepAliveClientMixin<HomeScreen>, WidgetsBindingObserver {
  Attendance? _attendance;
  bool _busy = false;
  int? _battery;
  double _km = 0;
  int _sitesToday = 0;
  String? _currentSite;
  bool _firstGpsPingLogged = false;
  String _buildNumber = '--';

  bool get _showTrackingDebug {
    final role = widget.user.role.trim().toLowerCase();
    return role == 'admin' || role == 'debug';
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
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: 'REMOTE_ATTENDANCE_RECOVERY_STARTED',
    );
    var attendance = await LocalStore.getAttendance();
    var visits = await LocalStore.getVisits();
    final today = startOfToday();
    final todayKey = indiaDateKey(DateTime.now());
    var activeVisit = await LocalStore.activeVisit();
    if (attendance != null) {
      final attendanceDate = _attendanceDateKey(attendance);
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'RECOVERY_ATTENDANCE_DATE_CHECK',
        error:
            'source=local attendance_id=${attendance.remoteId ?? attendance.id} attendance_date=$attendanceDate today=$todayKey active=${attendance.isActive}',
      );
      if (attendanceDate != todayKey) {
        await _clearPreviousDayLocalSession(
          attendance: attendance,
          attendanceDate: attendanceDate,
          todayKey: todayKey,
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
              );
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
              visits = await LocalStore.getVisits();
            }
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
  }) async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: 'PREVIOUS_DAY_LOCAL_SESSION_CLEANUP_STARTED',
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
        _sitesToday = 0;
        _currentSite = null;
      });
    }
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'home',
      action: 'PREVIOUS_DAY_LOCAL_SESSION_CLEANUP_COMPLETE',
    );
  }

  Future<void> _startDay() async {
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
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
            ? await SupabaseService.findCompletedAttendanceForToday(widget.user)
            : null;
        if (completed != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'REMOTE_COMPLETED_ATTENDANCE_FOUND',
            error: 'attendance_id=${completed.remoteId}',
          );
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'DUPLICATE_START_DAY_BLOCKED',
            error: 'completed_attendance_id=${completed.remoteId}',
          );
          await LocalStore.saveAttendance(completed);
          if (mounted) {
            setState(() {
              _attendance = completed;
              _km = completed.eligibleKm;
            });
          }
          _toast('Today\'s duty is already completed.');
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
      if (!ok) {
        _toast(PermissionService.message);
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
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
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'ATTENDANCE_CREATE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        final restored = await _restoreSameDayAttendanceAfterCreateFailure();
        if (restored) return;
        await _showErrorDialog(
          'Start Day failed',
          'Attendance sync failed. GPS tracking not started.',
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
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_SAVED_LOCAL',
        error:
            'attendance_id=${attendance.remoteId ?? attendance.id} remote_id=${attendance.remoteId ?? '--'} active=${attendance.isActive}',
      );
      await TrackingService.saveRouteAnchor(
        user: widget.user,
        attendance: attendance,
        position: position,
        action: 'ROUTE_ANCHOR_START_DAY_SAVED',
        capturedAt: attendance.startTime,
      );
      setState(() {
        _attendance = attendance;
        _battery = battery;
        _km = 0;
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
      if (!trackingStarted) {
        throw StateError('Background tracking failed to start.');
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'BACKGROUND_TRACKING_STARTED',
      );
      _toast('Attendance marked present. Tracking active.');
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

  Future<void> _endDay() async {
    if (_busy) return;
    final attendance = _attendance;
    if (attendance == null) return;
    setState(() => _busy = true);
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
            _km = attendance.eligibleKm;
            _battery = attendance.batteryEnd;
            _currentSite = null;
          });
        }
        _toast(
          'End Day was already completed. App status has been synchronized.',
        );
        return;
      }
      final openVisitsCount =
          await SupabaseService.countOpenSiteVisitsForAttendance(
            user: widget.user,
            attendance: resolvedAttendance.attendance,
          );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_OPEN_VISITS_COUNT',
        error:
            'count=$openVisitsCount attendance_id=${resolvedAttendance.attendance.remoteId}',
      );
      if (openVisitsCount > 0) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_BLOCKED_OPEN_VISITS_FOUND',
          error:
              'count=$openVisitsCount attendance_id=${resolvedAttendance.attendance.remoteId}',
        );
        _toast('Please Check Out from current store before ending the day.');
        return;
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'END_DAY_ALLOWED_NO_OPEN_VISITS',
        error: 'attendance_id=${resolvedAttendance.attendance.remoteId}',
      );
      Position? position;
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
          position = currentPosition;
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_FINAL_GPS_FETCH_SUCCESS',
          );
        } else {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'END_DAY_FINAL_GPS_FETCH_FAILED',
            error: 'End Day GPS accuracy/coordinate rejected.',
          );
        }
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_FINAL_GPS_FETCH_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        position = null;
      }
      final fallbackLog = position == null
          ? await TrackingService.latestValidLog(
              attendance.remoteId ?? attendance.id,
            )
          : null;
      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
        battery = null;
      }
      final endLatitude = position?.latitude ?? fallbackLog?.latitude;
      final endLongitude = position?.longitude ?? fallbackLog?.longitude;
      final endAccuracy = position?.accuracy ?? fallbackLog?.accuracy;
      final endSpeed = position != null
          ? (position.speed < 0 ? 0.0 : position.speed)
          : fallbackLog?.speed;
      if (position != null) {
        await TrackingService.saveRouteAnchor(
          user: widget.user,
          attendance: attendance,
          position: position,
          action: 'ROUTE_ANCHOR_END_DAY_SAVED',
        );
      }
      await TrackingService.syncQueuedLogs(force: true);
      final actualKm = await _calculateContinuedKm(attendance);
      final routeKm = await _routeKmFromVisits(attendance);
      final endTime = DateTime.now();
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
            );
        attendance
          ..remoteId = completedAttendance.attendance.remoteId
          ..endTime = completedAttendance.attendance.endTime ?? endTime;
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
          _km = attendance.eligibleKm;
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
      _toast(
        secondarySyncPending
            ? 'End Day completed; status synchronization pending.'
            : 'Day ended successfully.',
      );
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
      if (mounted) setState(() => _busy = false);
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
    LocalStore.activeVisit().then((visit) {
      if (!mounted) return;
      setState(() => _currentSite = visit?.storeName);
    });
    setState(() {
      _km = _attendance?.eligibleKm ?? 0;
      _battery = log.battery;
    });
  }

  Future<double> _routeKmFromVisits(Attendance attendance) async {
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
          if (_showTrackingDebug) ...[
            const SizedBox(height: 14),
            _debugIdentityCard(),
          ],
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
                    value: '${_km.toStringAsFixed(2)} km',
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
              onPressed: _busy || completed ? null : _startDay,
            ),
        ],
      ),
    );
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
              'GPS logs today',
              TrackingService.gpsLogsToday.toString(),
            ),
            _debugRow('Location queue', TrackingService.queueLength.toString()),
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
