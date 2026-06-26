import 'package:flutter/material.dart';

import '../models/bd_lead_models.dart';
import '../models/fo_models.dart';
import '../profile/profile_screen.dart';
import '../services/bd_lead_service.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'add_lead_screen.dart';
import 'bd_dashboard_screen.dart';
import 'lead_details_screen.dart';
import 'leads_list_screen.dart';

class BdShell extends StatefulWidget {
  const BdShell({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  @override
  State<BdShell> createState() => _BdShellState();
}

class _BdShellState extends State<BdShell> {
  int _index = 0;
  var _leads = <BdLead>[];
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLeads();
  }

  Future<void> _loadLeads() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final leads = await BdLeadService.fetchLeads();
      if (!mounted) return;
      setState(() => _leads = leads);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openLead(BdLead lead) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            LeadDetailsScreen(initialLead: lead, onChanged: _loadLeads),
      ),
    );
  }

  void _onLeadCreated(BdLead lead) {
    _loadLeads();
    setState(() => _index = 1);
    _openLead(lead);
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      BdDashboardScreen(
        user: widget.user,
        leads: _leads,
        loading: _loading,
        error: _error,
        onRefresh: _loadLeads,
        onAddLead: () => setState(() => _index = 2),
        onOpenLead: _openLead,
      ),
      LeadsListScreen(
        leads: _leads,
        loading: _loading,
        error: _error,
        onRefresh: _loadLeads,
        onOpenLead: _openLead,
      ),
      AddLeadScreen(onCreated: _onLeadCreated),
      ProfileScreen(user: widget.user, onLogout: widget.onLogout),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: foBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x180A43D1),
                blurRadius: 24,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              _navItem(0, Icons.dashboard_outlined, 'Dashboard'),
              _navItem(1, Icons.business_center_outlined, 'Leads'),
              _navItem(2, Icons.add_circle_outline_rounded, 'Add Lead'),
              _navItem(3, Icons.person_outline, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label) {
    final selected = _index == index;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => setState(() => _index = index),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: selected ? qpmsBlue : const Color(0xFF66708D)),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? qpmsBlue : const Color(0xFF66708D),
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
