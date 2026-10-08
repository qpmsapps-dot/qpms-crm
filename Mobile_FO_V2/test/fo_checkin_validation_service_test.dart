import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/services/fo_checkin_validation_service.dart';

void main() {
  test('recognizes only invalid or expired token 401 responses', () {
    expect(
      isInvalidOrExpiredAccessTokenResponse(
        statusCode: 401,
        body: '{"message":"Invalid or expired Supabase access token."}',
      ),
      isTrue,
    );
    expect(
      isInvalidOrExpiredAccessTokenResponse(
        statusCode: 400,
        body: '{"message":"Invalid or expired Supabase access token."}',
      ),
      isFalse,
    );
    expect(
      isInvalidOrExpiredAccessTokenResponse(
        statusCode: 401,
        body: '{"message":"User Management permission required."}',
      ),
      isFalse,
    );
  });

  test('Check-In API performs one forced refresh and one retry only', () {
    final source = File(
      'lib/services/fo_checkin_validation_service.dart',
    ).readAsStringSync();
    final start = source.indexOf(
      'static Future<CheckInValidationEvidence> validate',
    );
    final end = source.indexOf(
      'static Future<_CheckInHttpResponse> _sendValidationRequest',
      start,
    );
    final validate = source.substring(start, end);

    expect(validate, contains('requireAuthenticatedSession'));
    expect(validate, contains('forceRefresh: true'));
    expect(RegExp(r'_sendValidationRequest\(').allMatches(validate).length, 2);
    expect(validate, contains('accessToken: session.accessToken'));
    expect(validate, contains('throw const AuthSessionExpiredException()'));
    expect(validate, isNot(contains('while (')));
  });

  group('FoCheckInValidationService.decodeResponse', () {
    test('accepts an authenticated JSON success response', () {
      final result = FoCheckInValidationService.decodeResponse(
        statusCode: 200,
        contentType: 'application/json',
        body: '{"ok":true,"evidence":{}}',
      );

      expect(result['ok'], isTrue);
    });

    test('preserves the JSON authentication error', () {
      expect(
        () => FoCheckInValidationService.decodeResponse(
          statusCode: 401,
          contentType: 'application/json; charset=utf-8',
          body: '{"ok":false,"message":"Invalid or expired token."}',
        ),
        throwsA(
          isA<CheckInValidationException>().having(
            (error) => error.message,
            'message',
            'Invalid or expired token.',
          ),
        ),
      );
    });

    test('preserves an invalid-store JSON error', () {
      expect(
        () => FoCheckInValidationService.decodeResponse(
          statusCode: 404,
          contentType: 'application/json',
          body: '{"ok":false,"message":"Store was not found."}',
        ),
        throwsA(
          isA<CheckInValidationException>().having(
            (error) => error.message,
            'message',
            'Store was not found.',
          ),
        ),
      );
    });

    test('preserves a backend validation JSON error', () {
      expect(
        () => FoCheckInValidationService.decodeResponse(
          statusCode: 400,
          contentType: 'application/json',
          body: '{"ok":false,"message":"GPS accuracy is required."}',
        ),
        throwsA(
          isA<CheckInValidationException>().having(
            (error) => error.message,
            'message',
            'GPS accuracy is required.',
          ),
        ),
      );
    });

    test('does not attempt to decode an HTML 404 response', () {
      expect(
        () => FoCheckInValidationService.decodeResponse(
          statusCode: 404,
          contentType: 'text/html; charset=utf-8',
          body: '<!DOCTYPE html><html><body>Cannot POST</body></html>',
        ),
        throwsA(
          isA<CheckInValidationException>().having(
            (error) => error.message,
            'message',
            'Check-In service returned an invalid server response (HTTP 404)',
          ),
        ),
      );
    });
  });
}
