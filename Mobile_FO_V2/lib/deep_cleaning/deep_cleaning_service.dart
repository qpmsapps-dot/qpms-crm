import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../services/config_service.dart';
import '../services/supabase_service.dart';
import 'deep_cleaning_models.dart';

class DeepCleaningApiException implements Exception {
  const DeepCleaningApiException(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => message;
}

class DeepCleaningListResult {
  const DeepCleaningListResult({
    required this.rows,
    required this.page,
    required this.limit,
    required this.total,
  });

  final List<DeepCleaningSubmission> rows;
  final int page;
  final int limit;
  final int total;
}

class DeepCleaningScheduleListResult {
  const DeepCleaningScheduleListResult({
    required this.rows,
    required this.page,
    required this.limit,
    required this.total,
  });

  final List<DeepCleaningSchedule> rows;
  final int page;
  final int limit;
  final int total;
}

class DeepCleaningService {
  const DeepCleaningService({this.backendUrl, this.accessToken});
  final String? backendUrl;
  final String? Function()? accessToken;

  Future<DeepCleaningScheduleListResult> listSchedules({
    int page = 1,
    int limit = 50,
    String? month,
    String? status,
  }) async {
    final json = await _request(
      'GET',
      '/api/client-deep-cleaning/schedules',
      query: {
        'page': '$page',
        'limit': '$limit',
        if (month?.trim().isNotEmpty == true) 'month': month!.trim(),
        if (status?.trim().isNotEmpty == true) 'status': status!.trim(),
      },
    );
    if (json['contract_version'] != 'retail-cleaning.v1') {
      throw const DeepCleaningApiException(
        'Schedule delivery requires a compatible backend.',
      );
    }
    final pagination = json['pagination'] is Map
        ? Map<String, dynamic>.from(json['pagination'] as Map)
        : const <String, dynamic>{};
    return DeepCleaningScheduleListResult(
      rows: (json['rows'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (row) =>
                DeepCleaningSchedule.fromJson(Map<String, dynamic>.from(row)),
          )
          .toList(),
      page: _int(pagination['page'], fallback: page),
      limit: _int(pagination['limit'], fallback: limit),
      total: _int(pagination['total']),
    );
  }

  Future<DeepCleaningSubmission> createDraft({
    required String storeCode,
    required String deepCleaningDate,
    String? vendorName,
    String? remarks,
  }) async {
    final body = <String, dynamic>{
      'store_code': storeCode,
      'deep_cleaning_date': deepCleaningDate,
      'evidence_format': 'paired_v1',
    };
    if (vendorName != null) body['vendor_name'] = vendorName;
    if (remarks != null) body['remarks'] = remarks;
    final json = await _request(
      'POST',
      '/api/client-deep-cleaning/submissions',
      body: body,
    );
    return DeepCleaningSubmission.fromJson(
      Map<String, dynamic>.from(json['submission'] as Map),
    );
  }

  Future<DeepCleaningSubmission> createScheduledDraft({
    required String scheduleId,
    String? remarks,
  }) async {
    final body = <String, dynamic>{'schedule_id': scheduleId};
    if (remarks != null) body['remarks'] = remarks;
    final json = await _request(
      'POST',
      '/api/client-deep-cleaning/submissions',
      body: body,
    );
    return DeepCleaningSubmission.fromJson(
      Map<String, dynamic>.from(json['submission'] as Map),
    );
  }

  Future<DeepCleaningSubmission?> findSubmissionForSchedule(
    String scheduleId,
  ) async {
    const limit = 100;
    var page = 1;
    while (true) {
      final result = await listSubmissions(page: page, limit: limit);
      for (final submission in result.rows) {
        if (submission.scheduleId == scheduleId) {
          return getSubmission(submission.id);
        }
      }
      if (page * result.limit >= result.total || result.rows.isEmpty) {
        return null;
      }
      page += 1;
    }
  }

  Future<DeepCleaningListResult> listSubmissions({
    int page = 1,
    int limit = 25,
    String? status,
    String? storeCode,
  }) async {
    final json = await _request(
      'GET',
      '/api/client-deep-cleaning/submissions',
      query: {
        'page': '$page',
        'limit': '$limit',
        if (status?.trim().isNotEmpty == true) 'status': status!.trim(),
        if (storeCode?.trim().isNotEmpty == true)
          'store_code': storeCode!.trim(),
      },
    );
    final pagination = json['pagination'] is Map
        ? Map<String, dynamic>.from(json['pagination'] as Map)
        : const <String, dynamic>{};
    return DeepCleaningListResult(
      rows: (json['rows'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (row) =>
                DeepCleaningSubmission.fromJson(Map<String, dynamic>.from(row)),
          )
          .toList(),
      page: _int(pagination['page'], fallback: page),
      limit: _int(pagination['limit'], fallback: limit),
      total: _int(pagination['total']),
    );
  }

  Future<DeepCleaningSubmission> getSubmission(String id) async {
    final json = await _request(
      'GET',
      '/api/client-deep-cleaning/submissions/$id',
    );
    return DeepCleaningSubmission.fromJson(
      Map<String, dynamic>.from(json['submission'] as Map),
    );
  }

  Future<DeepCleaningSubmission> updateDraft({
    required String id,
    String? storeCode,
    String? deepCleaningDate,
    String? vendorName,
    String? remarks,
  }) async {
    final body = <String, dynamic>{};
    if (storeCode != null) body['store_code'] = storeCode;
    if (deepCleaningDate != null) body['deep_cleaning_date'] = deepCleaningDate;
    if (vendorName != null) body['vendor_name'] = vendorName;
    if (remarks != null) body['remarks'] = remarks;
    final json = await _request(
      'PATCH',
      '/api/client-deep-cleaning/submissions/$id',
      body: body,
    );
    return DeepCleaningSubmission.fromJson(
      Map<String, dynamic>.from(json['submission'] as Map),
    );
  }

  Future<DeepCleaningUploadIntent> requestUploadUrl({
    required String submissionId,
    required DeepCleaningUploadType uploadType,
    required String filename,
    required String mimeType,
    required int fileSize,
    String? pairId,
    int? pairOrder,
    String? uploadId,
  }) async {
    final body = <String, dynamic>{
      'upload_type': uploadType.apiValue,
      'filename': filename,
      'mime_type': mimeType,
      'file_size': fileSize,
    };
    if (pairId != null) body['pair_id'] = pairId;
    if (uploadId != null) body['upload_id'] = uploadId;
    if (pairOrder != null) body['pair_order'] = pairOrder;
    final json = await _request(
      'POST',
      '/api/client-deep-cleaning/submissions/$submissionId/upload-url',
      body: body,
    );
    return DeepCleaningUploadIntent.fromJson(
      Map<String, dynamic>.from(json['upload'] as Map),
    );
  }

  Future<void> uploadToSignedUrl({
    required DeepCleaningUploadIntent intent,
    required File file,
    void Function(double progress)? onProgress,
  }) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 20);
    try {
      final request = await client.putUrl(Uri.parse(intent.signedUrl));
      request.headers.contentType = ContentType.parse(intent.mimeType);
      request.contentLength = await file.length();
      var sent = 0;
      await for (final chunk in file.openRead()) {
        request.add(chunk);
        sent += chunk.length;
        onProgress?.call(sent / request.contentLength);
      }
      final response = await request.close().timeout(
        const Duration(seconds: 60),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const DeepCleaningApiException(
          'Upload failed. Please retry this file.',
        );
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<DeepCleaningUpload> completeUpload({
    required String submissionId,
    required DeepCleaningUploadIntent intent,
    required String originalFilename,
    required int fileSize,
  }) async {
    final json = await _request(
      'POST',
      '/api/client-deep-cleaning/submissions/$submissionId/uploads/complete',
      body: {
        'upload_id': intent.uploadId,
        'upload_type': intent.uploadType.apiValue,
        'storage_bucket': intent.storageBucket,
        'storage_path': intent.storagePath,
        'filename': originalFilename,
        'mime_type': intent.mimeType,
        'file_size': fileSize,
      },
    );
    return DeepCleaningUpload.fromJson(
      Map<String, dynamic>.from(json['upload'] as Map),
    );
  }

  Future<void> deleteUpload({
    required String submissionId,
    required String uploadId,
  }) async {
    await _request(
      'DELETE',
      '/api/client-deep-cleaning/submissions/$submissionId/uploads/$uploadId',
    );
  }

  Future<DeepCleaningSubmission> submitSubmission(
    String id, {
    String? outcome,
    String? notDoneReason,
  }) async {
    final body = <String, dynamic>{};
    if (outcome != null) body['outcome'] = outcome;
    if (notDoneReason != null) body['not_done_reason'] = notDoneReason;
    final json = await _request(
      'POST',
      '/api/client-deep-cleaning/submissions/$id/submit',
      body: body.isEmpty ? null : body,
    );
    return DeepCleaningSubmission.fromJson(
      Map<String, dynamic>.from(json['submission'] as Map),
    );
  }

  Future<RelianceDeepCleaningStoreResult> searchRelianceStores({
    String query = '',
    String? zoneId,
    int page = 1,
    int limit = 20,
  }) async {
    final json = await _request(
      'GET',
      '/api/client-deep-cleaning/stores',
      query: {
        if (query.trim().isNotEmpty) 'q': query.trim(),
        if (zoneId?.isNotEmpty == true) 'zone_id': zoneId!,
        'page': '$page',
        'limit': '$limit',
      },
    );
    final pagination = json['pagination'] is Map
        ? Map<String, dynamic>.from(json['pagination'] as Map)
        : const <String, dynamic>{};
    return RelianceDeepCleaningStoreResult(
      rows: (json['rows'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (row) => RelianceDeepCleaningStore.fromJson(
              Map<String, dynamic>.from(row),
            ),
          )
          .toList(),
      zones: (json['zones'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (row) => DeepCleaningZone.fromJson(Map<String, dynamic>.from(row)),
          )
          .toList(),
      page: _int(pagination['page'], fallback: page),
      limit: _int(pagination['limit'], fallback: limit),
      total: _int(pagination['total']),
    );
  }

  Future<DeepCleaningViewUrl> viewUploadUrl({
    required String submissionId,
    required String uploadId,
  }) async {
    final json = await _request(
      'GET',
      '/api/client-deep-cleaning/submissions/$submissionId/uploads/$uploadId/view-url',
    );
    return DeepCleaningViewUrl.fromJson(
      Map<String, dynamic>.from(json['view'] as Map),
    );
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String> query = const {},
    Map<String, dynamic>? body,
  }) async {
    final baseUrl = (backendUrl ?? AppConfig.backendApiUrl).trim();
    if (baseUrl.isEmpty) {
      throw const DeepCleaningApiException(
        'Deep Cleaning service is not configured. Please contact admin.',
      );
    }
    final token = accessToken == null
        ? SupabaseService.currentAccessToken
        : accessToken!();
    if (token == null || token.trim().isEmpty) {
      throw const DeepCleaningApiException(
        'Your session has expired. Please sign in again.',
        code: 'session_expired',
      );
    }
    final base = Uri.parse(baseUrl);
    final uri = base.replace(
      path: _joinPath(base.path, path),
      queryParameters: query.isEmpty ? null : query,
    );
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client.openUrl(method, uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(
        const Duration(seconds: 35),
      );
      final text = await response.transform(utf8.decoder).join();
      final decoded = text.trim().isEmpty
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(text) as Map);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw DeepCleaningApiException(
          _friendlyMessage(response.statusCode, decoded['message']),
          code: decoded['code']?.toString(),
        );
      }
      return decoded;
    } on DeepCleaningApiException {
      rethrow;
    } catch (_) {
      throw const DeepCleaningApiException(
        'Unable to reach Deep Cleaning service. Please check internet and try again.',
      );
    } finally {
      client.close(force: true);
    }
  }

  String _joinPath(String basePath, String childPath) {
    final cleanBase = basePath.endsWith('/')
        ? basePath.substring(0, basePath.length - 1)
        : basePath;
    final cleanChild = childPath.startsWith('/')
        ? childPath.substring(1)
        : childPath;
    if (cleanBase.isEmpty) return '/$cleanChild';
    return '$cleanBase/$cleanChild';
  }

  String _friendlyMessage(int statusCode, Object? message) {
    if (statusCode == 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (statusCode == 403) {
      return 'You are not authorised for Reliance Retail Deep Cleaning.';
    }
    if (statusCode == 404) return 'Deep Cleaning record was not found.';
    if (statusCode == 409) {
      return message?.toString() ?? 'Please refresh and try again.';
    }
    if (statusCode == 422 || statusCode == 400) {
      return message?.toString() ?? 'Please check the details and try again.';
    }
    return 'Deep Cleaning request failed. Please try again.';
  }
}

typedef DeepCleaningStorePageLoader =
    Future<RelianceDeepCleaningStoreResult> Function({
      required String query,
      String? zoneId,
      required int page,
      required int limit,
    });

class DeepCleaningStorePager extends ChangeNotifier {
  DeepCleaningStorePager({
    required DeepCleaningStorePageLoader loadPage,
    this.limit = 20,
  }) : _loadPage = loadPage;

  final DeepCleaningStorePageLoader _loadPage;
  final int limit;
  final stores = <RelianceDeepCleaningStore>[];
  var zones = <DeepCleaningZone>[];
  String query = '';
  String? zoneId;
  String? error;
  int total = 0;
  int page = 0;
  bool loading = false;
  bool loadingMore = false;
  bool loaded = false;
  bool _hasMore = false;
  int _generation = 0;

  @override
  void dispose() {
    _generation += 1;
    super.dispose();
  }

  bool get hasMore => _hasMore;

  Future<void> reset({String query = '', String? zoneId}) {
    _generation += 1;
    this.query = query.trim();
    this.zoneId = zoneId;
    stores.clear();
    page = 0;
    total = 0;
    error = null;
    loaded = false;
    _hasMore = false;
    loading = false;
    loadingMore = false;
    notifyListeners();
    return _fetch(1, _generation);
  }

  Future<void> loadMore() {
    if (loading || loadingMore || error != null || !_hasMore) {
      return Future.value();
    }
    return _fetch(page + 1, _generation);
  }

  Future<void> retry() {
    if (loading || loadingMore) return Future.value();
    return _fetch(page == 0 ? 1 : page + 1, _generation);
  }

  Future<void> _fetch(int requestedPage, int generation) async {
    if (requestedPage == 1) {
      loading = true;
    } else {
      loadingMore = true;
    }
    error = null;
    notifyListeners();
    try {
      final result = await _loadPage(
        query: query,
        zoneId: zoneId,
        page: requestedPage,
        limit: limit,
      );
      if (generation != _generation) return;
      if (requestedPage == 1) zones = result.zones;
      final seen = stores.map((store) => store.id).toSet();
      for (final store in result.rows) {
        if (seen.add(store.id)) stores.add(store);
      }
      page = result.page;
      total = result.total;
      loaded = true;
      _hasMore = result.rows.isNotEmpty && page * result.limit < total;
    } catch (failure) {
      if (generation != _generation) return;
      error = failure is DeepCleaningApiException
          ? failure.message
          : 'Unable to load stores. Please try again.';
    } finally {
      if (generation == _generation) {
        loading = false;
        loadingMore = false;
        notifyListeners();
      }
    }
  }
}

int _int(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse('${value ?? ''}'.trim()) ?? fallback;
}
