import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../../models/fo_models.dart';
import '../../services/config_service.dart';
import '../../services/supabase_service.dart';
import '../models/training_attendee.dart';
import '../models/training_category.dart';
import '../models/training_evidence.dart';
import '../models/training_session.dart';
import '../models/training_session_topic.dart';
import '../models/training_topic.dart';
import '../models/training_type.dart';
import 'training_errors.dart';

class TrainingHttpResponse {
  const TrainingHttpResponse(this.statusCode, this.body);
  final int statusCode;
  final Map<String, dynamic> body;
}

abstract class TrainingTransport {
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  });
  Future<void> upload(String signedUrl, Uint8List bytes, String mimeType);
}

class AuthenticatedTrainingTransport implements TrainingTransport {
  AuthenticatedTrainingTransport(this.user, {HttpClient? client})
    : _client = client ?? HttpClient();
  final FoUser user;
  final HttpClient _client;
  static const _jsonTimeout = Duration(seconds: 35);
  static const _uploadTimeout = Duration(seconds: 90);

  @override
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    try {
      var session = await SupabaseService.requireAuthenticatedSession(
        user,
        screen: 'StructuredTraining',
        action: method.toUpperCase(),
      );
      final base = AppConfig.backendApiUrl.trim().replaceFirst(
        RegExp(r'/+$'),
        '',
      );
      if (base.isEmpty) {
        throw const TrainingTransportException(
          'Backend API is not configured.',
        );
      }
      final uri = Uri.parse(
        '$base$path',
      ).replace(queryParameters: query?.isEmpty == true ? null : query);
      var response = await _sendOnce(method, uri, session.accessToken, body);
      if (response.statusCode == HttpStatus.unauthorized) {
        await SupabaseService.client.auth.refreshSession().timeout(
          const Duration(seconds: 15),
        );
        session = await SupabaseService.requireAuthenticatedSession(
          user,
          screen: 'StructuredTraining',
          action: '${method.toUpperCase()}_AUTH_RETRY',
        );
        response = await _sendOnce(method, uri, session.accessToken, body);
      }
      return response;
    } on TrainingException {
      rethrow;
    } on AuthSessionExpiredException {
      throw const TrainingAuthException(
        'Your login session expired. Please login again.',
      );
    } on SocketException catch (_) {
      throw const TrainingTransportException(
        'Unable to reach the Training service.',
      );
    } on TimeoutException catch (_) {
      throw const TrainingTransportException('Training request timed out.');
    } on FormatException catch (_) {
      throw const TrainingServerException(
        'Training service returned an invalid response.',
        retryable: false,
      );
    }
  }

  Future<TrainingHttpResponse> _sendOnce(
    String method,
    Uri uri,
    String accessToken,
    Map<String, dynamic>? body,
  ) async {
    final request = await _client.openUrl(method, uri).timeout(_jsonTimeout);
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $accessToken');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close().timeout(_jsonTimeout);
    final text = await utf8.decoder.bind(response).join().timeout(_jsonTimeout);
    final decoded = text.trim().isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(text) as Map);
    return TrainingHttpResponse(response.statusCode, decoded);
  }

  @override
  Future<void> upload(
    String signedUrl,
    Uint8List bytes,
    String mimeType,
  ) async {
    try {
      final request = await _client
          .putUrl(Uri.parse(signedUrl))
          .timeout(_uploadTimeout);
      request.headers.contentType = ContentType.parse(mimeType);
      request.contentLength = bytes.length;
      request.add(bytes);
      final response = await request.close().timeout(_uploadTimeout);
      await response.drain<void>();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw TrainingUploadException(
          'Evidence upload failed.',
          statusCode: response.statusCode,
          retryable: response.statusCode >= 500,
        );
      }
    } on TrainingException {
      rethrow;
    } on SocketException catch (_) {
      throw const TrainingTransportException(
        'Evidence upload could not reach storage.',
      );
    } on TimeoutException catch (_) {
      throw const TrainingTransportException('Evidence upload timed out.');
    }
  }
}

class TrainingApi {
  TrainingApi({required FoUser user, TrainingTransport? transport})
    : _transport = transport ?? AuthenticatedTrainingTransport(user);
  final TrainingTransport _transport;
  static const _base = '/api/training';

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final response = await _transport.send(
      method,
      '$_base$path',
      query: query,
      body: body,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw mapTrainingError(response.statusCode, response.body);
    }
    return response.body;
  }

  Future<List<TrainingCategory>> getCategories() async =>
      ((await _request('GET', '/categories'))['categories'] as List? ??
              const [])
          .whereType<Map>()
          .map((e) => TrainingCategory.fromJson(Map<String, dynamic>.from(e)))
          .toList();
  Future<List<TrainingType>> getTypes() async =>
      ((await _request('GET', '/types'))['training_types'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => TrainingType.fromJson(Map<String, dynamic>.from(e)))
          .toList();
  Future<List<TrainingTopic>> getTopics({required String categoryId}) async =>
      ((await _request(
                    'GET',
                    '/topics',
                    query: {'category_id': categoryId},
                  ))['topics']
                  as List? ??
              const [])
          .whereType<Map>()
          .map((e) => TrainingTopic.fromJson(Map<String, dynamic>.from(e)))
          .toList();
  Future<List<TrainingStaffSuggestion>> searchSiteStaff({
    required String siteId,
    String? query,
    int? limit,
  }) async {
    final params = <String, String>{'site_id': siteId};
    if (query?.trim().isNotEmpty == true) {
      params['q'] = query!.trim();
    }
    if (limit != null) {
      params['limit'] = '$limit';
    }
    return ((await _request('GET', '/site-staff', query: params))['staff']
                as List? ??
            const [])
        .whereType<Map>()
        .map(
          (e) => TrainingStaffSuggestion.fromJson(Map<String, dynamic>.from(e)),
        )
        .toList();
  }

  Future<TrainingSession> createSession({
    required String attendanceId,
    required String siteVisitId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) async => TrainingSession.fromJson(
    await _request(
      'POST',
      '/sessions',
      body: {
        'attendance_id': attendanceId,
        'site_visit_id': siteVisitId,
        'category_id': categoryId,
        'training_type_id': trainingTypeId,
        'training_date': _date(trainingDate),
        'trainer_name': trainerName.trim(),
        'remarks': _nullable(remarks),
      },
    ),
  );
  Future<TrainingSession> getSession(String id) async =>
      TrainingSession.fromJson(await _request('GET', '/sessions/$id'));
  Future<List<TrainingSession>> getSessions({
    bool? mine,
    String? status,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? categoryId,
    String? storeId,
    int? limit,
  }) async {
    final query = <String, String>{
      if (mine != null) 'mine': '$mine',
      'status': ?status,
      if (dateFrom != null) 'date_from': _date(dateFrom),
      if (dateTo != null) 'date_to': _date(dateTo),
      'category_id': ?categoryId,
      'store_id': ?storeId,
      if (limit != null) 'limit': '$limit',
    };
    return ((await _request('GET', '/sessions', query: query))['sessions']
                as List? ??
            const [])
        .whereType<Map>()
        .map((e) => TrainingSession.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<TrainingSession> updateSession({
    required String sessionId,
    required String categoryId,
    required String trainingTypeId,
    required DateTime trainingDate,
    required String trainerName,
    String? remarks,
  }) async => TrainingSession.fromJson(
    await _request(
      'PATCH',
      '/sessions/$sessionId',
      body: {
        'category_id': categoryId,
        'training_type_id': trainingTypeId,
        'training_date': _date(trainingDate),
        'trainer_name': trainerName.trim(),
        'remarks': _nullable(remarks),
      },
    ),
  );
  Future<TrainingAttendee> addAttendee({
    required String sessionId,
    required String profileId,
  }) async => TrainingAttendee.fromJson(
    Map<String, dynamic>.from(
      (await _request(
            'POST',
            '/sessions/$sessionId/attendees',
            body: {'profile_id': profileId},
          ))['attendee']
          as Map,
    ),
  );
  Future<void> removeAttendee({
    required String sessionId,
    required String attendeeId,
  }) async => _request('DELETE', '/sessions/$sessionId/attendees/$attendeeId');
  Future<void> setTopics({
    required String sessionId,
    required List<String> topicIds,
  }) async => _request(
    'PUT',
    '/sessions/$sessionId/topics',
    body: {'topic_ids': topicIds},
  );
  Future<TrainingSessionTopic> updateSessionTopic({
    required String sessionId,
    required String sessionTopicId,
    required bool isCovered,
    String? remarks,
  }) async => TrainingSessionTopic.fromJson(
    Map<String, dynamic>.from(
      (await _request(
            'PATCH',
            '/sessions/$sessionId/topics/$sessionTopicId',
            body: {'is_covered': isCovered, 'remarks': _nullable(remarks)},
          ))['topic']
          as Map,
    ),
  );
  Future<TrainingEvidenceUploadIntent> createEvidenceUploadIntent({
    required String sessionId,
    required TrainingEvidenceType evidenceType,
    String? sessionTopicId,
    required String fileName,
    required String mimeType,
    required int fileSize,
  }) async => TrainingEvidenceUploadIntent.fromJson(
    Map<String, dynamic>.from(
      (await _request(
            'POST',
            '/sessions/$sessionId/evidence/upload-url',
            body: {
              'evidence_type': evidenceType.wireValue,
              'training_session_topic_id': sessionTopicId,
              'file_name': fileName,
              'mime_type': mimeType,
              'file_size': fileSize,
            },
          ))['upload']
          as Map,
    ),
  );
  Future<void> uploadSigned(
    TrainingEvidenceUploadIntent intent,
    Uint8List bytes,
    String mimeType,
  ) => _transport.upload(intent.signedUploadUrl, bytes, mimeType);
  Future<TrainingEvidence> completeEvidence({
    required String sessionId,
    required String evidenceId,
    required TrainingEvidenceType evidenceType,
    String? sessionTopicId,
    required String fileName,
    required String mimeType,
    required int fileSize,
  }) async => TrainingEvidence.fromJson(
    Map<String, dynamic>.from(
      (await _request(
            'POST',
            '/sessions/$sessionId/evidence/complete',
            body: {
              'evidence_id': evidenceId,
              'evidence_type': evidenceType.wireValue,
              'training_session_topic_id': sessionTopicId,
              'file_name': fileName,
              'mime_type': mimeType,
              'file_size': fileSize,
            },
          ))['evidence']
          as Map,
    ),
  );
  Future<void> deleteEvidence({
    required String sessionId,
    required String evidenceId,
  }) async => _request('DELETE', '/sessions/$sessionId/evidence/$evidenceId');
  Future<TrainingEvidenceView> getEvidenceViewUrl({
    required String sessionId,
    required String evidenceId,
  }) async => TrainingEvidenceView.fromJson(
    Map<String, dynamic>.from(
      (await _request(
            'GET',
            '/sessions/$sessionId/evidence/$evidenceId/view-url',
          ))['view']
          as Map,
    ),
  );
  Future<TrainingSession> submitSession(String id) async =>
      TrainingSession.fromJson(await _request('POST', '/sessions/$id/submit'));
  Future<TrainingSession> cancelSession(String id) async =>
      TrainingSession.fromJson(await _request('POST', '/sessions/$id/cancel'));

  static String _date(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  static String? _nullable(String? value) =>
      value?.trim().isEmpty == true ? null : value?.trim();
}
