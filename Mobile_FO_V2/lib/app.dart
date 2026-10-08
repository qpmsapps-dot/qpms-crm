import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'auth/login_screen.dart';
import 'hospital_housekeeping/hospital_models.dart';
import 'hospital_housekeeping/hospital_push_service.dart';
import 'hospital_housekeeping/hospital_shell.dart';
import 'hospital_housekeeping/hospital_ticket_api.dart';
import 'home/home_shell.dart';
import 'models/fo_models.dart';
import 'services/config_service.dart';
import 'services/crash_log_service.dart';
import 'services/local_store.dart';
import 'services/supabase_service.dart';
import 'theme/app_theme.dart';
import 'tracking/tracking_service.dart';

class MyQpmsFoApp extends StatefulWidget {
  const MyQpmsFoApp({super.key});

  @override
  State<MyQpmsFoApp> createState() => _MyQpmsFoAppState();
}

class _MyQpmsFoAppState extends State<MyQpmsFoApp> with WidgetsBindingObserver {
  bool _loading = true;
  String? _error;
  bool _resolvingPrimaryHospitalAccess = false;
  String? _primaryHospitalAccessError;
  FoUser? _user;
  String? _loginMessage;
  HospitalDemoSession? _hospitalDemoSession;
  StreamSubscription<AuthState>? _authStateSubscription;
  bool _authEventReconciliationRunning = false;
  bool _resumeAuthCheckRunning = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _bootstrap();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _authStateSubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _handleResume();
    }
  }

  Future<void> _handleResume() async {
    if (_hospitalDemoSession != null || _resumeAuthCheckRunning) return;
    _resumeAuthCheckRunning = true;
    try {
      await CrashLogService.record(
        employeeCode: _user?.employeeCode,
        screen: 'app',
        action: 'APP_RESUME_SYNC_START',
      );
      final cachedUser = _user;
      if (cachedUser != null) {
        try {
          await SupabaseService.requireAuthenticatedSession(
            cachedUser,
            screen: 'app',
            action: 'APP_RESUME_AUTH_SESSION_INVALID',
          );
        } on AuthSessionExpiredException {
          await _requireReauthentication(cachedUser, source: 'app_resume');
          return;
        }
      }
      if (SupabaseService.isReady) {
        await TrackingService.syncQueuedLogs();
        await CrashLogService.sync();
      }
      var user = _user ?? await LocalStore.getUser();
      user = await _refreshCachedProfile(user, source: 'app_resume');
      if (mounted && user != null && user != _user) {
        setState(() => _user = user);
      }
      if (user != null &&
          _isDedicatedHospitalEmployee(user) &&
          _hospitalDemoSession == null) {
        await _resolvePrimaryHospitalAccess(user, source: 'app_resume');
        return;
      }
      final attendance = await LocalStore.getAttendance();
      if (user != null &&
          attendance?.isActive == true &&
          !TrackingService.isActive) {
        await TrackingService.start(
          user: user,
          attendance: attendance!,
          onLog: (log, liveKm) {},
        );
      }
      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'app',
        action: 'APP_RESUME_SYNC_SUCCESS',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: _user?.employeeCode,
        screen: 'app',
        action: 'APP_RESUME_SYNC_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      _resumeAuthCheckRunning = false;
    }
  }

  Future<void> _bootstrap() async {
    try {
      if (!AppConfig.hasSupabase) {
        _error = AppConfig.configError;
      } else {
        await SupabaseService.initialize();
        final cachedUser = await LocalStore.getUser();
        _user = await _restoreAuthenticatedUser(
          cachedUser,
          source: 'app_startup',
        );
        _startAuthStateListener();
        if (_user != null) await CrashLogService.sync();
        if (_user != null && _isDedicatedHospitalEmployee(_user!)) {
          await _resolvePrimaryHospitalAccess(_user!, source: 'app_startup');
        }
      }
    } catch (error, stackTrace) {
      _error = error.toString();
      await CrashLogService.record(
        screen: 'app',
        action: 'BOOTSTRAP_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<FoUser?> _restoreAuthenticatedUser(
    FoUser? cachedUser, {
    required String source,
  }) async {
    if (!SupabaseService.isReady) return null;
    if (cachedUser == null) {
      if (SupabaseService.client.auth.currentSession == null ||
          SupabaseService.client.auth.currentUser == null) {
        return null;
      }
      try {
        await SupabaseService.requireAuthenticatedSession(
          null,
          screen: 'app',
          action: 'BOOTSTRAP_RESTORED_AUTH_SESSION_INVALID',
        );
      } on AuthSessionExpiredException {
        _loginMessage = AuthSessionExpiredException.message;
        return null;
      }
      return _refreshCachedProfile(null, source: source);
    }
    try {
      await SupabaseService.requireAuthenticatedSession(
        cachedUser,
        screen: 'app',
        action: 'BOOTSTRAP_AUTH_SESSION_INVALID',
      );
      return _refreshCachedProfile(cachedUser, source: source);
    } on AuthSessionExpiredException {
      await CrashLogService.record(
        employeeCode: cachedUser.employeeCode,
        screen: 'app',
        action: 'BOOTSTRAP_REAUTHENTICATION_REQUIRED',
        error:
            'source=$source cached_user_present=true session_present=${SupabaseService.client.auth.currentSession != null} current_user_present=${SupabaseService.client.auth.currentUser != null}',
      );
      return null;
    }
  }

  void _startAuthStateListener() {
    if (_authStateSubscription != null || !SupabaseService.isReady) return;
    _authStateSubscription = SupabaseService.client.auth.onAuthStateChange
        .listen(
          (state) => unawaited(_handleAuthStateChange(state)),
          onError: (Object error, StackTrace stackTrace) {
            unawaited(
              CrashLogService.record(
                employeeCode: _user?.employeeCode,
                screen: 'app',
                action: 'AUTH_STATE_LISTENER_ERROR',
                error: error,
                stackTrace: stackTrace,
              ),
            );
          },
        );
  }

  Future<void> _handleAuthStateChange(AuthState state) async {
    final event = state.event;
    await CrashLogService.record(
      employeeCode: _user?.employeeCode,
      screen: 'app',
      action: 'AUTH_STATE_CHANGED',
      error:
          'event=${event.name} cached_user_present=${_user != null} session_present=${state.session != null} current_user_present=${SupabaseService.client.auth.currentUser != null}',
    );
    if (event == AuthChangeEvent.signedOut) {
      final cachedUser = _user ?? await LocalStore.getUser();
      await _requireReauthentication(cachedUser, source: 'auth_signed_out');
      return;
    }
    final authenticatedEvent =
        event == AuthChangeEvent.signedIn ||
        event == AuthChangeEvent.initialSession ||
        event == AuthChangeEvent.tokenRefreshed ||
        event == AuthChangeEvent.userUpdated ||
        event == AuthChangeEvent.passwordRecovery;
    if (!authenticatedEvent ||
        state.session == null ||
        SupabaseService.client.auth.currentUser == null ||
        _authEventReconciliationRunning) {
      return;
    }
    if (event == AuthChangeEvent.tokenRefreshed && _user != null) return;
    _authEventReconciliationRunning = true;
    try {
      final refreshed = await _refreshCachedProfile(
        _user ?? await LocalStore.getUser(),
        source: 'auth_${event.name}',
      );
      if (refreshed != null && mounted) setState(() => _user = refreshed);
    } finally {
      _authEventReconciliationRunning = false;
    }
  }

  Future<void> _requireReauthentication(
    FoUser? cachedUser, {
    required String source,
  }) async {
    await CrashLogService.record(
      employeeCode: cachedUser?.employeeCode,
      screen: 'app',
      action: 'REAUTHENTICATION_REQUIRED',
      error:
          'source=$source cached_user_present=${cachedUser != null} session_present=${SupabaseService.isReady && SupabaseService.client.auth.currentSession != null} current_user_present=${SupabaseService.isReady && SupabaseService.client.auth.currentUser != null} operational_data_preserved=true',
    );
    if (!mounted) return;
    setState(() {
      _user = null;
      _loginMessage = AuthSessionExpiredException.message;
      _hospitalDemoSession = null;
      _primaryHospitalAccessError = null;
      _resolvingPrimaryHospitalAccess = false;
    });
  }

  Future<FoUser?> _refreshCachedProfile(
    FoUser? cachedUser, {
    required String source,
  }) async {
    if (!SupabaseService.isReady ||
        SupabaseService.client.auth.currentUser == null) {
      return null;
    }
    try {
      final serverUser = await SupabaseService.fetchCurrentProfile();
      final attendance = await LocalStore.getAttendance();
      final hasActiveAttendance = attendance?.isActive == true;
      final cachedCode = cachedUser?.employeeCode.trim() ?? '';
      final serverCode = serverUser.employeeCode.trim();
      final employeeCodeChanged =
          cachedCode.isNotEmpty && cachedCode != serverCode;

      if (employeeCodeChanged && hasActiveAttendance) {
        await CrashLogService.record(
          employeeCode: cachedCode,
          screen: 'app',
          action: 'EMPLOYEE_CODE_REFRESH_DEFERRED_ACTIVE_ATTENDANCE',
          error:
              'source=$source cached_code=$cachedCode server_code=$serverCode attendance_id=${attendance?.remoteId ?? attendance?.id}',
        );
        return cachedUser;
      }

      await LocalStore.saveUser(serverUser);
      if (!hasActiveAttendance) {
        await LocalStore.updateBackgroundTrackingEmployeeCode(
          employeeCode: serverCode,
          fullName: serverUser.fullName,
        );
      }
      if (employeeCodeChanged) {
        await CrashLogService.record(
          employeeCode: serverCode,
          screen: 'app',
          action: 'EMPLOYEE_CODE_CACHE_REFRESHED',
          error:
              'source=$source previous_code=$cachedCode current_code=$serverCode queued_gps_rows_unchanged=true',
        );
      } else {
        await CrashLogService.record(
          employeeCode: serverCode,
          screen: 'app',
          action: 'PROFILE_CACHE_REFRESHED',
          error: 'source=$source',
        );
      }
      return serverUser;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: cachedUser?.employeeCode,
        screen: 'app',
        action: 'PROFILE_CACHE_REFRESH_SKIPPED',
        error: '$source: $error',
        stackTrace: stackTrace,
      );
      return cachedUser;
    }
  }

  Future<void> _setUser(FoUser user) async {
    await LocalStore.saveUser(user);
    if (mounted) {
      setState(() {
        _hospitalDemoSession = null;
        _primaryHospitalAccessError = null;
        _loginMessage = null;
        _user = user;
      });
    }
    if (_isDedicatedHospitalEmployee(user)) {
      await _resolvePrimaryHospitalAccess(user, source: 'login');
    }
  }

  void _setHospitalDemoSession(HospitalDemoSession session) {
    if (!mounted) return;
    setState(() {
      _hospitalDemoSession = session;
      _primaryHospitalAccessError = null;
      _resolvingPrimaryHospitalAccess = false;
      _user = null;
    });
    if (!session.isDemo) {
      unawaited(HospitalPushService.registerAuthenticatedDevice());
    }
  }

  Future<void> _logoutHospitalDemo() async {
    if (_hospitalDemoSession?.isDemo == false && SupabaseService.isReady) {
      await HospitalPushService.unregisterAuthenticatedDevice();
      await HospitalTicketApi.closeSession();
    }
    await LocalStore.clearUser();
    if (mounted) {
      setState(() {
        _hospitalDemoSession = null;
        _primaryHospitalAccessError = null;
        _resolvingPrimaryHospitalAccess = false;
        _loginMessage = null;
        _user = null;
      });
    }
  }

  Future<void> _resolvePrimaryHospitalAccess(
    FoUser user, {
    required String source,
  }) async {
    if (!_isDedicatedHospitalEmployee(user)) return;
    if (mounted) {
      setState(() {
        _resolvingPrimaryHospitalAccess = true;
        _primaryHospitalAccessError = null;
        _hospitalDemoSession = null;
      });
    }
    try {
      final session = await HospitalTicketApi.discoverCurrentInternalSession(
        emailHint: user.email.isEmpty ? user.mobile : user.email,
      );
      if (!_isPrimaryHospitalInternalSession(session)) {
        throw const HospitalTicketApiException(
          'This Hospital account is not active for the internal mobile workflow.',
        );
      }
      if (!session.isDemo) {
        unawaited(HospitalPushService.registerAuthenticatedDevice());
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'app',
        action: 'PRIMARY_HOSPITAL_ACCESS_RESOLVED',
        error: 'source=$source role=${session.role.name}',
      );
      if (!mounted) return;
      setState(() {
        _hospitalDemoSession = session;
        _resolvingPrimaryHospitalAccess = false;
        _primaryHospitalAccessError = null;
      });
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'app',
        action: 'PRIMARY_HOSPITAL_ACCESS_FAILED',
        error: '$source: $error',
        stackTrace: stackTrace,
      );
      if (!mounted) return;
      setState(() {
        _hospitalDemoSession = null;
        _resolvingPrimaryHospitalAccess = false;
        _primaryHospitalAccessError =
            error is HospitalTicketApiException && error.message.isNotEmpty
            ? error.message
            : 'Unable to load Hospital access. Retry.';
      });
    }
  }

  Future<void> _logout() async {
    final employeeCode = _user?.employeeCode;
    try {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'app',
        action: 'SESSION_REFRESH_LOGOUT_REQUESTED',
      );
      await TrackingService.stop(
        user: _user,
        updateRemoteLiveStatus: false,
        reason: 'logout',
      );
      if (SupabaseService.isReady) {
        try {
          await SupabaseService.signOut();
        } catch (error, stackTrace) {
          await CrashLogService.record(
            employeeCode: employeeCode,
            screen: 'app',
            action: 'SESSION_REFRESH_LOGOUT_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      await LocalStore.clearUser();
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'app',
        action: 'SESSION_REFRESH_LOGOUT_COMPLETED',
      );
      if (mounted) {
        setState(() {
          _hospitalDemoSession = null;
          _primaryHospitalAccessError = null;
          _resolvingPrimaryHospitalAccess = false;
          _user = null;
        });
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'app',
        action: 'SESSION_REFRESH_LOGOUT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (mounted) {
        setState(() {
          _hospitalDemoSession = null;
          _primaryHospitalAccessError = null;
          _resolvingPrimaryHospitalAccess = false;
          _user = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'myQPMS',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: _home(),
    );
  }

  Widget _home() {
    if (_loading) return const SplashScreen();
    if (_error != null) return ConfigErrorScreen(message: _error!);
    if (_hospitalDemoSession != null) {
      return HospitalHousekeepingShell(
        session: _hospitalDemoSession!,
        onLogout: _logoutHospitalDemo,
      );
    }
    if (_user == null) {
      return LoginScreen(
        onAuthenticated: _setUser,
        onHospitalDemoAuthenticated: _setHospitalDemoSession,
        initialMessage: _loginMessage,
      );
    }
    if (_isDedicatedHospitalEmployee(_user!)) {
      if (_resolvingPrimaryHospitalAccess) return const SplashScreen();
      return PrimaryHospitalAccessErrorScreen(
        message:
            _primaryHospitalAccessError ??
            'Unable to load Hospital access. Retry.',
        onRetry: () =>
            _resolvePrimaryHospitalAccess(_user!, source: 'manual_retry'),
        onLogout: _logout,
      );
    }
    return HomeShell(
      user: _user!,
      onLogout: _logout,
      onAuthRequired: () =>
          _requireReauthentication(_user, source: 'authenticated_write'),
    );
  }
}

bool _isDedicatedHospitalEmployee(FoUser user) =>
    (user.business ?? '').trim().toLowerCase() == 'hospitals';

bool _isPrimaryHospitalInternalSession(HospitalDemoSession session) {
  if (session.isDemo) return false;
  return const {
    HospitalDemoRole.supervisor,
    HospitalDemoRole.operationsExecutive,
    HospitalDemoRole.facilityManager,
    HospitalDemoRole.projectHead,
  }.contains(session.role);
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [qpmsBlue, qpmsBlue2],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Center(child: _LogoTitle(light: true)),
      ),
    );
  }
}

class ConfigErrorScreen extends StatelessWidget {
  const ConfigErrorScreen({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _LogoTitle(),
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PrimaryHospitalAccessErrorScreen extends StatelessWidget {
  const PrimaryHospitalAccessErrorScreen({
    required this.message,
    required this.onRetry,
    required this.onLogout,
    super.key,
  });

  final String message;
  final VoidCallback onRetry;
  final Future<void> Function() onLogout;

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
                const _LogoTitle(),
                const SizedBox(height: 20),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.local_hospital_outlined,
                          color: qpmsBlue,
                          size: 42,
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Unable to load Hospital access. Retry.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: qpmsBlue,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          message,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: qpmsMuted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 18),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: onRetry,
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('Retry'),
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextButton.icon(
                          onPressed: onLogout,
                          icon: const Icon(Icons.logout_rounded),
                          label: const Text('Logout'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LogoTitle extends StatelessWidget {
  const _LogoTitle({this.light = false});

  final bool light;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 76,
          height: 76,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Image.asset('assets/qpms-logo.png'),
        ),
        const SizedBox(height: 14),
        Text(
          'myQPMS',
          style: TextStyle(
            color: light ? Colors.white : qpmsBlue,
            fontSize: 30,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}
