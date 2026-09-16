import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final supabaseSource = File('lib/services/supabase_service.dart');
  final tasksSource = File('lib/tasks/tasks_screen.dart');

  test(
    'checkout auth guard refreshes expired sessions before write access',
    () {
      final source = supabaseSource.readAsStringSync();
      final guardIndex = source.indexOf(
        'static Future<void> requireAuthenticatedSession',
      );
      final checkoutIndex = source.indexOf(
        'static Future<void> updateVisitCheckout',
      );
      expect(guardIndex, greaterThanOrEqualTo(0));
      expect(checkoutIndex, greaterThan(guardIndex));

      final guard = source.substring(guardIndex, checkoutIndex);
      expect(guard, contains('client.auth.refreshSession()'));
      expect(guard, contains(r'${action}_REFRESH_STARTED'));
      expect(guard, contains(r'${action}_REFRESH_FAILED'));
      expect(guard, contains('finalSessionExpired'));
    },
  );

  test(
    'checkout auth guard fails closed without falling back to anon writes',
    () {
      final source = supabaseSource.readAsStringSync();
      final guardIndex = source.indexOf(
        'static Future<void> requireAuthenticatedSession',
      );
      final checkoutIndex = source.indexOf(
        'static Future<void> updateVisitCheckout',
      );
      final guard = source.substring(guardIndex, checkoutIndex);

      expect(guard, contains('AuthSessionExpiredException'));
      expect(guard, isNot(contains('GRANT UPDATE')));
      expect(guard, isNot(contains('anon')));
    },
  );

  test(
    'checkout refresh failure preserves active visit and asks user to login',
    () {
      final source = tasksSource.readAsStringSync();
      final checkoutStart = source.indexOf('Future<void> _checkOut() async');
      final checkoutEnd = source.indexOf('bool _isSessionExpiredError');
      expect(checkoutStart, greaterThanOrEqualTo(0));
      expect(checkoutEnd, greaterThan(checkoutStart));

      final checkout = source.substring(checkoutStart, checkoutEnd);
      expect(checkout, contains('AuthSessionExpiredException.message'));
      expect(
        checkout,
        isNot(contains("await widget.onLogout();\n          return;")),
      );
      expect(checkout, contains('await LocalStore.saveVisit(visit);'));
    },
  );

  test(
    'checkout update requires authenticated session before table update',
    () {
      final source = supabaseSource.readAsStringSync();
      final updateIndex = source.indexOf(
        'static Future<void> updateVisitCheckout',
      );
      final update = source.substring(updateIndex);
      final authIndex = update.indexOf('await requireAuthenticatedSession');
      final writeIndex = update.indexOf(".from('fo_site_visits')");
      expect(authIndex, greaterThanOrEqualTo(0));
      expect(writeIndex, greaterThan(authIndex));
    },
  );
}
