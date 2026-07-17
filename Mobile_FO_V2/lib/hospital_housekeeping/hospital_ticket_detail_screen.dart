import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_sla_policy.dart';
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

class _HospitalTicketDetailScreenState
    extends State<HospitalTicketDetailScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_refresh);
    widget.controller.loadDetail(widget.ticketId);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ticket = widget.controller.ticketById(widget.ticketId);
    final sla = widget.controller.slaFor(ticket);
    final actions = widget.controller.actionsFor(ticket);
    return Scaffold(
      appBar: AppBar(title: const Text('Complaint details')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 30),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(17),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          ticket.id,
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
                  const SizedBox(height: 10),
                  Text(
                    ticket.status.label,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    sla.label,
                    style: TextStyle(
                      color: _slaColor(sla.state.name),
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          _Section(
            title: 'Complaint',
            children: [
              _row('Block / Floor', '${ticket.block} • ${ticket.floor}'),
              _row('Department / Location', ticket.location),
              _row('Category', ticket.category),
              _row('Description', ticket.description),
              _row('Reported by', ticket.reportedBy),
              _row(
                'Raised',
                DateFormat('dd MMM yyyy, hh:mm a').format(ticket.raisedAt),
              ),
              _row(
                'Responsible',
                '${ticket.responsiblePerson} • ${ticket.responsibleRole}',
              ),
              _row('Escalation level', _escalationLabel(ticket)),
              if (ticket.complaintPhotoPaths.isNotEmpty)
                _photos('Complaint photo', ticket.complaintPhotoPaths),
            ],
          ),
          if (ticket.operationsEscalatedAt != null ||
              ticket.facilityEscalatedAt != null) ...[
            const SizedBox(height: 12),
            _Section(
              title: 'Escalation history',
              children: [
                _row('Original Supervisor', ticket.supervisorName),
                _row(
                  'Supervisor SLA due',
                  DateFormat('dd MMM, hh:mm a').format(ticket.supervisorDueAt),
                ),
                if (ticket.operationsEscalatedAt != null)
                  _row(
                    'Operations escalation',
                    DateFormat(
                      'dd MMM, hh:mm a',
                    ).format(ticket.operationsEscalatedAt!),
                  ),
                if (ticket.operationsDueAt != null)
                  _row(
                    'Operations SLA due',
                    DateFormat(
                      'dd MMM, hh:mm a',
                    ).format(ticket.operationsDueAt!),
                  ),
                if (ticket.facilityEscalatedAt != null)
                  _row(
                    'Facility escalation',
                    DateFormat(
                      'dd MMM, hh:mm a',
                    ).format(ticket.facilityEscalatedAt!),
                  ),
                _row(
                  'Total elapsed',
                  HospitalSlaPolicy.formatDuration(
                    widget.controller.now.difference(ticket.raisedAt),
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
                _row('Action taken', ticket.actionTaken),
                _row('Resolution remarks', ticket.resolutionRemarks),
                if (ticket.resolvedAt != null)
                  _row(
                    'Resolved',
                    DateFormat(
                      'dd MMM yyyy, hh:mm a',
                    ).format(ticket.resolvedAt!),
                  ),
                if (ticket.completionPhotoPaths.isNotEmpty)
                  _photos('Completion photo', ticket.completionPhotoPaths),
                if (ticket.clientRating != null)
                  _row(
                    'Client feedback',
                    '${ticket.clientRating}/5 • ${ticket.clientFeedback}',
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          _Section(
            title: 'Activity timeline',
            children: ticket.events.reversed
                .map((event) => _TimelineEvent(event))
                .toList(),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            _Section(
              title: 'Available actions',
              children: [_actionButtons(ticket, actions)],
            ),
          ],
        ],
      ),
    );
  }

  Widget _actionButtons(
    HospitalTicket ticket,
    Set<HospitalTicketAction> actions,
  ) {
    final buttons = <Widget>[];
    void add(
      HospitalTicketAction action,
      String label,
      IconData icon,
      VoidCallback callback, {
      bool demo = false,
    }) {
      if (!actions.contains(action)) return;
      buttons.add(
        OutlinedButton.icon(
          onPressed: () => _confirm(label, callback),
          icon: Icon(icon),
          label: Text(demo ? '$label (Demo only)' : label),
        ),
      );
    }

    add(
      HospitalTicketAction.accept,
      'Accept Ticket',
      Icons.task_alt,
      () => widget.controller.accept(ticket.id),
    );
    add(
      HospitalTicketAction.startWork,
      'Start Work',
      Icons.play_arrow,
      () => widget.controller.startWork(ticket.id),
    );
    add(
      HospitalTicketAction.addProgress,
      'Add Progress Update',
      Icons.add_comment_outlined,
      () => _addUpdate(ticket.id),
    );
    add(
      HospitalTicketAction.addRemarks,
      'Add Remarks',
      Icons.notes,
      () => _addUpdate(ticket.id, action: 'Remarks added'),
    );
    add(
      HospitalTicketAction.uploadProgressPhoto,
      'Upload Progress Photo',
      Icons.add_a_photo_outlined,
      () => _addPhotoUpdate(ticket.id),
    );
    add(
      HospitalTicketAction.requestAssistance,
      'Request Assistance',
      Icons.support_agent,
      () => _remarksAction(
        ticket.id,
        'Request Assistance',
        widget.controller.requestAssistance,
      ),
    );
    add(
      HospitalTicketAction.takeOver,
      'Take Over',
      Icons.person_pin_circle_outlined,
      () => widget.controller.takeOver(ticket.id),
    );
    add(
      HospitalTicketAction.reassignSupervisor,
      'Reassign to Supervisor',
      Icons.assignment_ind_outlined,
      () => widget.controller.reassignSupervisor(ticket.id),
    );
    add(
      HospitalTicketAction.assignSupport,
      'Assign Support',
      Icons.groups_outlined,
      () => _remarksAction(
        ticket.id,
        'Assign Support',
        widget.controller.assignSupport,
      ),
    );
    add(
      HospitalTicketAction.escalateManually,
      'Escalate Manually',
      Icons.trending_up,
      () => widget.controller.escalateManually(ticket.id),
    );
    add(
      HospitalTicketAction.escalateFurther,
      'Escalate Further',
      Icons.warning_amber,
      () => widget.controller.escalateFurther(ticket.id),
    );
    add(
      HospitalTicketAction.resolve,
      'Resolve Ticket',
      Icons.check_circle_outline,
      () => _resolve(ticket.id),
    );
    add(
      HospitalTicketAction.simulateSupervisorBreach,
      'Simulate Supervisor SLA Breach',
      Icons.timer_off_outlined,
      () => widget.controller.simulateSupervisorBreach(ticket.id),
      demo: true,
    );
    add(
      HospitalTicketAction.simulateOperationsBreach,
      'Simulate Operations SLA Breach',
      Icons.timer_off_outlined,
      () => widget.controller.simulateOperationsBreach(ticket.id),
      demo: true,
    );
    add(
      HospitalTicketAction.simulateClientSatisfied,
      'Client Marked Satisfied',
      Icons.sentiment_satisfied_alt,
      () => _feedback(ticket.id, true),
      demo: true,
    );
    add(
      HospitalTicketAction.simulateClientNotSatisfied,
      'Client Marked Not Satisfied',
      Icons.sentiment_dissatisfied_outlined,
      () => _feedback(ticket.id, false),
      demo: true,
    );
    return Wrap(spacing: 8, runSpacing: 8, children: buttons);
  }

  Future<void> _confirm(String label, VoidCallback callback) async {
    final ok = await showDialog<bool>(
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
    if (ok == true) {
      try {
        callback();
      } catch (error) {
        _message(error.toString());
      }
    }
  }

  Future<void> _addUpdate(
    String id, {
    String action = 'Progress update',
  }) async {
    final text = await _textDialog(action, 'Enter a clear housekeeping update');
    if (text != null) {
      widget.controller.addUpdate(id, remarks: text, action: action);
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
      widget.controller.addUpdate(id, remarks: remarks, photoPath: photo.path);
    }
  }

  Future<void> _remarksAction(
    String id,
    String title,
    void Function(String, String) action,
  ) async {
    final remarks = await _textDialog(title, 'Reason or support details');
    if (remarks != null) action(id, remarks);
  }

  Future<void> _resolve(String id) async {
    final action = await _textDialog(
      'Action taken',
      'Describe the housekeeping action completed',
    );
    if (action == null || !mounted) return;
    final remarks = await _textDialog(
      'Resolution remarks',
      'Add resolution details',
    );
    if (remarks == null || !mounted) return;
    final photo = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 72,
    );
    if (photo == null) {
      _message('A completion photo is required.');
      return;
    }
    widget.controller.resolve(
      id,
      actionTaken: action,
      resolutionRemarks: remarks,
      completionPhotoPath: photo.path,
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
              child: Text(satisfied ? 'Close Ticket' : 'Reopen Ticket'),
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
    bool allowEmpty = false,
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
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
              if (allowEmpty || value.isNotEmpty) Navigator.pop(context, value);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  void _message(String value) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(value)));

  static Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: qpmsMuted,
            fontSize: 11,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
    ),
  );

  static Widget _photos(String label, List<String> paths) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: qpmsMuted,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 6),
      SizedBox(
        height: 88,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: paths.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (_, index) => _Photo(path: paths[index]),
        ),
      ),
    ],
  );

  static String _escalationLabel(HospitalTicket ticket) =>
      ticket.facilityEscalatedAt != null
      ? 'Facility Manager'
      : ticket.operationsEscalatedAt != null
      ? 'Operations Executive'
      : 'Supervisor';
  static Color _slaColor(String state) => state == 'breached'
      ? hospitalRed
      : state == 'nearBreach'
      ? hospitalAmber
      : hospitalGreen;
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(17),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    ),
  );
}

class _TimelineEvent extends StatelessWidget {
  const _TimelineEvent(this.event);
  final HospitalTicketEvent event;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 15),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 10,
          height: 10,
          margin: const EdgeInsets.only(top: 5),
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: hospitalTeal,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                event.action,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              Text(
                '${event.actor} • ${event.actorRole}',
                style: const TextStyle(color: qpmsMuted, fontSize: 11),
              ),
              Text(
                DateFormat('dd MMM yyyy, hh:mm a').format(event.occurredAt),
                style: const TextStyle(color: qpmsMuted, fontSize: 11),
              ),
              const SizedBox(height: 3),
              Text(event.remarks),
              if (event.hasPhoto)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Row(
                    children: [
                      Icon(Icons.photo_outlined, size: 16, color: hospitalTeal),
                      SizedBox(width: 4),
                      Text(
                        'Photo attached',
                        style: TextStyle(color: hospitalTeal, fontSize: 12),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Photo extends StatelessWidget {
  const _Photo({required this.path});
  final String path;
  @override
  Widget build(BuildContext context) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          path,
          width: 110,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _fallback(),
        ),
      );
    }
    if (!path.startsWith('demo://') && File(path).existsSync()) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.file(File(path), width: 110, fit: BoxFit.cover),
      );
    }
    return _fallback();
  }

  Widget _fallback() => Container(
    width: 110,
    decoration: BoxDecoration(
      color: const Color(0xFFE8F5F5),
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.photo_outlined, color: hospitalTeal),
        SizedBox(height: 4),
        Text('Demo photo', style: TextStyle(fontSize: 11, color: hospitalTeal)),
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
      style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 11),
    ),
  );
}
