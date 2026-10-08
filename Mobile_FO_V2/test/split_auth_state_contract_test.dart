import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final appSource = File('lib/app.dart').readAsStringSync();
  final tasksSource = File('lib/tasks/tasks_screen.dart').readAsStringSync();
  final serviceSource = File(
    'lib/services/supabase_service.dart',
  ).readAsStringSync();
  final loginSource = File('lib/auth/login_screen.dart').readAsStringSync();

  test('bootstrap validates cached identity before opening Home', () {
    final start = appSource.indexOf(
      'Future<FoUser?> _restoreAuthenticatedUser',
    );
    final end = appSource.indexOf('void _startAuthStateListener', start);
    final bootstrap = appSource.substring(start, end);

    expect(bootstrap, contains('requireAuthenticatedSession'));
    expect(bootstrap, contains('BOOTSTRAP_RESTORED_AUTH_SESSION_INVALID'));
    expect(bootstrap, contains('_refreshCachedProfile'));
    expect(bootstrap, contains('on AuthSessionExpiredException'));
    expect(bootstrap, contains('return null;'));
  });

  test('one auth listener reconciles signed out state and is disposed', () {
    expect(appSource, contains('_authStateSubscription != null'));
    expect(appSource, contains('auth.onAuthStateChange'));
    expect(appSource, contains('.listen('));
    expect(appSource, contains('event == AuthChangeEvent.signedOut'));
    expect(appSource, contains('_authStateSubscription?.cancel()'));
    expect(appSource, contains('_authEventReconciliationRunning'));
  });

  test('reauthentication preserves operational LocalStore state', () {
    final start = appSource.indexOf('Future<void> _requireReauthentication');
    final end = appSource.indexOf(
      'Future<FoUser?> _refreshCachedProfile',
      start,
    );
    final reauthentication = appSource.substring(start, end);

    expect(reauthentication, contains('operational_data_preserved=true'));
    expect(reauthentication, isNot(contains('LocalStore.clearUser')));
    expect(reauthentication, isNot(contains('LocalStore.saveAttendance')));
    expect(reauthentication, isNot(contains('TrackingService.stop')));
    expect(reauthentication, isNot(contains('signOut')));
  });

  test('Add Site authenticates before profile, store, and visit work', () {
    final start = tasksSource.indexOf('class _AddStoreDialogState');
    final saveStart = tasksSource.indexOf('Future<void> _save()', start);
    final saveEnd = tasksSource.indexOf(
      'Future<_NearbyStore?> _similarSiteWithin100m',
      saveStart,
    );
    final save = tasksSource.substring(saveStart, saveEnd);

    final authIndex = save.indexOf('requireAuthenticatedSession');
    final profileIndex = save.indexOf('fetchCurrentProfile');
    final storeIndex = save.indexOf('createStore');
    expect(authIndex, greaterThanOrEqualTo(0));
    expect(profileIndex, greaterThan(authIndex));
    expect(storeIndex, greaterThan(profileIndex));
    expect(save, contains('on AuthSessionExpiredException'));
    expect(save, contains('FO_ADD_SITE_AUTH_REQUIRED'));
    expect(save, contains('onAuthRequired?.call()'));
  });

  test('write guards cover attendance, Add Site, travel, and activities', () {
    for (final action in <String>[
      'START_DAY_AUTH_SESSION_INVALID',
      'END_DAY_AUTH_SESSION_INVALID',
      'ADD_SITE_AUTH_SESSION_INVALID',
      'CHECKIN_AUTH_SESSION_INVALID',
      'CHECKOUT_AUTH_SESSION_INVALID',
      'TRAVEL_CLAIM_UPLOAD_AUTH_SESSION_INVALID',
      'TRAVEL_CLAIM_SUBMIT_AUTH_SESSION_INVALID',
      'ACTIVITY_SUBMISSION_AUTH_SESSION_INVALID',
      'ACTIVITY_FILE_UPLOAD_AUTH_SESSION_INVALID',
      'ACTIVITY_UPLOAD_ROW_AUTH_SESSION_INVALID',
      'TRAVEL_LEG_CREATE_AUTH_SESSION_INVALID',
      'TRAVEL_LEG_CLOSE_AUTH_SESSION_INVALID',
    ]) {
      expect(serviceSource, contains(action), reason: action);
    }
  });

  test('safe diagnostics never interpolate secret token values', () {
    final start = serviceSource.indexOf(
      'static Future<Session> requireAuthenticatedSession',
    );
    final end = serviceSource.indexOf('static String writeDiagnostic', start);
    final validator = serviceSource.substring(start, end);

    expect(validator, isNot(contains(r'${session.accessToken}')));
    expect(validator, isNot(contains(r'${session.refreshToken}')));
    expect(validator, isNot(contains('authorization=')));
    expect(validator, contains('access_token_present='));
  });

  test('app resume uses guarded authentication reconciliation', () {
    final start = appSource.indexOf('Future<void> _handleResume()');
    final end = appSource.indexOf('Future<void> _bootstrap()', start);
    final resume = appSource.substring(start, end);

    expect(resume, contains('_resumeAuthCheckRunning'));
    expect(resume, contains('requireAuthenticatedSession'));
    expect(resume, contains('_requireReauthentication'));
  });

  test('Check-In auth failure preserves operational state and opens Login', () {
    final start = tasksSource.indexOf('Future<void> _checkIn() async');
    final end = tasksSource.indexOf(
      'Future<void> _addSiteFromCheckIn()',
      start,
    );
    final checkIn = tasksSource.substring(start, end);

    expect(checkIn, contains('AuthSessionExpiredException.message'));
    expect(checkIn, contains('await widget.onAuthRequired()'));
    expect(checkIn, isNot(contains('await widget.onLogout()')));
    expect(checkIn, isNot(contains('TrackingService.stop')));
    expect(checkIn, isNot(contains('LocalStore.clearUser')));
  });

  test('expired-session message is carried onto Login', () {
    expect(
      serviceSource,
      contains('Your session has expired. Please sign in again.'),
    );
    expect(
      appSource,
      contains('_loginMessage = AuthSessionExpiredException.message'),
    );
    expect(appSource, contains('initialMessage: _loginMessage'));
    expect(loginSource, contains('_message = widget.initialMessage'));
  });
}
