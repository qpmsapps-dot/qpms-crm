import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import '../models/fo_models.dart';
import 'config_service.dart';
import 'supabase_service.dart';

bool isInvalidOrExpiredAccessTokenResponse({
  required int statusCode,
  required String body,
}) {
  if (statusCode != HttpStatus.unauthorized) return false;
  var evidence = body.toLowerCase();
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map) {
      evidence = [
        decoded['code'],
        decoded['error_code'],
        decoded['error'],
        decoded['message'],
      ].whereType<Object>().join(' ').toLowerCase();
    }
  } catch (_) {
    // The backend normally returns JSON; retain the raw body for matching.
  }
  return evidence.contains('token') &&
      (evidence.contains('invalid') || evidence.contains('expired'));
}

class _CheckInHttpResponse {
  const _CheckInHttpResponse({
    required this.statusCode,
    required this.contentType,
    required this.body,
  });

  final int statusCode;
  final String? contentType;
  final String body;
}

class CheckInValidationException implements Exception {
  const CheckInValidationException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CheckInValidationEvidence {
  const CheckInValidationEvidence({
    required this.siteLatitude,
    required this.siteLongitude,
    required this.measuredDistanceMeters,
    required this.minimumPlausibleDistanceMeters,
    required this.accuracyMeters,
    required this.gpsTimestamp,
    required this.radiusOutcome,
    required this.warningCategory,
  });

  final double siteLatitude;
  final double siteLongitude;
  final double measuredDistanceMeters;
  final double minimumPlausibleDistanceMeters;
  final double accuracyMeters;
  final DateTime gpsTimestamp;
  final String radiusOutcome;
  final String? warningCategory;

  factory CheckInValidationEvidence.fromJson(Map<String, dynamic> json) {
    double number(String key) {
      final value = json[key];
      final parsed = value is num
          ? value.toDouble()
          : double.tryParse(value?.toString() ?? '');
      if (parsed == null || !parsed.isFinite) {
        throw FormatException('Invalid backend Check-In field: $key');
      }
      return parsed;
    }

    final timestamp = DateTime.tryParse(
      json['gps_timestamp']?.toString() ?? '',
    );
    if (timestamp == null) {
      throw const FormatException('Invalid backend Check-In GPS timestamp.');
    }
    return CheckInValidationEvidence(
      siteLatitude: number('site_latitude'),
      siteLongitude: number('site_longitude'),
      measuredDistanceMeters: number('calculated_distance_meters'),
      minimumPlausibleDistanceMeters: number(
        'minimum_plausible_distance_meters',
      ),
      accuracyMeters: number('accuracy_meters'),
      gpsTimestamp: timestamp.toUtc(),
      radiusOutcome: json['radius_outcome']?.toString() ?? '',
      warningCategory: json['warning_category']?.toString(),
    );
  }
}

class FoCheckInValidationService {
  const FoCheckInValidationService._();

  static Map<String, dynamic> decodeResponse({
    required int statusCode,
    required String? contentType,
    required String body,
  }) {
    final normalizedContentType = (contentType ?? '')
        .split(';')
        .first
        .trim()
        .toLowerCase();
    final isJson =
        normalizedContentType == 'application/json' ||
        normalizedContentType.endsWith('+json');
    if (!isJson) {
      throw CheckInValidationException(
        'Check-In service returned an invalid server response (HTTP $statusCode)',
      );
    }

    Map<String, dynamic> json;
    try {
      final decoded = body.trim().isEmpty
          ? <String, dynamic>{}
          : jsonDecode(body);
      if (decoded is! Map) throw const FormatException();
      json = Map<String, dynamic>.from(decoded);
    } on FormatException {
      throw CheckInValidationException(
        'Check-In service returned an invalid server response (HTTP $statusCode)',
      );
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw CheckInValidationException(
        json['message']?.toString().trim().isNotEmpty == true
            ? json['message'].toString()
            : 'Check-In service request failed (HTTP $statusCode)',
      );
    }
    return json;
  }

  static Future<CheckInValidationEvidence> validate({
    required FoUser user,
    required String storeId,
    required double latitude,
    required double longitude,
    required double accuracy,
    required DateTime gpsTimestamp,
  }) async {
    final baseUrl = AppConfig.backendApiUrl.trim();
    if (baseUrl.isEmpty) {
      throw StateError(
        'Secure Check-In validation is unavailable. Please sign in again and retry.',
      );
    }
    var session = await SupabaseService.requireAuthenticatedSession(
      user,
      screen: 'tasks',
      action: 'CHECKIN_VALIDATION_AUTH_SESSION_INVALID',
    );
    final base = Uri.parse(baseUrl);
    final cleanBasePath = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    final uri = base.replace(
      path: '$cleanBasePath/api/fo/site-visits/validate-checkin-location',
    );
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final payload = <String, dynamic>{
        'store_id': storeId,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'gps_timestamp': gpsTimestamp.toUtc().toIso8601String(),
      };
      var response = await _sendValidationRequest(
        client: client,
        uri: uri,
        accessToken: session.accessToken,
        payload: payload,
      );
      if (isInvalidOrExpiredAccessTokenResponse(
        statusCode: response.statusCode,
        body: response.body,
      )) {
        session = await SupabaseService.requireAuthenticatedSession(
          user,
          screen: 'tasks',
          action: 'CHECKIN_VALIDATION_401_AUTH_SESSION_INVALID',
          forceRefresh: true,
        );
        response = await _sendValidationRequest(
          client: client,
          uri: uri,
          accessToken: session.accessToken,
          payload: payload,
        );
        if (isInvalidOrExpiredAccessTokenResponse(
          statusCode: response.statusCode,
          body: response.body,
        )) {
          throw const AuthSessionExpiredException();
        }
      }
      final json = decodeResponse(
        statusCode: response.statusCode,
        contentType: response.contentType,
        body: response.body,
      );
      final evidence = json['evidence'];
      if (evidence is! Map) {
        throw CheckInValidationException(
          'Check-In service returned an invalid server response (HTTP ${response.statusCode})',
        );
      }
      try {
        return CheckInValidationEvidence.fromJson(
          Map<String, dynamic>.from(evidence),
        );
      } on FormatException {
        throw CheckInValidationException(
          'Check-In service returned an invalid server response (HTTP ${response.statusCode})',
        );
      }
    } finally {
      client.close(force: true);
    }
  }

  static Future<_CheckInHttpResponse> _sendValidationRequest({
    required HttpClient client,
    required Uri uri,
    required String accessToken,
    required Map<String, dynamic> payload,
  }) async {
    developer.log(
      'request method=POST url=$uri path=${uri.path}',
      name: 'FO Check-In',
    );
    final request = await client.postUrl(uri);
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $accessToken');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(payload));
    final response = await request.close().timeout(const Duration(seconds: 25));
    final text = await response.transform(utf8.decoder).join();
    final contentType = response.headers.contentType?.mimeType;
    final responsePreview = text.replaceAll(RegExp(r'[\r\n\t]+'), ' ').trim();
    developer.log(
      'response url=$uri status=${response.statusCode} '
      'content_type=${contentType ?? 'missing'} '
      'body_preview=${responsePreview.substring(0, responsePreview.length > 200 ? 200 : responsePreview.length)}',
      name: 'FO Check-In',
    );
    return _CheckInHttpResponse(
      statusCode: response.statusCode,
      contentType: contentType,
      body: text,
    );
  }
}
