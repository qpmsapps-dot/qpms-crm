import 'package:flutter/material.dart';

import '../hospital_housekeeping/hospital_demo_auth.dart';
import '../hospital_housekeeping/hospital_models.dart';
import '../hospital_housekeeping/hospital_ticket_api.dart';
import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/config_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.onAuthenticated,
    this.onHospitalDemoAuthenticated,
    super.key,
  });

  final ValueChanged<FoUser> onAuthenticated;
  final ValueChanged<HospitalDemoSession>? onHospitalDemoAuthenticated;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _loginId = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _showPassword = false;
  String? _message;

  @override
  void dispose() {
    _loginId.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final loginId = _loginId.text.trim();
      if (AppConfig.hospitalDemoMode &&
          HospitalDemoAuth.isDemoLoginId(loginId)) {
        final session = HospitalDemoAuth.authenticate(
          loginId: loginId,
          candidatePassword: _password.text,
        );
        if (session == null) {
          throw const HospitalDemoLoginException(
            'Invalid local demo credentials.',
          );
        }
        final callback = widget.onHospitalDemoAuthenticated;
        if (callback == null) {
          throw const HospitalDemoLoginException(
            'Hospital demo module is unavailable.',
          );
        }
        callback(session);
        return;
      }
      FoUser? user;
      Object? employeeLoginError;
      try {
        user = await SupabaseService.login(
          loginId: loginId,
          password: _password.text,
        );
      } catch (error) {
        employeeLoginError = error;
      }

      if (user != null) {
        widget.onAuthenticated(user);
        return;
      }

      if (SupabaseService.client.auth.currentSession != null) {
        try {
          final hospitalSession =
              await HospitalTicketApi.discoverCurrentInternalSession(
                emailHint: loginId,
              );
          final callback = widget.onHospitalDemoAuthenticated;
          if (callback == null) {
            throw const HospitalDemoLoginException(
              'Hospital Housekeeping module is unavailable.',
            );
          }
          callback(hospitalSession);
          return;
        } on HospitalTicketApiException {
          if (user == null) rethrow;
        }
      }
      throw employeeLoginError ??
          const MobileLoginException(
            MobileLoginFailureType.profileNotFound,
            'Login failed. Please try again.',
          );
    } catch (error, stackTrace) {
      final loginError = error is MobileLoginException ? error : null;
      final demoError = error is HospitalDemoLoginException ? error : null;
      if (demoError == null) {
        await CrashLogService.record(
          screen: 'login',
          action: loginError?.action ?? 'LOGIN_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
      if (mounted) {
        setState(
          () => _message =
              demoError?.message ??
              loginError?.message ??
              'Login failed. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(22),
          children: [
            const SizedBox(height: 24),
            Center(
              child: Image.asset('assets/qpms-logo.png', width: 74, height: 74),
            ),
            const SizedBox(height: 12),
            const Text(
              'myQPMS',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: qpmsBlue,
                fontSize: 30,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 28),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    TextField(
                      controller: _loginId,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                        labelText: 'Email or Mobile Number',
                        hintText: 'Enter company email or mobile number',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: !_showPassword,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        suffixIcon: IconButton(
                          tooltip: _showPassword
                              ? 'Hide password'
                              : 'Show password',
                          icon: Icon(
                            _showPassword
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                          ),
                          onPressed: () =>
                              setState(() => _showPassword = !_showPassword),
                        ),
                      ),
                    ),
                    if (_message != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _message!,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ],
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _busy ? null : _login,
                        child: Text(_busy ? 'Signing in...' : 'Login'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Account access is provided by your organisation.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: qpmsMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Divider(height: 26),
                    const Row(
                      children: [
                        Icon(Icons.science_outlined, size: 18, color: qpmsBlue),
                        SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            'Hospital housekeeping UAT accounts use the same login form.',
                            style: TextStyle(color: qpmsMuted, fontSize: 11),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class HospitalDemoLoginException implements Exception {
  const HospitalDemoLoginException(this.message);

  final String message;

  @override
  String toString() => message;
}
