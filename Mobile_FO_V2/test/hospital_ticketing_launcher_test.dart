import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_ticketing_launcher_screen.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:url_launcher/url_launcher.dart';

const _adminUser = FoUser(
  authUserId: 'auth-admin',
  employeeCode: 'QPMSADMIN',
  fullName: 'Demo Admin',
  mobile: '',
  email: 'admin@myqpms.com',
  state: 'TN',
  role: 'Admin',
);

void main() {
  testWidgets('launcher shows both hospital ticketing cards for admin', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HospitalTicketingLauncherScreen(
          user: _adminUser,
          openOperations: () async {},
          launchClientApp: (_, {mode = LaunchMode.platformDefault}) async =>
              true,
        ),
      ),
    );

    expect(find.text('Hospital Ticketing'), findsOneWidget);
    expect(find.text('RMO / Client View'), findsOneWidget);
    expect(find.text('QPMS Operations View'), findsOneWidget);
    expect(find.text('Demo Access'), findsOneWidget);
  });

  testWidgets('client card invokes qpms hospital tickets deep link', (
    tester,
  ) async {
    Uri? launchedUri;
    LaunchMode? launchMode;
    await tester.pumpWidget(
      MaterialApp(
        home: HospitalTicketingLauncherScreen(
          user: _adminUser,
          openOperations: () async {},
          launchClientApp: (uri, {mode = LaunchMode.platformDefault}) async {
            launchedUri = uri;
            launchMode = mode;
            return true;
          },
        ),
      ),
    );

    await tester.tap(find.text('Open QPMS App'));
    await tester.pump();

    expect(launchedUri.toString(), qpmsClientTicketingDeepLink);
    expect(launchMode, LaunchMode.externalApplication);
  });

  testWidgets('missing client app shows a safe message', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HospitalTicketingLauncherScreen(
          user: _adminUser,
          openOperations: () async {},
          launchClientApp: (_, {mode = LaunchMode.platformDefault}) async =>
              false,
        ),
      ),
    );

    await tester.tap(find.text('Open QPMS App'));
    await tester.pump();

    expect(
      find.text('QPMS client app is not installed on this device.'),
      findsOneWidget,
    );
  });

  testWidgets('operations card opens existing hospital shell callback', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var opened = false;
    await tester.pumpWidget(
      MaterialApp(
        home: HospitalTicketingLauncherScreen(
          user: _adminUser,
          openOperations: () async => opened = true,
          launchClientApp: (_, {mode = LaunchMode.platformDefault}) async =>
              true,
        ),
      ),
    );

    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Open Operations'),
    );
    button.onPressed!();
    await tester.pump();

    expect(opened, isTrue);
  });
}
