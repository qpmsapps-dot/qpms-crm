import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'deep_cleaning_form_screen.dart';
import 'deep_cleaning_models.dart';
import 'deep_cleaning_service.dart';

class DeepCleaningScreen extends StatefulWidget {
  const DeepCleaningScreen({required this.user, super.key});

  final FoUser user;

  @override
  State<DeepCleaningScreen> createState() => _DeepCleaningScreenState();
}

class _DeepCleaningScreenState extends State<DeepCleaningScreen> {
  static const _pageSize = 50;
  static const _statuses = ['Planned', 'Completed', 'Not Done', 'Cancelled'];
  static const _showScheduleInterface = true;

  final _service = const DeepCleaningService();
  var _selectedSection = 0;

  var _schedules = <DeepCleaningSchedule>[];
  var _scheduleLoading = true;
  var _loadingMore = false;
  String? _scheduleError;
  var _schedulePage = 1;
  var _scheduleRequest = 0;
  var _scheduleTotal = 0;
  DateTime? _selectedMonth = DateTime(
    DateTime.now().year,
    DateTime.now().month,
  );
  String? _selectedStatus;

  var _submissions = <DeepCleaningSubmission>[];
  var _submissionsLoading = true;
  String? _submissionsError;

  @override
  void initState() {
    super.initState();
    if (_showScheduleInterface) _loadSchedules();
    _loadSubmissions();
  }

  Future<void> _loadSchedules({bool loadMore = false}) async {
    if (loadMore) {
      if (_loadingMore || _schedules.length >= _scheduleTotal) return;
      setState(() => _loadingMore = true);
    } else {
      setState(() {
        _scheduleLoading = true;
        _scheduleError = null;
        _schedulePage = 1;
      });
    }

    final request = ++_scheduleRequest;
    final requestedPage = loadMore ? _schedulePage + 1 : 1;
    try {
      final result = await _service.listSchedules(
        page: requestedPage,
        limit: _pageSize,
        month: _selectedMonth == null ? null : _monthKey(_selectedMonth!),
        status: _selectedStatus,
      );
      if (!mounted || request != _scheduleRequest) return;
      setState(() {
        _schedules = loadMore ? [..._schedules, ...result.rows] : result.rows;
        _schedulePage = result.page;
        _scheduleTotal = result.total;
        _scheduleError = null;
      });
    } catch (error) {
      if (!mounted) return;
      if (request != _scheduleRequest) return;
      setState(() {
        _scheduleError = _message(error);
        if (!loadMore) {
          _schedules = [];
          _scheduleTotal = 0;
        }
      });
    } finally {
      if (mounted && request == _scheduleRequest) {
        setState(() {
          _scheduleLoading = false;
          _loadingMore = false;
        });
      }
    }
  }

  Future<void> _loadSubmissions() async {
    setState(() {
      _submissionsLoading = true;
      _submissionsError = null;
    });
    try {
      final result = await _service.listSubmissions();
      if (!mounted) return;
      setState(() => _submissions = result.rows);
    } catch (error) {
      if (!mounted) return;
      setState(() => _submissionsError = _message(error));
    } finally {
      if (mounted) setState(() => _submissionsLoading = false);
    }
  }

  Future<void> _openForm({DeepCleaningSubmission? submission}) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DeepCleaningFormScreen(
          user: widget.user,
          initialSubmission: submission,
        ),
      ),
    );
    if (changed == true || submission == null) await _loadSubmissions();
  }

  Future<void> _selectMonth() async {
    final now = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      initialDate: _selectedMonth ?? now,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 10, 12, 31),
      helpText: 'Select any date in the month',
    );
    if (selected == null || !mounted) return;
    setState(() => _selectedMonth = DateTime(selected.year, selected.month));
    await _loadSchedules();
  }

  @override
  Widget build(BuildContext context) {
    final loading = _showScheduleInterface && _selectedSection == 0
        ? _scheduleLoading || _loadingMore
        : _submissionsLoading;
    return Scaffold(
      body: FoPage(
        children: [
          FoHeader(
            title: 'Deep Cleaning',
            subtitle: 'Reliance Retail reports',
            leading: IconButton(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.arrow_back_rounded, color: qpmsBlue),
            ),
            trailing: IconButton(
              onPressed: loading
                  ? null
                  : (_showScheduleInterface && _selectedSection == 0
                        ? _loadSchedules
                        : _loadSubmissions),
              icon: const Icon(Icons.refresh_rounded, color: qpmsBlue),
            ),
          ),
          const SizedBox(height: 18),
          if (_showScheduleInterface) ...[
            _sectionSelector(),
            const SizedBox(height: 18),
          ],
          if (_showScheduleInterface && _selectedSection == 0)
            ..._scheduleContent()
          else
            ..._reportContent(),
        ],
      ),
    );
  }

  Widget _sectionSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: foSoftBlue,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: foBorder),
      ),
      child: Row(
        children: [
          _sectionButton(
            0,
            Icons.calendar_month_outlined,
            'Assigned Schedules',
          ),
          _sectionButton(1, Icons.assignment_turned_in_outlined, 'My Reports'),
        ],
      ),
    );
  }

  Widget _sectionButton(int section, IconData icon, String label) {
    final selected = _selectedSection == section;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => _selectedSection = section),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            color: selected ? qpmsBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 19, color: selected ? Colors.white : qpmsMuted),
              const SizedBox(width: 7),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected ? Colors.white : foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _scheduleContent() {
    return [
      _scheduleFilters(),
      const SizedBox(height: 18),
      FoSectionTitle(
        title: 'Assigned Schedule',
        subtitle: _schedules.isEmpty
            ? null
            : '${_schedules.length} of $_scheduleTotal shown',
      ),
      const SizedBox(height: 10),
      if (_scheduleLoading)
        const _LoadingCard()
      else if (_scheduleError != null && _schedules.isEmpty)
        _ErrorCard(
          title: 'Unable to load schedules',
          message: _scheduleError!,
          onRetry: _loadSchedules,
        )
      else if (_schedules.isEmpty)
        const FoCard(
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'No assigned schedules match these filters.',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w800),
            ),
          ),
        )
      else ...[
        ..._schedules.map(_scheduleCard),
        if (_scheduleError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              _scheduleError!,
              style: const TextStyle(
                color: Color(0xFFE11D48),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        if (_schedules.length < _scheduleTotal)
          OutlinedButton.icon(
            onPressed: _loadingMore
                ? null
                : () => _loadSchedules(loadMore: true),
            icon: _loadingMore
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.expand_more_rounded),
            label: Text(_loadingMore ? 'Loading...' : 'Load More'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(50),
              textStyle: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
      ],
    ];
  }

  Widget _scheduleFilters() {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Filter Schedule',
            style: TextStyle(
              color: foNavy,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _FilterBox(
                  label: 'Month',
                  value: _selectedMonth == null
                      ? 'All months'
                      : _monthLabel(_selectedMonth!),
                  icon: Icons.calendar_month_outlined,
                  onTap: _selectMonth,
                ),
              ),
              if (_selectedMonth != null) ...[
                const SizedBox(width: 6),
                IconButton(
                  tooltip: 'Show all months',
                  onPressed: () {
                    setState(() => _selectedMonth = null);
                    _loadSchedules();
                  },
                  icon: const Icon(Icons.close_rounded, color: qpmsMuted),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          InputDecorator(
            decoration: InputDecoration(
              labelText: 'Status',
              prefixIcon: const Icon(Icons.tune_rounded),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedStatus ?? '',
                isExpanded: true,
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('All statuses'),
                  ),
                  ..._statuses.map(
                    (status) =>
                        DropdownMenuItem(value: status, child: Text(status)),
                  ),
                ],
                onChanged: (value) {
                  setState(() {
                    _selectedStatus = value == null || value.isEmpty
                        ? null
                        : value;
                  });
                  _loadSchedules();
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _scheduleCard(DeepCleaningSchedule schedule) {
    final statusColor = _scheduleStatusColor(schedule.status);
    return FoCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _openScheduledReport(schedule),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FoIconCircle(
                  icon: Icons.storefront_outlined,
                  color: statusColor,
                  size: 48,
                  iconSize: 24,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        schedule.storeCode,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: foNavy,
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        schedule.storeName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: qpmsMuted,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: qpmsBlue),
              ],
            ),
            Text(
              [
                schedule.locationLabel,
                schedule.zoneLabel,
                schedule.geographicState,
                schedule.assignmentStatus,
                schedule.notes,
              ].whereType<String>().where((v) => v.isNotEmpty).join(' ? '),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.event_outlined, size: 18, color: qpmsMuted),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    _dateLabel(schedule.scheduledDate),
                    style: const TextStyle(
                      color: foNavy,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                FoStatusBadge(label: schedule.status, color: statusColor),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openScheduledReport(DeepCleaningSchedule schedule) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            DeepCleaningFormScreen(user: widget.user, schedule: schedule),
      ),
    );
    if (changed == true) {
      await Future.wait([_loadSchedules(), _loadSubmissions()]);
    }
  }

  List<Widget> _reportContent() {
    return [
      FilledButton.icon(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add Deep Cleaning'),
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          textStyle: const TextStyle(fontWeight: FontWeight.w900),
        ),
      ),
      const SizedBox(height: 18),
      FoSectionTitle(
        title: 'Recent Submissions',
        subtitle: _submissions.isEmpty ? null : '${_submissions.length} shown',
      ),
      const SizedBox(height: 10),
      if (_submissionsLoading)
        const _LoadingCard()
      else if (_submissionsError != null)
        _ErrorCard(
          title: 'Unable to load submissions',
          message: _submissionsError!,
          onRetry: _loadSubmissions,
        )
      else if (_submissions.isEmpty)
        const FoCard(
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'No Deep Cleaning submissions yet.',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w800),
            ),
          ),
        )
      else
        ..._submissions.map(_submissionCard),
    ];
  }

  Widget _submissionCard(DeepCleaningSubmission submission) {
    final label =
        submission.finalOutcome ?? deepCleaningStatusLabel(submission.status);
    final statusColor = label == 'Not Done'
        ? const Color(0xFFE11D48)
        : submission.isSubmitted
        ? foGreen
        : qpmsBlue;
    return FoCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _openForm(submission: submission),
        child: Row(
          children: [
            FoIconCircle(
              icon: Icons.cleaning_services_outlined,
              color: statusColor,
              size: 48,
              iconSize: 24,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    submission.storeCode,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    submission.storeName ?? 'Reliance Retail store',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: qpmsMuted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (submission.deepCleaningDate?.isNotEmpty == true)
                    Text(
                      submission.deepCleaningDate!,
                      style: const TextStyle(
                        color: qpmsMuted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                ],
              ),
            ),
            FoStatusBadge(label: label, color: statusColor),
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right_rounded, color: qpmsBlue),
          ],
        ),
      ),
    );
  }

  String _message(Object error) {
    if (error is DeepCleaningApiException) return error.message;
    return 'Please check your network and try again.';
  }
}

class _FilterBox extends StatelessWidget {
  const _FilterBox({
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          suffixIcon: const Icon(Icons.expand_more_rounded),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
        child: Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: foNavy, fontWeight: FontWeight.w800),
        ),
      ),
    );
  }
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();

  @override
  Widget build(BuildContext context) {
    return const FoCard(
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: CircularProgressIndicator(),
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({
    required this.title,
    required this.message,
    required this.onRetry,
  });

  final String title;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(color: foNavy, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(message, style: const TextStyle(color: qpmsMuted)),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

Color _scheduleStatusColor(String status) {
  switch (status.trim().toLowerCase()) {
    case 'completed':
      return foGreen;
    case 'not done':
      return const Color(0xFFE11D48);
    default:
      return qpmsBlue;
  }
}

String _monthKey(DateTime date) {
  return '${date.year}-${date.month.toString().padLeft(2, '0')}';
}

String _monthLabel(DateTime date) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return '${months[date.month - 1]} ${date.year}';
}

String _dateLabel(String value) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
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
  return '${parsed.day.toString().padLeft(2, '0')} ${months[parsed.month - 1]} ${parsed.year}';
}
