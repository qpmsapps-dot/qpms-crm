import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({required this.onAuthenticated, super.key});

  final ValueChanged<FoUser> onAuthenticated;

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
      final user = await SupabaseService.login(
        loginId: _loginId.text,
        password: _password.text,
      );
      widget.onAuthenticated(user);
    } catch (error, stackTrace) {
      final loginError = error is MobileLoginException ? error : null;
      await CrashLogService.record(
        screen: 'login',
        action: loginError?.action ?? 'LOGIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (mounted) {
        setState(
          () => _message =
              loginError?.message ?? 'Login failed. Please try again.',
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
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () async {
                              final user = await Navigator.of(context)
                                  .push<FoUser>(
                                    MaterialPageRoute(
                                      builder: (_) => const RegisterScreen(),
                                    ),
                                  );
                              if (user != null) widget.onAuthenticated(user);
                            },
                      child: const Text('Register for Mobile Access'),
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
