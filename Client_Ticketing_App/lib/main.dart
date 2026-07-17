import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/app.dart';
import 'services/app_config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!ClientAppConfig.demoMode && ClientAppConfig.isConfigured) {
    await Supabase.initialize(
      url: ClientAppConfig.supabaseUrl,
      publishableKey: ClientAppConfig.supabaseAnonKey,
    );
  }
  runApp(const QpmsClientTicketingApp());
}
