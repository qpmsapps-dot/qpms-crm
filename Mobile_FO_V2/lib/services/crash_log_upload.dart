import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> uploadCrashLog(
  SupabaseClient client,
  Map<String, dynamic> payload,
) async {
  try {
    await client.from('mobile_crash_logs').insert(payload);
  } on PostgrestException catch (error) {
    // Only this known primary-key conflict confirms that this stable event ID
    // was already accepted. Never retry the same insert immediately on any error.
    if (error.code != '23505' ||
        !error.message.contains('mobile_crash_logs_pkey')) {
      rethrow;
    }
  }
}
