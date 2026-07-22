import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_ticket_card.dart';
import 'hospital_ticket_detail_screen.dart';

class HospitalTicketsScreen extends StatefulWidget {
  const HospitalTicketsScreen({
    required this.controller,
    this.initialFilter = HospitalTicketListFilter.all,
    super.key,
  });

  final HospitalController controller;
  final HospitalTicketListFilter initialFilter;

  @override
  State<HospitalTicketsScreen> createState() => _HospitalTicketsScreenState();
}

class _HospitalTicketsScreenState extends State<HospitalTicketsScreen> {
  final _search = TextEditingController();
  HospitalTicketStatus? _status;
  HospitalPriority? _priority;
  late HospitalTicketListFilter _filter;
  String _block = '';
  String _category = '';
  bool _assignedToMe = false;

  @override
  void initState() {
    super.initState();
    _filter = widget.initialFilter;
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final blocks =
        widget.controller.visibleTickets.map((t) => t.block).toSet().toList()
          ..sort();
    final categories =
        widget.controller.visibleTickets.map((t) => t.category).toSet().toList()
          ..sort();
    final rows = widget.controller.filteredTickets(
      filter: _filter,
      status: _status,
      priority: _priority,
      query: _search.text,
      block: _block,
      category: _category,
      assignedToMe: _assignedToMe,
    );
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'Search ticket, block, ward or complaint',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              ChoiceChip(
                label: const Text('All'),
                selected:
                    _filter == HospitalTicketListFilter.all &&
                    _status == null &&
                    _priority == null &&
                    _block.isEmpty &&
                    _category.isEmpty &&
                    !_assignedToMe,
                onSelected: (_) => setState(() {
                  _filter = HospitalTicketListFilter.all;
                  _status = null;
                  _priority = null;
                  _block = '';
                  _category = '';
                  _assignedToMe = false;
                }),
              ),
              const SizedBox(width: 7),
              _chip(
                'Assigned to me',
                _assignedToMe,
                () => setState(() => _assignedToMe = !_assignedToMe),
              ),
              _chip(
                'Due soon',
                _filter == HospitalTicketListFilter.dueSoon,
                () =>
                    setState(() => _filter = HospitalTicketListFilter.dueSoon),
              ),
              _chip(
                'SLA breached',
                _filter == HospitalTicketListFilter.breached,
                () =>
                    setState(() => _filter = HospitalTicketListFilter.breached),
              ),
              _chip(
                'Reopened',
                _filter == HospitalTicketListFilter.reopened,
                () =>
                    setState(() => _filter = HospitalTicketListFilter.reopened),
              ),
              ...HospitalTicketStatus.values.map(
                (status) => Padding(
                  padding: const EdgeInsets.only(right: 7),
                  child: ChoiceChip(
                    label: Text(status.label),
                    selected: _status == status,
                    onSelected: (_) => setState(() => _status = status),
                  ),
                ),
              ),
              const SizedBox(width: 7),
              _menuChip(
                label: _priority?.label ?? 'Priority',
                selected: _priority != null,
                onClear: () => setState(() => _priority = null),
                children: [
                  for (final priority in HospitalPriority.values)
                    PopupMenuItem(value: priority, child: Text(priority.label)),
                ],
                onSelected: (value) => setState(() => _priority = value),
              ),
              _menuChip(
                label: _block.isEmpty ? 'Block' : _block,
                selected: _block.isNotEmpty,
                onClear: () => setState(() => _block = ''),
                children: [
                  for (final block in blocks)
                    PopupMenuItem(value: block, child: Text(block)),
                ],
                onSelected: (value) => setState(() => _block = value),
              ),
              _menuChip(
                label: _category.isEmpty ? 'Category' : _category,
                selected: _category.isNotEmpty,
                onClear: () => setState(() => _category = ''),
                children: [
                  for (final category in categories)
                    PopupMenuItem(value: category, child: Text(category)),
                ],
                onSelected: (value) => setState(() => _category = value),
              ),
            ],
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? RefreshIndicator(
                  onRefresh: widget.controller.load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      SizedBox(height: 180),
                      Center(
                        child: Text(
                          'No tickets match this view.',
                          style: TextStyle(color: qpmsMuted),
                        ),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: widget.controller.load,
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 110),
                    itemCount: rows.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, index) => HospitalTicketCard(
                      ticket: rows[index],
                      controller: widget.controller,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => HospitalTicketDetailScreen(
                            controller: widget.controller,
                            ticketId: rows[index].id,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) => Padding(
    padding: const EdgeInsets.only(right: 7),
    child: ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
    ),
  );

  Widget _menuChip<T>({
    required String label,
    required bool selected,
    required VoidCallback onClear,
    required List<PopupMenuEntry<T>> children,
    required ValueChanged<T> onSelected,
  }) => Padding(
    padding: const EdgeInsets.only(right: 7),
    child: PopupMenuButton<T>(
      onSelected: onSelected,
      itemBuilder: (_) => [
        PopupMenuItem<T>(
          enabled: selected,
          onTap: onClear,
          child: const Text('Clear'),
        ),
        ...children,
      ],
      child: Chip(
        label: Text(label),
        backgroundColor: selected ? const Color(0xFFE8F5F5) : null,
      ),
    ),
  );
}
