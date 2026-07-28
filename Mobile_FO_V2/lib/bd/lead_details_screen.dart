import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../services/bd_lead_service.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'lead_followup_screen.dart';

class LeadDetailsScreen extends StatefulWidget {
  const LeadDetailsScreen({
    required this.initialLead,
    required this.onChanged,
    super.key,
  });

  final BdLead initialLead;
  final VoidCallback onChanged;

  @override
  State<LeadDetailsScreen> createState() => _LeadDetailsScreenState();
}

class _LeadDetailsScreenState extends State<LeadDetailsScreen> {
  late BdLead _lead = widget.initialLead;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final lead = await BdLeadService.fetchLead(widget.initialLead.id);
      if (!mounted) return;
      setState(() => _lead = lead);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openFollowUp() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => LeadFollowUpScreen(
          lead: _lead,
          onSaved: () {
            widget.onChanged();
            _refresh();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final contacts = [
      ..._lead.contacts.where((contact) => contact.isPrimary),
      ..._lead.contacts.where((contact) => !contact.isPrimary),
    ];
    return Scaffold(
      body: FoPage(
        children: [
          FoHeader(
            title: 'Lead Details',
            subtitle: _lead.clientName,
            leading: IconButton(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            trailing: IconButton(
              onPressed: _loading ? null : _refresh,
              icon: const Icon(Icons.refresh_rounded, color: qpmsBlue),
            ),
          ),
          const SizedBox(height: 18),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            FoCard(
              child: Text(
                _error!,
                style: const TextStyle(
                  color: Colors.red,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          FoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FoSectionTitle(
                  title: _lead.clientName,
                  subtitle: '${_lead.city}, ${_lead.state}',
                  trailing: FoStatusBadge(
                    label: _lead.status.isEmpty ? '-' : _lead.status,
                  ),
                ),
                const SizedBox(height: 14),
                _row('Industry', _lead.industryType),
                _row('Lead Source', _lead.leadSource),
                _row('Priority', _lead.leadPriority),
                _row('Stage', _lead.leadStage),
                _row('Site Location', _lead.siteLocation),
                _row('Assigned BD', _lead.assignedBdExecutive),
                _row('Created', _date(_lead.createdAt)),
                _row('Updated', _date(_lead.updatedAt)),
                _row('Next Follow-up', _lead.nextFollowUpDate ?? '--'),
              ],
            ),
          ),
          const SizedBox(height: 14),
          FoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FoSectionTitle(title: 'Contact Details'),
                const SizedBox(height: 10),
                if (contacts.isEmpty)
                  const Text(
                    'No contact details available.',
                    style: TextStyle(
                      color: Color(0xFF53607D),
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else
                  ...contacts.indexed.map(
                    (entry) => _contactCard(
                      entry.$1,
                      entry.$2,
                      isLast: entry.$1 == contacts.length - 1,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          FoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FoSectionTitle(title: 'Service Scope'),
                const SizedBox(height: 10),
                Text(
                  _lead.serviceScope.isEmpty
                      ? '--'
                      : _lead.serviceScope.join('\n'),
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w800,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                const FoSectionTitle(title: 'Remarks'),
                const SizedBox(height: 10),
                Text(
                  _lead.remarks.isEmpty ? '--' : _lead.remarks,
                  style: const TextStyle(
                    color: Color(0xFF53607D),
                    fontWeight: FontWeight.w700,
                    height: 1.45,
                  ),
                ),
                if (_lead.latestMomSummary.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const FoSectionTitle(title: 'Latest Follow-up / MOM Summary'),
                  const SizedBox(height: 10),
                  Text(_lead.latestMomSummary),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          FoPrimaryButton(
            label: 'Add Follow-up',
            icon: Icons.add_comment_rounded,
            onPressed: _openFollowUp,
          ),
          if (_lead.activityLogs.isNotEmpty) ...[
            const SizedBox(height: 14),
            FoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const FoSectionTitle(title: 'Activity'),
                  const SizedBox(height: 10),
                  ..._lead.activityLogs
                      .take(8)
                      .map(
                        (item) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(
                            '${item.type}: ${item.message}',
                            style: const TextStyle(
                              color: Color(0xFF53607D),
                              fontWeight: FontWeight.w700,
                            ),
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

  Widget _contactCard(
    int index,
    BdLeadContact contact, {
    required bool isLast,
  }) {
    return Container(
      margin: EdgeInsets.only(bottom: isLast ? 0 : 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Contact Person ${index + 1}',
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (contact.isPrimary)
                const Chip(
                  avatar: Icon(Icons.star_rounded, size: 17),
                  label: Text('Primary'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          _row('Name', contact.name),
          if (contact.designation.isNotEmpty)
            _row('Designation', contact.designation),
          if (contact.phone.isNotEmpty) _row('Phone', contact.phone),
          if (contact.email.isNotEmpty) _row('Email', contact.email),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    final display = value.trim().isEmpty ? '--' : value;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF53607D),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              display,
              style: const TextStyle(
                color: foNavy,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _date(DateTime? value) {
    if (value == null) return '--';
    return '${value.day.toString().padLeft(2, '0')}-${value.month.toString().padLeft(2, '0')}-${value.year}';
  }
}
