import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../services/bd_lead_service.dart';
import '../ui/fo_ui.dart';
import 'bd_lead_options.dart';

class LeadFollowUpScreen extends StatefulWidget {
  const LeadFollowUpScreen({
    required this.lead,
    required this.onSaved,
    super.key,
  });

  final BdLead lead;
  final VoidCallback onSaved;

  @override
  State<LeadFollowUpScreen> createState() => _LeadFollowUpScreenState();
}

class _LeadFollowUpScreenState extends State<LeadFollowUpScreen> {
  final _remark = TextEditingController();
  final _followUpDate = TextEditingController();
  late String _status;
  late String _stage;
  late String _priority;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _status = bdStatusOptions.contains(widget.lead.status)
        ? widget.lead.status
        : 'Active';
    _stage = bdStageOptions.contains(widget.lead.leadStage)
        ? widget.lead.leadStage
        : 'New Lead';
    _priority = bdPriorityOptions.contains(widget.lead.leadPriority)
        ? widget.lead.leadPriority
        : 'Medium';
    _followUpDate.text = widget.lead.nextFollowUpDate ?? '';
  }

  @override
  void dispose() {
    _remark.dispose();
    _followUpDate.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_remark.text.trim().isEmpty && _followUpDate.text.trim().isEmpty) {
      setState(
        () => _error = 'Enter a follow-up remark or next follow-up date.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await BdLeadService.addFollowUp(
        widget.lead.id,
        remark: _remark.text.trim(),
        nextFollowUpDate: _followUpDate.text.trim(),
        status: _status,
        stage: _stage,
        priority: _priority,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Follow-up saved.')));
      widget.onSaved();
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FoPage(
        children: [
          FoHeader(
            title: 'Follow-up',
            subtitle: widget.lead.clientName,
            leading: IconButton(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.arrow_back_rounded),
            ),
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
              children: [
                TextField(
                  controller: _remark,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Follow-up Remark',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _followUpDate,
                  decoration: const InputDecoration(
                    labelText: 'Next Follow-up Date',
                    hintText: 'YYYY-MM-DD',
                  ),
                ),
                const SizedBox(height: 12),
                _dropdown(
                  'Status',
                  _status,
                  bdStatusOptions,
                  (value) => setState(() => _status = value),
                ),
                _dropdown(
                  'Stage',
                  _stage,
                  bdStageOptions,
                  (value) => setState(() => _stage = value),
                ),
                _dropdown(
                  'Priority',
                  _priority,
                  bdPriorityOptions,
                  (value) => setState(() => _priority = value),
                ),
                const SizedBox(height: 18),
                FoPrimaryButton(
                  label: _saving ? 'Saving...' : 'Save Follow-up',
                  icon: Icons.save_rounded,
                  onPressed: _saving ? null : _save,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dropdown(
    String label,
    String value,
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
