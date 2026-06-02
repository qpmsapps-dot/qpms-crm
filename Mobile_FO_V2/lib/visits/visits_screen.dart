import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';
import '../utils/date_utils.dart';

enum VisitFilter { today, yesterday, last7, month }

class VisitsScreen extends StatefulWidget {
  const VisitsScreen({required this.user, super.key});

  final FoUser user;

  @override
  State<VisitsScreen> createState() => _VisitsScreenState();
}

class _VisitsScreenState extends State<VisitsScreen>
    with AutomaticKeepAliveClientMixin<VisitsScreen> {
  VisitFilter _filter = VisitFilter.today;
  List<SiteVisit> _visits = [];
  Map<String, _VisitDistance> _distances = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'visits',
      action: 'VISIT_HISTORY_DATE_FILTER_START',
    );
    final attendance = await LocalStore.getAttendance();
    final range = _range();
    final localVisits = await LocalStore.getVisits();
    final localLogs = await LocalStore.getLocationLogs();
    var all = localVisits;
    var logs = localLogs;
    if (SupabaseService.isReady) {
      try {
        final remoteVisits = await SupabaseService.fetchVisitsForRange(
          user: widget.user,
          from: range.$1,
          to: range.$2,
        );
        final remoteLogs = await SupabaseService.fetchLocationLogsForRange(
          user: widget.user,
          from: range.$1,
          to: range.$2,
        );
        all = _mergeVisits(localVisits, remoteVisits);
        logs = _mergeLogs(localLogs, remoteLogs);
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'visits',
          action: 'VISIT_HISTORY_REMOTE_FALLBACK_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
    final visitsAsc =
        all
            .where(
              (visit) =>
                  visit.employeeCode == widget.user.employeeCode &&
                  !visit.checkInTime.isBefore(range.$1) &&
                  !visit.checkInTime.isAfter(range.$2),
            )
            .toList()
          ..sort((a, b) => a.checkInTime.compareTo(b.checkInTime));
    final distances = _buildVisitDistances(visitsAsc, logs, attendance);
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'visits',
      action: 'VISIT_HISTORY_DATE_FILTER_SUCCESS',
    );
    if (!mounted) return;
    setState(() {
      _visits = visitsAsc.reversed.toList();
      _distances = distances;
    });
  }

  List<SiteVisit> _mergeVisits(List<SiteVisit> local, List<SiteVisit> remote) {
    final byKey = <String, SiteVisit>{};
    for (final visit in [...local, ...remote]) {
      byKey[visit.remoteId ?? visit.id] = visit;
    }
    return byKey.values.toList();
  }

  List<LocationLog> _mergeLogs(
    List<LocationLog> local,
    List<LocationLog> remote,
  ) {
    final byKey = <String, LocationLog>{};
    for (final log in [...local, ...remote]) {
      byKey[log.remoteId ?? log.id] = log;
    }
    return byKey.values.toList();
  }

  (DateTime, DateTime) _range() {
    final today = startOfToday();
    switch (_filter) {
      case VisitFilter.today:
        return (today, endOfDay(today));
      case VisitFilter.yesterday:
        final day = today.subtract(const Duration(days: 1));
        return (day, endOfDay(day));
      case VisitFilter.last7:
        return (today.subtract(const Duration(days: 6)), endOfDay(today));
      case VisitFilter.month:
        return (DateTime(today.year, today.month), endOfDay(today));
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Site Visit')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          SegmentedButton<VisitFilter>(
            segments: const [
              ButtonSegment(value: VisitFilter.today, label: Text('Today')),
              ButtonSegment(
                value: VisitFilter.yesterday,
                label: Text('Yesterday'),
              ),
              ButtonSegment(value: VisitFilter.last7, label: Text('Last 7')),
              ButtonSegment(value: VisitFilter.month, label: Text('Month')),
            ],
            selected: {_filter},
            onSelectionChanged: (value) {
              setState(() => _filter = value.first);
              _load();
            },
          ),
          const SizedBox(height: 14),
          if (_visits.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text('No site visits available for selected date.'),
              ),
            )
          else
            for (final visit in _visits) _visitCard(visit),
        ],
      ),
    );
  }

  Widget _visitCard(SiteVisit visit) {
    final distance = _distances[visit.id];
    final distanceLabel = distance?.firstVisit == true
        ? 'Distance From Start Location'
        : 'Distance From Previous Site';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                visit.storeName,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              Text('${visit.clientName} • ${visit.storeCode}'),
              Text(visit.state),
              const SizedBox(height: 8),
              Text('Check-In: ${formatTime(visit.checkInTime)}'),
              Text('Check-Out: ${formatTime(visit.checkOutTime)}'),
              Text('Visit Duration: ${visit.durationMinutes ?? 0} min'),
              Text(
                '$distanceLabel: ${(distance?.segmentKm ?? 0).toStringAsFixed(1)} km',
              ),
              Text(
                'Running KM Today: ${(distance?.runningKm ?? 0).toStringAsFixed(1)} km',
              ),
              Text('Status: ${visit.status}'),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, _VisitDistance> _buildVisitDistances(
    List<SiteVisit> visits,
    List<LocationLog> logs,
    Attendance? attendance,
  ) {
    final result = <String, _VisitDistance>{};
    var runningKm = 0.0;
    SiteVisit? previousVisit;

    for (final visit in visits) {
      final attendanceId = visit.attendanceId;
      final sessionLogs =
          logs
              .where(
                (log) =>
                    log.employeeCode == widget.user.employeeCode &&
                    (attendanceId == null ||
                        attendanceId.isEmpty ||
                        log.attendanceId == attendanceId),
              )
              .toList()
            ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
      final startTime =
          attendance?.id == attendanceId || attendance?.remoteId == attendanceId
          ? attendance?.startTime
          : null;
      final fallbackStartTime = sessionLogs
          .where((log) => !log.capturedAt.isAfter(visit.checkInTime))
          .map((log) => log.capturedAt)
          .firstOrNull;
      final fromTime =
          previousVisit?.checkOutTime ??
          previousVisit?.checkInTime ??
          startTime ??
          fallbackStartTime;
      final routeKm = _routeDistanceKm(
        sessionLogs,
        fromTime,
        visit.checkInTime,
      );
      final fallbackKm = _fallbackDistanceKm(previousVisit, visit, attendance);
      final segmentKm = routeKm ?? fallbackKm;
      runningKm += segmentKm;
      result[visit.id] = _VisitDistance(
        segmentKm: segmentKm,
        runningKm: runningKm,
        firstVisit: previousVisit == null,
      );
      previousVisit = visit;
    }
    return result;
  }

  double? _routeDistanceKm(
    List<LocationLog> logs,
    DateTime? from,
    DateTime to,
  ) {
    if (from == null) return null;
    final window = logs
        .where(
          (log) =>
              !log.capturedAt.isBefore(from) && !log.capturedAt.isAfter(to),
        )
        .toList();
    final good = window.where(_isGoodRoutePoint).toList();
    final points = good.length >= 2
        ? good
        : window.where(_isValidPoint).toList();
    if (points.length < 2) return null;
    var meters = 0.0;
    for (var index = 1; index < points.length; index += 1) {
      meters += Geolocator.distanceBetween(
        points[index - 1].latitude,
        points[index - 1].longitude,
        points[index].latitude,
        points[index].longitude,
      );
    }
    return meters / 1000;
  }

  double _fallbackDistanceKm(
    SiteVisit? previousVisit,
    SiteVisit visit,
    Attendance? attendance,
  ) {
    final from = previousVisit == null
        ? _point(attendance?.startLat, attendance?.startLng)
        : _point(
                previousVisit.checkOutLatitude,
                previousVisit.checkOutLongitude,
              ) ??
              _point(
                previousVisit.currentLatitude,
                previousVisit.currentLongitude,
              );
    final to = _point(visit.currentLatitude, visit.currentLongitude);
    if (from == null || to == null) return 0;
    return Geolocator.distanceBetween(
          from.latitude,
          from.longitude,
          to.latitude,
          to.longitude,
        ) /
        1000;
  }

  bool _isGoodRoutePoint(LocationLog log) =>
      _isValidPoint(log) && (log.accuracy == null || log.accuracy! <= 50);

  bool _isValidPoint(LocationLog log) =>
      log.latitude.isFinite &&
      log.longitude.isFinite &&
      log.latitude >= -90 &&
      log.latitude <= 90 &&
      log.longitude >= -180 &&
      log.longitude <= 180;

  _GeoPoint? _point(double? latitude, double? longitude) {
    if (latitude == null || longitude == null) return null;
    if (!latitude.isFinite || !longitude.isFinite) return null;
    return _GeoPoint(latitude, longitude);
  }

  @override
  bool get wantKeepAlive => true;
}

class _VisitDistance {
  const _VisitDistance({
    required this.segmentKm,
    required this.runningKm,
    required this.firstVisit,
  });

  final double segmentKm;
  final double runningKm;
  final bool firstVisit;
}

class _GeoPoint {
  const _GeoPoint(this.latitude, this.longitude);

  final double latitude;
  final double longitude;
}
