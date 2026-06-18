import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_drawer.dart';
import '../../core/widgets/ticket_card.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class MyTicketsScreen extends StatefulWidget {
  const MyTicketsScreen({super.key});

  @override
  State<MyTicketsScreen> createState() => _MyTicketsScreenState();
}

class _MyTicketsScreenState extends State<MyTicketsScreen> {
  TicketStatus? _filter;
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tickets = context
        .watch<TicketController>()
        .filterByStatus(_filter)
        .where((ticket) {
          final q = _search.text.toLowerCase();
          return q.isEmpty ||
              '${ticket.number} ${ticket.title} ${ticket.site}'
                  .toLowerCase()
                  .contains(q);
        })
        .toList();
    return Scaffold(
      drawer: const QpmsDrawer(),
      appBar: AppBar(
        title: const Text('My Tickets'),
        leading: Builder(
          builder: (context) => IconButton(
            icon: const Icon(Icons.menu_rounded),
            onPressed: () => Scaffold.of(context).openDrawer(),
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
          children: [
            TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                hintText: 'Search tickets',
              ),
            ),
            const SizedBox(height: 12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All',
                    selected: _filter == null,
                    onTap: () => setState(() => _filter = null),
                  ),
                  _FilterChip(
                    label: 'Open',
                    selected: _filter == TicketStatus.open,
                    onTap: () => setState(() => _filter = TicketStatus.open),
                  ),
                  _FilterChip(
                    label: 'In Progress',
                    selected: _filter == TicketStatus.inProgress,
                    onTap: () =>
                        setState(() => _filter = TicketStatus.inProgress),
                  ),
                  _FilterChip(
                    label: 'On Hold',
                    selected: _filter == TicketStatus.onHold,
                    onTap: () => setState(() => _filter = TicketStatus.onHold),
                  ),
                  _FilterChip(
                    label: 'Closed',
                    selected: _filter == TicketStatus.closed,
                    onTap: () => setState(() => _filter = TicketStatus.closed),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            for (final ticket in tickets)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: TicketCard(
                  ticket: ticket,
                  onTap: () => Navigator.pushNamed(
                    context,
                    AppRoutes.ticketDetails,
                    arguments: ticket.number,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: AppColors.royalBlue.withValues(alpha: 0.12),
        labelStyle: TextStyle(
          color: selected ? AppColors.royalBlue : AppColors.muted,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}
