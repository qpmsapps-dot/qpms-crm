import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_dashboard_screen.dart';
import 'hospital_demo_tools_screen.dart';
import 'hospital_models.dart';
import 'hospital_notifications_screen.dart';
import 'hospital_push_service.dart';
import 'hospital_ticket_detail_screen.dart';
import 'hospital_tickets_screen.dart';
import 'hospital_ticket_card.dart';

class HospitalHousekeepingShell extends StatefulWidget {
  const HospitalHousekeepingShell({
    required this.session,
    required this.onLogout,
    this.initialIndex = 0,
    super.key,
  });

  final HospitalDemoSession session;
  final Future<void> Function() onLogout;
  final int initialIndex;

  @override
  State<HospitalHousekeepingShell> createState() =>
      _HospitalHousekeepingShellState();
}

class _HospitalHousekeepingShellState extends State<HospitalHousekeepingShell>
    with WidgetsBindingObserver {
  late final HospitalController _controller;
  Timer? _clock;
  Timer? _refreshTimer;
  StreamSubscription<HospitalPushMessage>? _pushSubscription;
  late int _index;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _index = widget.initialIndex;
    _controller = HospitalController(session: widget.session)
      ..addListener(_refresh);
    if (!widget.session.isDemo) {
      unawaited(_controller.load());
      unawaited(HospitalPushService.registerAuthenticatedDevice());
      _pushSubscription = HospitalPushService.foregroundMessages.listen(
        _handlePush,
      );
      for (final message in HospitalPushService.takePendingMessages()) {
        unawaited(Future<void>(() => _handlePush(message)));
      }
      _startRefreshTimer();
    }
    _clock = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _controller.updateClock(
        _controller.now.add(const Duration(seconds: 1)),
        applyEscalations: widget.session.isDemo,
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock?.cancel();
    _refreshTimer?.cancel();
    _pushSubscription?.cancel();
    _controller.removeListener(_refresh);
    _controller.dispose();
    super.dispose();
  }

  void _startRefreshTimer() {
    if (widget.session.isDemo || _refreshTimer?.isActive == true) return;
    _refreshTimer = Timer.periodic(const Duration(seconds: 20), (_) async {
      await _controller.load();
      if (_controller.sessionExpired) _refreshTimer?.cancel();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startRefreshTimer();
    } else {
      _refreshTimer?.cancel();
      _refreshTimer = null;
    }
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  void _handlePush(HospitalPushMessage message) {
    if (!mounted) return;
    unawaited(_controller.load());
    if (message.openImmediately) {
      _openPushTicket(message);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message.body.isEmpty
              ? message.title
              : '${message.title}\n${message.body}',
        ),
        action: SnackBarAction(
          label: 'Open',
          onPressed: () => _openPushTicket(message),
        ),
      ),
    );
  }

  void _openPushTicket(HospitalPushMessage message) {
    final ticketId = message.ticketId.isNotEmpty
        ? message.ticketId
        : message.ticketNumber;
    if (ticketId.isEmpty) return;
    setState(() => _index = message.targetScreen == 'incoming_ticket' ? 0 : 1);
    unawaited(_controller.loadDetail(ticketId, force: true));
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => HospitalTicketDetailScreen(
          controller: _controller,
          ticketId: ticketId,
        ),
      ),
    );
  }

  Future<void> _showAccount() async {
    final session = widget.session;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: hospitalTeal.withValues(alpha: .12),
                    child: const Icon(
                      Icons.person_outline,
                      color: hospitalTeal,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          session.displayName,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            color: qpmsText,
                          ),
                        ),
                        Text(
                          session.role.label,
                          style: const TextStyle(
                            color: qpmsMuted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _AccountRow(
                icon: Icons.local_hospital_outlined,
                label: 'Hospital',
                value: session.clientName.isEmpty
                    ? 'Hospital Housekeeping'
                    : session.clientName,
              ),
              _AccountRow(
                icon: Icons.business_outlined,
                label: 'Scope',
                value: session.scopeLabel,
              ),
              if (session.shiftLabel.isNotEmpty)
                _AccountRow(
                  icon: Icons.schedule_outlined,
                  label: 'Shift',
                  value: session.shiftLabel,
                ),
              if (session.email.isNotEmpty)
                _AccountRow(
                  icon: Icons.mail_outline,
                  label: 'Email',
                  value: session.email,
                ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    Navigator.pop(context);
                    await widget.onLogout();
                  },
                  icon: const Icon(Icons.logout_rounded),
                  label: const Text('Logout'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      HospitalDashboardScreen(controller: _controller),
      HospitalTicketsScreen(controller: _controller),
      if (!widget.session.isDemo)
        HospitalNotificationsScreen(controller: _controller),
      if (widget.session.isDemo)
        HospitalDemoToolsScreen(
          controller: _controller,
          onLogout: widget.onLogout,
        ),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset('assets/qpms-logo.png', width: 34, height: 34),
            const SizedBox(width: 9),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'myQPMS',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                ),
                Text(
                  'Hospital Housekeeping',
                  style: TextStyle(fontSize: 10, color: qpmsMuted),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Account',
            onPressed: _showAccount,
            icon: const Icon(Icons.account_circle_outlined),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: hospitalTeal.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  widget.session.scopeLabel,
                  style: const TextStyle(
                    color: hospitalTeal,
                    fontWeight: FontWeight.w900,
                    fontSize: 11,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          IndexedStack(index: _index, children: pages),
          if (_controller.isLoading)
            const Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: LinearProgressIndicator(),
            ),
          if (_controller.error != null)
            Positioned(
              left: 12,
              right: 12,
              bottom: 8,
              child: MaterialBanner(
                content: Text(_controller.error!),
                actions: [
                  TextButton(
                    onPressed: _controller.load,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          const NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number),
            label: 'Tickets',
          ),
          if (widget.session.isDemo)
            const NavigationDestination(
              icon: Icon(Icons.science_outlined),
              selectedIcon: Icon(Icons.science),
              label: 'Demo',
            ),
          if (!widget.session.isDemo)
            const NavigationDestination(
              icon: Icon(Icons.notifications_none),
              selectedIcon: Icon(Icons.notifications),
              label: 'Alerts',
            ),
        ],
      ),
    );
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Icon(icon, size: 20, color: hospitalTeal),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11,
                    color: qpmsMuted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  value,
                  style: TextStyle(
                    color: qpmsText,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
