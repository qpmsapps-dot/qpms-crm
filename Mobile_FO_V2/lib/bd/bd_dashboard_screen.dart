import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../models/fo_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';

class BdDashboardScreen extends StatelessWidget {
  const BdDashboardScreen({
    required this.user,
    required this.leads,
    required this.loading,
    required this.error,
    required this.onRefresh,
    required this.onAddLead,
    required this.onOpenLead,
    super.key,
  });

  final FoUser user;
  final List<BdLead> leads;
  final bool loading;
  final String? error;
  final Future<void> Function() onRefresh;
  final VoidCallback onAddLead;
  final ValueChanged<BdLead> onOpenLead;

  @override
  Widget build(BuildContext context) {
    final active = leads.where((lead) => lead.status == 'Active').length;
    final newLeads = leads.where((lead) => lead.leadStage == 'New Lead').length;
    final converted = leads
        .where(
          (lead) =>
              lead.status.contains('Converted') ||
              lead.leadStage == 'Converted',
        )
        .length;
    final highPriority = leads
        .where((lead) => lead.leadPriority == 'High')
        .length;
    final followUpsDue = leads.where(_isFollowUpDue).length;
    final recent = [...leads]
      ..sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? DateTime(1900)).compareTo(
          a.updatedAt ?? a.createdAt ?? DateTime(1900),
        ),
      );

    return FoPage(
      children: [
        FoHeader(
          title: 'BD Dashboard',
          subtitle: '${user.fullName} • ${user.role}',
          trailing: IconButton(
            onPressed: loading ? null : onRefresh,
            icon: const Icon(Icons.refresh_rounded, color: qpmsBlue),
          ),
        ),
        const SizedBox(height: 18),
        if (error != null) _messageCard(error!, isError: true),
        if (loading) const LinearProgressIndicator(),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _stat(
              'Active Leads',
              active,
              Icons.business_center_outlined,
              qpmsBlue,
            ),
            _stat('New Leads', newLeads, Icons.fiber_new_rounded, foGreen),
            _stat(
              'Follow-ups Due',
              followUpsDue,
              Icons.event_busy_rounded,
              foOrange,
            ),
            _stat(
              'Converted Leads',
              converted,
              Icons.verified_rounded,
              foPurple,
            ),
            _stat(
              'High Priority',
              highPriority,
              Icons.priority_high_rounded,
              Colors.red,
            ),
          ],
        ),
        const SizedBox(height: 16),
        FoPrimaryButton(
          label: 'Add New Lead',
          icon: Icons.add_rounded,
          onPressed: onAddLead,
        ),
        const SizedBox(height: 18),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(title: 'Recent Leads'),
              const SizedBox(height: 12),
              if (!loading && leads.isEmpty)
                const Text(
                  'No leads found yet.',
                  style: TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                  ),
                )
              else
                ...recent.take(5).map((lead) => _recentLeadTile(context, lead)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _stat(String label, int value, IconData icon, Color color) {
    return SizedBox(
      width: 155,
      child: FoCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FoIconCircle(icon: icon, color: color, size: 42, iconSize: 22),
            const SizedBox(height: 10),
            Text(
              '$value',
              style: const TextStyle(
                color: foNavy,
                fontSize: 26,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF53607D),
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _recentLeadTile(BuildContext context, BdLead lead) {
    return InkWell(
      onTap: () => onOpenLead(lead),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    lead.clientName,
                    style: const TextStyle(
                      color: foNavy,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${lead.city}, ${lead.state} • ${lead.leadPriority}',
                    style: const TextStyle(
                      color: Color(0xFF53607D),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            FoStatusBadge(
              label: lead.status.isEmpty ? '-' : lead.status,
              color: _statusColor(lead.status),
            ),
          ],
        ),
      ),
    );
  }

  Widget _messageCard(String message, {bool isError = false}) {
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

  bool _isFollowUpDue(BdLead lead) {
    final date = DateTime.tryParse(lead.nextFollowUpDate ?? '');
    if (date == null) return false;
    final today = DateTime.now();
    return !date.isAfter(DateTime(today.year, today.month, today.day));
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
