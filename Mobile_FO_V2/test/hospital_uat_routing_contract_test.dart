import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('production routing discovers hospital role through me endpoint', () {
    final login = File('lib/auth/login_screen.dart').readAsStringSync();
    final api = File(
      'lib/hospital_housekeeping/hospital_ticket_api.dart',
    ).readAsStringSync();
    expect(login, contains('discoverCurrentInternalSession'));
    expect(api, contains("'/api/hospital-tickets/me'"));
    expect(api, contains('hospitalClientId: clientId'));
    expect(
      login,
      matches(
        RegExp(
          r'AppConfig\.hospitalDemoMode\s*&&\s*HospitalDemoAuth\.isDemoLoginId',
        ),
      ),
    );
  });

  test('dedicated Hospitals employees route through hospital context', () {
    final app = File('lib/app.dart').readAsStringSync();
    expect(app, contains("toLowerCase() == 'hospitals'"));
    expect(app, contains('_resolvePrimaryHospitalAccess'));
    expect(app, contains('HospitalTicketApi.discoverCurrentInternalSession'));
    expect(app, contains('HospitalHousekeepingShell'));
    expect(app, contains('PrimaryHospitalAccessErrorScreen'));
    expect(app, contains('Unable to load Hospital access. Retry.'));
    expect(app, contains('HospitalDemoRole.supervisor'));
    expect(app, contains('HospitalDemoRole.operationsExecutive'));
    expect(app, contains('HospitalDemoRole.facilityManager'));
    expect(app, contains('HospitalDemoRole.projectHead'));
  });

  test('normal employee login remains base profile first', () {
    final login = File('lib/auth/login_screen.dart').readAsStringSync();
    final shell = File('lib/home/home_shell.dart').readAsStringSync();
    final home = File('lib/home/home_screen.dart').readAsStringSync();
    expect(
      login,
      matches(
        RegExp(
          r'if\s*\(user\s*!=\s*null\)\s*\{\s*widget\.onAuthenticated\(user\);',
          dotAll: true,
        ),
      ),
    );
    expect(login, isNot(contains('business = Hospitals')));
    expect(shell, contains('_checkHospitalTicketingAccess'));
    expect(shell, contains('_hasHospitalTicketingAccess'));
    expect(shell, contains('HospitalTicketApi.discoverCurrentInternalSession'));
    expect(home, contains('showHospitalTicketingEntry'));
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
