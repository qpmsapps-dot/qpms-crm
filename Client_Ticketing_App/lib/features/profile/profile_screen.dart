import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/logo_mark.dart';
import '../../state/auth_controller.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final profile = auth.profile ?? const <String, dynamic>{};
    final name = _profileText(profile, const [
      'display_name',
      'full_name',
      'name',
      'email',
    ], fallback: 'Client User');
    final role = _roleLabel('${profile['role_code'] ?? ''}');
    final client = _profileText(profile, const [
      'client_name',
      'hospital_client_name',
      'site_name',
    ], fallback: 'Client account');
    final email = _profileText(profile, const ['email'], fallback: '');
    final mobile = _profileText(profile, const [
      'mobile',
      'phone',
      'phone_number',
    ], fallback: '');

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      bottomNavigationBar: const ClientBottomNav(currentRoute: AppRoutes.profile),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
          children: [
            AppCard(
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 32,
                    backgroundColor: AppColors.paleBlue,
                    child: Text(
                      _initials(name),
                      style: const TextStyle(
                        color: AppColors.royalBlue,
                        fontWeight: FontWeight.w900,
                        fontSize: 20,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: AppColors.deepBlue,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          role,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            color: AppColors.muted,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          client,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            AppCard(
              child: Column(
                children: [
                  _ProfileTile(
                    icon: Icons.badge_outlined,
                    label: 'My Profile',
                    value: [
                      if (email.isNotEmpty) email,
                      if (mobile.isNotEmpty) mobile,
                    ].join('\n'),
                  ),
                  const Divider(height: 1),
                  const _ProfileTile(
                    icon: Icons.lock_reset_rounded,
                    label: 'Change Password',
                    value: 'Contact your administrator or QPMS support.',
                  ),
                  const Divider(height: 1),
                  const _ProfileTile(
                    icon: Icons.support_agent_rounded,
                    label: 'Help & Support',
                    value: 'Reach your QPMS support contact for assistance.',
                  ),
                  const Divider(height: 1),
                  const _ProfileTile(
                    icon: Icons.privacy_tip_outlined,
                    label: 'Privacy Policy',
                    value: 'Client data is used only for authorised support.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            AppCard(
              child: const Row(
                children: [
                  LogoMark(size: 44),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Client Ticketing App',
                          style: TextStyle(
                            fontWeight: FontWeight.w900,
                            color: AppColors.deepBlue,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Version 1.0.0',
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: () => _confirmLogout(context),
              icon: const Icon(Icons.logout_rounded),
              label: const Text('Logout'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.red,
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: AppColors.red),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Logout?'),
        content: const Text('You will return to the login screen.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<AuthController>().logout();
    if (!context.mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, AppRoutes.login, (_) => false);
  }
}

class _ProfileTile extends StatelessWidget {
  const _ProfileTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          backgroundColor: AppColors.paleBlue,
          child: Icon(icon, color: AppColors.royalBlue),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
              if (value.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

String _profileText(
  Map<String, dynamic> profile,
  List<String> keys, {
  required String fallback,
}) {
  for (final key in keys) {
    final text = '${profile[key] ?? ''}'.trim();
    if (text.isNotEmpty && text != 'null') return text;
  }
  return fallback;
}

String _roleLabel(String role) => switch (role) {
  'hospital_management' => 'Hospital Management',
  'doctor' => 'Doctor',
  _ => 'Client User',
};

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'CL';
  return parts.take(2).map((part) => part.substring(0, 1)).join().toUpperCase();
}
