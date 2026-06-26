import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';

class LeadsListScreen extends StatefulWidget {
  const LeadsListScreen({
    required this.leads,
    required this.loading,
    required this.error,
    required this.onRefresh,
    required this.onOpenLead,
    super.key,
  });

  final List<BdLead> leads;
  final bool loading;
  final String? error;
  final Future<void> Function() onRefresh;
  final ValueChanged<BdLead> onOpenLead;

  @override
  State<LeadsListScreen> createState() => _LeadsListScreenState();
}

class _LeadsListScreenState extends State<LeadsListScreen> {
  final _search = TextEditingController();
  String _status = 'All';
  String _priority = 'All';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rows = widget.leads.where(_matchesFilters).toList();
    return FoPage(
      children: [
        FoHeader(
          title: 'Leads',
          subtitle: '${rows.length} records',
          trailing: IconButton(
            onPressed: widget.loading ? null : widget.onRefresh,
            icon: const Icon(Icons.refresh_rounded, color: qpmsBlue),
          ),
        ),
        const SizedBox(height: 16),
        FoCard(
          child: Column(
            children: [
              TextField(
                controller: _search,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Search',
                  hintText: 'Client, contact, or city',
                  prefixIcon: Icon(Icons.search_rounded),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _status,
                      decoration: const InputDecoration(labelText: 'Status'),
                      items:
                          const [
                                'All',
                                'Active',
                                'Converted',
                                'Lost',
                                'Archived',
                              ]
                              .map(
                                (item) => DropdownMenuItem(
                                  value: item,
                                  child: Text(item),
                                ),
                              )
                              .toList(),
                      onChanged: (value) =>
                          setState(() => _status = value ?? 'All'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _priority,
                      decoration: const InputDecoration(labelText: 'Priority'),
                      items: const ['All', 'High', 'Medium', 'Low']
                          .map(
                            (item) => DropdownMenuItem(
                              value: item,
                              child: Text(item),
                            ),
                          )
                          .toList(),
                      onChanged: (value) =>
                          setState(() => _priority = value ?? 'All'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (widget.error != null) _message(widget.error!, isError: true),
        if (widget.loading) const LinearProgressIndicator(),
        if (!widget.loading && rows.isEmpty)
          _message('No leads match the selected filters.')
        else
          ...rows.map((lead) => _leadCard(lead)),
      ],
    );
  }

  bool _matchesFilters(BdLead lead) {
    final query = _search.text.trim().toLowerCase();
    if (_status != 'All') {
      if (_status == 'Converted') {
        if (!lead.status.contains('Converted') &&
            lead.leadStage != 'Converted') {
          return false;
        }
      } else if (lead.status != _status) {
        return false;
      }
    }
    if (_priority != 'All' && lead.leadPriority != _priority) return false;
    if (query.isEmpty) return true;
    final contact = lead.primaryContact;
    final haystack = [
      lead.clientName,
      lead.city,
      lead.state,
      lead.industryType,
      contact?.name,
      contact?.phone,
    ].join(' ').toLowerCase();
    return haystack.contains(query);
  }

  Widget _leadCard(BdLead lead) {
    final contact = lead.primaryContact;
    return FoCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => widget.onOpenLead(lead),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    lead.clientName,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                FoStatusBadge(
                  label: lead.leadPriority.isEmpty ? '-' : lead.leadPriority,
                  color: _priorityColor(lead.leadPriority),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('${lead.city}, ${lead.state}', style: _muted()),
            Text('${lead.industryType} • ${lead.leadSource}', style: _muted()),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FoStatusBadge(
                  label: lead.leadStage.isEmpty ? '-' : lead.leadStage,
                  color: qpmsBlue,
                ),
                FoStatusBadge(
                  label: lead.status.isEmpty ? '-' : lead.status,
                  color: _statusColor(lead.status),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'Assigned: ${lead.assignedBdExecutive.isEmpty ? '--' : lead.assignedBdExecutive}',
              style: _muted(),
            ),
            Text(
              'Contact: ${contact?.name.isNotEmpty == true ? contact!.name : '--'} ${contact?.phone.isNotEmpty == true ? '• ${contact!.phone}' : ''}',
              style: _muted(),
            ),
            Text(
              'Updated: ${_date(lead.updatedAt ?? lead.createdAt)}',
              style: _muted(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _message(String message, {bool isError = false}) {
    return FoCard(
      child: Text(
        message,
        style: TextStyle(
          color: isError ? Colors.red : foNavy,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  TextStyle _muted() =>
      const TextStyle(color: Color(0xFF53607D), fontWeight: FontWeight.w700);

  String _date(DateTime? value) {
    if (value == null) return '--';
    return '${value.day.toString().padLeft(2, '0')}-${value.month.toString().padLeft(2, '0')}-${value.year}';
  }

  Color _priorityColor(String priority) {
    if (priority == 'High') return Colors.red;
    if (priority == 'Medium') return foOrange;
    return foGreen;
  }

  Color _statusColor(String status) {
    if (status.contains('Lost') || status.contains('Archived')) {
      return Colors.red;
    }
    if (status.contains('Converted') || status == 'Completed') return foGreen;
    if (status.contains('Pending') || status.contains('Escalated')) {
      return foOrange;
    }
    return qpmsBlue;
  }
}
