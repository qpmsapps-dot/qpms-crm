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
      'General Manager',
      'Admin',
      'QPMS Admin',
      'Developer',
      'Dev',
      'IT Admin',
      'Management IT Admin',
    ]) {
      expect(isMobileLoginRole(role), isTrue, reason: role);
    }
  });

  test('mobile login role matching is case and whitespace insensitive', () {
    expect(isMobileLoginRole(' field_officer '), isTrue);
    expect(isMobileLoginRole('operations   manager'), isTrue);
    expect(isMobileLoginRole('qpms_admin'), isTrue);
    expect(isMobileLoginRole('management it admin'), isTrue);
  });

  test('canonicalizes mobile admin and developer aliases', () {
    expect(canonicalMobileRole('QPMS Admin'), 'QPMS Admin');
    expect(canonicalMobileRole('Dev'), 'Developer');
    expect(canonicalMobileRole('IT Admin'), 'Developer');
    expect(canonicalMobileRole('Management IT Admin'), 'Developer');
    expect(canonicalMobileRole('General Manager'), 'GM');
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

  test('canonical BD and management roles remain distinct', () {
    expect(canonicalMobileRole('bd executive'), 'BD Executive');
    expect(
      canonicalMobileRole('BUSINESS_DEVELOPMENT_EXECUTIVE'),
      'BD Executive',
    );
    expect(canonicalMobileRole('bd-head'), 'BD Head');
    expect(canonicalMobileRole('Business Development Head'), 'BD Head');
    expect(canonicalMobileRole('Business Head'), 'Business Head');
    expect(canonicalMobileRole('branch_head'), 'Branch Head');
    expect(canonicalMobileRole('Admin'), 'Admin');
    expect(canonicalMobileRole('QPMS Admin'), 'QPMS Admin');
    expect(canonicalMobileRole('dev'), 'Developer');
  });

  test('dedicated and optional BD module access is safe', () {
    expect(isBusinessDevelopmentRole('BD Executive'), isTrue);
    expect(isBusinessDevelopmentRole('BD Head'), isTrue);
    for (final role in [
      'Business Head',
      'Branch Head',
      'Admin',
      'QPMS Admin',
      'Developer',
    ]) {
      expect(canAccessBusinessDevelopmentModule(role), isTrue, reason: role);
      expect(isBusinessDevelopmentRole(role), isFalse, reason: role);
    }
    expect(canAccessBusinessDevelopmentModule('FO'), isFalse);
  });

  test('lead creation is restricted to approved mobile roles', () {
    for (final role in [
      'BD Executive',
      'BD Head',
      'Admin',
      'QPMS Admin',
      'Developer',
    ]) {
      expect(canCreateBusinessDevelopmentLead(role), isTrue, reason: role);
    }
    expect(canCreateBusinessDevelopmentLead('Business Head'), isFalse);
    expect(canCreateBusinessDevelopmentLead('Branch Head'), isFalse);
    expect(canCreateBusinessDevelopmentLead('FO'), isFalse);
  });
}
