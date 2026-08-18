import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_sla_policy.dart';
import 'hospital_ticket_api.dart';
import 'hospital_ticket_card.dart';

class HospitalTicketDetailScreen extends StatefulWidget {
  const HospitalTicketDetailScreen({
    required this.controller,
    required this.ticketId,
    super.key,
  });

  final HospitalController controller;
  final String ticketId;

  @override
  State<HospitalTicketDetailScreen> createState() =>
      _HospitalTicketDetailScreenState();
}

class _HospitalTicketDetailScreenState extends State<HospitalTicketDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  bool _descriptionExpanded = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    widget.controller.addListener(_refresh);
    widget.controller.loadDetail(widget.ticketId);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    _tabController.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ticket = widget.controller.ticketById(widget.ticketId);
    final actions = widget.controller.actionsFor(ticket);
    final primary = _primaryAction(ticket, actions);
    final busy = widget.controller.isTicketBusy(ticket.id);
    final bottomInset = primary == null ? 16.0 : 92.0;

    return Scaffold(
      appBar: AppBar(
        title: Text(_ticketLabel(ticket), overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: widget.controller.isDetailLoading(ticket.id)
                ? null
                : () => widget.controller.loadDetail(ticket.id, force: true),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          _CompactHeader(
            ticket: ticket,
            sla: widget.controller.slaFor(ticket),
            primaryBusy: busy,
          ),
          Material(
            color: Theme.of(context).scaffoldBackgroundColor,
            child: TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Overview'),
                Tab(text: 'Timeline'),
                Tab(text: 'Actions'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _OverviewTab(
                  ticket: ticket,
                  descriptionExpanded: _descriptionExpanded,
                  onToggleDescription: () => setState(
                    () => _descriptionExpanded = !_descriptionExpanded,
                  ),
                  onViewAllPhotos: _showAllPhotos,
                  bottomInset: bottomInset,
                ),
                _TimelineTab(
                  ticket: ticket,
                  loading:
                      widget.controller.isDetailLoading(ticket.id) ||
                      widget.controller.isDetailLoading(widget.ticketId),
                  refreshing:
                      widget.controller.isDetailRefreshing(ticket.id) ||
                      widget.controller.isDetailRefreshing(widget.ticketId),
                  error:
                      widget.controller.detailError(ticket.id) ??
                      widget.controller.detailError(widget.ticketId),
                  loadedAt:
                      widget.controller.detailLoadedAt(ticket.id) ??
                      widget.controller.detailLoadedAt(widget.ticketId),
                  onRetry: () =>
                      widget.controller.loadDetail(ticket.id, force: true),
                  bottomInset: bottomInset,
                ),
                _ActionsTab(
                  ticket: ticket,
                  actions: actions,
                  primaryAction: primary?.action,
                  busy: busy,
                  onAction: _performAction,
                  bottomInset: bottomInset,
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: primary == null
          ? null
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: FilledButton.icon(
                onPressed: busy || primary.disabled
                    ? null
                    : () => _performAction(primary.action, primary.label),
                icon: busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(primary.icon),
                label: Text(primary.label),
              ),
            ),
    );
  }

  _PrimaryAction? _primaryAction(
    HospitalTicket ticket,
    Set<HospitalTicketAction> actions,
  ) {
    if (ticket.status == HospitalTicketStatus.resolvedAwaitingConfirmation) {
      return const _PrimaryAction(
        HospitalTicketAction.resolve,
        'Awaiting Client Confirmation',
        Icons.hourglass_top_rounded,
        disabled: true,
      );
    }
    if (actions.contains(HospitalTicketAction.accept) &&
        (ticket.status == HospitalTicketStatus.awaitingSupervisorAcceptance ||
            ticket.status == HospitalTicketStatus.open ||
            ticket.status == HospitalTicketStatus.assigned ||
            ticket.status == HospitalTicketStatus.reopened)) {
      return const _PrimaryAction(
        HospitalTicketAction.accept,
        'Accept Ticket',
        Icons.task_alt_rounded,
      );
    }
    if (actions.contains(HospitalTicketAction.startWork) &&
        ticket.status == HospitalTicketStatus.accepted) {
      return const _PrimaryAction(
        HospitalTicketAction.startWork,
        'Start Work',
        Icons.play_arrow_rounded,
      );
    }
    if (actions.contains(HospitalTicketAction.takeOver) &&
        (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive ||
            ticket.status == HospitalTicketStatus.escalatedFacilityManager ||
            ticket.status == HospitalTicketStatus.escalatedProjectHead)) {
      return const _PrimaryAction(
        HospitalTicketAction.takeOver,
        'Take Over',
        Icons.person_pin_circle_outlined,
      );
    }
    if (actions.contains(HospitalTicketAction.resolve) &&
        (ticket.status == HospitalTicketStatus.inProgress ||
            ticket.status ==
                HospitalTicketStatus.escalatedOperationsExecutive ||
            ticket.status == HospitalTicketStatus.escalatedFacilityManager ||
            ticket.status == HospitalTicketStatus.escalatedProjectHead)) {
      if (ticket.completionPhotoPaths.isEmpty &&
          actions.contains(HospitalTicketAction.uploadCompletionPhoto)) {
        return const _PrimaryAction(
          HospitalTicketAction.uploadCompletionPhoto,
          'Upload Completion Photo',
          Icons.add_a_photo_outlined,
        );
      }
      return const _PrimaryAction(
        HospitalTicketAction.resolve,
        'Resolve Ticket',
        Icons.check_circle_outline,
      );
    }
    return null;
  }

  Future<void> _performAction(
    HospitalTicketAction action, [
    String? label,
  ]) async {
    final ticket = widget.controller.ticketById(widget.ticketId);
    final actionLabel = label ?? _actionLabel(action);
    final confirmed = action == HospitalTicketAction.accept
        ? await _confirmAccept(ticket)
        : await _confirm(actionLabel);
    if (confirmed != true || !mounted) return;
    try {
      switch (action) {
        case HospitalTicketAction.accept:
          await widget.controller.accept(ticket.id);
          break;
        case HospitalTicketAction.startWork:
          await widget.controller.startWork(ticket.id);
          break;
        case HospitalTicketAction.addProgress:
        case HospitalTicketAction.addRemarks:
          await _addUpdate(
            ticket.id,
            action: action == HospitalTicketAction.addRemarks
                ? 'Remarks added'
                : 'Progress update',
          );
          break;
        case HospitalTicketAction.uploadProgressPhoto:
          await _addPhotoUpdate(ticket.id);
          break;
        case HospitalTicketAction.uploadCompletionPhoto:
          await _addCompletionPhoto(ticket.id);
          break;
        case HospitalTicketAction.requestAssistance:
          await _remarksAction(
            ticket.id,
            'Request Assistance',
            widget.controller.requestAssistance,
          );
          break;
        case HospitalTicketAction.takeOver:
          await widget.controller.takeOver(ticket.id);
          break;
        case HospitalTicketAction.reassignSupervisor:
          await widget.controller.reassignSupervisor(ticket.id);
          break;
        case HospitalTicketAction.escalateManually:
          await widget.controller.escalateManually(ticket.id);
          break;
        case HospitalTicketAction.escalateFurther:
          await widget.controller.escalateFurther(ticket.id);
          break;
        case HospitalTicketAction.assignSupport:
          await _remarksAction(
            ticket.id,
            'Assign Support',
            widget.controller.assignSupport,
          );
          break;
        case HospitalTicketAction.resolve:
          await _resolve(ticket.id);
          break;
        case HospitalTicketAction.simulateSupervisorBreach:
          widget.controller.simulateSupervisorBreach(ticket.id);
          break;
        case HospitalTicketAction.simulateOperationsBreach:
          widget.controller.simulateOperationsBreach(ticket.id);
          break;
        case HospitalTicketAction.simulateClientSatisfied:
          await _feedback(ticket.id, true);
          break;
        case HospitalTicketAction.simulateClientNotSatisfied:
          await _feedback(ticket.id, false);
          break;
      }
      if (mounted) {
        _message(
          action == HospitalTicketAction.resolve
              ? 'Work completion sent to client for confirmation.'
              : '$actionLabel completed.',
        );
      }
    } catch (error) {
      if (mounted) _message(_friendlyMessage(error));
    }
  }

  Future<bool?> _confirm(String label) => showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(label),
      content: const Text('Confirm this action for the selected complaint?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Confirm'),
        ),
      ],
    ),
  );

  Future<bool?> _confirmAccept(HospitalTicket ticket) => showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Accept this ticket?'),
      content: Text(
        [
          'Block: ${ticket.block}',
          'Floor: ${ticket.floor}',
          'Area: ${ticket.conciseLocation}',
          '',
          'Confirm that this location is under your responsibility.',
        ].join('\n'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Accept Ticket'),
        ),
      ],
    ),
  );

  Future<void> _addUpdate(String id, {required String action}) async {
    final text = await _textDialog(action, 'Enter a clear housekeeping update');
    if (text != null) {
      await widget.controller.addUpdate(id, remarks: text, action: action);
    }
  }

  Future<void> _addPhotoUpdate(String id) async {
    final photo = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 72,
    );
    if (photo == null || !mounted) return;
    final remarks = await _textDialog(
      'Progress photo',
      'Describe what this photo shows',
    );
    if (remarks != null) {
      await widget.controller.addUpdate(
        id,
        remarks: remarks,
        photoPath: photo.path,
      );
    }
  }

  Future<void> _addCompletionPhoto(String id) async {
    final photo = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 72,
    );
    if (photo == null || !mounted) return;
    await widget.controller.uploadCompletionPhoto(id, photoPath: photo.path);
  }

  Future<void> _remarksAction(
    String id,
    String title,
    Future<void> Function(String, String) action,
  ) async {
    final remarks = await _textDialog(title, 'Reason or support details');
    if (remarks != null) await action(id, remarks);
  }

  Future<void> _resolve(String id) async {
    final ticket = widget.controller.ticketById(id);
    if (ticket.completionPhotoPaths.isEmpty) {
      _message('Upload a completion photo before resolving this ticket.');
      return;
    }
    final remarks = await _textDialog(
      'Work Completion Remarks',
      'Briefly describe the work completed',
      maxLength: 500,
    );
    if (remarks == null || !mounted) return;
    await widget.controller.resolve(
      id,
      resolutionRemarks: remarks,
    );
  }

  Future<void> _feedback(String id, bool satisfied) async {
    final feedback = await _feedbackDialog(satisfied);
    if (feedback == null) return;
    widget.controller.simulateClientFeedback(
      id,
      satisfied: satisfied,
      rating: feedback.$1,
      comments: feedback.$2,
    );
  }

  Future<(int, String)?> _feedbackDialog(bool satisfied) async {
    final comments = TextEditingController();
    var rating = satisfied ? 5 : 2;
    final result = await showDialog<(int, String)>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(
            satisfied
                ? 'Client marked Satisfied'
                : 'Client marked Not Satisfied',
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Client rating'),
              Row(
                children: List.generate(
                  5,
                  (index) => IconButton(
                    tooltip: '${index + 1} star',
                    onPressed: () => setDialogState(() => rating = index + 1),
                    icon: Icon(
                      index < rating
                          ? Icons.star_rounded
                          : Icons.star_border_rounded,
                      color: hospitalAmber,
                    ),
                  ),
                ),
              ),
              TextField(
                controller: comments,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: satisfied
                      ? 'Optional client comments'
                      : 'Reason for reopening (required)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final value = comments.text.trim();
                if (!satisfied && value.isEmpty) return;
                Navigator.pop(context, (rating, value));
              },
              child: Text(satisfied ? 'Mark Satisfied' : 'Reopen Ticket'),
            ),
          ],
        ),
      ),
    );
    comments.dispose();
    return result;
  }

  Future<String?> _textDialog(
    String title,
    String hint, {
    int maxLength = 500,
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: maxLength,
          maxLines: 3,
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.isNotEmpty) Navigator.pop(context, value);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  void _showAllPhotos(List<String> paths) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: GridView.builder(
          padding: const EdgeInsets.all(16),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
          ),
          itemCount: paths.length,
          itemBuilder: (_, index) => _Photo(path: paths[index], size: 180),
        ),
      ),
    );
  }

  void _message(String value) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(value)));

  String _friendlyMessage(Object error) {
    final text = error.toString();
    if (error is HospitalTicketApiException) return error.message;
    if (text.contains('session')) return 'Your session expired. Sign in again.';
    if (text.contains('timed out')) return 'The request timed out. Try again.';
    if (text.contains('not allowed')) {
      return 'This action is not available for the current complaint status.';
    }
    return 'Unable to complete this action. Please try again.';
  }
}

class _CompactHeader extends StatelessWidget {
  const _CompactHeader({
    required this.ticket,
    required this.sla,
    required this.primaryBusy,
  });

  final HospitalTicket ticket;
  final HospitalSlaSnapshot sla;
  final bool primaryBusy;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border(bottom: BorderSide(color: Colors.grey.shade200)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _ticketLabel(ticket),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: qpmsBlue,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            _Pill(ticket.priority.label, hospitalRed),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _Pill(ticket.status.label, _statusColor(ticket.status)),
            _Pill(sla.label, _slaColor(sla.state)),
            _Pill(_ownerLabel(ticket), hospitalTeal),
            if (primaryBusy)
              const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        if (ticket.status ==
                HospitalTicketStatus.awaitingSupervisorAcceptance &&
            ticket.acceptanceDueAt != null) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: hospitalAmber.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: hospitalAmber.withValues(alpha: .35)),
            ),
            child: Row(
              children: [
                const Icon(Icons.timer_outlined, color: hospitalAmber),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Acceptance Required • ${_remainingLabel(ticket.acceptanceDueAt!)} remaining',
                    style: const TextStyle(
                      color: qpmsText,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    ),
  );
}

String _remainingLabel(DateTime dueAt) {
  final remaining = dueAt.difference(DateTime.now());
  if (remaining.isNegative) return '00:00';
  final minutes = remaining.inMinutes.remainder(60).toString().padLeft(2, '0');
  final seconds = remaining.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$minutes:$seconds';
}

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({
    required this.ticket,
    required this.descriptionExpanded,
    required this.onToggleDescription,
    required this.onViewAllPhotos,
    required this.bottomInset,
  });

  final HospitalTicket ticket;
  final bool descriptionExpanded;
  final VoidCallback onToggleDescription;
  final void Function(List<String>) onViewAllPhotos;
  final double bottomInset;

  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(16, 12, 16, bottomInset),
    children: [
      _Section(
        title: 'Location',
        children: [
          ...[
            _optionalRow('Client / Site', ticket.site),
            _optionalRow('Block', ticket.block),
            _optionalRow('Floor', ticket.floor),
            _optionalRow('Department', ticket.department),
            _optionalRow(
              'Room / Location',
              ticket.roomArea.isEmpty ? ticket.location : ticket.roomArea,
            ),
            _optionalRow('Landmark', ticket.exactLandmark),
          ].whereType<Widget>(),
          if (ticket.fullLocationDisplay.trim().isNotEmpty)
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text(
                'View full location',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
              ),
              childrenPadding: EdgeInsets.zero,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    ticket.fullLocationDisplay,
                    style: const TextStyle(height: 1.35),
                  ),
                ),
              ],
            ),
        ],
      ),
      const SizedBox(height: 12),
      _Section(
        title: 'Issue',
        children: [
          _row('Category', ticket.category),
          _ExpandableText(
            label: 'Description',
            value: ticket.description,
            expanded: descriptionExpanded,
            onToggle: onToggleDescription,
          ),
          _row('Reported by', ticket.reportedBy),
          _row(
            'Raised',
            DateFormat('dd MMM yyyy, hh:mm a').format(ticket.raisedAt),
          ),
        ],
      ),
      const SizedBox(height: 12),
      _PhotoSummary(ticket: ticket, onViewAllPhotos: onViewAllPhotos),
      if (ticket.completionPhotoPaths.isNotEmpty) ...[
        const SizedBox(height: 12),
        _Section(
          title: 'Completion Evidence',
          children: [
            const Text(
              'Completion photo uploaded. Work completion remarks can now be submitted to the client.',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 88,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: ticket.completionPhotoPaths.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (_, index) =>
                    _Photo(path: ticket.completionPhotoPaths[index]),
              ),
            ),
          ],
        ),
      ],
      if (ticket.resolutionRemarks.isNotEmpty) ...[
        const SizedBox(height: 12),
        _Section(
          title: 'Resolution',
          children: [
            ...[
              if (ticket.actionTaken.trim().toLowerCase() != 'work completed')
                _optionalRow('Action taken', ticket.actionTaken),
            ].whereType<Widget>(),
            _row('Work completion remarks', ticket.resolutionRemarks),
            if (ticket.clientRating != null)
              _row(
                'Client feedback',
                '${ticket.clientRating}/5 - ${ticket.clientFeedback}',
              ),
          ],
        ),
      ],
    ],
  );
}

class _TimelineTab extends StatelessWidget {
  const _TimelineTab({
    required this.ticket,
    required this.loading,
    required this.refreshing,
    required this.error,
    required this.loadedAt,
    required this.onRetry,
    required this.bottomInset,
  });

  final HospitalTicket ticket;
  final bool loading;
  final bool refreshing;
  final String? error;
  final DateTime? loadedAt;
  final VoidCallback onRetry;
  final double bottomInset;

  @override
  Widget build(BuildContext context) {
    final events = [...ticket.events]
      ..sort((a, b) => b.occurredAt.compareTo(a.occurredAt));
    if (loading && events.isEmpty) {
      return const _CenteredState(
        icon: Icons.history_rounded,
        title: 'Loading activity...',
        showProgress: true,
      );
    }
    if (error != null && events.isEmpty) {
      return _CenteredState(
        icon: Icons.warning_amber_rounded,
        title: 'Unable to load activity',
        message: error!,
        actionLabel: 'Retry',
        onAction: onRetry,
      );
    }
    if (events.isEmpty) {
      return const _CenteredState(
        icon: Icons.history_toggle_off_rounded,
        title: 'No activity yet',
        message: 'Activity will appear here after the first update.',
      );
    }
    return RefreshIndicator(
      onRefresh: () async => onRetry(),
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, 12, 16, bottomInset),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  loadedAt == null
                      ? 'Latest activity first'
                      : 'Last updated ${DateFormat('hh:mm a').format(loadedAt!)}',
                  style: const TextStyle(color: qpmsMuted, fontSize: 12),
                ),
              ),
              if (refreshing)
                const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 10),
          ...events.map((event) => _TimelineEvent(event)),
        ],
      ),
    );
  }
}

class _ActionsTab extends StatelessWidget {
  const _ActionsTab({
    required this.ticket,
    required this.actions,
    required this.primaryAction,
    required this.busy,
    required this.onAction,
    required this.bottomInset,
  });

  final HospitalTicket ticket;
  final Set<HospitalTicketAction> actions;
  final HospitalTicketAction? primaryAction;
  final bool busy;
  final Future<void> Function(HospitalTicketAction, [String?]) onAction;
  final double bottomInset;

  @override
  Widget build(BuildContext context) {
    final secondary = actions
        .where((action) => action != primaryAction)
        .where(_isOperationalSecondaryAction)
        .toList();
    final workUpdates = secondary
        .where(
          (action) =>
              action == HospitalTicketAction.addProgress ||
              action == HospitalTicketAction.addRemarks ||
              action == HospitalTicketAction.uploadProgressPhoto,
        )
        .toList();
    final completion = secondary
        .where(
          (action) =>
              action == HospitalTicketAction.uploadCompletionPhoto ||
              action == HospitalTicketAction.resolve,
        )
        .toList();
    final escalation = secondary
        .where((action) => !workUpdates.contains(action) && !completion.contains(action))
        .toList();
    final groups = [
      if (workUpdates.isNotEmpty) ('WORK UPDATE', workUpdates),
      if (completion.isNotEmpty) ('COMPLETION', completion),
      if (escalation.isNotEmpty) ('ESCALATION / ASSIGNMENT', escalation),
    ];
    if (groups.isEmpty) {
      return const _CenteredState(
        icon: Icons.lock_clock_rounded,
        title: 'No other actions available',
        message: 'Available actions depend on the ticket status and your role.',
      );
    }
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 12, 16, bottomInset),
      children: [
        if (primaryAction == HospitalTicketAction.resolve)
          const _Section(
            title: 'COMPLETION READY',
            children: [
              Text(
                'Completion evidence is uploaded. Use Resolve Ticket to send the work completion to the client.',
                style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        for (final group in groups) ...[
          if (primaryAction == HospitalTicketAction.resolve)
            const SizedBox(height: 12),
          _ActionGroup(
            title: group.$1,
            actions: group.$2,
            busy: busy,
            onAction: onAction,
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _ActionGroup extends StatelessWidget {
  const _ActionGroup({
    required this.title,
    required this.actions,
    required this.busy,
    required this.onAction,
  });

  final String title;
  final List<HospitalTicketAction> actions;
  final bool busy;
  final Future<void> Function(HospitalTicketAction, [String?]) onAction;

  @override
  Widget build(BuildContext context) => _Section(
    title: title,
    children: [
      for (final action in actions) ...[
        OutlinedButton.icon(
          onPressed: busy ? null : () => onAction(action),
          icon: Icon(_actionIcon(action)),
          label: Align(
            alignment: Alignment.centerLeft,
            child: Text(_actionLabel(action)),
          ),
        ),
        if (action != actions.last) const SizedBox(height: 10),
      ],
    ],
  );
}

class _PhotoSummary extends StatelessWidget {
  const _PhotoSummary({required this.ticket, required this.onViewAllPhotos});

  final HospitalTicket ticket;
  final void Function(List<String>) onViewAllPhotos;

  @override
  Widget build(BuildContext context) {
    final photos = [
      ...ticket.complaintPhotoPaths,
      ...ticket.progressPhotoPaths,
      ...ticket.completionPhotoPaths,
    ];
    if (photos.isEmpty) {
      return const _Section(
        title: 'Photos',
        children: [
          Text(
            'No photos loaded yet.',
            style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
          ),
        ],
      );
    }
    return _Section(
      title: 'Photos',
      children: [
        SizedBox(
          height: 88,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: photos.take(3).length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (_, index) => _Photo(path: photos[index]),
          ),
        ),
        if (photos.length > 3)
          TextButton(
            onPressed: () => onViewAllPhotos(photos),
            child: Text('View all ${photos.length} photos'),
          ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    ),
  );
}

class _ExpandableText extends StatelessWidget {
  const _ExpandableText({
    required this.label,
    required this.value,
    required this.expanded,
    required this.onToggle,
  });

  final String label;
  final String value;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: expanded ? null : 4,
          overflow: expanded ? TextOverflow.visible : TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        if (value.length > 140)
          TextButton(
            onPressed: onToggle,
            child: Text(expanded ? 'Show less' : 'Show more'),
          ),
      ],
    ),
  );
}

class _TimelineEvent extends StatelessWidget {
  const _TimelineEvent(this.event);

  final HospitalTicketEvent event;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: hospitalTeal.withValues(alpha: .1),
          child: Icon(
            event.hasPhoto ? Icons.photo_outlined : Icons.history_rounded,
            color: hospitalTeal,
            size: 16,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _titleCase(event.action),
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${event.actor} - ${_titleCase(event.actorRole)}',
                    style: const TextStyle(color: qpmsMuted, fontSize: 11),
                  ),
                  Text(
                    DateFormat('dd MMM yyyy, hh:mm a').format(event.occurredAt),
                    style: const TextStyle(color: qpmsMuted, fontSize: 11),
                  ),
                  if (event.remarks.trim().isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(event.remarks),
                  ],
                  if (event.hasPhoto)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Row(
                        children: [
                          Icon(
                            Icons.photo_outlined,
                            size: 16,
                            color: hospitalTeal,
                          ),
                          SizedBox(width: 4),
                          Text(
                            'Photo attached',
                            style: TextStyle(
                              color: hospitalTeal,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _CenteredState extends StatelessWidget {
  const _CenteredState({
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.showProgress = false,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool showProgress;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: hospitalTeal, size: 38),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: qpmsMuted),
            ),
          ],
          if (showProgress) ...[
            const SizedBox(height: 14),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 14),
            FilledButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    ),
  );
}

class _Photo extends StatelessWidget {
  const _Photo({required this.path, this.size = 110});

  final String path;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          path,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _fallback(),
        ),
      );
    }
    if (!path.startsWith('demo://') && File(path).existsSync()) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.file(
          File(path),
          width: size,
          height: size,
          fit: BoxFit.cover,
        ),
      );
    }
    return _fallback();
  }

  Widget _fallback() => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: const Color(0xFFE8F5F5),
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.photo_outlined, color: hospitalTeal),
        SizedBox(height: 4),
        Text('Photo', style: TextStyle(fontSize: 11, color: hospitalTeal)),
      ],
    ),
  );
}

class _Pill extends StatelessWidget {
  const _Pill(this.label, this.color);

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .1),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w900),
    ),
  );
}

class _PrimaryAction {
  const _PrimaryAction(
    this.action,
    this.label,
    this.icon, {
    this.disabled = false,
  });

  final HospitalTicketAction action;
  final String label;
  final IconData icon;
  final bool disabled;
}

Widget _row(String label, String value) => Padding(
  padding: const EdgeInsets.only(bottom: 11),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label(label),
      const SizedBox(height: 2),
      Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
    ],
  ),
);

Widget? _optionalRow(String label, String value) {
  final text = value.trim();
  if (text.isEmpty) return null;
  return _row(label, text);
}

Widget _label(String label) => Text(
  label,
  style: const TextStyle(
    color: qpmsMuted,
    fontSize: 11,
    fontWeight: FontWeight.w800,
  ),
);

String _ticketLabel(HospitalTicket ticket) {
  final number = ticket.ticketNumber.trim();
  if (number.isNotEmpty) return number;
  return ticket.id.length <= 12 ? ticket.id : '${ticket.id.substring(0, 8)}...';
}

String _ownerLabel(HospitalTicket ticket) {
  final owner = ticket.responsiblePerson.trim();
  if (owner.isEmpty || owner == 'Assignment pending') return 'Unassigned';
  final role = ticket.responsibleRole.trim();
  return role.isEmpty ? owner : '$owner - ${_titleCase(role)}';
}

bool _isOperationalSecondaryAction(HospitalTicketAction action) =>
    switch (action) {
      HospitalTicketAction.addProgress ||
      HospitalTicketAction.addRemarks ||
      HospitalTicketAction.uploadProgressPhoto ||
      HospitalTicketAction.uploadCompletionPhoto ||
      HospitalTicketAction.requestAssistance ||
      HospitalTicketAction.escalateManually ||
      HospitalTicketAction.reassignSupervisor ||
      HospitalTicketAction.assignSupport ||
      HospitalTicketAction.escalateFurther ||
      HospitalTicketAction.simulateSupervisorBreach ||
      HospitalTicketAction.simulateOperationsBreach ||
      HospitalTicketAction.simulateClientSatisfied ||
      HospitalTicketAction.simulateClientNotSatisfied => true,
      _ => false,
    };

String _actionLabel(HospitalTicketAction action) => switch (action) {
  HospitalTicketAction.accept => 'Accept Ticket',
  HospitalTicketAction.startWork => 'Start Work',
  HospitalTicketAction.addProgress => 'Add Progress',
  HospitalTicketAction.addRemarks => 'Add Remark',
  HospitalTicketAction.uploadProgressPhoto => 'Upload Photo',
  HospitalTicketAction.uploadCompletionPhoto => 'Upload Completion Photo',
  HospitalTicketAction.resolve => 'Resolve Ticket',
  HospitalTicketAction.requestAssistance => 'Request Assistance',
  HospitalTicketAction.escalateManually => 'Escalate',
  HospitalTicketAction.takeOver => 'Take Over',
  HospitalTicketAction.reassignSupervisor => 'Reassign Supervisor',
  HospitalTicketAction.escalateFurther => 'Escalate Further',
  HospitalTicketAction.assignSupport => 'Assign Support',
  HospitalTicketAction.simulateSupervisorBreach => 'Simulate Supervisor Breach',
  HospitalTicketAction.simulateOperationsBreach => 'Simulate Operations Breach',
  HospitalTicketAction.simulateClientSatisfied => 'Client Satisfied',
  HospitalTicketAction.simulateClientNotSatisfied => 'Client Not Satisfied',
};

IconData _actionIcon(HospitalTicketAction action) => switch (action) {
  HospitalTicketAction.addProgress => Icons.add_comment_outlined,
  HospitalTicketAction.addRemarks => Icons.notes_rounded,
  HospitalTicketAction.uploadProgressPhoto => Icons.add_a_photo_outlined,
  HospitalTicketAction.uploadCompletionPhoto => Icons.add_photo_alternate_outlined,
  HospitalTicketAction.requestAssistance => Icons.support_agent_rounded,
  HospitalTicketAction.escalateManually ||
  HospitalTicketAction.escalateFurther => Icons.trending_up_rounded,
  HospitalTicketAction.reassignSupervisor => Icons.assignment_ind_outlined,
  HospitalTicketAction.assignSupport => Icons.groups_outlined,
  HospitalTicketAction.simulateSupervisorBreach ||
  HospitalTicketAction.simulateOperationsBreach => Icons.timer_off_outlined,
  HospitalTicketAction.simulateClientSatisfied => Icons.sentiment_satisfied_alt,
  HospitalTicketAction.simulateClientNotSatisfied =>
    Icons.sentiment_dissatisfied_outlined,
  _ => Icons.task_alt_rounded,
};

Color _slaColor(HospitalSlaState state) => switch (state) {
  HospitalSlaState.breached => hospitalRed,
  HospitalSlaState.nearBreach => hospitalAmber,
  HospitalSlaState.healthy => hospitalGreen,
  HospitalSlaState.notApplicable => qpmsBlue,
};

Color _statusColor(HospitalTicketStatus status) => switch (status) {
  HospitalTicketStatus.closed ||
  HospitalTicketStatus.resolvedAwaitingConfirmation => hospitalGreen,
  HospitalTicketStatus.awaitingSupervisorAcceptance => hospitalAmber,
    HospitalTicketStatus.escalatedOperationsExecutive ||
    HospitalTicketStatus.escalatedFacilityManager ||
    HospitalTicketStatus.escalatedProjectHead ||
    HospitalTicketStatus.reopened => hospitalRed,
  HospitalTicketStatus.inProgress ||
  HospitalTicketStatus.accepted => hospitalTeal,
  _ => qpmsBlue,
};

String _titleCase(String value) {
  return value
      .replaceAll('_', ' ')
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}
