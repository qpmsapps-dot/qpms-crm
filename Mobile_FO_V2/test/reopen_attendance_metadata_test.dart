import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/services/supabase_service.dart';

void main() {
  test('builds restart day metadata without dropping existing values', () {
    final reopenedAt = DateTime.utc(2026, 6, 29, 10, 30);
    final metadata = SupabaseService.buildReopenAttendanceMetadata(
      existingMetadata: {'source': 'mobile', 'reopen_count': 2},
      previousLogoutTime: '2026-06-29T09:30:00.000Z',
      reopenedAt: reopenedAt,
    );

    expect(metadata['source'], 'mobile');
    expect(metadata['reopened_after_end_day'], isTrue);
    expect(metadata['reopen_count'], 3);
    expect(metadata['last_reopened_at'], '2026-06-29T10:30:00.000Z');
    expect(metadata['previous_logout_time'], '2026-06-29T09:30:00.000Z');
    expect(
      metadata['reopen_reason'],
      'Employee restarted duty after accidental End Day',
    );
  });
}
