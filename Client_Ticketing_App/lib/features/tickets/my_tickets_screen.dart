import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/client_ui.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class MyTicketsScreen extends StatefulWidget {
  const MyTicketsScreen({super.key});
  @override
  State<MyTicketsScreen> createState() => _MyTicketsScreenState();
}

class _MyTicketsScreenState extends State<MyTicketsScreen> {
  TicketListFilter _filter = TicketListFilter.all;
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final tickets = controller.filterTickets(_filter, query: _search.text);
    const visibleFilters = [
      TicketListFilter.all,
      TicketListFilter.open,
      TicketListFilter.inProgress,
      TicketListFilter.awaitingConfirmation,
      TicketListFilter.closed,
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FC),
      bottomNavigationBar: const ClientBottomNav(
        currentRoute: AppRoutes.tickets,
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'My Tickets',
                    style: TextStyle(
                      color: AppColors.ink,
                      fontSize: 27,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0,
                    ),
                  ),
                  const SizedBox(height: 22),
                  _TicketSearchBar(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
            _TicketStatusFilters(
              filters: visibleFilters,
              selected: _filter,
              onSelected: (filter) => setState(() => _filter = filter),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
              child: Text(
                '${tickets.length} ${tickets.length == 1 ? 'Ticket' : 'Tickets'}',
                style: const TextStyle(
                  color: Color(0xFF475569),
                  fontSize: 15.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: controller.load,
                child: tickets.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 40, 20, 120),
                        children: const [_EmptyTickets()],
                      )
                    : ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                        itemCount: tickets.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, index) => _TicketListCard(
                          ticket: tickets[index],
                          onTap: () => Navigator.pushNamed(
                            context,
                            AppRoutes.ticketDetails,
                            arguments: tickets[index].number,
                          ),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TicketSearchBar extends StatelessWidget {
  const _TicketSearchBar({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    height: 54,
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.line),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFF0F172A).withValues(alpha: 0.04),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
      ],
    ),
    child: TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: const InputDecoration(
        prefixIcon: Icon(Icons.search_rounded, color: AppColors.muted),
        suffixIcon: Icon(Icons.tune_rounded, color: AppColors.deepBlue),
        hintText: 'Search tickets',
        hintStyle: TextStyle(
          color: AppColors.muted,
          fontWeight: FontWeight.w700,
        ),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        contentPadding: EdgeInsets.symmetric(vertical: 16),
      ),
      style: const TextStyle(
        color: AppColors.ink,
        fontSize: 15,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _TicketStatusFilters extends StatelessWidget {
  const _TicketStatusFilters({
    required this.filters,
    required this.selected,
    required this.onSelected,
  });

  final List<TicketListFilter> filters;
  final TicketListFilter selected;
  final ValueChanged<TicketListFilter> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.symmetric(horizontal: 20),
    child: Row(
      children: [
        for (final filter in filters) ...[
          _FilterPill(
            label: _filterLabel(filter),
            selected: selected == filter,
            onTap: () => onSelected(filter),
          ),
          if (filter != filters.last) const SizedBox(width: 11),
        ],
      ],
    ),
  );
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(999),
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: selected ? AppColors.paleBlue : Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: selected
              ? AppColors.royalBlue.withValues(alpha: 0.22)
              : const Color(0xFFD8E2F0),
        ),
      ),
      child: Text(
        label,
        maxLines: 1,
        style: TextStyle(
          color: selected ? AppColors.royalBlue : AppColors.ink,
          fontSize: 13,
          fontWeight: selected ? FontWeight.w900 : FontWeight.w800,
        ),
      ),
    ),
  );
}

class _TicketListCard extends StatelessWidget {
  const _TicketListCard({required this.ticket, required this.onTap});

  final Ticket ticket;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final statusColor = _statusColor(ticket.status);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.line.withValues(alpha: 0.72)),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF0F172A).withValues(alpha: 0.055),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(width: 4, color: statusColor),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(15, 15, 12, 15),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  clientServiceLabel(ticket.category),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.ink,
                                    fontSize: 18,
                                    height: 1.12,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              _StatusPill(
                                label: _ticketStatusLabel(ticket.status),
                                color: statusColor,
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            ticket.number,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.royalBlue,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 14),
                          _InfoRow(
                            icon: Icons.location_on_outlined,
                            iconColor: AppColors.royalBlue,
                            text: ticket.conciseLocation,
                            maxLines: 2,
                          ),
                          const SizedBox(height: 12),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Expanded(
                                child: _InfoRow(
                                  icon: Icons.calendar_month_outlined,
                                  iconColor: AppColors.muted,
                                  text: formatTicketDateTime(ticket.raisedAt),
                                ),
                              ),
                              const SizedBox(width: 10),
                              _PriorityIndicator(priority: ticket.priority),
                              const SizedBox(width: 4),
                              const Icon(
                                Icons.chevron_right_rounded,
                                color: AppColors.muted,
                                size: 22,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w900),
    ),
  );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.iconColor,
    required this.text,
    this.maxLines = 1,
  });

  final IconData icon;
  final Color iconColor;
  final String text;
  final int maxLines;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: maxLines > 1
        ? CrossAxisAlignment.start
        : CrossAxisAlignment.center,
    children: [
      Padding(
        padding: EdgeInsets.only(top: maxLines > 1 ? 1 : 0),
        child: Icon(icon, size: 17, color: iconColor),
      ),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          text,
          maxLines: maxLines,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFF334155),
            fontSize: 13.5,
            height: 1.28,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ],
  );
}

class _PriorityIndicator extends StatelessWidget {
  const _PriorityIndicator({required this.priority});

  final TicketPriority priority;

  @override
  Widget build(BuildContext context) {
    final color = _priorityColor(priority);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(
          priorityLabel(priority),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: color,
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _EmptyTickets extends StatelessWidget {
  const _EmptyTickets();
  @override
  Widget build(BuildContext context) => const ClientEmptyState(
    icon: Icons.task_alt_rounded,
    title: 'No tickets found',
    message: 'Try another status or search term.',
  );
}

String _filterLabel(TicketListFilter filter) => switch (filter) {
  TicketListFilter.all => 'All',
  TicketListFilter.open => 'Open',
  TicketListFilter.assigned => 'Open',
  TicketListFilter.inProgress => 'In Progress',
  TicketListFilter.awaitingConfirmation => 'Work Completed',
  TicketListFilter.resolved => 'Work Completed',
  TicketListFilter.closed => 'Closed',
  TicketListFilter.reopened => 'Reopened',
};

String _ticketStatusLabel(TicketStatus status) => switch (status) {
  TicketStatus.open => 'Open',
  TicketStatus.assigned => 'Team Assigned',
  TicketStatus.accepted || TicketStatus.inProgress => 'In Progress',
  TicketStatus.escalatedOperations ||
  TicketStatus.escalatedFacilityManager ||
  TicketStatus.escalatedProjectHead ||
  TicketStatus.reopened => 'In Progress',
  TicketStatus.awaitingConfirmation => 'Work Completed',
  TicketStatus.closed => 'Closed',
  TicketStatus.cancelled => 'Cancelled',
};

Color _statusColor(TicketStatus status) => switch (status) {
  TicketStatus.open || TicketStatus.assigned => AppColors.orange,
  TicketStatus.awaitingConfirmation => AppColors.green,
  TicketStatus.closed => const Color(0xFF0F9F9A),
  TicketStatus.cancelled => AppColors.muted,
  _ => AppColors.royalBlue,
};

Color _priorityColor(TicketPriority priority) => switch (priority) {
  TicketPriority.low => AppColors.green,
  TicketPriority.medium => const Color(0xFFD97706),
  TicketPriority.high => AppColors.red,
};
