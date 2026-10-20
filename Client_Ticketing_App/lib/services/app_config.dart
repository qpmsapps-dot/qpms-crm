import 'package:flutter/foundation.dart';

class ClientAppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const backendApiUrl = String.fromEnvironment('BACKEND_API_URL');
  static const demoMode = bool.fromEnvironment(
    'HOSPITAL_DEMO_MODE',
    defaultValue: false,
  );

  @visibleForTesting
  static String? backendApiUrlOverride;

  static String get effectiveBackendApiUrl =>
      backendApiUrlOverride ?? backendApiUrl;

  static bool get hasSupabaseConfig =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;

  static bool get isConfigured => effectiveBackendApiUrl.isNotEmpty;
}
