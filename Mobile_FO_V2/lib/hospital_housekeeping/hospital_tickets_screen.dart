import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_models.dart';
import 'hospital_ticket_card.dart';
import 'hospital_ticket_detail_screen.dart';

class HospitalTicketsScreen extends StatefulWidget {
  const HospitalTicketsScreen({required this.controller, super.key});

  final HospitalController controller;

  @override
  State<HospitalTicketsScreen> createState() => _HospitalTicketsScreenState();
}

class _HospitalTicketsScreenState extends State<HospitalTicketsScreen> {
  final _search = TextEditingController();
  HospitalTicketStatus? _status;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final rows = widget.controller.visibleTickets.where((ticket) {
      if (_status != null && ticket.status != _status) return false;
      if (query.isEmpty) return true;
      return '${ticket.id} ${ticket.block} ${ticket.floor} ${ticket.location} ${ticket.category} ${ticket.description}'
          .toLowerCase()
          .contains(query);
    }).toList();
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
                selected: _status == null,
                onSelected: (_) => setState(() => _status = null),
              ),
              const SizedBox(width: 7),
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
}
