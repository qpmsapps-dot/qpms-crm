import 'package:flutter/material.dart';

import '../admin/admin_modules_screen.dart';
import '../bd/bd_shell.dart';
import '../hospital_housekeeping/hospital_models.dart';
import '../hospital_housekeeping/hospital_shell.dart';
import '../hospital_housekeeping/hospital_ticket_api.dart';
import '../hospital_housekeeping/hospital_ticketing_launcher_screen.dart';
import '../models/fo_models.dart';
import '../profile/profile_screen.dart';
import '../services/local_store.dart';
import '../tasks/tasks_screen.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import '../visits/visits_screen.dart';
import '../utils/mobile_roles.dart';
import 'home_screen.dart';

List<String> homeShellPrimaryNavigationLabels(String role) {
  if (isBusinessDevelopmentRole(role)) {
    return [
      'Dashboard',
      'Leads',
      if (canCreateBusinessDevelopmentLead(role)) 'Add Lead',
      'Profile',
    ];
  }
  return [
    'Home',
    'My Tasks',
    'Site Visit',
    if (isAdminRole(role))
      'Modules'
    else if (canAccessBusinessDevelopmentModule(role))
      'BD Leads',
    'Profile',
  ];
}

Future<void> showHospitalAccessRequiredSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 8, 22, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const FoIconCircle(
              icon: Icons.local_hospital_outlined,
              color: Color(0xFF0F766E),
              size: 54,
              iconSize: 28,
            ),
            const SizedBox(height: 14),
            const Text(
              'Hospital Access Required',
              style: TextStyle(
                color: foNavy,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'This account is not currently linked to a Hospital operational role.',
              style: TextStyle(
                color: qpmsMuted,
                fontSize: 14,
                fontWeight: FontWeight.w700,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('OK'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class HomeShell extends StatefulWidget {
  const HomeShell({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  bool _hasHospitalTicketingAccess = false;
  late final PageController _pageController;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _checkHospitalTicketingAccess();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _selectTab(int value) {
    if (value == _index) return;
    _pageController.animateToPage(
      value,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutCubic,
    );
  }

  bool get _isAdmin => isAdminRole(widget.user.role);

  int get _profileIndex => _isAdmin ? 4 : 3;

  bool get _showHospitalTicketingEntry =>
      canAccessHospitalTicketingLauncher(widget.user.role) ||
      _hasHospitalTicketingAccess;

  Future<void> _checkHospitalTicketingAccess() async {
    if (canAccessHospitalTicketingLauncher(widget.user.role)) return;
    try {
      final session = await HospitalTicketApi.discoverCurrentInternalSession(
        emailHint: widget.user.email,
      );
      if (!mounted || session.isDemo) return;
      setState(() => _hasHospitalTicketingAccess = true);
    } catch (_) {
      // Normal QPMS users without Hospital Ticketing access keep their home.
    }
  }

  void _openBdModule() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BdShell(user: widget.user, onLogout: widget.onLogout),
      ),
    );
  }

  void _openAdminTab(int index, {String? message}) {
    _selectTab(index);
    if (message == null || message.isEmpty) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openAdminActivity(FoActivityType type) async {
    final attendance = await LocalStore.getAttendance();
    final activeVisit = await LocalStore.activeVisit(
      user: widget.user,
      attendance: attendance,
    );
    if (!mounted) return;
    if (attendance?.isActive == true && activeVisit != null) {
      await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => ActivityFormScreen(
            type: type,
            visit: activeVisit,
            attendance: attendance!,
            user: widget.user,
          ),
        ),
      );
      return;
    }
    _openAdminTab(
      1,
      message: 'Start Day and check in to a site to open activities.',
    );
  }

  Future<void> _openHospitalModule(AdminModuleId id) async {
    try {
      var session = await HospitalTicketApi.discoverCurrentInternalSession();
      if (session.role == HospitalDemoRole.admin &&
          session.availableClients.length > 1) {
        if (!mounted) return;
        final selected = await _selectAdminHospital(session.availableClients);
        if (!mounted || selected == null) return;
        if (selected.id != session.clientId) {
          session = await HospitalTicketApi.discoverCurrentInternalSession(
            clientId: selected.id,
          );
        }
      }
      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => HospitalHousekeepingShell(
            session: session,
            onLogout: () async {},
            initialIndex: _hospitalInitialIndex(id, session),
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      await _showHospitalAccessRequired();
    }
  }

  int _hospitalInitialIndex(AdminModuleId id, HospitalDemoSession session) {
    if (id == AdminModuleId.hospitalTickets) return 1;
    if (id == AdminModuleId.hospitalNotifications && !session.isDemo) return 2;
    return 0;
  }

  Future<void> _showHospitalAccessRequired() {
    return showHospitalAccessRequiredSheet(context);
  }

  Future<HospitalClientOption?> _selectAdminHospital(
    List<HospitalClientOption> clients,
  ) {
    return showModalBottomSheet<HospitalClientOption>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Hospital Operations',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: foNavy,
                ),
              ),
              const SizedBox(height: 12),
              for (final client in clients)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    backgroundColor: foSoftBlue,
                    child: Icon(Icons.local_hospital_outlined),
                  ),
                  title: Text(client.name),
                  subtitle: client.code.isEmpty ? null : Text(client.code),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => Navigator.of(context).pop(client),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (isBusinessDevelopmentRole(widget.user.role)) {
      return BdShell(user: widget.user, onLogout: widget.onLogout);
    }
    final showBdModule =
        !_isAdmin && canAccessBusinessDevelopmentModule(widget.user.role);
    final pages = <Widget>[
      HomeScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        onOpenAdminModules: _isAdmin ? () => _openAdminTab(3) : null,
        onOpenAdminActivities: _isAdmin
            ? () => _openAdminTab(
                1,
                message:
                    'Use My Tasks to start day, check in, and open activities.',
              )
            : null,
        onOpenAdminBdLeads: _isAdmin ? _openBdModule : null,
        onOpenAdminHospital: _isAdmin
            ? () => _openHospitalModule(AdminModuleId.hospitalHousekeeping)
            : null,
        onOpenHospitalTicketing: _openHospitalTicketingLauncher,
        showHospitalTicketingEntry: _showHospitalTicketingEntry,
        key: const PageStorageKey('home'),
      ),
      TasksScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        isSelected: _index == 1,
        key: const PageStorageKey('tasks'),
      ),
      VisitsScreen(user: widget.user, key: const PageStorageKey('visits')),
      if (_isAdmin)
        AdminModulesScreen(
          onOpenActivity: _openAdminActivity,
          onOpenSiteVisits: () => _openAdminTab(2),
          onOpenBdLeads: _openBdModule,
          onOpenAttendance: () => _openAdminTab(0),
          onOpenTasks: () => _openAdminTab(1),
          onOpenHospital: _openHospitalModule,
          onOpenProfile: () => _openAdminTab(_profileIndex),
          key: const PageStorageKey('admin-modules'),
        ),
      ProfileScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        key: const PageStorageKey('profile'),
      ),
    ];
    return Scaffold(
      body: PageView(
        controller: _pageController,
        onPageChanged: (value) => setState(() => _index = value),
        children: pages,
      ),
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
              _navItem(0, Icons.home_outlined, Icons.home_rounded, 'Home'),
              _navItem(
                1,
                Icons.assignment_outlined,
                Icons.assignment_rounded,
                'My Tasks',
              ),
              _navItem(
                2,
                Icons.location_on_outlined,
                Icons.location_on_rounded,
                'Site Visit',
              ),
              if (showBdModule) _bdModuleItem(),
              if (_isAdmin)
                _navItem(3, Icons.apps_outlined, Icons.apps_rounded, 'Modules'),
              _navItem(
                _profileIndex,
                Icons.person_outline,
                Icons.person,
                'Profile',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(
    int index,
    IconData icon,
    IconData selectedIcon,
    String label,
  ) {
    final selected = _index == index;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _selectTab(index),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 54,
                height: 38,
                decoration: BoxDecoration(
                  color: selected ? qpmsBlue.withValues(alpha: 0.12) : null,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  selected ? selectedIcon : icon,
                  color: selected ? qpmsBlue : const Color(0xFF66708D),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? qpmsBlue : const Color(0xFF66708D),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bdModuleItem() {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: _openBdModule,
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 54,
                height: 38,
                child: Icon(
                  Icons.business_center_outlined,
                  color: Color(0xFF66708D),
                ),
              ),
              SizedBox(height: 4),
              Text(
                'BD Leads',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Color(0xFF66708D),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openHospitalTicketingLauncher() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => HospitalTicketingLauncherScreen(
          user: widget.user,
          openOperations: () =>
              _openHospitalModule(AdminModuleId.hospitalHousekeeping),
        ),
      ),
    );
  }
}
