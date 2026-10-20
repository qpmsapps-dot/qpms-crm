import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/app.dart';
import 'services/app_config.dart';
import 'services/client_push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!ClientAppConfig.demoMode && ClientAppConfig.hasSupabaseConfig) {
    await Supabase.initialize(
      url: ClientAppConfig.supabaseUrl,
      publishableKey: ClientAppConfig.supabaseAnonKey,
    );
  }
  if (!ClientAppConfig.demoMode && ClientAppConfig.isConfigured) {
    try {
      await ClientPushService.configure();
    } catch (error, stackTrace) {
      debugPrint('QPMS client push startup skipped: $error');
      debugPrint('$stackTrace');
    }
  }
  runApp(const QpmsClientTicketingApp());
}
