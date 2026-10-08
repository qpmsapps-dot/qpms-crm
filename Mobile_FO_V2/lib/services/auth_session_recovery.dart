import 'dart:convert';

int? accessTokenExpiryEpochSeconds(String? accessToken) {
  final token = accessToken?.trim() ?? '';
  final parts = token.split('.');
  if (parts.length != 3 || parts[1].isEmpty) return null;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    if (payload is! Map) return null;
    final expiry = payload['exp'];
    if (expiry is int) return expiry;
    if (expiry is num) return expiry.toInt();
    return int.tryParse(expiry?.toString() ?? '');
  } catch (_) {
    return null;
  }
}

class AuthSessionSnapshot {
  const AuthSessionSnapshot({
    required this.supabaseReady,
    required this.sessionPresent,
    required this.currentUserPresent,
    required this.accessTokenPresent,
    required this.sessionExpired,
    this.sessionExpiringSoon = false,
    required this.identityMatches,
  });

  final bool supabaseReady;
  final bool sessionPresent;
  final bool currentUserPresent;
  final bool accessTokenPresent;
  final bool sessionExpired;
  final bool sessionExpiringSoon;
  final bool identityMatches;

  bool get isAuthenticated =>
      supabaseReady &&
      sessionPresent &&
      currentUserPresent &&
      accessTokenPresent &&
      !sessionExpired &&
      !sessionExpiringSoon &&
      identityMatches;
}

class AuthSessionRecoveryResult {
  const AuthSessionRecoveryResult({
    required this.snapshot,
    required this.recoveryAttempted,
    required this.recoverySucceeded,
  });

  final AuthSessionSnapshot snapshot;
  final bool recoveryAttempted;
  final bool recoverySucceeded;

  bool get isAuthenticated => snapshot.isAuthenticated && recoverySucceeded;
}

typedef AuthSessionSnapshotReader = AuthSessionSnapshot Function();
typedef AuthSessionRefresh = Future<void> Function();

/// Coordinates one bounded recovery attempt and shares it between concurrent
/// callers so lifecycle events and repeated button taps cannot cause a refresh
/// storm.
class AuthSessionRecoveryCoordinator {
  Future<AuthSessionRecoveryResult>? _inFlight;

  Future<AuthSessionRecoveryResult> validate({
    required AuthSessionSnapshotReader readSnapshot,
    required AuthSessionRefresh refresh,
    bool forceRefresh = false,
  }) {
    final initial = readSnapshot();
    if (initial.isAuthenticated && !forceRefresh) {
      return Future.value(
        AuthSessionRecoveryResult(
          snapshot: initial,
          recoveryAttempted: false,
          recoverySucceeded: true,
        ),
      );
    }
    if (!initial.supabaseReady) {
      return Future.value(
        AuthSessionRecoveryResult(
          snapshot: initial,
          recoveryAttempted: false,
          recoverySucceeded: false,
        ),
      );
    }
    return _inFlight ??= _recover(
      readSnapshot: readSnapshot,
      refresh: refresh,
    ).whenComplete(() => _inFlight = null);
  }

  Future<AuthSessionRecoveryResult> _recover({
    required AuthSessionSnapshotReader readSnapshot,
    required AuthSessionRefresh refresh,
  }) async {
    try {
      await refresh();
    } catch (_) {
      final snapshot = readSnapshot();
      return AuthSessionRecoveryResult(
        snapshot: snapshot,
        recoveryAttempted: true,
        recoverySucceeded: false,
      );
    }
    final snapshot = readSnapshot();
    return AuthSessionRecoveryResult(
      snapshot: snapshot,
      recoveryAttempted: true,
      recoverySucceeded: snapshot.isAuthenticated,
    );
  }
}
