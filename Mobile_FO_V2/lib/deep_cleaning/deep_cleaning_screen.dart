import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'deep_cleaning_form_screen.dart';
import 'deep_cleaning_models.dart';
import 'deep_cleaning_readiness.dart';
import 'deep_cleaning_service.dart';

class DeepCleaningScreen extends StatefulWidget {
  const DeepCleaningScreen({
    required this.user,
    this.service = const DeepCleaningService(),
    super.key,
  });

  final FoUser user;
  final DeepCleaningService service;

  @override
  State<DeepCleaningScreen> createState() => _DeepCleaningScreenState();
}

class _DeepCleaningScreenState extends State<DeepCleaningScreen> {
  static const _pageSize = 50;
  static const _statuses = ['Scheduled', 'Completed', 'Not Done'];
  static const _showScheduleInterface = false;

  DeepCleaningService get _service => widget.service;
  bool _showSubmitted = false;
  final _details = <String, Future<DeepCleaningSubmission>>{};
  bool _openingForm = false;
  var _selectedSection = 1;

  var _schedules = <DeepCleaningSchedule>[];
  var _scheduleLoading = true;
  var _loadingMore = false;
  String? _scheduleError;
  var _schedulePage = 1;
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

    final requestedPage = loadMore ? _schedulePage + 1 : 1;
    try {
      final result = await _service.listSchedules(
        page: requestedPage,
        limit: _pageSize,
        month: _selectedMonth == null ? null : _monthKey(_selectedMonth!),
        status: _selectedStatus,
      );
      if (!mounted) return;
      setState(() {
        _schedules = loadMore ? [..._schedules, ...result.rows] : result.rows;
        _schedulePage = result.page;
        _scheduleTotal = result.total;
        _scheduleError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _scheduleError = _message(error));
    } finally {
      if (mounted) {
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
      _details.clear();
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
    if (_openingForm) return;
    _openingForm = true;
    try {
      await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => DeepCleaningFormScreen(
            user: widget.user,
            initialSubmission: submission,
            service: _service,
          ),
        ),
      );
      if (mounted) await _loadSubmissions();
    } finally {
      _openingForm = false;
    }
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
      appBar: AppBar(
        title: const Text('Deep Cleaning'),
        backgroundColor: qpmsBlue,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh records',
            onPressed: loading ? null : _loadSubmissions,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: FoPage(
        children: [
          const FoSectionTitle(
            title: 'My Records',
            subtitle: 'Reliance Retail reports',
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
          _sectionButton(0, Icons.calendar_month_outlined, 'Schedule'),
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
    final records = _submissions
        .where((s) => s.isSubmitted == _showSubmitted)
        .toList();
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
      SegmentedButton<bool>(
        segments: const [
          ButtonSegment(
            value: false,
            label: Text('Drafts'),
            icon: Icon(Icons.edit_note),
          ),
          ButtonSegment(
            value: true,
            label: Text('Submitted'),
            icon: Icon(Icons.verified_outlined),
          ),
        ],
        selected: {_showSubmitted},
        onSelectionChanged: (value) =>
            setState(() => _showSubmitted = value.first),
      ),
      const SizedBox(height: 12),
      FoSectionTitle(
        title: _showSubmitted ? 'Submitted records' : 'My drafts',
        subtitle: '${records.length} in the loaded records',
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
      else if (records.isEmpty)
        FoCard(
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              _showSubmitted
                  ? 'No submitted records in this list.'
                  : 'No drafts in this list. Add Deep Cleaning to begin.',
              style: const TextStyle(
                color: qpmsMuted,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        )
      else
        ...records.map(_submissionCard),
    ];
  }

  Widget _submissionCard(DeepCleaningSubmission submission) {
    final submitted = submission.isSubmitted;
    return FoCard(
      margin: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  submission.storeCode,
                  style: const TextStyle(
                    color: qpmsBlue,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              FoStatusBadge(
                label: submitted
                    ? submission.finalOutcome ?? 'Submitted'
                    : 'Draft',
                color: submission.finalOutcome == 'Not Done'
                    ? Colors.red
                    : submitted
                    ? foGreen
                    : foOrange,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            submission.storeName ?? 'Reliance Retail store',
            style: const TextStyle(
              color: foNavy,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            'Actual date: ${submission.deepCleaningDate ?? 'Not selected'}',
            style: const TextStyle(color: qpmsMuted),
          ),
          const SizedBox(height: 14),
          if (submitted) ...[
            const Text(
              'Submission confirmed by the server.',
              style: TextStyle(color: foGreen, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => _openForm(submission: submission),
              child: const Text('View Record'),
            ),
          ] else
            Builder(
              builder: (context) => FutureBuilder<DeepCleaningSubmission>(
                future: _details.putIfAbsent(
                  submission.id,
                  () => _service.getSubmission(submission.id),
                ),
                builder: (context, snapshot) {
                  final readiness = snapshot.hasData
                      ? DeepCleaningReadiness.fromSubmission(snapshot.data!)
                      : null;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (snapshot.hasError) ...[
                        const Text(
                          'Readiness unavailable. Open the draft to retry.',
                        ),
                      ] else if (readiness == null) ...[
                        const LinearProgressIndicator(),
                        const SizedBox(height: 8),
                        const Text('Checking server-confirmed evidence...'),
                      ] else ...[
                        Row(
                          children: [
                            const Expanded(child: Text('Readiness checks')),
                            Text(
                              '${(readiness.progress * 100).round()}%',
                              style: TextStyle(
                                color: readiness.ready ? foGreen : foOrange,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 7),
                        LinearProgressIndicator(
                          value: readiness.progress,
                          color: readiness.ready ? foGreen : foOrange,
                          borderRadius: BorderRadius.circular(8),
                          minHeight: 6,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          readiness.nextAction,
                          style: const TextStyle(color: qpmsMuted),
                        ),
                      ],
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: () =>
                            _openForm(submission: snapshot.data ?? submission),
                        child: Text(
                          readiness?.ready == true
                              ? 'Review & Submit'
                              : 'Resume Work',
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
        ],
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
