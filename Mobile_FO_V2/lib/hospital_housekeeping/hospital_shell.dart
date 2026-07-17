import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'hospital_controller.dart';
import 'hospital_dashboard_screen.dart';
import 'hospital_demo_tools_screen.dart';
import 'hospital_models.dart';
import 'hospital_notifications_screen.dart';
import 'hospital_tickets_screen.dart';
import 'hospital_ticket_card.dart';

class HospitalHousekeepingShell extends StatefulWidget {
  const HospitalHousekeepingShell({
    required this.session,
    required this.onLogout,
    super.key,
  });

  final HospitalDemoSession session;
  final Future<void> Function() onLogout;

  @override
  State<HospitalHousekeepingShell> createState() =>
      _HospitalHousekeepingShellState();
}

class _HospitalHousekeepingShellState extends State<HospitalHousekeepingShell> {
  late final HospitalController _controller;
  Timer? _clock;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _controller = HospitalController(session: widget.session)
      ..addListener(_refresh);
    if (!widget.session.isDemo) {
      unawaited(_controller.load());
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
    _clock?.cancel();
    _controller.removeListener(_refresh);
    _controller.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
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
                  widget.session.assignedBlock ?? 'All Blocks',
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
