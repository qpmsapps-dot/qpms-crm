class ClientAppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const backendApiUrl = String.fromEnvironment('BACKEND_API_URL');
  static const demoMode = bool.fromEnvironment(
    'HOSPITAL_DEMO_MODE',
    defaultValue: false,
  );

  static bool get isConfigured =>
      supabaseUrl.isNotEmpty &&
      supabaseAnonKey.isNotEmpty &&
      backendApiUrl.isNotEmpty;
}
