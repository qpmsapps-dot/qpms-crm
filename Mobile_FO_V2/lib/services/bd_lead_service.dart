import 'dart:convert';
import 'dart:io';

import '../models/bd_lead_models.dart';
import 'config_service.dart';
import 'supabase_service.dart';

class BdLeadApiException implements Exception {
  const BdLeadApiException(
    this.message, {
    this.code = '',
    this.duplicates = const [],
  });

  final String message;
  final String code;
  final List<Map<String, dynamic>> duplicates;

  @override
  String toString() => message;
}

class BdLeadService {
  static Future<List<BdLead>> fetchLeads({
    String? status,
    String? stage,
    String? search,
    String? priority,
    String? scope,
  }) async {
    final query = <String, String>{
      if (status?.trim().isNotEmpty == true) 'status': status!.trim(),
      if (stage?.trim().isNotEmpty == true) 'stage': stage!.trim(),
      if (search?.trim().isNotEmpty == true) 'search': search!.trim(),
      if (priority?.trim().isNotEmpty == true) 'priority': priority!.trim(),
      if (scope?.trim().isNotEmpty == true) 'scope': scope!.trim(),
    };
    final json = await _request(
      'GET',
      '/api/lead-management/leads',
      query: query,
    );
    final rows = json['leads'] is List ? json['leads'] as List : const [];
    return rows
        .whereType<Map>()
        .map((row) => BdLead.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }

  static Future<BdLead> fetchLead(String leadId) async {
    final json = await _request('GET', '/api/lead-management/leads/$leadId');
    final lead = json['lead'];
    if (lead is! Map) {
      throw const BdLeadApiException('Lead details were not available.');
    }
    return BdLead.fromJson(Map<String, dynamic>.from(lead));
  }

  static Future<BdLead> createLead(
    CreateBdLeadRequest request, {
    bool duplicateOverride = false,
    String duplicateOverrideReason = '',
  }) async {
    final json = await _request(
      'POST',
      '/api/lead-management/leads',
      body: {
        ...request.toJson(),
        'source_context': 'mobile_bd_lead_creation',
        'duplicate_override': duplicateOverride,
        'duplicate_override_reason': duplicateOverrideReason,
      },
      headers: {'Idempotency-Key': request.idempotencyKey},
    );
    final lead = json['lead'];
    if (lead is! Map) {
      throw const BdLeadApiException('Lead was created but not returned.');
    }
    return BdLead.fromJson(Map<String, dynamic>.from(lead));
  }

  static Future<void> updateLead(
    String leadId,
    Map<String, dynamic> patch,
  ) async {
    await _request('PATCH', '/api/lead-management/leads/$leadId', body: patch);
  }

  static Future<void> addFollowUp(
    String leadId, {
    String remark = '',
    String nextFollowUpDate = '',
    String? status,
    String? stage,
    String? priority,
  }) async {
    final body = <String, dynamic>{
      'remark': remark,
      'next_followup_date': nextFollowUpDate,
      if (status?.trim().isNotEmpty == true) 'status': status!.trim(),
      if (stage?.trim().isNotEmpty == true) 'lead_stage': stage!.trim(),
      if (priority?.trim().isNotEmpty == true)
        'lead_priority': priority!.trim(),
    };
    await _request('POST', '/api/mobile/leads/$leadId/follow-up', body: body);
    final patch = <String, dynamic>{
      if (status?.trim().isNotEmpty == true) 'status': status!.trim(),
      if (stage?.trim().isNotEmpty == true) 'lead_stage': stage!.trim(),
      if (priority?.trim().isNotEmpty == true)
        'lead_priority': priority!.trim(),
    };
    if (patch.isNotEmpty) {
      await updateLead(leadId, patch);
    }
  }

  static Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String> query = const {},
    Map<String, dynamic>? body,
    Map<String, String> headers = const {},
  }) async {
    final baseUrl = AppConfig.backendApiUrl.trim();
    if (baseUrl.isEmpty) {
      throw const BdLeadApiException(
        'Lead service is not configured. Please contact admin.',
      );
    }
    final token = SupabaseService.currentAccessToken;
    if (token == null || token.trim().isEmpty) {
      throw const BdLeadApiException(
        'Login session expired. Please login again.',
      );
    }

    final base = Uri.parse(baseUrl);
    final uri = base.replace(
      path: _joinPath(base.path, path),
      queryParameters: query.isEmpty ? null : query,
    );
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      headers.forEach(request.headers.set);
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      final decoded = text.trim().isEmpty
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(text) as Map);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw BdLeadApiException(
          _friendlyMessage(
            response.statusCode,
            decoded['message']?.toString() ?? '',
          ),
          code: decoded['code']?.toString() ?? '',
          duplicates: decoded['duplicates'] is List
              ? (decoded['duplicates'] as List)
                    .whereType<Map>()
                    .map((row) => Map<String, dynamic>.from(row))
                    .toList()
              : const [],
        );
      }
      return decoded;
    } on BdLeadApiException {
      rethrow;
    } catch (_) {
      throw const BdLeadApiException(
        'Unable to connect to lead service. Please check internet and try again.',
      );
    } finally {
      client.close(force: true);
    }
  }

  static String _joinPath(String basePath, String childPath) {
    final cleanBase = basePath.endsWith('/')
        ? basePath.substring(0, basePath.length - 1)
        : basePath;
    final cleanChild = childPath.startsWith('/')
        ? childPath.substring(1)
        : childPath;
    if (cleanBase.isEmpty) return '/$cleanChild';
    return '$cleanBase/$cleanChild';
  }

  static String _friendlyMessage(int statusCode, String message) {
    if (statusCode == 401) return 'Session expired. Please login again.';
    if (statusCode == 403) return 'You do not have access to this lead.';
    if (message.toLowerCase().contains('configured')) {
      return 'Backend connection is not configured. Please contact admin.';
    }
    if (message.trim().isNotEmpty && statusCode == 400) return message.trim();
    return 'Lead service failed. Please try again.';
  }
}
