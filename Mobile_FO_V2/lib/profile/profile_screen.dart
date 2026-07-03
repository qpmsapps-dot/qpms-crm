import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../models/fo_models.dart';
import '../services/app_state_sync_service.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';
import '../services/tracking_health_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _syncing = false;
  String _appVersion = '--';
  DateTime? _lastStateSyncAt;
  TrackingHealthSnapshot? _trackingHealth;

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
    _loadTrackingHealth();
  }

  Future<void> _loadAppVersion() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() {
        _appVersion = '${info.version}+${info.buildNumber}';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _appVersion = '--');
    }
  }

  Future<void> _loadTrackingHealth() async {
    final health = await TrackingHealthService.load(user: widget.user);
    if (!mounted) return;
    setState(() => _trackingHealth = health);
  }

  Future<void> _fixAppState(BuildContext context) async {
    if (_syncing) return;
    setState(() => _syncing = true);
    try {
      final result = await AppStateSyncService.syncNow(widget.user);
      if (!mounted || !context.mounted) return;
      setState(() => _lastStateSyncAt = DateTime.now());
      await _loadTrackingHealth();
      if (!mounted || !context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(result.message)));
    } catch (_) {
      if (!mounted || !context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Sync failed. Please check internet and try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _logout(BuildContext context) async {
    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'profile',
      action: 'SESSION_REFRESH_LOGOUT_REQUESTED',
    );

    final localAttendance = await LocalStore.getAttendance();
    final localActiveVisit = await LocalStore.activeVisit(
      user: widget.user,
      attendance: localAttendance,
    );
    final pendingGpsLogs = await LocalStore.countUnsyncedLocationLogs();
    final hasLocalActiveAttendance =
        localAttendance?.isActive == true &&
        localAttendance?.employeeCode == widget.user.employeeCode;
    final hasLocalActiveVisit = localActiveVisit != null;
    var hasRemoteActiveAttendance = false;

    if (SupabaseService.isReady) {
      try {
        final remoteAttendance = await SupabaseService.findOpenActiveAttendance(
          widget.user,
        );
        hasRemoteActiveAttendance = remoteAttendance != null;
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'profile',
          action: 'SESSION_REFRESH_LOGOUT_REMOTE_STATE_CHECK_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }

    if (hasLocalActiveAttendance ||
        hasLocalActiveVisit ||
        hasRemoteActiveAttendance) {
      if (!context.mounted) return;
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Active Day Detected'),
          content: const Text(
            'You have an active attendance or site visit. Logout will only refresh your login session. Your Start Day, active visit, and pending GPS logs will be kept safely. After login, tap Fix App State / Retry Checkout.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Logout & Re-login'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }

    await CrashLogService.record(
      employeeCode: widget.user.employeeCode,
      screen: 'profile',
      action: 'SESSION_REFRESH_LOGOUT_CONFIRMED',
      error:
          'local_active_attendance=$hasLocalActiveAttendance local_active_visit=$hasLocalActiveVisit remote_active_attendance=$hasRemoteActiveAttendance pending_gps_logs=$pendingGpsLogs',
    );
    await widget.onLogout();
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
                  _row('Employee Code', widget.user.employeeCode),
                  _row('Full Name', widget.user.fullName),
                  _row('Mobile', widget.user.mobile),
                  _row('Email', widget.user.email),
                  _row('State', widget.user.state),
                  _row('Department', widget.user.department ?? ''),
                  _row('Designation', widget.user.designation ?? ''),
                  if (widget.user.business?.trim().isNotEmpty == true)
                    _row('Business', widget.user.business ?? ''),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Troubleshooting',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Use this if Start Day, Check-In, or Check-Out looks stuck after poor network or previous-day auto-close.',
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 14),
                  _row('App Version', _appVersion),
                  _row(
                    'Last Fix',
                    _lastStateSyncAt == null
                        ? '-'
                        : _lastStateSyncAt!.toLocal().toString(),
                  ),
                  _row(
                    'Last Sync',
                    _trackingHealth?.lastSyncAt == null
                        ? '-'
                        : _trackingHealth!.lastSyncAt!.toLocal().toString(),
                  ),
                  _row(
                    'Pending GPS Logs',
                    _trackingHealth == null
                        ? '-'
                        : '${_trackingHealth!.pendingGpsLogs}',
                  ),
                  _row('Tracking', _trackingHealth?.trackingLabel ?? '-'),
                  _row(
                    'Permission',
                    _trackingHealth?.locationPermissionLabel ?? '-',
                  ),
                  if (_trackingHealth?.guidance.isNotEmpty == true) ...[
                    const SizedBox(height: 8),
                    ..._trackingHealth!.guidance.map(
                      (message) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.info_outline_rounded,
                              size: 18,
                              color: Colors.orange,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                message,
                                style: const TextStyle(
                                  color: Colors.black54,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _syncing ? null : () => _fixAppState(context),
                    icon: _syncing
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.build_circle_outlined),
                    label: Text(
                      _syncing ? 'Fixing app state...' : 'Fix App State',
                    ),
                  ),
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
