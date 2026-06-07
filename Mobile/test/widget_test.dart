import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qpms_mobile/fo_app.dart';
import 'package:qpms_mobile/models/fo_models.dart';
import 'package:qpms_mobile/services/fo_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('myQPMS login screen shows enterprise auth layout', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      MaterialApp(home: FoLoginScreen(onLogin: (_) async {})),
    );
    await tester.pumpAndSettle();

    expect(find.text('Welcome Back!'), findsOneWidget);
    expect(find.text('Please login to continue.'), findsOneWidget);
    expect(find.text('Mobile Number'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Login'), findsOneWidget);
    expect(find.text('Register Now'), findsOneWidget);
  });

  testWidgets('FO shell exposes field-only navigation', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      MaterialApp(
        home: FoOperationsShell(
          onLogout: () async {},
          themeMode: ThemeMode.dark,
          onThemeModeChanged: (_) {},
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('My Tasks'), findsAtLeastNWidgets(1));
    expect(find.text('Site Visits'), findsAtLeastNWidgets(1));
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Approvals'), findsNothing);
    expect(find.textContaining('Pipeline'), findsNothing);
  });

  test('logout keeps completed Android permission setup state', () async {
    SharedPreferences.setMockInitialValues({});
    await FoLocalStorage.setSession();
    await FoLocalStorage.setPermissionSetupComplete();
    await FoLocalStorage.clearSession();

    expect(await FoLocalStorage.hasSession(), isFalse);
    expect(await FoLocalStorage.hasCompletedPermissionSetup(), isTrue);
  });

  test('QPMS office is available as a 100 meter geofence test site', () {
    final office = FoSite.assignedDemoSites.first;

    expect(office.name, 'QPMS Office');
    expect(office.latitude, 13.029051);
    expect(office.longitude, 80.248947);
    expect(office.geofenceRadiusMeters, 100);
  });
}
