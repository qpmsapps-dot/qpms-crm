import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../models/fo_models.dart';
import '../services/bd_lead_service.dart';
import '../ui/fo_ui.dart';
import '../utils/mobile_roles.dart';
import 'bd_contact_draft.dart';
import 'bd_lead_options.dart';

typedef BdLeadCreator =
    Future<BdLead> Function(
      CreateBdLeadRequest request, {
      bool duplicateOverride,
      String duplicateOverrideReason,
    });
typedef BdLeadAssigneeLoader = Future<List<BdLeadAssignee>> Function();

class AddLeadScreen extends StatefulWidget {
  const AddLeadScreen({
    required this.user,
    required this.onCreated,
    this.createLead,
    this.loadAssignees,
    super.key,
  });

  final FoUser user;
  final Future<void> Function(BdLead) onCreated;
  final BdLeadCreator? createLead;
  final BdLeadAssigneeLoader? loadAssignees;

  @override
  State<AddLeadScreen> createState() => _AddLeadScreenState();
}

class _AddLeadScreenState extends State<AddLeadScreen> {
  final _clientName = TextEditingController();
  final _siteLocation = TextEditingController();
  final _city = TextEditingController();
  final _remarks = TextEditingController();
  final List<BdLeadContactDraft> _contacts = [
    BdLeadContactDraft(isPrimary: true),
  ];
  String? _industry;
  String _state = bdStateOptions.first;
  String _source = bdLeadSourceOptions.first;
  String _priority = 'Medium';
  final Set<String> _serviceScope = {};
  List<BdLeadAssignee> _assignees = const [];
  String _assigneeProfileId = '';
  bool _loadingAssignees = false;
  String? _assigneeError;
  bool _saving = false;
  String? _error;
  String _submissionKey = _newSubmissionKey();

  @override
  void initState() {
    super.initState();
    if (canAssignBusinessDevelopmentLead(widget.user.role)) {
      _loadAssignees();
    }
  }

  @override
  void dispose() {
    _clientName.dispose();
    _siteLocation.dispose();
    _city.dispose();
    for (final contact in _contacts) {
      contact.dispose();
    }
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
        contacts: _contacts.map((contact) => contact.toRequest()).toList(),
        leadSource: _source,
        leadPriority: _priority,
        serviceScope: orderedBdServiceScope(_serviceScope),
        remarks: _remarks.text.trim(),
        assignedBdProfileId: _assigneeProfileId,
        idempotencyKey: _submissionKey,
      );
      BdLead lead;
      final createLead = widget.createLead ?? BdLeadService.createLead;
      try {
        lead = await createLead(request);
      } on BdLeadApiException catch (error) {
        if (error.code != 'possible_duplicate_lead' || !mounted) rethrow;
        final reason = await _confirmDuplicate(error.duplicates);
        if (reason == null) return;
        lead = await createLead(
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
    return validateBdContactDrafts(_contacts);
  }

  void _clearForm() {
    _clientName.clear();
    _siteLocation.clear();
    _city.clear();
    _remarks.clear();
    _serviceScope.clear();
    _submissionKey = _newSubmissionKey();
    for (final contact in _contacts) {
      contact.dispose();
    }
    _contacts
      ..clear()
      ..add(BdLeadContactDraft(isPrimary: true));
    setState(() {
      _industry = null;
      _state = bdStateOptions.first;
      _source = bdLeadSourceOptions.first;
      _priority = 'Medium';
      _assigneeProfileId = '';
    });
  }

  Future<void> _loadAssignees() async {
    if (_loadingAssignees) return;
    setState(() {
      _loadingAssignees = true;
      _assigneeError = null;
    });
    try {
      final loader = widget.loadAssignees ?? BdLeadService.fetchAssignees;
      final assignees = await loader();
      if (!mounted) return;
      setState(() => _assignees = assignees);
    } catch (error) {
      if (!mounted) return;
      setState(() => _assigneeError = error.toString());
    } finally {
      if (mounted) setState(() => _loadingAssignees = false);
    }
  }

  void _addContact() {
    if (_saving) return;
    setState(() => _contacts.add(BdLeadContactDraft()));
  }

  void _makePrimary(int selectedIndex) {
    if (_saving) return;
    setState(() {
      for (var index = 0; index < _contacts.length; index += 1) {
        _contacts[index].isPrimary = index == selectedIndex;
      }
    });
  }

  void _removeContact(int selectedIndex) {
    if (_saving || _contacts.length == 1) return;
    setState(() {
      final removed = _contacts.removeAt(selectedIndex);
      removed.dispose();
      if (!_contacts.any((contact) => contact.isPrimary)) {
        _contacts.first.isPrimary = true;
      }
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
              const SizedBox(height: 10),
              ...List.generate(
                _contacts.length,
                (index) => _contactCard(index),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  key: const ValueKey('add-contact'),
                  onPressed: _saving ? null : _addContact,
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  label: const Text('Add Contact Person'),
                ),
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
              if (canonicalMobileRole(widget.user.role) == 'BD Executive')
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text(
                    'This lead will be assigned to you.',
                    key: ValueKey('bd-self-assignment-message'),
                    style: TextStyle(
                      color: Color(0xFF174EA6),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              if (canAssignBusinessDevelopmentLead(widget.user.role))
                _assigneeDropdown(),
              _field(_remarks, 'Remarks', maxLines: 3),
              const SizedBox(height: 16),
              const FoSectionTitle(title: 'Service Scope'),
              ...bdServiceScopeOptions.map(
                (scope) => Material(
                  color: Colors.transparent,
                  child: CheckboxListTile(
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
              ),
              const SizedBox(height: 18),
              FoPrimaryButton(
                key: const ValueKey('create-lead'),
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
    Key? key,
    bool required = false,
    int maxLines = 1,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        key: key,
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: InputDecoration(labelText: required ? '$label *' : label),
      ),
    );
  }

  Widget _contactCard(int index) {
    final contact = _contacts[index];
    return Container(
      key: ValueKey(contact),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
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
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (contact.isPrimary)
                const Chip(
                  avatar: Icon(Icons.star_rounded, size: 17),
                  label: Text('Primary'),
                )
              else
                TextButton.icon(
                  key: ValueKey('make-primary-$index'),
                  onPressed: _saving ? null : () => _makePrimary(index),
                  icon: const Icon(Icons.star_outline_rounded),
                  label: const Text('Make Primary'),
                ),
            ],
          ),
          _field(
            contact.nameController,
            'Contact Person Name',
            key: ValueKey('contact-name-$index'),
            required: true,
          ),
          _field(
            contact.designationController,
            'Designation',
            key: ValueKey('contact-designation-$index'),
          ),
          _field(
            contact.phoneController,
            'Contact Number',
            key: ValueKey('contact-phone-$index'),
            keyboardType: TextInputType.phone,
          ),
          _field(
            contact.emailController,
            'Email ID',
            key: ValueKey('contact-email-$index'),
            keyboardType: TextInputType.emailAddress,
          ),
          if (_contacts.length > 1)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                key: ValueKey('remove-contact-$index'),
                onPressed: _saving ? null : () => _removeContact(index),
                icon: const Icon(Icons.delete_outline_rounded),
                label: const Text('Remove'),
              ),
            ),
        ],
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

  Widget _assigneeDropdown() {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          KeyedSubtree(
            key: ValueKey(_submissionKey),
            child: DropdownButtonFormField<String>(
              key: const ValueKey('bd-assignee-dropdown'),
              initialValue: _assigneeProfileId,
              decoration: const InputDecoration(
                labelText: 'Assign to BD Executive',
              ),
              items: [
                const DropdownMenuItem(value: '', child: Text('Unassigned')),
                ..._assignees.map(
                  (assignee) => DropdownMenuItem(
                    value: assignee.id,
                    child: Text(
                      assignee.label,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
              onChanged: _saving || _loadingAssignees
                  ? null
                  : (value) => setState(() => _assigneeProfileId = value ?? ''),
            ),
          ),
          if (_loadingAssignees)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: LinearProgressIndicator(),
            ),
          if (_assigneeError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _assigneeError!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                  TextButton(
                    onPressed: _loadAssignees,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
