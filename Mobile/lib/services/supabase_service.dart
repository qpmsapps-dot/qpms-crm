import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/fo_models.dart';

typedef QpmsProfileBreadcrumb =
    Future<void> Function(
      String action, {
      String? employeeCode,
      Object? error,
      StackTrace? stackTrace,
    });

class QpmsSupabaseService {
  QpmsSupabaseService._();

  static bool _initialized = false;
  static Future<void>? _initializing;

  static const String _url = String.fromEnvironment('SUPABASE_URL');
  static const String _anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const String _googleMapsApiKey = String.fromEnvironment(
    'GOOGLE_MAPS_API_KEY',
  );
  static const String _apiBaseUrl = String.fromEnvironment('QPMS_API_URL');
  static String get apiBaseUrl {
    if (_apiBaseUrl.isNotEmpty) return _apiBaseUrl;
    return Platform.isAndroid
        ? 'http://10.0.2.2:4000'
        : 'http://localhost:4000';
  }

  static List<String> get missingRequiredKeys {
    final missing = <String>[];
    if (_url.isEmpty) missing.add('SUPABASE_URL');
    if (_anonKey.isEmpty) missing.add('SUPABASE_ANON_KEY');
    return missing;
  }

  static List<String> get missingOptionalKeys {
    final missing = <String>[];
    if (_googleMapsApiKey.isEmpty) missing.add('GOOGLE_MAPS_API_KEY');
    return missing;
  }

  static bool get isConfigured => missingRequiredKeys.isEmpty;

  static String get projectHost {
    if (_url.isEmpty) return 'not configured';
    final uri = Uri.tryParse(_normalizedSupabaseUrl);
    return uri?.host.isNotEmpty == true ? uri!.host : 'invalid SUPABASE_URL';
  }

  static SupabaseClient? get client {
    if (!isConfigured || !_initialized) return null;
    return Supabase.instance.client;
  }

  static Future<void> initialize() async {
    if (_initialized) return;
    if (_initializing != null) return _initializing!;
    _initializing = _initialize();
    try {
      await _initializing;
    } catch (_) {
      _initializing = null;
      rethrow;
    }
  }

  static Future<void> _initialize() async {
    if (!isConfigured) {
      final missing = missingRequiredKeys.join(', ');
      debugPrint('[myQPMS Mobile Config] Missing dart-define key(s): $missing');
      throw StateError(
        'Missing mobile configuration: $missing. Rebuild with --dart-define values.',
      );
    }
    final optionalMissing = missingOptionalKeys;
    if (optionalMissing.isNotEmpty) {
      debugPrint(
        '[myQPMS Mobile Config] Optional dart-define key(s) missing: ${optionalMissing.join(', ')}',
      );
    }
    final normalizedUrl = _normalizedSupabaseUrl;
    final parsedUrl = Uri.tryParse(normalizedUrl);
    if (parsedUrl == null ||
        !parsedUrl.hasScheme ||
        parsedUrl.host.trim().isEmpty) {
      throw StateError('Invalid SUPABASE_URL: $_url');
    }
    try {
      await Supabase.initialize(url: normalizedUrl, anonKey: _anonKey);
      _initialized = true;
      debugPrint('[myQPMS Mobile Supabase] Connected to $projectHost');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS Mobile Supabase] Initialization failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _initialized = false;
      throw StateError('Supabase initialization failed: $error');
    }
  }

  static String get _normalizedSupabaseUrl =>
      _url.trim().replaceAll(RegExp(r'/rest/v1/?$'), '');

  static SupabaseClient requireClient() {
    final supabase = client;
    if (supabase == null) {
      throw StateError(
        'Supabase is not configured. Rebuild the mobile app with SUPABASE_URL and SUPABASE_ANON_KEY.',
      );
    }
    return supabase;
  }

  static Future<Map<String, bool>> checkFoRegistrationUnique({
    required String mobile,
    required String email,
  }) async {
    final supabase = requireClient();
    final result = await supabase.rpc(
      'rpc_check_fo_registration_unique',
      params: {'p_mobile': mobile, 'p_email': email},
    );
    final row = Map<String, dynamic>.from(result as Map);
    return {
      'mobile_exists': row['mobile_exists'] == true,
      'email_exists': row['email_exists'] == true,
    };
  }

  static Future<FoUser> registerFoUser({
    required String fullName,
    required String mobile,
    required String email,
    required DateTime birthDate,
    required String gender,
    required String state,
    required String password,
  }) async {
    final supabase = requireClient();
    final normalizedEmail = email.trim().toLowerCase();
    final normalizedMobile = mobile.replaceAll(RegExp(r'\D'), '');

    final uniqueness = await checkFoRegistrationUnique(
      mobile: normalizedMobile,
      email: normalizedEmail,
    );
    if (uniqueness['mobile_exists'] == true) {
      throw StateError('Mobile number is already registered.');
    }
    if (uniqueness['email_exists'] == true) {
      throw StateError('Email is already registered.');
    }

    final birthDateText =
        '${birthDate.year.toString().padLeft(4, '0')}-'
        '${birthDate.month.toString().padLeft(2, '0')}-'
        '${birthDate.day.toString().padLeft(2, '0')}';

    await supabase.auth.signUp(
      email: normalizedEmail,
      password: password,
      data: {
        'registration_source': 'myqpms_mobile',
        'full_name': fullName.trim(),
        'mobile': normalizedMobile,
        'birth_date': birthDateText,
        'gender': gender,
        'state': state,
        'role': 'FO',
      },
    );

    try {
      await supabase.auth.signInWithPassword(
        email: normalizedEmail,
        password: password,
      );
    } on AuthException catch (error) {
      throw StateError(
        'Registration saved, but immediate login failed: ${error.message}',
      );
    }

    final profile = await _fetchCurrentFoProfile();
    debugPrint(
      '[myQPMS Mobile Supabase] FO registered via auth.users + public.profiles: ${profile.id}',
    );
    return profile;
  }

  static Future<FoUser> signInFoByMobile({
    required String mobile,
    required String password,
  }) async {
    final supabase = requireClient();
    final normalizedMobile = mobile.replaceAll(RegExp(r'\D'), '');
    final email = await supabase.rpc(
      'rpc_resolve_fo_login_email',
      params: {'p_mobile': normalizedMobile},
    );
    if (email == null || email.toString().trim().isEmpty) {
      throw StateError('No active Field Officer found for this mobile number.');
    }
    await supabase.auth.signInWithPassword(
      email: email.toString(),
      password: password,
    );
    return _fetchCurrentFoProfile();
  }

  static Future<FoUser> currentFoUser({QpmsProfileBreadcrumb? diagnostics}) =>
      _fetchCurrentFoProfile(diagnostics: diagnostics);

  static Future<FoUser> _fetchCurrentFoProfile({
    QpmsProfileBreadcrumb? diagnostics,
  }) async {
    final supabase = requireClient();
    final authUserId = supabase.auth.currentUser?.id;
    if (authUserId == null) {
      throw StateError('Supabase Auth session was not created.');
    }
    await diagnostics?.call('PROFILE_QUERY_START');
    await diagnostics?.call('PROFILE_SINGLE_QUERY_EXECUTED');
    final Object? profileResponse;
    try {
      profileResponse = await supabase
          .from('profiles')
          .select(
            'id, auth_user_id, employee_code, username, display_name, full_name, mobile, role, state',
          )
          .eq('auth_user_id', authUserId)
          .maybeSingle();
      await diagnostics?.call('PROFILE_QUERY_RETURNED');
      await diagnostics?.call('PROFILE_SINGLE_QUERY_SUCCESS');
      await diagnostics?.call('PROFILE_QUERY_SUCCESS');
    } catch (error, stackTrace) {
      await diagnostics?.call(
        'PROFILE_QUERY_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
    if (profileResponse == null) {
      throw StateError(
        'Profile not found for auth_user_id=$authUserId. The mobile app queries public.profiles.auth_user_id, not public.profiles.id or employee_code.',
      );
    }
    try {
      if (profileResponse is! Map) {
        throw StateError(
          'Profile response was ${profileResponse.runtimeType}, expected Map.',
        );
      }
      final profile = Map<String, dynamic>.from(profileResponse);
      await diagnostics?.call('PROFILE_JSON_RECEIVED');
      await diagnostics?.call('PROFILE_PARSE_START');
      final employeeCode = FoUser.profileTextField(
        profile,
        'employee_code',
        fallbackKeys: const ['username', 'mobile'],
      );
      if (employeeCode == null || employeeCode.trim().isEmpty) {
        throw StateError(
          'Profile parse failed: employee_code, username, and mobile are empty. Fields: ${_profileFieldSnapshot(profile)}',
        );
      }
      await diagnostics?.call(
        'EMPLOYEE_CODE_LOADED',
        employeeCode: employeeCode,
      );
      final fullName =
          FoUser.profileTextField(
            profile,
            'full_name',
            fallbackKeys: const ['display_name'],
          ) ??
          'Field Officer';
      await diagnostics?.call('FULL_NAME_LOADED', employeeCode: employeeCode);
      final role = FoUser.profileTextField(profile, 'role') ?? 'FO';
      await diagnostics?.call('ROLE_LOADED', employeeCode: employeeCode);
      final user = FoUser.fromProfile(profile);
      await diagnostics?.call('PROFILE_PARSE_SUCCESS', employeeCode: user.id);
      await diagnostics?.call(
        'PROFILE_LOAD_REMOTE_SUCCESS',
        employeeCode: user.id,
      );
      debugPrint(
        '[myQPMS Mobile Supabase] Profile loaded: employee_code=$employeeCode full_name=$fullName role=$role auth_user_id=$authUserId',
      );
      return user;
    } catch (error, stackTrace) {
      await diagnostics?.call(
        'PROFILE_PARSE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static String _profileFieldSnapshot(Map<String, dynamic> profile) {
    final fields = <String, Object?>{
      'id': profile['id'],
      'auth_user_id': profile['auth_user_id'],
      'employee_code': profile['employee_code'],
      'username': profile['username'],
      'display_name': profile['display_name'],
      'full_name': profile['full_name'],
      'mobile': profile['mobile'],
      'role': profile['role'],
      'state': profile['state'],
    };
    return fields.entries
        .map(
          (entry) => '${entry.key}=${entry.value.runtimeType}:${entry.value}',
        )
        .join(', ');
  }

  static Future<List<Map<String, dynamic>>> fetchLeads() async {
    final supabase = requireClient();
    final leads = await supabase
        .from('leads')
        .select()
        .order('created_at', ascending: false);
    final rows = List<Map<String, dynamic>>.from(leads);
    if (rows.isEmpty) return rows;

    final leadIds = rows.map((lead) => lead['id'] as String).toList();
    final contacts = List<Map<String, dynamic>>.from(
      await supabase
          .from('lead_contacts')
          .select()
          .inFilter('lead_id', leadIds),
    );
    final visits = List<Map<String, dynamic>>.from(
      await supabase.from('site_visits').select().inFilter('lead_id', leadIds),
    );

    return rows.map((lead) {
      final leadId = lead['id'];
      return {
        ...lead,
        'lead_contacts': contacts
            .where((contact) => contact['lead_id'] == leadId)
            .toList(),
        'site_visits': visits
            .where((visit) => visit['lead_id'] == leadId)
            .toList(),
      };
    }).toList();
  }

  static Future<String?> createLead({
    required Map<String, dynamic> lead,
    required List<Map<String, dynamic>> contacts,
  }) async {
    final supabase = requireClient();

    Map<String, dynamic> created;
    try {
      created = await supabase.from('leads').insert(lead).select('id').single();
    } catch (error) {
      if (!error.toString().contains('service_scope')) rethrow;
      final retryLead = Map<String, dynamic>.from(lead)
        ..remove('service_scope');
      created = await supabase
          .from('leads')
          .insert(retryLead)
          .select('id')
          .single();
    }
    final leadId = created['id'] as String;

    if (contacts.isNotEmpty) {
      await supabase
          .from('lead_contacts')
          .insert(
            contacts.map((contact) => {...contact, 'lead_id': leadId}).toList(),
          );
    }

    await logActivity(
      leadId: leadId,
      type: 'Lead Created',
      message: 'Lead Created from mobile app',
    );
    debugPrint('[myQPMS Mobile Supabase] Lead inserted: $leadId');
    return leadId;
  }

  static Future<void> saveLeadMom({
    required String leadId,
    required Map<String, dynamic> mom,
    required bool sent,
  }) async {
    final supabase = requireClient();
    final payload = {
      ...mom,
      'lead_id': leadId,
      'mom_status': sent ? 'Sent' : 'Draft',
      'sent_at': sent ? DateTime.now().toIso8601String() : null,
    };
    final existing = await supabase
        .from('lead_mom')
        .select('id')
        .eq('lead_id', leadId)
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (existing == null) {
      await supabase.from('lead_mom').insert(payload);
    } else {
      await supabase
          .from('lead_mom')
          .update(payload)
          .eq('id', existing['id'] as String);
    }
    debugPrint('[myQPMS Mobile Supabase] Lead MOM saved: $leadId');
  }

  static Future<void> updateLeadStage({
    required String leadId,
    required String stage,
    required String status,
  }) async {
    final supabase = requireClient();
    await supabase
        .from('leads')
        .update({
          'lead_stage': stage,
          'status': status,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('id', leadId);
    debugPrint(
      '[myQPMS Mobile Supabase] Lead stage updated: $leadId -> $stage',
    );
  }

  static Future<void> deleteLead(String leadId) async {
    final supabase = requireClient();

    await logActivity(type: 'Lead Deleted', message: 'Lead Deleted');
    await supabase.from('site_assessments').delete().eq('lead_id', leadId);
    await supabase.from('site_visits').delete().eq('lead_id', leadId);
    await supabase.from('lead_mom').delete().eq('lead_id', leadId);
    await supabase.from('lead_contacts').delete().eq('lead_id', leadId);
    await supabase.from('leads').delete().eq('id', leadId);
  }

  static Future<String?> createSiteVisit(Map<String, dynamic> visit) async {
    final supabase = requireClient();
    final leadId = visit['lead_id'] as String?;
    if (leadId == null || leadId.isEmpty) {
      throw ArgumentError('A lead_id is required to create a site visit.');
    }
    final existing = await supabase
        .from('site_visits')
        .select('id')
        .eq('lead_id', leadId)
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    String? siteVisitId;
    if (existing == null) {
      final row = await supabase
          .from('site_visits')
          .insert(visit)
          .select('id')
          .single();
      siteVisitId = row['id'] as String?;
    } else {
      siteVisitId = existing['id'] as String?;
      await supabase.from('site_visits').update(visit).eq('id', siteVisitId!);
    }
    debugPrint('[myQPMS Mobile Supabase] Site visit saved: $siteVisitId');
    return siteVisitId;
  }

  static Future<void> saveAssessment(Map<String, dynamic> assessment) async {
    final supabase = requireClient();
    final siteVisitId = assessment['site_visit_id'] as String?;
    if (siteVisitId == null || siteVisitId.isEmpty) {
      throw ArgumentError('A site_visit_id is required to save an assessment.');
    }
    final existing = await supabase
        .from('site_assessments')
        .select('id')
        .eq('site_visit_id', siteVisitId)
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (existing == null) {
      await supabase.from('site_assessments').insert(assessment);
    } else {
      await supabase
          .from('site_assessments')
          .update(assessment)
          .eq('id', existing['id'] as String);
    }
    debugPrint(
      '[myQPMS Mobile Supabase] Assessment saved for site visit: ${assessment['site_visit_id']}',
    );
  }

  static Future<void> submitAssessmentStage({
    required String siteVisitId,
    required String leadId,
  }) async {
    final supabase = requireClient();
    await supabase
        .from('site_visits')
        .update({
          'current_stage': 'Commercial Review',
          'status': 'Pending Review',
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('id', siteVisitId);
    await logActivity(
      leadId: leadId,
      siteVisitId: siteVisitId,
      type: 'Submitted for Commercial Review',
      message: 'Site assessment submitted from mobile app',
    );
    debugPrint(
      '[myQPMS Mobile Supabase] Site assessment submitted: $siteVisitId',
    );
  }

  static Future<String?> uploadSiteImage({
    required String siteVisitId,
    required String category,
    required File file,
    String? assessmentId,
    String? uploadedBy,
  }) async {
    final supabase = requireClient();

    final fileName = file.path.split(Platform.pathSeparator).last;
    final path =
        '$siteVisitId/$category/${DateTime.now().millisecondsSinceEpoch}-$fileName';
    await supabase.storage.from('site-survey-images').upload(path, file);
    final publicUrl = supabase.storage
        .from('site-survey-images')
        .getPublicUrl(path);
    await supabase.from('site_images').insert({
      'site_visit_id': siteVisitId,
      'assessment_id': assessmentId,
      'image_category': category,
      'image_url': publicUrl,
      'file_name': fileName,
      'uploaded_by': uploadedBy,
    });
    return publicUrl;
  }

  static Future<void> logActivity({
    String? leadId,
    String? siteVisitId,
    required String type,
    required String message,
    String? createdBy,
  }) async {
    final supabase = requireClient();
    await supabase.from('activity_logs').insert({
      'lead_id': leadId,
      'site_visit_id': siteVisitId,
      'activity_type': type,
      'activity_message': message,
      'created_by': createdBy,
    });
  }

  static Future<void> sendLeadMomEmail(Map<String, dynamic> payload) async {
    await _postMail('/send-lead-mom', payload);
  }

  static Future<void> sendSiteVisitMomEmail(
    Map<String, dynamic> payload,
  ) async {
    await _postMail('/send-sitevisit-mom', payload);
  }

  static Future<void> _postMail(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final client = HttpClient();
    try {
      final uri = Uri.parse('$apiBaseUrl$path');
      final request = await client.postUrl(uri);
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(payload));
      final response = await request.close();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final body = await response.transform(utf8.decoder).join();
        throw HttpException('Mail API failed: ${response.statusCode} $body');
      }
    } finally {
      client.close();
    }
  }
}
