import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/services/auth_session_recovery.dart';

const _authenticated = AuthSessionSnapshot(
  supabaseReady: true,
  sessionPresent: true,
  currentUserPresent: true,
  accessTokenPresent: true,
  sessionExpired: false,
  identityMatches: true,
);

const _missingSession = AuthSessionSnapshot(
  supabaseReady: true,
  sessionPresent: false,
  currentUserPresent: false,
  accessTokenPresent: false,
  sessionExpired: false,
  identityMatches: false,
);

void main() {
  test('parses access-token expiry without exposing the token', () {
    final payload = base64Url.encode(utf8.encode('{"exp":1893456000}'));
    final token = 'header.${payload.replaceAll('=', '')}.signature';

    expect(accessTokenExpiryEpochSeconds(token), 1893456000);
    expect(accessTokenExpiryEpochSeconds('not-a-jwt'), isNull);
  });

  test(
    'cached user with a valid session is allowed without recovery',
    () async {
      var refreshCalls = 0;
      final result = await AuthSessionRecoveryCoordinator().validate(
        readSnapshot: () => _authenticated,
        refresh: () async => refreshCalls += 1,
      );

      expect(result.isAuthenticated, isTrue);
      expect(result.recoveryAttempted, isFalse);
      expect(refreshCalls, 0);
    },
  );

  test('missing session is allowed after one successful recovery', () async {
    var snapshot = _missingSession;
    var refreshCalls = 0;
    final result = await AuthSessionRecoveryCoordinator().validate(
      readSnapshot: () => snapshot,
      refresh: () async {
        refreshCalls += 1;
        snapshot = _authenticated;
      },
    );

    expect(result.isAuthenticated, isTrue);
    expect(result.recoveryAttempted, isTrue);
    expect(result.recoverySucceeded, isTrue);
    expect(refreshCalls, 1);
  });

  test('missing session fails closed after one failed recovery', () async {
    var refreshCalls = 0;
    final result = await AuthSessionRecoveryCoordinator().validate(
      readSnapshot: () => _missingSession,
      refresh: () async {
        refreshCalls += 1;
        throw StateError('refresh failed');
      },
    );

    expect(result.isAuthenticated, isFalse);
    expect(result.recoveryAttempted, isTrue);
    expect(result.recoverySucceeded, isFalse);
    expect(refreshCalls, 1);
  });

  test(
    'unconfigured Supabase fails closed without a recovery attempt',
    () async {
      var refreshCalls = 0;
      final result = await AuthSessionRecoveryCoordinator().validate(
        readSnapshot: () => const AuthSessionSnapshot(
          supabaseReady: false,
          sessionPresent: false,
          currentUserPresent: false,
          accessTokenPresent: false,
          sessionExpired: false,
          identityMatches: false,
        ),
        refresh: () async => refreshCalls += 1,
      );

      expect(result.isAuthenticated, isFalse);
      expect(result.recoveryAttempted, isFalse);
      expect(refreshCalls, 0);
    },
  );

  test(
    'expired session is recovered only when refreshed state is valid',
    () async {
      var snapshot = const AuthSessionSnapshot(
        supabaseReady: true,
        sessionPresent: true,
        currentUserPresent: true,
        accessTokenPresent: true,
        sessionExpired: true,
        identityMatches: true,
      );
      final result = await AuthSessionRecoveryCoordinator().validate(
        readSnapshot: () => snapshot,
        refresh: () async => snapshot = _authenticated,
      );

      expect(result.isAuthenticated, isTrue);
      expect(result.recoveryAttempted, isTrue);
    },
  );

  test('near-expiry session is refreshed before protected work', () async {
    var snapshot = const AuthSessionSnapshot(
      supabaseReady: true,
      sessionPresent: true,
      currentUserPresent: true,
      accessTokenPresent: true,
      sessionExpired: false,
      sessionExpiringSoon: true,
      identityMatches: true,
    );
    var refreshCalls = 0;
    final result = await AuthSessionRecoveryCoordinator().validate(
      readSnapshot: () => snapshot,
      refresh: () async {
        refreshCalls += 1;
        snapshot = _authenticated;
      },
    );

    expect(refreshCalls, 1);
    expect(result.isAuthenticated, isTrue);
  });

  test('forced refresh failure never reuses the previous token', () async {
    var refreshCalls = 0;
    final result = await AuthSessionRecoveryCoordinator().validate(
      readSnapshot: () => _authenticated,
      refresh: () async {
        refreshCalls += 1;
        throw StateError('refresh token expired');
      },
      forceRefresh: true,
    );

    expect(refreshCalls, 1);
    expect(result.recoveryAttempted, isTrue);
    expect(result.recoverySucceeded, isFalse);
    expect(result.isAuthenticated, isFalse);
  });

  test('identity mismatch is not accepted after refresh', () async {
    const mismatch = AuthSessionSnapshot(
      supabaseReady: true,
      sessionPresent: true,
      currentUserPresent: true,
      accessTokenPresent: true,
      sessionExpired: false,
      identityMatches: false,
    );
    final result = await AuthSessionRecoveryCoordinator().validate(
      readSnapshot: () => mismatch,
      refresh: () async {},
    );

    expect(result.isAuthenticated, isFalse);
    expect(result.recoveryAttempted, isTrue);
  });

  test('concurrent write attempts share one recovery operation', () async {
    var snapshot = _missingSession;
    var refreshCalls = 0;
    final refreshStarted = Completer<void>();
    final releaseRefresh = Completer<void>();
    final coordinator = AuthSessionRecoveryCoordinator();

    Future<void> refresh() async {
      refreshCalls += 1;
      refreshStarted.complete();
      await releaseRefresh.future;
      snapshot = _authenticated;
    }

    final first = coordinator.validate(
      readSnapshot: () => snapshot,
      refresh: refresh,
    );
    await refreshStarted.future;
    final second = coordinator.validate(
      readSnapshot: () => snapshot,
      refresh: refresh,
    );
    releaseRefresh.complete();

    final results = await Future.wait([first, second]);
    expect(refreshCalls, 1);
    expect(results.every((result) => result.isAuthenticated), isTrue);
  });
}
