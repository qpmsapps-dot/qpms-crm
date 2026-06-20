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
}
