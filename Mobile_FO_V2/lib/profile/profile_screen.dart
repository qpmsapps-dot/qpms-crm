import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../tracking/tracking_service.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  Future<void> _logout() async {
    await TrackingService.stop(user: user);
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
          FilledButton(onPressed: _logout, child: const Text('Logout')),
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
