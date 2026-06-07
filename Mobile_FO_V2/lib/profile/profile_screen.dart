import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  Future<void> _logout(BuildContext context) async {
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'profile',
      action: 'LOGOUT_ATTEMPT',
    );

    final localAttendance = await LocalStore.getAttendance();
    final hasLocalActiveAttendance =
        localAttendance?.isActive == true &&
        localAttendance?.employeeCode == user.employeeCode;
    var hasRemoteActiveAttendance = false;

    if (SupabaseService.isReady) {
      final remoteAttendance = await SupabaseService.findOpenActiveAttendance(
        user,
      );
      hasRemoteActiveAttendance = remoteAttendance != null;
    }

    if (hasLocalActiveAttendance || hasRemoteActiveAttendance) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'profile',
        action: 'LOGOUT_BLOCKED_ACTIVE_ATTENDANCE',
      );
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('End Day Required'),
          content: const Text(
            'Your day is still active. Please click End Day before logging out.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }

    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'profile',
      action: 'LOGOUT_ALLOWED_NO_ACTIVE_ATTENDANCE',
    );
    await onLogout();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  _row('Full Name', user.fullName),
                  _row('Employee Code', user.employeeCode),
                  _row('Mobile Number', user.mobile),
                  _row('Email', user.email),
                  _row('State', user.state),
                  _row('Role', user.role),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => _logout(context),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label, style: const TextStyle(color: Colors.black54)),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? '-' : value,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}
