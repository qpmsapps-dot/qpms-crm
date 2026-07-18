import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('production routing discovers hospital role through me endpoint', () {
    final login = File('lib/auth/login_screen.dart').readAsStringSync();
    final api = File(
      'lib/hospital_housekeeping/hospital_ticket_api.dart',
    ).readAsStringSync();
    expect(login, contains('discoverCurrentInternalSession'));
    expect(api, contains("request('GET', '/api/hospital-tickets/me')"));
    expect(
      login,
      matches(
        RegExp(
          r'AppConfig\.hospitalDemoMode\s*&&\s*HospitalDemoAuth\.isDemoLoginId',
        ),
      ),
    );
  });

  test('hospital refresh timer is bounded and lifecycle-aware', () {
    final shell = File(
      'lib/hospital_housekeeping/hospital_shell.dart',
    ).readAsStringSync();
    expect(shell, contains('Duration(seconds: 20)'));
    expect(shell, contains('_refreshTimer?.isActive == true'));
    expect(shell, contains('WidgetsBindingObserver'));
    expect(shell, contains('_refreshTimer?.cancel()'));
  });
}
