import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/logo_mark.dart';
import '../../state/auth_controller.dart';
import '../../state/ticket_controller.dart';
import '../../state/notification_controller.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..forward();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final auth = context.read<AuthController>();
      await auth.load();
      if (!mounted) return;
      final tickets = context.read<TicketController>();
      final notifications = context.read<NotificationController>();
      if (auth.isAuthenticated) {
        await tickets.load();
        await notifications.load();
        if (!mounted) return;
      }
      Navigator.pushReplacementNamed(
        context,
        auth.isAuthenticated ? AppRoutes.dashboard : AppRoutes.login,
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: FadeTransition(
            opacity: CurvedAnimation(
              parent: _controller,
              curve: Curves.easeOut,
            ),
            child: ScaleTransition(
              scale: Tween<double>(begin: 0.92, end: 1).animate(_controller),
              child: const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LogoMark(size: 96),
                  SizedBox(height: 18),
                  Text(
                    'QPMS',
                    style: TextStyle(
                      fontSize: 42,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Client Ticketing',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.royalBlue,
                    ),
                  ),
                  SizedBox(height: 22),
                  Text(
                    'Raise. Track. Resolve.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 22,
                      height: 1.22,
                      fontWeight: FontWeight.w900,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
