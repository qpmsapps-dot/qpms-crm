import 'dart:convert';
import 'dart:io';
import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import 'app_config.dart';
import '../models/hospital_location_models.dart';

class HospitalApiException implements Exception {
  const HospitalApiException(this.message, {this.code = '', this.statusCode});
  final String message;
  final String code;
  final int? statusCode;
  @override
  String toString() => message;
}

class HospitalTicketApi {
  static Future<List<HospitalBlock>> loadBlocks() async {
    final response = await request('GET', '/api/hospital-tickets/blocks');
    return _rows(response['blocks']).map(HospitalBlock.fromJson).toList();
  }

  static Future<List<HospitalFloor>> loadFloors(String blockId) async {
    final response = await request(
      'GET',
      '/api/hospital-tickets/floors',
      query: {'block_id': blockId},
    );
    return _rows(response['floors']).map(HospitalFloor.fromJson).toList();
  }

  static Future<List<HospitalDepartment>> loadDepartments(
    String blockId, {
    String? floorId,
  }) async {
    final query = {'block_id': blockId};
    if (floorId != null && floorId.isNotEmpty) query['floor_id'] = floorId;
    final response = await request(
      'GET',
      '/api/hospital-tickets/departments',
      query: query,
    );
    return _rows(
      response['departments'],
    ).map(HospitalDepartment.fromJson).toList();
  }

  static Future<List<HospitalLocation>> loadHierarchyLocations(
    String blockId, {
    String? floorId,
    String? departmentId,
  }) async {
    final query = {'block_id': blockId};
    if (floorId != null && floorId.isNotEmpty) query['floor_id'] = floorId;
    if (departmentId != null && departmentId.isNotEmpty) {
      query['department_id'] = departmentId;
    }
    final response = await request(
      'GET',
      '/api/hospital-tickets/hierarchy/locations',
      query: query,
    );
    return _rows(response['locations']).map(HospitalLocation.fromJson).toList();
  }

  static Future<Map<String, List<Object>>> loadCompleteHierarchy() async {
    final response = await request('GET', '/api/hospital-tickets/hierarchy');
    final hierarchy = response['hierarchy'] is Map
        ? Map<String, dynamic>.from(response['hierarchy'] as Map)
        : <String, dynamic>{};
    return {
      'blocks': _rows(hierarchy['blocks']).map(HospitalBlock.fromJson).toList(),
      'floors': _rows(hierarchy['floors']).map(HospitalFloor.fromJson).toList(),
      'departments': _rows(
        hierarchy['departments'],
      ).map(HospitalDepartment.fromJson).toList(),
      'locations': _rows(
        hierarchy['locations'],
      ).map(HospitalLocation.fromJson).toList(),
    };
  }

  static Future<void> uploadPhoto({
    required String ticketId,
    required String filePath,
    required String attachmentType,
  }) async {
    final file = File(filePath);
    final lower = filePath.toLowerCase();
    final mime = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    final sign = await request(
      'POST',
      '/api/hospital-tickets/$ticketId/attachments/sign-upload',
      body: {'attachment_type': attachmentType, 'mime_type': mime},
    );
    final uploadClient = HttpClient();
    try {
      final upload = await uploadClient.putUrl(
        Uri.parse('${sign['signed_url']}'),
      );
      upload.headers.set(HttpHeaders.contentTypeHeader, mime);
      upload.add(await file.readAsBytes());
      final response = await upload.close().timeout(
        const Duration(seconds: 45),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const HospitalApiException(
          'Photo upload failed. Please retry.',
          code: 'upload_failed',
        );
      }
    } finally {
      uploadClient.close(force: true);
    }
    await request(
      'POST',
      '/api/hospital-tickets/$ticketId/attachments/complete',
      body: {
        'storage_path': sign['storage_path'],
        'attachment_type': attachmentType,
        'original_filename': file.uri.pathSegments.last,
        'mime_type': mime,
        'size_bytes': await file.length(),
        'is_client_visible': true,
      },
    );
  }

  static Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    Map<String, String>? headers,
  }) async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) {
      throw const HospitalApiException(
        'Your session expired. Please sign in again.',
        code: 'session_expired',
        statusCode: 401,
      );
    }
    final base = ClientAppConfig.backendApiUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base$path').replace(
      queryParameters: query?.map((key, value) => MapEntry(key, value)),
    );
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client.openUrl(method, uri);
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${session.accessToken}',
      );
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      headers?.forEach(request.headers.set);
      if (body != null) request.write(jsonEncode(body));
      final response = await request.close().timeout(
        const Duration(seconds: 30),
      );
      final text = await response.transform(utf8.decoder).join();
      final decoded = text.isEmpty
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(text) as Map);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HospitalApiException(
          '${decoded['message'] ?? 'Request failed. Please try again.'}',
          code: '${decoded['code'] ?? ''}',
          statusCode: response.statusCode,
        );
      }
      return decoded;
    } on HospitalApiException {
      rethrow;
    } on TimeoutException {
      throw const HospitalApiException(
        'The request timed out. Your complaint can be retried safely.',
        code: 'timeout',
      );
    } catch (_) {
      throw const HospitalApiException(
        'Unable to reach QPMS. Check your connection and try again.',
        code: 'network_error',
      );
    } finally {
      client.close(force: true);
    }
  }

  static List<Map<String, dynamic>> _rows(dynamic value) => value is List
      ? value
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList()
      : const [];
}
