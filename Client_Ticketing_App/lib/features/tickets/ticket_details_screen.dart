import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';

import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/chips.dart';
import '../../data/mock_data.dart';
import '../../state/ticket_controller.dart';

class TicketDetailsScreen extends StatefulWidget {
  const TicketDetailsScreen({required this.ticketNumber, super.key});

  final String ticketNumber;

  @override
  State<TicketDetailsScreen> createState() => _TicketDetailsScreenState();
}

class _TicketDetailsScreenState extends State<TicketDetailsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final ticket = controller.ticketByNumber(widget.ticketNumber);
    final comments = controller.commentsFor(widget.ticketNumber);
    return Scaffold(
      appBar: AppBar(title: const Text('Ticket Details')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          ticket.number,
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: AppColors.deepBlue,
                          ),
                        ),
                      ),
                      StatusChip(ticket.status),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    ticket.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      PriorityChip(ticket.priority),
                      _InfoPill(Icons.category_rounded, ticket.category),
                      _InfoPill(Icons.location_on_rounded, ticket.site),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _InfoLine('Raised date', ticket.raisedDate),
                  _InfoLine('Description', ticket.description),
                  const SizedBox(height: 10),
                  const Text(
                    'Photos',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 10,
                    children: ticket.photoAssets
                        .map(
                          (asset) => ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: SvgPicture.asset(
                              asset,
                              width: 82,
                              height: 64,
                              fit: BoxFit.cover,
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            AppCard(
              child: Row(
                children: [
                  const CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.paleBlue,
                    child: Icon(
                      Icons.engineering_rounded,
                      color: AppColors.royalBlue,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ticket.assignedTechnician,
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            color: AppColors.deepBlue,
                          ),
                        ),
                        const Text(
                          'Technician',
                          style: TextStyle(
                            color: AppColors.muted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _communicationDialog,
                    icon: const Icon(
                      Icons.call_rounded,
                      color: AppColors.royalBlue,
                    ),
                  ),
                  IconButton(
                    onPressed: _communicationDialog,
                    icon: const Icon(
                      Icons.chat_rounded,
                      color: AppColors.purple,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _openCommentSheet,
                    child: const Text('Add Comment'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _communicationDialog,
                    child: const Text('Call / Chat'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                children: [
                  TabBar(
                    controller: _tabController,
                    labelColor: AppColors.royalBlue,
                    unselectedLabelColor: AppColors.muted,
                    tabs: const [
                      Tab(text: 'Updates'),
                      Tab(text: 'Comments'),
                    ],
                  ),
                  SizedBox(
                    height: 390,
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        _UpdatesTimeline(),
                        _CommentsPane(
                          comments: comments,
                          controller: _comment,
                          onSend: () {
                            context.read<TicketController>().addComment(
                              widget.ticketNumber,
                              _comment.text,
                            );
                            _comment.clear();
                          },
                        ),
                      ],
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

  void _communicationDialog() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text(
          'Technician communication will be enabled in the production version.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  void _openCommentSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 18,
          right: 18,
          top: 18,
          bottom: MediaQuery.of(context).viewInsets.bottom + 18,
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _comment,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'Type a comment...',
                ),
              ),
            ),
            const SizedBox(width: 10),
            IconButton(
              onPressed: () {
                context.read<TicketController>().addComment(
                  widget.ticketNumber,
                  _comment.text,
                );
                _comment.clear();
                Navigator.pop(context);
              },
              icon: const Icon(Icons.send_rounded, color: AppColors.royalBlue),
            ),
          ],
        ),
      ),
    );
  }
}

class _UpdatesTimeline extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(14),
      itemCount: demoUpdates.length,
      itemBuilder: (context, index) {
        final update = demoUpdates[index];
        final color = [
          AppColors.royalBlue,
          AppColors.purple,
          AppColors.orange,
          AppColors.orange,
          AppColors.green,
        ][index];
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: color.withValues(alpha: 0.15),
                  child: Icon(Icons.check_rounded, size: 16, color: color),
                ),
                if (index < demoUpdates.length - 1)
                  Container(
                    width: 2,
                    height: 46,
                    color: color.withValues(alpha: 0.18),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      update.title,
                      style: TextStyle(
                        fontWeight: FontWeight.w900,
                        color: color,
                      ),
                    ),
                    Text(
                      update.body,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      update.dateTime,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _CommentsPane extends StatelessWidget {
  const _CommentsPane({
    required this.comments,
    required this.controller,
    required this.onSend,
  });
  final List<String> comments;
  final TextEditingController controller;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(14),
            children: comments
                .map(
                  (comment) => Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.purple.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      comment,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  decoration: const InputDecoration(
                    hintText: 'Type a comment...',
                  ),
                ),
              ),
              IconButton(
                onPressed: onSend,
                icon: const Icon(
                  Icons.send_rounded,
                  color: AppColors.royalBlue,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _InfoPill extends StatelessWidget {
  const _InfoPill(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.paleBlue,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppColors.royalBlue),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}
