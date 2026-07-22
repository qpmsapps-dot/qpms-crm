import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/auth/register_screen.dart';
import 'package:myqpms_fo_v2/services/supabase_service.dart';

void main() {
  testWidgets('obsolete registration route fails closed', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: RegisterScreen(),
      ),
    );

    expect(find.text('Account Access'), findsOneWidget);
    expect(find.text(RegisterScreen.message), findsOneWidget);
    expect(find.text('Create Account'), findsNothing);
  });

  test('SupabaseService.register cannot create production accounts', () async {
    await expectLater(
      SupabaseService.register(
        fullName: 'Test User',
        employeeId: 'TEST001',
        mobile: '9999999999',
        email: 'test@example.com',
        birthDate: '2000-01-01',
        gender: 'Other',
        state: 'TN',
        department: 'Operations',
        designation: 'Field Officer',
        business: 'Standalone',
        password: 'Password123',
      ),
      throwsA(isA<UnsupportedError>()),
    );
  });
}
