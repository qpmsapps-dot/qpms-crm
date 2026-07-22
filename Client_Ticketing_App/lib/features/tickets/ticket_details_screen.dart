import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/chips.dart';
import '../../models/ticket.dart';
import '../../models/ticket_update.dart';
import '../../state/ticket_controller.dart';
import '../../state/auth_controller.dart';

class TicketDetailsScreen extends StatefulWidget {
  const TicketDetailsScreen({required this.ticketNumber, super.key});
  final String ticketNumber;

  @override
  State<TicketDetailsScreen> createState() => _TicketDetailsScreenState();
}

class _TicketDetailsScreenState extends State<TicketDetailsScreen>
    with WidgetsBindingObserver {
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    context.read<TicketController>().loadDetail(widget.ticketNumber);
    _startPolling();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted || !context.read<AuthController>().isAuthenticated) {
        _pollTimer?.cancel();
        return;
      }
      context.read<TicketController>().loadDetail(widget.ticketNumber);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startPolling();
    } else {
      _pollTimer?.cancel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ticket = context.watch<TicketController>().ticketByNumber(
      widget.ticketNumber,
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Track Ticket')),
      bottomNavigationBar: ticket.status == TicketStatus.awaitingConfirmation
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 16),
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.pushNamed(
                    context,
                    AppRoutes.feedback,
                    arguments: ticket.number,
                  ),
                  icon: const Icon(Icons.verified_rounded),
                  label: const Text('Confirm Completed Work'),
                ),
              ),
            )
          : null,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () =>
              context.read<TicketController>().loadDetail(widget.ticketNumber),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 6, 18, 26),
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                ticket.number,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w900,
                                  color: AppColors.deepBlue,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                formatTicketDateTime(ticket.raisedAt),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        PriorityChip(ticket.priority),
                      ],
                    ),
                    const SizedBox(height: 14),
                    StatusChip(ticket.status),
                    const SizedBox(height: 14),
                    _InfoLine(
                      Icons.location_on_rounded,
                      'Path',
                      ticket.detailLocation,
                    ),
                    if (ticket.site.isNotEmpty)
                      _InfoLine(Icons.business_rounded, 'Site', ticket.site),
                    if (ticket.block.isNotEmpty)
                      _InfoLine(Icons.apartment_rounded, 'Block', ticket.block),
                    if (ticket.floor.isNotEmpty)
                      _InfoLine(Icons.layers_rounded, 'Floor', ticket.floor),
                    if (ticket.department.isNotEmpty)
                      _InfoLine(
                        Icons.local_hospital_rounded,
                        'Unit',
                        ticket.department,
                      ),
                    if (ticket.ward.isNotEmpty)
                      _InfoLine(Icons.bed_rounded, 'Ward', ticket.ward),
                    if (ticket.roomArea.isNotEmpty)
                      _InfoLine(
                        Icons.meeting_room_rounded,
                        'Room',
                        ticket.roomArea,
                      ),
                    if (ticket.exactLandmark.isNotEmpty)
                      _InfoLine(
                        Icons.place_rounded,
                        'Landmark',
                        ticket.exactLandmark,
                      ),
                    _InfoLine(
                      Icons.cleaning_services_rounded,
                      'Category',
                      ticket.category,
                    ),
                    _InfoLine(
                      Icons.description_rounded,
                      'Complaint',
                      ticket.description,
                    ),
                  ],
                ),
              ),
              if (ticket.complaintPhotoAssets.isNotEmpty) ...[
                const SizedBox(height: 14),
                _PhotoSection(
                  title: 'Complaint photo',
                  assets: ticket.complaintPhotoAssets,
                ),
              ],
              const SizedBox(height: 14),
              _AssignmentCard(ticket: ticket),
              const SizedBox(height: 14),
              _ProgressCard(ticket: ticket),
              const SizedBox(height: 14),
              _UpdatesCard(updates: ticket.updates),
              if (ticket.resolutionNotes.isNotEmpty) ...[
                const SizedBox(height: 14),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _CardTitle(
                        icon: Icons.task_alt_rounded,
                        title: 'Resolution notes',
                      ),
                      const SizedBox(height: 10),
                      Text(
                        ticket.resolutionNotes,
                        style: const TextStyle(
                          height: 1.45,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (ticket.completionPhotoAssets.isNotEmpty) ...[
                const SizedBox(height: 14),
                _PhotoSection(
                  title: 'Completion photo',
                  assets: ticket.completionPhotoAssets,
                ),
              ],
              if (ticket.status == TicketStatus.closed &&
                  ticket.feedbackRating != null) ...[
                const SizedBox(height: 14),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _CardTitle(
                        icon: Icons.star_rounded,
                        title: 'Your feedback',
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: List.generate(
                          5,
                          (index) => Icon(
                            index < ticket.feedbackRating!
                                ? Icons.star_rounded
                                : Icons.star_border_rounded,
                            color: const Color(0xFFF59E0B),
                          ),
                        ),
                      ),
                      if (ticket.feedbackComment.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(ticket.feedbackComment),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AssignmentCard extends StatelessWidget {
  const _AssignmentCard({required this.ticket});
  final Ticket ticket;
  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _CardTitle(icon: Icons.badge_rounded, title: 'Assignment & SLA'),
        const SizedBox(height: 12),
        Row(
          children: [
            const CircleAvatar(
              backgroundColor: AppColors.paleBlue,
              child: Icon(Icons.person_rounded, color: AppColors.royalBlue),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ticket.assignedPerson,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    ticket.assignedRole,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            color: AppColors.paleBlue,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.timer_outlined,
                size: 18,
                color: AppColors.royalBlue,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  ticket.slaLabel,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.deepBlue,
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

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.ticket});
  final Ticket ticket;
  static const steps = [
    ('Open', TicketStatus.open),
    ('Assigned to Supervisor', TicketStatus.assigned),
    ('In Progress', TicketStatus.inProgress),
    ('Escalated to Operations Executive', TicketStatus.escalatedOperations),
    ('Escalated to Facility Manager', TicketStatus.escalatedFacilityManager),
    ('Resolved – Awaiting Confirmation', TicketStatus.awaitingConfirmation),
    ('Closed', TicketStatus.closed),
  ];

  int get activeIndex => steps.indexWhere((step) => step.$2 == ticket.status);

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _CardTitle(icon: Icons.route_rounded, title: 'Ticket progress'),
        const SizedBox(height: 14),
        for (var index = 0; index < steps.length; index++)
          _ProgressStep(
            label: steps[index].$1,
            complete:
                index < activeIndex || ticket.status == TicketStatus.closed,
            active: index == activeIndex,
            last: index == steps.length - 1,
          ),
      ],
    ),
  );
}

class _ProgressStep extends StatelessWidget {
  const _ProgressStep({
    required this.label,
    required this.complete,
    required this.active,
    required this.last,
  });
  final String label;
  final bool complete;
  final bool active;
  final bool last;
  @override
  Widget build(BuildContext context) {
    final color = complete
        ? AppColors.green
        : active
        ? AppColors.royalBlue
        : AppColors.line;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 26,
            child: Column(
              children: [
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: complete ? AppColors.green : Colors.white,
                    border: Border.all(color: color, width: 2),
                  ),
                  child: complete
                      ? const Icon(Icons.check, size: 13, color: Colors.white)
                      : active
                      ? const Center(
                          child: CircleAvatar(
                            radius: 3,
                            backgroundColor: AppColors.royalBlue,
                          ),
                        )
                      : null,
                ),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: complete
                          ? const Color(0xFF86EFAC)
                          : AppColors.line,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: active || complete
                      ? FontWeight.w900
                      : FontWeight.w600,
                  color: active
                      ? AppColors.royalBlue
                      : complete
                      ? AppColors.ink
                      : AppColors.muted,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UpdatesCard extends StatelessWidget {
  const _UpdatesCard({required this.updates});
  final List<TicketUpdate> updates;
  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _CardTitle(icon: Icons.update_rounded, title: 'Status updates'),
        const SizedBox(height: 12),
        for (final update in updates.reversed)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 15,
                  backgroundColor: update.isEscalation
                      ? const Color(0xFFFFEDD5)
                      : AppColors.paleBlue,
                  child: Icon(
                    update.isEscalation
                        ? Icons.priority_high_rounded
                        : Icons.check_rounded,
                    size: 16,
                    color: update.isEscalation
                        ? AppColors.orange
                        : AppColors.royalBlue,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        update.title,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        update.body,
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.35,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        formatTicketDateTime(update.dateTime),
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted,
                        ),
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

class _PhotoSection extends StatelessWidget {
  const _PhotoSection({required this.title, required this.assets});
  final String title;
  final List<String> assets;
  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CardTitle(icon: Icons.photo_rounded, title: title),
        const SizedBox(height: 12),
        SizedBox(
          height: 180,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: assets.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (_, index) => ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: _TicketImage(path: assets[index]),
            ),
          ),
        ),
      ],
    ),
  );
}

class _TicketImage extends StatelessWidget {
  const _TicketImage({required this.path});
  final String path;
  @override
  Widget build(BuildContext context) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return Image.network(
        path,
        width: 280,
        height: 180,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _imageError(),
      );
    }
    if (path.endsWith('.svg')) {
      return SvgPicture.asset(path, width: 280, height: 180, fit: BoxFit.cover);
    }
    return Image.file(
      File(path),
      width: 280,
      height: 180,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => _imageError(),
    );
  }

  Widget _imageError() => Container(
    width: 280,
    height: 180,
    color: AppColors.paleBlue,
    child: const Center(
      child: Icon(Icons.broken_image_outlined, color: AppColors.muted),
    ),
  );
}

class _CardTitle extends StatelessWidget {
  const _CardTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 19, color: AppColors.royalBlue),
      const SizedBox(width: 8),
      Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w900,
          color: AppColors.deepBlue,
        ),
      ),
    ],
  );
}

class _InfoLine extends StatelessWidget {
  const _InfoLine(this.icon, this.label, this.value);
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: AppColors.royalBlue),
        const SizedBox(width: 9),
        SizedBox(
          width: 72,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
        ),
      ],
    ),
  );
}
