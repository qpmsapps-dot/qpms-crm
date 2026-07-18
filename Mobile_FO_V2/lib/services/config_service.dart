class AppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const googleMapsApiKey = String.fromEnvironment('GOOGLE_MAPS_API_KEY');
  static const backendApiUrl = String.fromEnvironment('BACKEND_API_URL');
  static const hospitalDemoMode = bool.fromEnvironment(
    'HOSPITAL_DEMO_MODE',
    defaultValue: false,
  );

  static bool get hasSupabase =>
      supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;

  static bool get hasGoogleMaps => googleMapsApiKey.trim().isNotEmpty;

  static String? get configError {
    final missing = <String>[];
    if (supabaseUrl.trim().isEmpty) missing.add('SUPABASE_URL');
    if (supabaseAnonKey.trim().isEmpty) missing.add('SUPABASE_ANON_KEY');
    if (backendApiUrl.trim().isEmpty) missing.add('BACKEND_API_URL');
    if (missing.isEmpty) return null;
    return 'Missing required mobile configuration: ${missing.join(', ')}';
  }
}
