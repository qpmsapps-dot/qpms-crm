import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
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
  final _search = TextEditingController();
  String _statusFilter = 'All';
  String _activityFilter = 'All';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
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
    final visibleVisits = _filteredVisits();
    final recentVisits = visibleVisits.take(3).toList();
    return Scaffold(
      body: FoPage(
        children: [
          const FoHeader(
            title: 'Site Visit',
            subtitle: 'View all your site visit history and details',
            leading: FoIconCircle(
              icon: Icons.location_on_outlined,
              color: qpmsBlue,
              size: 62,
              iconSize: 34,
            ),
          ),
          const SizedBox(height: 18),
          _filtersCard(),
          const SizedBox(height: 16),
          FoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FoSectionTitle(title: 'Recent Visits'),
                const SizedBox(height: 14),
                if (recentVisits.isEmpty)
                  const Text(
                    'No site visits available for selected filters.',
                    style: TextStyle(
                      color: qpmsMuted,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else
                  for (final visit in recentVisits) _recentVisitCard(visit),
              ],
            ),
          ),
          const SizedBox(height: 16),
          FoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FoSectionTitle(title: 'Visit History'),
                const SizedBox(height: 14),
                if (visibleVisits.isEmpty)
                  const Text(
                    'No visit history for selected filters.',
                    style: TextStyle(
                      color: qpmsMuted,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else
                  for (final visit in visibleVisits) _historyRow(visit),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _filtersCard() {
    return FoCard(
      child: Column(
        children: [
          TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search_rounded),
              hintText: 'Search by store name, location or visit ID...',
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _filterChipButton(
                icon: Icons.calendar_month_outlined,
                label: _filterLabel(_filter),
                onTap: _showDateFilter,
              ),
              _filterChipButton(
                icon: Icons.tune_rounded,
                label: 'Status $_statusFilter',
                onTap: _showStatusFilter,
              ),
              _filterChipButton(
                icon: Icons.grid_view_rounded,
                label: 'Activity $_activityFilter',
                onTap: _showActivityFilter,
              ),
              _filterChipButton(
                icon: Icons.swap_vert_rounded,
                label: 'Newest',
                onTap: () {},
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _filterChipButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
        decoration: BoxDecoration(
          color: foSoftBlue,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: foBorder),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: qpmsBlue, size: 20),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                color: foNavy,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.keyboard_arrow_down_rounded, color: foNavy),
          ],
        ),
      ),
    );
  }

  Widget _recentVisitCard(SiteVisit visit) {
    final activity = _activityForVisit(visit);
    final routeKm = visit.routeKm ?? _distances[visit.id]?.segmentKm ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
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
      child: Row(
        children: [
          FoIconCircle(icon: activity.icon, color: activity.color, size: 62),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  visit.storeName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: foNavy,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  '${visit.state} - ${visit.clientName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                FoStatusBadge(label: activity.label, color: activity.color),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              FoStatusBadge(
                label: visit.isActive ? 'Checked In' : 'Checked Out',
                color: visit.isActive ? qpmsBlue : foGreen,
              ),
              const SizedBox(height: 10),
              Text(
                formatTime(visit.checkOutTime ?? visit.checkInTime),
                style: const TextStyle(
                  color: foNavy,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                _dateLabel(visit.checkInTime),
                style: const TextStyle(
                  color: Color(0xFF53607D),
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                '${routeKm.toStringAsFixed(1)} km',
                style: const TextStyle(
                  color: Color(0xFF53607D),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(width: 6),
          const Icon(Icons.chevron_right_rounded, color: foNavy),
        ],
      ),
    );
  }

  Widget _historyRow(SiteVisit visit) {
    final activity = _activityForVisit(visit);
    final routeKm = visit.routeKm ?? _distances[visit.id]?.runningKm ?? 0;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 13),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: foBorder)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _dateLabel(visit.checkInTime),
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  formatTime(visit.checkInTime),
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  visit.storeName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  visit.state,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  '${routeKm.toStringAsFixed(1)} km',
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          FoStatusBadge(label: activity.label, color: activity.color),
          const SizedBox(width: 8),
          FoStatusBadge(
            label: visit.isActive ? 'Checked In' : 'Checked Out',
            color: visit.isActive ? qpmsBlue : foGreen,
            showDot: true,
          ),
          const Icon(Icons.chevron_right_rounded, color: foNavy),
        ],
      ),
    );
  }

  List<SiteVisit> _filteredVisits() {
    final q = _search.text.trim().toLowerCase();
    return _visits.where((visit) {
      final activity = _activityForVisit(visit).label;
      final status = visit.isActive ? 'Checked In' : 'Checked Out';
      final queryMatch =
          q.isEmpty ||
          '${visit.storeName} ${visit.clientName} ${visit.state} ${visit.storeCode} ${visit.remoteId ?? visit.id}'
              .toLowerCase()
              .contains(q);
      final statusMatch = _statusFilter == 'All' || _statusFilter == status;
      final activityMatch =
          _activityFilter == 'All' || _activityFilter == activity;
      return queryMatch && statusMatch && activityMatch;
    }).toList();
  }

  _ActivityBadge _activityForVisit(SiteVisit visit) {
    final status = visit.status.toLowerCase();
    if (status.contains('training')) {
      return const _ActivityBadge(
        'Training',
        Icons.co_present_rounded,
        foPurple,
      );
    }
    if (status.contains('clean')) {
      return const _ActivityBadge(
        'Deep Cleaning',
        Icons.cleaning_services_rounded,
        foGreen,
      );
    }
    return const _ActivityBadge(
      'Inspection',
      Icons.content_paste_search_rounded,
      qpmsBlue,
    );
  }

  String _filterLabel(VisitFilter filter) {
    switch (filter) {
      case VisitFilter.today:
        return 'Date Range Today';
      case VisitFilter.yesterday:
        return 'Date Range Yesterday';
      case VisitFilter.last7:
        return 'Date Range Last 7';
      case VisitFilter.month:
        return 'Date Range Month';
    }
  }

  String _dateLabel(DateTime value) {
    final today = startOfToday();
    if (!value.isBefore(today) && !value.isAfter(endOfDay(today))) {
      return 'Today';
    }
    return '${value.day.toString().padLeft(2, '0')} ${_month(value.month)} ${value.year}';
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

  Future<void> _showDateFilter() async {
    final selected = await showModalBottomSheet<VisitFilter>(
      context: context,
      builder: (context) => _OptionSheet<VisitFilter>(
        title: 'Date Range',
        options: const {
          VisitFilter.today: 'Today',
          VisitFilter.yesterday: 'Yesterday',
          VisitFilter.last7: 'Last 7 Days',
          VisitFilter.month: 'This Month',
        },
      ),
    );
    if (selected == null) return;
    setState(() => _filter = selected);
    _load();
  }

  Future<void> _showStatusFilter() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => const _OptionSheet<String>(
        title: 'Status',
        options: {
          'All': 'All',
          'Checked In': 'Checked In',
          'Checked Out': 'Checked Out',
        },
      ),
    );
    if (selected == null) return;
    setState(() => _statusFilter = selected);
  }

  Future<void> _showActivityFilter() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => const _OptionSheet<String>(
        title: 'Activity',
        options: {
          'All': 'All',
          'Inspection': 'Inspection',
          'Deep Cleaning': 'Deep Cleaning',
          'Training': 'Training',
        },
      ),
    );
    if (selected == null) return;
    setState(() => _activityFilter = selected);
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

class _OptionSheet<T> extends StatelessWidget {
  const _OptionSheet({required this.title, required this.options});

  final String title;
  final Map<T, String> options;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: foNavy,
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            for (final entry in options.entries)
              ListTile(
                title: Text(entry.value),
                onTap: () => Navigator.of(context).pop(entry.key),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActivityBadge {
  const _ActivityBadge(this.label, this.icon, this.color);

  final String label;
  final IconData icon;
  final Color color;
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
