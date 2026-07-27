import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../services/bd_lead_service.dart';
import '../ui/fo_ui.dart';
import 'bd_lead_options.dart';

class AddLeadScreen extends StatefulWidget {
  const AddLeadScreen({required this.onCreated, super.key});

  final Future<void> Function(BdLead) onCreated;

  @override
  State<AddLeadScreen> createState() => _AddLeadScreenState();
}

class _AddLeadScreenState extends State<AddLeadScreen> {
  final _clientName = TextEditingController();
  final _siteLocation = TextEditingController();
  final _city = TextEditingController();
  final _contactName = TextEditingController();
  final _contactDesignation = TextEditingController();
  final _contactPhone = TextEditingController();
  final _contactEmail = TextEditingController();
  final _remarks = TextEditingController();
  String? _industry;
  String _state = bdStateOptions.first;
  String _source = bdLeadSourceOptions.first;
  String _priority = 'Medium';
  final Set<String> _serviceScope = {};
  bool _saving = false;
  String? _error;
  String _submissionKey = _newSubmissionKey();

  @override
  void dispose() {
    _clientName.dispose();
    _siteLocation.dispose();
    _city.dispose();
    _contactName.dispose();
    _contactDesignation.dispose();
    _contactPhone.dispose();
    _contactEmail.dispose();
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final error = _validate();
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final request = CreateBdLeadRequest(
        clientName: _clientName.text.trim(),
        industryType: _industry!,
        siteLocation: _siteLocation.text.trim(),
        state: _state,
        city: _city.text.trim(),
        contactPersonName: _contactName.text.trim(),
        contactPersonDesignation: _contactDesignation.text.trim(),
        contactNumber: _contactPhone.text.trim(),
        emailId: _contactEmail.text.trim(),
        leadSource: _source,
        leadPriority: _priority,
        serviceScope: orderedBdServiceScope(_serviceScope),
        remarks: _remarks.text.trim(),
        idempotencyKey: _submissionKey,
      );
      BdLead lead;
      try {
        lead = await BdLeadService.createLead(request);
      } on BdLeadApiException catch (error) {
        if (error.code != 'possible_duplicate_lead' || !mounted) rethrow;
        final reason = await _confirmDuplicate(error.duplicates);
        if (reason == null) return;
        lead = await BdLeadService.createLead(
          request,
          duplicateOverride: true,
          duplicateOverrideReason: reason,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Lead created successfully.')),
      );
      _clearForm();
      await widget.onCreated(lead);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _validate() {
    if (_clientName.text.trim().isEmpty) {
      return 'Client / Company Name is required.';
    }
    final industryError = validateBdIndustry(_industry);
    if (industryError != null) return industryError;
    if (_siteLocation.text.trim().isEmpty) return 'Site Location is required.';
    if (_state.trim().isEmpty) return 'State is required.';
    if (_city.text.trim().isEmpty) return 'City is required.';
    if (_priority.trim().isEmpty) return 'Lead Priority is required.';
    if (_contactName.text.trim().isEmpty) return 'Contact name is required.';
    if (_contactPhone.text.trim().isEmpty &&
        _contactEmail.text.trim().isEmpty) {
      return 'Enter a contact phone or email.';
    }
    final email = _contactEmail.text.trim();
    if (email.isNotEmpty &&
        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      return 'Enter a valid contact email.';
    }
    final phone = _contactPhone.text.trim();
    if (phone.isNotEmpty) {
      final digits = phone.replaceAll(RegExp(r'\D'), '');
      if (!RegExp(r'^[+()\-\s0-9]+$').hasMatch(phone) ||
          digits.length < 7 ||
          digits.length > 15) {
        return 'Enter a valid contact phone number.';
      }
    }
    return null;
  }

  void _clearForm() {
    _clientName.clear();
    _siteLocation.clear();
    _city.clear();
    _contactName.clear();
    _contactDesignation.clear();
    _contactPhone.clear();
    _contactEmail.clear();
    _remarks.clear();
    _serviceScope.clear();
    _submissionKey = _newSubmissionKey();
    setState(() {
      _industry = null;
      _state = bdStateOptions.first;
      _source = bdLeadSourceOptions.first;
      _priority = 'Medium';
    });
  }

  Future<String?> _confirmDuplicate(
    List<Map<String, dynamic>> duplicates,
  ) async {
    final reason = TextEditingController();
    final matches = duplicates
        .map(
          (lead) => lead['restricted'] == true
              ? (lead['message']?.toString() ??
                    'A matching lead exists outside your visibility scope.')
              : '${lead['lead_code'] ?? lead['id']}: ${lead['client_name']} - ${lead['site_location']}',
        )
        .join('\n');
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Possible duplicate lead'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(matches),
            const SizedBox(height: 12),
            const Text('Continue only if this is a separate lead or site.'),
            TextField(
              controller: reason,
              decoration: const InputDecoration(labelText: 'Reason *'),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Create Separate Lead'),
          ),
        ],
      ),
    );
    final value = reason.text.trim();
    reason.dispose();
    if (confirmed != true) return null;
    if (value.isEmpty) {
      if (mounted) {
        setState(() => _error = 'Reason is required to override a duplicate.');
      }
      return null;
    }
    return value;
  }

  static String _newSubmissionKey() =>
      'mobile-${DateTime.now().microsecondsSinceEpoch}';

  @override
  Widget build(BuildContext context) {
    return FoPage(
      children: [
        const FoHeader(
          title: 'Add Lead',
          subtitle: 'Create a new business lead',
        ),
        const SizedBox(height: 18),
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
              const FoSectionTitle(title: 'Client Details'),
              _field(_clientName, 'Client / Company Name', required: true),
              _dropdown(
                'Industry Type',
                _industry,
                bdIndustryOptions,
                (value) => setState(() => _industry = value),
              ),
              _field(_siteLocation, 'Site Location', required: true),
              _dropdown(
                'State',
                _state,
                bdStateOptions,
                (value) => setState(() => _state = value),
              ),
              _field(_city, 'City', required: true),
              const SizedBox(height: 16),
              const FoSectionTitle(title: 'Contact Details'),
              _field(_contactName, 'Contact Name'),
              _field(_contactDesignation, 'Contact Designation'),
              _field(
                _contactPhone,
                'Contact Phone',
                keyboardType: TextInputType.phone,
              ),
              _field(
                _contactEmail,
                'Contact Email',
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 16),
              const FoSectionTitle(title: 'Lead Information'),
              _dropdown(
                'Lead Source',
                _source,
                bdLeadSourceOptions,
                (value) => setState(() => _source = value),
              ),
              _dropdown(
                'Lead Priority',
                _priority,
                bdPriorityOptions,
                (value) => setState(() => _priority = value),
              ),
              _field(_remarks, 'Remarks', maxLines: 3),
              const SizedBox(height: 16),
              const FoSectionTitle(title: 'Service Scope'),
              ...bdServiceScopeOptions.map(
                (scope) => CheckboxListTile(
                  value: _serviceScope.contains(scope),
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    scope,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  onChanged: (checked) {
                    setState(() {
                      if (checked == true) {
                        _serviceScope.add(scope);
                      } else {
                        _serviceScope.remove(scope);
                      }
                    });
                  },
                ),
              ),
              const SizedBox(height: 18),
              FoPrimaryButton(
                label: _saving ? 'Creating Lead...' : 'Create Lead',
                icon: Icons.save_rounded,
                onPressed: _saving ? null : _submit,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    int maxLines = 1,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: InputDecoration(labelText: required ? '$label *' : label),
      ),
    );
  }

  Widget _dropdown(
    String label,
    String? value,
    List<String> options,
    ValueChanged<String> onChanged,
  ) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        items: options
            .map((item) => DropdownMenuItem(value: item, child: Text(item)))
            .toList(),
        onChanged: (value) {
          if (value != null) onChanged(value);
        },
      ),
    );
  }
}
