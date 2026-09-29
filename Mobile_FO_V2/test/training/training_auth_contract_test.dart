import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'Training transport uses canonical auth and a single bounded 401 retry',
    () {
      final source = File(
        'lib/training/data/training_api.dart',
      ).readAsStringSync();
      expect(source, contains('SupabaseService.requireAuthenticatedSession'));
      expect(source, contains('HttpHeaders.authorizationHeader'));
      expect(source, contains("'Bearer \$accessToken'"));
      expect(
        source,
        contains('response.statusCode == HttpStatus.unauthorized'),
      );
      expect(source, contains('refreshSession().timeout'));
      expect(source, contains("action: '\${method.toUpperCase()}_AUTH_RETRY'"));
    },
  );

  test('Training cache never persists secrets or expiring signed URLs', () {
    final source = File(
      'lib/training/data/training_draft_cache.dart',
    ).readAsStringSync();
    expect(source, isNot(contains('access_token')));
    expect(source, isNot(contains('refresh_token')));
    expect(source, isNot(contains('signed_upload_url')));
    expect(source, isNot(contains('signed_view_url')));
  });
}
