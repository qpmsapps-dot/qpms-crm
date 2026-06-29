import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/utils/mobile_roles.dart';

void main() {
  test('derives every supported mobile registration role', () {
    expect(deriveMobileRole('Operations', 'Field Officer'), 'FO');
    expect(deriveMobileRole('Operations', 'Key Account Manager'), 'KAM');
    expect(
      deriveMobileRole('Operations', 'Operations Manager'),
      'Operations Manager',
    );
    expect(deriveMobileRole('Operations', 'Branch Head'), 'Branch Head');
    expect(deriveMobileRole('Operations', 'GM'), 'GM');
    expect(
      deriveMobileRole('Business Development', 'BD Executive'),
      'BD Executive',
    );
    expect(deriveMobileRole('Business Development', 'BD Head'), 'BD Head');
  });

  test('rejects a designation under the wrong department', () {
    expect(
      () => deriveMobileRole('Business Development', 'GM'),
      throwsStateError,
    );
  });

  test('derives a missing profile role from designation', () {
    final user = FoUser.fromJson({
      'auth_user_id': 'auth-id',
      'employee_code': 'QPMS001',
      'full_name': 'Test User',
      'department': 'Operations',
      'designation': 'Key Account Manager',
    });

    expect(user.role, 'KAM');
  });

  test('preserves legacy FO profiles with no classification fields', () {
    final user = FoUser.fromJson({
      'auth_user_id': 'auth-id',
      'employee_code': 'QPMS002',
      'full_name': 'Legacy User',
    });

    expect(user.role, 'FO');
  });

  test('allows all required Operations mobile login roles', () {
    for (final role in <String>[
      'FO',
      'KAM',
      'Operations Manager',
      'Manager',
      'Branch Head',
      'GM',
    ]) {
      expect(isMobileLoginRole(role), isTrue, reason: role);
    }
  });

  test('mobile login role matching is case and whitespace insensitive', () {
    expect(isMobileLoginRole(' field_officer '), isTrue);
    expect(isMobileLoginRole('operations   manager'), isTrue);
  });

  test('debug panels are visible only for admin and support roles', () {
    for (final role in <String>[
      'Admin',
      'QPMS Admin',
      'Support',
      'Developer',
      'MD',
      'COO',
      'GM',
    ]) {
      expect(isMobileDebugVisible(role: role), isTrue, reason: role);
    }

    for (final role in <String>[
      'FO',
      'KAM',
      'Operations Manager',
      'BD Executive',
      'Employee',
    ]) {
      expect(isMobileDebugVisible(role: role), isFalse, reason: role);
    }
  });
}
