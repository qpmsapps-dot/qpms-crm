import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'hospital_ticket_api.dart';
import '../models/fo_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import '../utils/mobile_roles.dart';

const qpmsClientTicketingDeepLink = 'qpms://hospital-tickets';

class HospitalTicketingLauncherScreen extends StatefulWidget {
  const HospitalTicketingLauncherScreen({
    required this.user,
    required this.openOperations,
    this.launchClientApp = launchUrl,
    super.key,
  });

  final FoUser user;
  final Future<void> Function() openOperations;
  final Future<bool> Function(Uri, {LaunchMode mode}) launchClientApp;

  @override
  State<HospitalTicketingLauncherScreen> createState() =>
      _HospitalTicketingLauncherScreenState();
}

class _HospitalTicketingLauncherScreenState
    extends State<HospitalTicketingLauncherScreen> {
  bool _openingClient = false;
  bool _openingOperations = false;

  bool get _demoAccess => hasHospitalTicketingDemoPreview(widget.user.role);

  Future<void> _openClientApp() async {
    if (_openingClient) return;
    setState(() => _openingClient = true);
    try {
      final opened = await widget.launchClientApp(
        Uri.parse(qpmsClientTicketingDeepLink),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        _message('QPMS client app is not installed on this device.');
      }
    } catch (_) {
      if (mounted) {
        _message('QPMS client app is not installed on this device.');
      }
    } finally {
      if (mounted) setState(() => _openingClient = false);
    }
  }

  Future<void> _openOperations() async {
    if (_openingOperations) return;
    setState(() => _openingOperations = true);
    try {
      await widget.openOperations();
    } catch (error) {
      if (mounted) {
        _message(
          error is HospitalTicketApiException
              ? error.message
              : 'Hospital Ticketing access is not available for this account.',
        );
      }
    } finally {
      if (mounted) setState(() => _openingOperations = false);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FoPage(
        children: [
          FoHeader(
            title: 'Hospital Ticketing',
            subtitle: 'Open QPMS client and operations views for housekeeping.',
            leading: IconButton(
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.arrow_back_rounded, color: foNavy),
            ),
            trailing: _demoAccess
                ? const FoStatusBadge(label: 'Demo Access', color: foPurple)
                : const SizedBox.shrink(),
          ),
          const SizedBox(height: 22),
          _LauncherCard(
            icon: Icons.medical_services_outlined,
            title: 'RMO / Client View',
            description:
                'Raise and track Housekeeping complaints from the QPMS client application.',
            actionLabel: _openingClient ? 'Opening...' : 'Open QPMS App',
            onPressed: _openingClient ? null : _openClientApp,
          ),
          const SizedBox(height: 14),
          _LauncherCard(
            icon: Icons.support_agent_rounded,
            title: 'QPMS Operations View',
            description:
                'Receive, accept, process, escalate and resolve Hospital Housekeeping tickets.',
            actionLabel: _openingOperations ? 'Opening...' : 'Open Operations',
            onPressed: _openingOperations ? null : _openOperations,
          ),
          const SizedBox(height: 14),
          const Text(
            'Live ticket actions remain controlled by backend permissions.',
            style: TextStyle(
              color: qpmsMuted,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _LauncherCard extends StatelessWidget {
  const _LauncherCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.actionLabel,
    required this.onPressed,
  });

  final IconData icon;
  final String title;
  final String description;
  final String actionLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoIconCircle(icon: icon, color: qpmsBlue),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              color: foNavy,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            description,
            style: const TextStyle(
              color: Color(0xFF4D5A7A),
              height: 1.4,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 18),
          FoPrimaryButton(
            label: actionLabel,
            icon: Icons.open_in_new_rounded,
            onPressed: onPressed,
          ),
        ],
      ),
    );
  }
}
