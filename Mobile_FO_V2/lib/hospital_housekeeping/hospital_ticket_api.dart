import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../services/config_service.dart';
import '../services/supabase_service.dart';
import 'hospital_models.dart';

class HospitalTicketApiException implements Exception {
  const HospitalTicketApiException(this.message, {this.code = ''});
  final String message;
  final String code;
  @override
  String toString() => message;
}

class HospitalTicketApi {
  static Future<void> closeSession() => SupabaseService.client.auth.signOut();

  static Future<HospitalDemoSession> login({
    required String email,
    required String password,
  }) async {
    await SupabaseService.client.auth.signInWithPassword(
      email: email.trim().toLowerCase(),
      password: password,
    );
    try {
      return await discoverCurrentInternalSession(emailHint: email);
    } catch (_) {
      await SupabaseService.client.auth.signOut();
      rethrow;
    }
  }

  static Future<HospitalDemoSession> discoverCurrentInternalSession({
    String? emailHint,
  }) async {
    final response = await request('GET', '/api/hospital-tickets/me');
    final user = Map<String, dynamic>.from(response['user'] as Map);
    if (user['profile_type'] != 'internal') {
      throw const HospitalTicketApiException(
        'An internal Hospital Ticketing profile is required.',
      );
    }
    final role = switch (user['role_code']) {
      'housekeeping_supervisor' => HospitalDemoRole.supervisor,
      'operations_executive' => HospitalDemoRole.operationsExecutive,
      'facility_manager' => HospitalDemoRole.facilityManager,
      _ => throw const HospitalTicketApiException(
        'This account cannot use the internal housekeeping module.',
      ),
    };
    final scopes = response['scopes'] is List
        ? response['scopes'] as List
        : const [];
    String? assignedBlock;
    if (role == HospitalDemoRole.supervisor) {
      final blockScopes = scopes
          .whereType<Map>()
          .where((row) => row['scope_type'] == 'block')
          .toList();
      final blockScope = blockScopes.isEmpty ? null : blockScopes.first;
      if (blockScope != null) {
        final blocks = await request('GET', '/api/hospital-tickets/blocks');
        final matchingBlocks = (blocks['blocks'] as List? ?? const [])
            .whereType<Map>()
            .where((row) => row['id'] == blockScope['block_id'])
            .toList();
        final block = matchingBlocks.isEmpty ? null : matchingBlocks.first;
        assignedBlock = block?['block_name']?.toString();
      }
    }
    return HospitalDemoSession(
      loginId:
          (emailHint ?? SupabaseService.client.auth.currentUser?.email ?? '')
              .trim()
              .toLowerCase(),
      displayName: '${user['display_name'] ?? ''}',
      role: role,
      assignedBlock: assignedBlock,
      userId: '${user['id'] ?? ''}',
      isDemo: false,
    );
  }

  static Future<List<HospitalTicket>> fetchTickets() async {
    final response = await request('GET', '/api/hospital-tickets');
    final rows = response['tickets'] is List
        ? response['tickets'] as List
        : const [];
    return rows
        .whereType<Map>()
        .map((row) => HospitalTicket.fromApi(Map<String, dynamic>.from(row)))
        .toList();
  }

  static Future<List<Map<String, dynamic>>> fetchNotifications() async {
    final response = await request(
      'GET',
      '/api/hospital-tickets/notifications',
    );
    final rows = response['notifications'] is List
        ? response['notifications'] as List
        : const [];
    return rows
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  static Future<void> markNotificationRead(String id) => request(
    'POST',
    '/api/hospital-tickets/notifications/$id/read',
  ).then((_) {});

  static Future<Map<String, dynamic>> fetchDetail(String ticketId) =>
      request('GET', '/api/hospital-tickets/$ticketId');

  static Future<String> signedDownload(
    String ticketId,
    String attachmentId,
  ) async {
    final response = await request(
      'GET',
      '/api/hospital-tickets/$ticketId/attachments/$attachmentId/sign-download',
    );
    return '${response['signed_url'] ?? ''}';
  }

  static Future<Map<String, dynamic>> action(
    String ticketId,
    String path,
    int version, [
    Map<String, dynamic> payload = const {},
  ]) => request(
    'POST',
    '/api/hospital-tickets/$ticketId/$path',
    body: {'version': version, ...payload},
  );

  static Future<void> uploadPhoto(
    String ticketId,
    String filePath,
    String type,
  ) async {
    final file = File(filePath);
    final mime = filePath.toLowerCase().endsWith('.png')
        ? 'image/png'
        : filePath.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    final sign = await request(
      'POST',
      '/api/hospital-tickets/$ticketId/attachments/sign-upload',
      body: {'attachment_type': type, 'mime_type': mime},
    );
    final client = HttpClient();
    try {
      final upload = await client.putUrl(Uri.parse('${sign['signed_url']}'));
      upload.headers.contentType = ContentType.parse(mime);
      upload.add(await file.readAsBytes());
      final response = await upload.close().timeout(
        const Duration(seconds: 45),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const HospitalTicketApiException('Photo upload failed.');
      }
    } finally {
      client.close(force: true);
    }
    await request(
      'POST',
      '/api/hospital-tickets/$ticketId/attachments/complete',
      body: {
        'storage_path': sign['storage_path'],
        'attachment_type': type,
        'original_filename': file.uri.pathSegments.last,
        'mime_type': mime,
        'size_bytes': await file.length(),
        'is_client_visible': type == 'completion_photo',
      },
    );
  }

  static Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final token = SupabaseService.client.auth.currentSession?.accessToken;
    if (token == null) {
      throw const HospitalTicketApiException(
        'Your session expired. Please sign in again.',
        code: 'session_expired',
      );
    }
    final base = AppConfig.backendApiUrl.replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) {
      throw const HospitalTicketApiException(
        'Hospital Ticketing API is not configured.',
      );
    }
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client.openUrl(method, Uri.parse('$base$path'));
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.contentType = ContentType.json;
      if (body != null) request.write(jsonEncode(body));
      final response = await request.close().timeout(
        const Duration(seconds: 30),
      );
      final text = await response.transform(utf8.decoder).join();
      final json = text.isEmpty
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(text) as Map);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HospitalTicketApiException(
          '${json['message'] ?? 'Request failed.'}',
          code: '${json['code'] ?? ''}',
        );
      }
      return json;
    } on HospitalTicketApiException {
      rethrow;
    } on TimeoutException {
      throw const HospitalTicketApiException(
        'The request timed out. Refresh before retrying.',
      );
    } catch (_) {
      throw const HospitalTicketApiException(
        'Unable to reach QPMS. Check the connection.',
      );
    } finally {
      client.close(force: true);
    }
  }
}
