import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/permission_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../tracking/tracking_service.dart';
import '../utils/date_utils.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.user, super.key});

  final FoUser user;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with AutomaticKeepAliveClientMixin<HomeScreen> {
  Attendance? _attendance;
  bool _busy = false;
  int? _battery;
  double _km = 0;
  DateTime? _lastSeen;
  int _sitesToday = 0;
  String? _currentSite;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final attendance = await LocalStore.getAttendance();
    final visits = await LocalStore.getVisits();
    final today = startOfToday();
    final hasActiveAttendanceToday =
        attendance?.isActive == true &&
        indiaDateKey(attendance!.startTime) == indiaDateKey(DateTime.now());
    var liveKm = 0.0;
    if (hasActiveAttendanceToday) {
      liveKm = await _calculateContinuedKm(attendance);
      attendance
        ..actualKm = liveKm
        ..eligibleKm = liveKm;
      await LocalStore.saveAttendance(attendance);
    } else if (SupabaseService.isReady) {
      final completed = await SupabaseService.findCompletedAttendanceForToday(
        widget.user,
      );
      if (completed != null) {
        liveKm = await _calculateContinuedKm(completed);
        completed
          ..actualKm = liveKm
          ..eligibleKm = liveKm;
        if (!mounted) return;
        setState(() {
          _attendance = completed;
          _km = liveKm;
          _sitesToday = visits
              .where((visit) => visit.checkInTime.isAfter(today))
              .length;
        });
        return;
      }
    }
    if (!mounted) return;
    setState(() {
      _attendance = attendance;
      _km = hasActiveAttendanceToday ? liveKm : 0;
      _sitesToday = visits
          .where((visit) => visit.checkInTime.isAfter(today))
          .length;
      _currentSite = visits
          .where((visit) => visit.isActive)
          .map((visit) => visit.storeName)
          .firstOrNull;
    });
    if (hasActiveAttendanceToday && !TrackingService.isActive) {
      await TrackingService.start(
        user: widget.user,
        attendance: attendance,
        onLog: _onLog,
      );
    }
  }

  Future<void> _startDay() async {
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'SAME_DAY_ATTENDANCE_CONTINUE_CHECK',
      );
      try {
        final existing = await SupabaseService.findActiveAttendanceForToday(
          widget.user,
        );
        if (existing != null) {
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'SAME_DAY_ACTIVE_ATTENDANCE_FOUND',
          );
          await _resumeAttendance(existing);
          _toast('Day already started. Tracking resumed.');
          return;
        }
        final completed = await SupabaseService.findCompletedAttendanceForToday(
          widget.user,
        );
        if (completed != null) {
          await SupabaseService.reopenAttendanceForToday(completed);
          await CrashLogService.record(
            employeeCode: widget.user.employeeCode,
            screen: 'home',
            action: 'SAME_DAY_COMPLETED_ATTENDANCE_REOPENED',
          );
          await _resumeAttendance(completed);
          _toast('Continuing today’s attendance.');
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
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        employeeCode: widget.user.employeeCode,
        startTime: DateTime.now(),
        startLat: position.latitude,
        startLng: position.longitude,
        batteryStart: battery,
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
          action: 'ATTENDANCE_SYNC_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'home',
        action: 'SAME_DAY_NEW_ATTENDANCE_CREATED',
      );
      await LocalStore.saveAttendance(attendance);
      setState(() {
        _attendance = attendance;
        _battery = battery;
        _km = 0;
        _lastSeen = DateTime.now();
      });
      await TrackingService.start(
        user: widget.user,
        attendance: attendance,
        onLog: _onLog,
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
      _toast('Start Day failed. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resumeAttendance(Attendance attendance) async {
    final existingKm = await _calculateContinuedKm(attendance);
    attendance
      ..actualKm = existingKm
      ..eligibleKm = existingKm;
    await LocalStore.saveAttendance(attendance);
    if (mounted) {
      setState(() {
        _attendance = attendance;
        _battery = attendance.batteryStart ?? _battery;
        _lastSeen = DateTime.now();
        _km = existingKm;
      });
    }
    await TrackingService.start(
      user: widget.user,
      attendance: attendance,
      onLog: _onLog,
    );
  }

  Future<double> _calculateContinuedKm(Attendance attendance) async {
    final attendanceId = attendance.remoteId ?? attendance.id;
    final localKm = await TrackingService.calculateKm(attendanceId);
    var bestKm = localKm > attendance.actualKm ? localKm : attendance.actualKm;
    if (localKm == 0 &&
        SupabaseService.isReady &&
        attendance.remoteId != null) {
      final remoteLogs = await SupabaseService.fetchLocationLogsForAttendance(
        user: widget.user,
        attendanceId: attendance.remoteId!,
      );
      final remoteKm = _kmFromLogs(remoteLogs);
      if (remoteKm > bestKm) bestKm = remoteKm;
    }
    return double.parse(bestKm.toStringAsFixed(2));
  }

  double _kmFromLogs(List<LocationLog> logs) {
    final points =
        logs
            .where((log) => log.accuracy == null || log.accuracy! <= 50)
            .toList()
          ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    final usable = points.length >= 2
        ? points
        : (logs..sort((a, b) => a.capturedAt.compareTo(b.capturedAt)));
    var meters = 0.0;
    for (var index = 1; index < usable.length; index += 1) {
      meters += Geolocator.distanceBetween(
        usable[index - 1].latitude,
        usable[index - 1].longitude,
        usable[index].latitude,
        usable[index].longitude,
      );
    }
    return meters / 1000;
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
    final attendance = _attendance;
    if (attendance == null) return;
    final activeVisit = await LocalStore.activeVisit();
    if (activeVisit != null) {
      _toast('Please Check Out from current store before ending the day.');
      return;
    }
    setState(() => _busy = true);
    try {
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
      final actualKm = await _calculateContinuedKm(attendance);
      attendance
        ..endTime = DateTime.now()
        ..endLat = endLatitude
        ..endLng = endLongitude
        ..batteryEnd = battery
        ..actualKm = actualKm
        ..eligibleKm = attendance.actualKm;
      await TrackingService.stop(
        user: widget.user,
        latitude: endLatitude,
        longitude: endLongitude,
        accuracy: endAccuracy,
        speed: endSpeed,
        routeKm: attendance.actualKm,
      );
      await LocalStore.saveAttendance(attendance);
      try {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_START',
        );
        await SupabaseService.endAttendance(attendance);
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_SUCCESS',
        );
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'home',
          action: 'END_DAY_ATTENDANCE_UPDATE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
      if (mounted) {
        setState(() {
          _attendance = null;
          _km = attendance.actualKm;
          _battery = battery;
        });
      }
      await LocalStore.saveAttendance(null);
      _toast('Day ended successfully.');
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

  void _onLog(LocationLog log, double liveKm) {
    if (!mounted) return;
    _attendance
      ?..actualKm = liveKm
      ..eligibleKm = liveKm;
    setState(() {
      _km = liveKm;
      _battery = log.battery;
      _lastSeen = log.capturedAt;
    });
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final active = _attendance?.isActive == true;
    final currentStatus = _currentSite != null
        ? 'On Site Visit'
        : active
        ? 'Active'
        : 'Offline';
    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
        children: [
          _brandHeader(currentStatus),
          const SizedBox(height: 12),
          _summaryCard(),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    active ? 'Tracking Active' : 'Not Tracking',
                    style: TextStyle(
                      color: active ? Colors.green : qpmsMuted,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  FilledButton(
                    onPressed: _busy || active ? null : _startDay,
                    child: const Text('Start Day'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: _busy || !active ? null : _endDay,
                    child: const Text('End Day'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _brandHeader(String currentStatus) {
    return Card(
      color: qpmsBlue,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
        child: Column(
          children: [
            Container(
              width: 62,
              height: 62,
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
              ),
              child: Image.asset('assets/qpms-logo.png', fit: BoxFit.contain),
            ),
            const SizedBox(height: 8),
            const Text(
              'myQPMS',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const Text(
              'Field Operations',
              style: TextStyle(
                color: Color(0xFFDCEAFF),
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Welcome, ${widget.user.fullName}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                _brandPill('Employee ID', widget.user.employeeCode),
                _brandPill('Current Status', currentStatus),
                _brandPill('v1.0', 'Pilot'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _brandPill(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Text(
        '$label: ${value.isEmpty ? '--' : value}',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _summaryCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Today's Summary",
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final itemWidth = (constraints.maxWidth - 10) / 2;
                return Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    _summaryItem(
                      'Live KM Today',
                      _km.toStringAsFixed(2),
                      itemWidth,
                    ),
                    _summaryItem(
                      'Sites Visited Today',
                      '$_sitesToday',
                      itemWidth,
                    ),
                    _summaryItem(
                      'Current Site',
                      _currentSite ?? '--',
                      itemWidth,
                    ),
                    _summaryItem('Last Sync', formatTime(_lastSeen), itemWidth),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryItem(String label, String value, double width) {
    return SizedBox(
      width: width,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: qpmsLight,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(color: qpmsMuted, fontSize: 12)),
            const SizedBox(height: 4),
            Text(
              value.isEmpty ? '--' : value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: qpmsText,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}
