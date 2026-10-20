import 'dart:io';

import 'package:client_ticketing_app/features/auth/login_screen.dart';
import 'package:client_ticketing_app/features/dashboard/dashboard_screen.dart';
import 'package:client_ticketing_app/models/ticket.dart';
import 'package:client_ticketing_app/services/app_config.dart';
import 'package:client_ticketing_app/services/hospital_ticket_api.dart';
import 'package:client_ticketing_app/state/auth_controller.dart';
import 'package:client_ticketing_app/state/notification_controller.dart';
import 'package:client_ticketing_app/state/ticket_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    ClientAppConfig.backendApiUrlOverride = 'http://127.0.0.1:1';
    HospitalTicketApi.contactSessionToken = null;
    HospitalTicketApi.requestOverrideForTesting = null;
    HospitalTicketApi.publicRequestOverrideForTesting = null;
    AuthController.registerPushDeviceForTesting = null;
    AuthController.unregisterPushDeviceForTesting = null;
  });

  tearDown(() {
    ClientAppConfig.backendApiUrlOverride = null;
    HospitalTicketApi.contactSessionToken = null;
    HospitalTicketApi.requestOverrideForTesting = null;
    HospitalTicketApi.publicRequestOverrideForTesting = null;
    AuthController.registerPushDeviceForTesting = null;
    AuthController.unregisterPushDeviceForTesting = null;
  });

  testWidgets('login screen uses mobile-only registered contact copy', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final prefs = await SharedPreferences.getInstance();
    final auth = AuthController(preferences: prefs, demoMode: false);
    await auth.load();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthController>.value(value: auth),
          ChangeNotifierProvider(
            create: (_) => TicketController(demoMode: false),
          ),
          ChangeNotifierProvider(
            create: (_) =>
                NotificationController(preferences: prefs, demoMode: false),
          ),
        ],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );

    expect(find.text('Welcome'), findsOneWidget);
    expect(
      find.text('Continue with your registered mobile number.'),
      findsOneWidget,
    );
    expect(find.text('Mobile Number'), findsOneWidget);
    expect(
      find.text('Enter your registered hospital contact mobile number.'),
      findsOneWidget,
    );
    expect(find.text('Continue with Registered Mobile Number'), findsOneWidget);
    expect(find.text('Password'), findsNothing);
    expect(find.text('Forgot Password'), findsNothing);
    expect(find.text('Login'), findsNothing);
  });

  test('registered contact lookup waits for explicit confirmation', () async {
    HospitalTicketApi
        .publicRequestOverrideForTesting = (method, path, body) async {
      expect(path, '/api/hospital-client/identify');
      expect(body?['mobile'], '9876543210');
      return {
        'ok': true,
        'token': 'contact-token',
        'contact': {
          'id': 'contact-id',
          'full_name': 'TEST PERSON NAME',
          'mobile': '9876543210',
          'designation': 'Dean',
          'department': 'Administration',
        },
        'client': {'id': 'client-id', 'name': 'NIMS Hyderabad', 'code': 'NIMS'},
      };
    };

    final prefs = await SharedPreferences.getInstance();
    final auth = AuthController(preferences: prefs, demoMode: false);

    expect(await auth.lookupRegisteredMobile('9876543210'), isTrue);
    expect(auth.isAuthenticated, isFalse);
    expect(HospitalTicketApi.contactSessionToken, isNull);
    expect(auth.pendingProfile?['full_name'], 'TEST PERSON NAME');
    expect(auth.pendingProfile?['designation'], 'Dean');
    expect(auth.pendingProfile?['client_name'], 'NIMS Hyderabad');

    await auth.confirmRegisteredContact();

    expect(auth.isAuthenticated, isTrue);
    expect(HospitalTicketApi.contactSessionToken, 'contact-token');
    expect(prefs.getString('qpms_contact_token'), 'contact-token');
  });

  test(
    'contact login registers push token and logout unregisters device',
    () async {
      var registerCount = 0;
      var unregisterCount = 0;
      AuthController.registerPushDeviceForTesting = () async {
        expect(HospitalTicketApi.contactSessionToken, 'contact-token');
        registerCount += 1;
      };
      AuthController.unregisterPushDeviceForTesting = () async {
        expect(HospitalTicketApi.contactSessionToken, 'contact-token');
        unregisterCount += 1;
      };

      final prefs = await SharedPreferences.getInstance();
      final auth = AuthController(preferences: prefs, demoMode: false);
      auth.setPendingRegisteredContactForTesting(
        token: 'contact-token',
        profile: const {
          'id': 'contact-id',
          'client_id': 'client-id',
          'full_name': 'TEST PERSON NAME',
          'mobile': '9876543210',
          'profile_type': 'client_contact',
          'role_code': 'client_contact',
          'is_active': true,
        },
      );

      await auth.confirmRegisteredContact();
      expect(registerCount, 1);

      await auth.logout();
      expect(unregisterCount, 1);
      expect(HospitalTicketApi.contactSessionToken, isNull);
    },
  );

  test('unknown registered mobile shows neutral support message', () async {
    HospitalTicketApi.publicRequestOverrideForTesting = (_, _, _) async =>
        throw const HospitalApiException(
          'This mobile number is not registered for Hospital Client Ticketing.',
          code: 'mobile_not_registered',
          statusCode: 403,
        );

    final prefs = await SharedPreferences.getInstance();
    final auth = AuthController(preferences: prefs, demoMode: false);

    expect(await auth.lookupRegisteredMobile('9999999999'), isFalse);
    expect(auth.errorMessage, contains('Hospital Client Ticketing'));
    expect(auth.isAuthenticated, isFalse);
  });

  test('contact mode translates API requests to hospital-client routes', () {
    expect(
      HospitalTicketApi.contactPathForTesting('/api/hospital-tickets'),
      '/api/hospital-client/tickets',
    );
    expect(
      HospitalTicketApi.contactPathForTesting('/api/hospital-tickets/me'),
      '/api/hospital-client/me',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/me/push-devices',
      ),
      '/api/hospital-client/me/push-devices',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/me/push-devices/device-1',
      ),
      '/api/hospital-client/me/push-devices/device-1',
    );
    expect(
      HospitalTicketApi.contactPathForTesting('/api/hospital-tickets/blocks'),
      '/api/hospital-client/blocks',
    );
    expect(
      HospitalTicketApi.contactPathForTesting('/api/hospital-tickets/floors'),
      '/api/hospital-client/floors',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/departments',
      ),
      '/api/hospital-client/departments',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/hierarchy/locations',
      ),
      '/api/hospital-client/hierarchy/locations',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/categories',
      ),
      '/api/hospital-client/categories',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/ticket-id/attachments/sign-upload',
      ),
      '/api/hospital-client/tickets/ticket-id/attachments/sign-upload',
    );
    expect(
      HospitalTicketApi.contactPathForTesting(
        '/api/hospital-tickets/ticket-id/feedback',
      ),
      '/api/hospital-client/tickets/ticket-id/feedback',
    );
  });

  test('resolved contact tickets expose visible confirmation entry points', () {
    final detail = File(
      'lib/features/tickets/ticket_details_screen.dart',
    ).readAsStringSync();
    final feedback = File(
      'lib/features/tickets/feedback_screen.dart',
    ).readAsStringSync();

    expect(
      detail,
      contains('ticket.status == TicketStatus.awaitingConfirmation'),
    );
    expect(detail, isNot(contains('const canConfirm = false')));
    expect(detail, contains('Confirm & Close'));
    expect(detail, contains('Not Satisfied'));
    expect(feedback, contains('Select a rating from 1 to 5 stars.'));
    expect(feedback, contains('Please tell us what still needs attention.'));
    expect(feedback, contains('Add feedback (optional)'));
  });

  test(
    'Housekeeping and Security categories resolve from production names',
    () {
      final categories = [
        {'id': 'hk', 'category_name': 'Housekeeping', 'is_active': true},
        {'id': 'sec', 'category_name': 'Security', 'is_active': true},
      ];
      final controller = TicketController(demoMode: false)
        ..replaceMastersForTesting(
          blocks: const [
            {'id': 'block', 'block_name': 'NIMS Block', 'is_active': true},
          ],
          floors: const [
            {
              'id': 'floor',
              'block_id': 'block',
              'floor_name': 'Ground Floor',
              'is_active': true,
            },
          ],
          locations: const [
            {
              'id': 'loc',
              'block_id': 'block',
              'floor_id': 'floor',
              'location_name': 'Reception',
              'is_active': true,
            },
          ],
          categories: categories,
        );

      for (final category in ['Housekeeping', 'Security']) {
        final payload = controller.createPayloadForTesting(
          ComplaintDraft(
              category: category,
              priority: TicketPriority.medium,
              description: '$category issue',
            )
            ..blockId = 'block'
            ..block = 'NIMS Block'
            ..floorId = 'floor'
            ..floor = 'Ground Floor'
            ..locationId = 'loc'
            ..location = 'Reception',
        );
        expect(
          payload['category_id'],
          category == 'Housekeeping' ? 'hk' : 'sec',
        );
      }
    },
  );

  test('logout clears contact token and cached contact session', () async {
    final prefs = await SharedPreferences.getInstance();
    final auth = AuthController(preferences: prefs, demoMode: false);
    await prefs.setString('qpms_contact_token', 'contact-token');
    await prefs.setString('qpms_contact_name', 'TEST PERSON NAME');
    HospitalTicketApi.contactSessionToken = 'contact-token';

    await auth.logout();

    expect(HospitalTicketApi.contactSessionToken, isNull);
    expect(prefs.getString('qpms_contact_token'), isNull);
    expect(prefs.getString('qpms_contact_name'), isNull);
    expect(auth.isAuthenticated, isFalse);
  });

  test(
    'NIMS to logout to Osmania clears client state and uses new configuration',
    () async {
      final prefs = await SharedPreferences.getInstance();
      final tickets = TicketController(demoMode: false);
      final notifications = NotificationController(
        preferences: prefs,
        demoMode: false,
      );
      final auth = AuthController(
        preferences: prefs,
        demoMode: false,
        onSessionCleared: () {
          tickets.clearSessionState();
          notifications.clearSessionState();
        },
      );
      AuthController.registerPushDeviceForTesting = () async {};
      AuthController.unregisterPushDeviceForTesting = () async {};
      auth.setPendingRegisteredContactForTesting(
        token: 'nims-token',
        profile: const {
          'client_id': 'nims',
          'client_name': 'NIMS Hyderabad',
          'client_short_name': 'NIMS',
          'profile_type': 'client_contact',
          'role_code': 'client_contact',
          'is_active': true,
        },
      );
      await auth.confirmRegisteredContact();
      tickets.replaceMastersForTesting(
        blocks: const [
          {'id': 'nims-block', 'block_name': 'NIMS Block', 'is_active': true},
        ],
        locations: const [],
      );
      notifications.addTicketRaisedNotification('NIMS-1');
      expect(tickets.blocks, isNotEmpty);
      expect(notifications.items, isNotEmpty);
      await auth.logout();
      expect(auth.profile, isNull);
      expect(tickets.blocks, isEmpty);
      expect(notifications.items, isEmpty);
      auth.setPendingRegisteredContactForTesting(
        token: 'osmania-token',
        profile: const {
          'client_id': 'osmania',
          'client_name': 'Osmania General Hospital',
          'client_short_name': 'Osmania',
          'client_configuration_version': 'v2',
          'profile_type': 'client_contact',
          'role_code': 'client_contact',
          'is_active': true,
        },
      );
      await auth.confirmRegisteredContact();
      expect(auth.profile?['client_name'], 'Osmania General Hospital');
      expect(HospitalTicketApi.contactSessionToken, 'osmania-token');
      expect(tickets.blocks, isEmpty);
    },
  );

  test('authenticated profile refresh replaces backend branding', () async {
    HospitalTicketApi.contactSessionToken = 'nims-token';
    HospitalTicketApi.requestOverrideForTesting = (method, path, token) async {
      expect(path, '/api/hospital-client/me');
      expect(token, 'nims-token');
      return {
        'ok': true,
        'user': {
          'id': 'contact',
          'client_id': 'nims',
          'profile_type': 'client_contact',
          'role_code': 'client_contact',
          'is_active': true,
        },
        'client': {
          'id': 'nims',
          'name': 'NIMS Hyderabad',
          'code': 'NIMS',
          'short_name': 'NIMS',
          'logo_url': 'https://assets.example/nims-v2.png',
          'banner_url': null,
          'configuration_version': 'v2',
        },
      };
    };
    final auth = AuthController(demoMode: false);
    await auth.loadProfile();
    expect(
      auth.profile?['client_logo_url'],
      'https://assets.example/nims-v2.png',
    );
    expect(auth.profile?['client_configuration_version'], 'v2');
  });

  test(
    'authenticated hierarchy uses active contact token and backend hospital records',
    () async {
      HospitalTicketApi.requestOverrideForTesting =
          (method, path, token) async {
            expect(token, 'osmania-token');
            if (path == '/api/hospital-client/hierarchy') {
              return {
                'ok': true,
                'hierarchy': {
                  'blocks': [
                    {
                      'id': 'osmania-block',
                      'client_id': 'osmania',
                      'block_name': 'Osmania Block',
                      'is_active': true,
                    },
                  ],
                  'floors': [],
                  'departments': [],
                  'locations': [],
                },
              };
            }
            if (path == '/api/hospital-client/categories') {
              return {
                'ok': true,
                'categories': [
                  {
                    'id': 'security',
                    'category_name': 'Security',
                    'is_active': true,
                  },
                ],
              };
            }
            fail('Unexpected master route $path');
          };
      HospitalTicketApi.contactSessionToken = 'osmania-token';
      final tickets = TicketController(demoMode: false);
      await tickets.loadCompleteHierarchy();
      expect(tickets.hospitalBlocks.single.name, 'Osmania Block');
      expect(tickets.categories.single['category_name'], 'Security');
    },
  );

  testWidgets(
    'dashboard branding follows configured hospital including a future client',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final prefs = await SharedPreferences.getInstance();
      AuthController.registerPushDeviceForTesting = () async {};
      final auth = AuthController(preferences: prefs, demoMode: false);
      auth.setPendingRegisteredContactForTesting(
        token: 'future-token',
        profile: const {
          'client_id': 'future',
          'client_name': 'Future Hospital',
          'client_short_name': 'Future',
          'client_configuration_version': 'v3',
          'profile_type': 'client_contact',
          'role_code': 'client_contact',
          'is_active': true,
        },
      );
      await auth.confirmRegisteredContact();
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthController>.value(value: auth),
            ChangeNotifierProvider(
              create: (_) => TicketController(demoMode: false),
            ),
            ChangeNotifierProvider(
              create: (_) =>
                  NotificationController(preferences: prefs, demoMode: false),
            ),
          ],
          child: const MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(0.8)),
              child: DashboardScreen(),
            ),
          ),
        ),
      );
      expect(find.text('Future Hospital'), findsOneWidget);
      expect(find.text('Future'), findsWidgets);
      expect(find.text('NIMS'), findsNothing);
    },
  );
}
