import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/client_ticket_deep_link.dart';
import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../state/auth_controller.dart';
import '../../state/ticket_controller.dart';

class HospitalTicketDeepLinkScreen extends StatefulWidget {
  const HospitalTicketDeepLinkScreen({required this.destination, super.key});

  final ClientTicketDeepLinkDestination destination;

  @override
  State<HospitalTicketDeepLinkScreen> createState() =>
      _HospitalTicketDeepLinkScreenState();
}

class _HospitalTicketDeepLinkScreenState
    extends State<HospitalTicketDeepLinkScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _resolve());
  }

  Future<void> _resolve() async {
    final auth = context.read<AuthController>();
    await auth.load();
    if (!mounted) return;
    if (!auth.isAuthenticated) {
      PendingClientTicketDeepLink.set(widget.destination);
      Navigator.pushReplacementNamed(context, AppRoutes.login);
      return;
    }

    final tickets = context.read<TicketController>();
    try {
      await tickets.load();
      if (widget.destination.hasTicket) {
        await tickets.loadDetail(widget.destination.ticketNumber!);
      }
      if (!mounted) return;
      Navigator.pushReplacementNamed(
        context,
        widget.destination.targetRoute,
        arguments: widget.destination.ticketNumber,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = 'Unable to open the latest ticket state.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 18),
                const Text(
                  'Opening Hospital Tickets',
                  style: TextStyle(
                    color: AppColors.deepBlue,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _error ?? 'Fetching live QPMS ticket state...',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _resolve, child: const Text('Retry')),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
