import 'dart:convert';
import 'dart:io';

import 'package:client_ticketing_app/features/auth/login_screen.dart';
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
  });

  tearDown(() {
    ClientAppConfig.backendApiUrlOverride = null;
    HospitalTicketApi.contactSessionToken = null;
  });

  testWidgets('login screen uses mobile-only registered contact copy', (
    tester,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => AuthController(preferences: prefs, demoMode: false),
          ),
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
      find.text('Enter the mobile number registered with NIMS services.'),
      findsOneWidget,
    );
    expect(find.text('Continue with Registered Mobile Number'), findsOneWidget);
    expect(find.text('Password'), findsNothing);
    expect(find.text('Forgot Password'), findsNothing);
    expect(find.text('Login'), findsNothing);
  });

  test('registered contact lookup waits for explicit confirmation', () async {
    final server = await _contactServer((request) async {
      expect(request.uri.path, '/api/hospital-client/identify');
      final body = jsonDecode(await utf8.decoder.bind(request).join()) as Map;
      expect(body['mobile'], '9876543210');
      request.response
        ..headers.contentType = ContentType.json
        ..write(
          jsonEncode({
            'ok': true,
            'token': 'contact-token',
            'contact': {
              'id': 'contact-id',
              'full_name': 'TEST PERSON NAME',
              'mobile': '9876543210',
              'designation': 'Dean',
              'department': 'Administration',
            },
            'client': {
              'id': 'client-id',
              'name': 'NIMS Hyderabad',
              'code': 'NIMS',
            },
          }),
        );
      await request.response.close();
    });
    addTearDown(() => server.close(force: true));
    ClientAppConfig.backendApiUrlOverride = 'http://127.0.0.1:${server.port}';

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

  test('unknown registered mobile shows NIMS administrator message', () async {
    final server = await _contactServer((request) async {
      request.response
        ..statusCode = 403
        ..headers.contentType = ContentType.json
        ..write(
          jsonEncode({
            'ok': false,
            'code': 'mobile_not_registered',
            'message':
                'This mobile number is not registered for NIMS Client Ticketing.',
          }),
        );
      await request.response.close();
    });
    addTearDown(() => server.close(force: true));
    ClientAppConfig.backendApiUrlOverride = 'http://127.0.0.1:${server.port}';

    final prefs = await SharedPreferences.getInstance();
    final auth = AuthController(preferences: prefs, demoMode: false);

    expect(await auth.lookupRegisteredMobile('9999999999'), isFalse);
    expect(auth.errorMessage, contains('NIMS/QPMS administrator'));
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

  test('Housekeeping and Security categories resolve from production names', () {
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
      expect(payload['category_id'], category == 'Housekeeping' ? 'hk' : 'sec');
    }
  });

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
}

Future<HttpServer> _contactServer(
  Future<void> Function(HttpRequest request) handler,
) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen(handler);
  return server;
}
