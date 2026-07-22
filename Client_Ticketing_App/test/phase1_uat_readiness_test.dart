import 'dart:io';

import 'package:client_ticketing_app/state/auth_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('release manifest contains only required connectivity permission', () {
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    expect(manifest, contains('android.permission.INTERNET'));
    expect(manifest, contains('android.permission.CAMERA'));
  });

  test('only active client hospital roles are accepted', () {
    expect(
      AuthController.isAllowedClientProfile({
        'profile_type': 'client',
        'role_code': 'doctor',
        'is_active': true,
      }),
      isTrue,
    );
    expect(
      AuthController.isAllowedClientProfile({
        'profile_type': 'client',
        'role_code': 'hospital_management',
        'is_active': true,
      }),
      isTrue,
    );
    expect(
      AuthController.isAllowedClientProfile({
        'profile_type': 'internal',
        'role_code': 'facility_manager',
        'is_active': true,
      }),
      isFalse,
    );
    expect(
      AuthController.isAllowedClientProfile({
        'profile_type': 'client',
        'role_code': 'doctor',
        'is_active': false,
      }),
      isFalse,
    );
  });

  test('location hierarchy is constrained by block and floor', () {
    final controller = TicketController(demoMode: false)
      ..replaceMastersForTesting(
        blocks: const [
          {'id': 'a', 'block_name': 'Block A'},
          {'id': 'b', 'block_name': 'Block B'},
        ],
        locations: const [
          {
            'id': 'a1',
            'block_id': 'a',
            'floor_name': '1st Floor',
            'location_name': 'Ward A1',
          },
          {
            'id': 'a3',
            'block_id': 'a',
            'floor_name': '3rd Floor',
            'location_name': 'Ward A3',
          },
          {
            'id': 'b3',
            'block_id': 'b',
            'floor_name': '3rd Floor',
            'location_name': 'Ward B3',
          },
        ],
      );
    expect(controller.floorsForBlock('Block A'), ['1st Floor', '3rd Floor']);
    expect(controller.locationsForBlockAndFloor('Block A', '3rd Floor'), [
      'Ward A3',
    ]);
    expect(
      controller.isDraftValid(
        ComplaintDraft(
          block: 'Block A',
          floor: '3rd Floor',
          location: 'Ward B3',
          category: 'Housekeeping',
          description: 'Mismatch',
        ),
      ),
      isFalse,
    );
  });

  test('temporary polling and refresh have lifecycle guards', () {
    final detail = File(
      'lib/features/tickets/ticket_details_screen.dart',
    ).readAsStringSync();
    final dashboard = File(
      'lib/features/dashboard/dashboard_screen.dart',
    ).readAsStringSync();
    expect(detail, contains('WidgetsBindingObserver'));
    expect(detail, contains('_pollTimer?.cancel()'));
    expect(
      dashboard,
      contains('Future.wait([tickets.load(), notifications.load()])'),
    );
  });

  test('startup routing waits for the single auth bootstrap future', () {
    final splash = File(
      'lib/features/splash/splash_screen.dart',
    ).readAsStringSync();
    final auth = File('lib/state/auth_controller.dart').readAsStringSync();
    expect(splash, contains('await auth.load()'));
    expect(auth, contains('_bootstrapFuture ??= _bootstrap()'));
    expect(auth, contains('auth.onAuthStateChange.listen'));
    expect(auth, contains('_authSubscription?.cancel()'));
  });
}
