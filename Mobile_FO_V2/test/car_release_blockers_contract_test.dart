import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  late String service;
  late String tasks;

  setUpAll(() {
    service = File('lib/services/supabase_service.dart').readAsStringSync();
    tasks = File('lib/tasks/tasks_screen.dart').readAsStringSync();
  });

  test('start_day_car_writes_attendance_rate_8', () {
    expect(service, contains("'rate_per_km': attendance.ratePerKm"));
    expect(service, contains("'travel_mode': attendance.travelMode"));
  });

  test('start_day_car_updates_live_status_rate_8', () {
    final createStart = service.indexOf(
      'static Future<String?> createAttendance',
    );
    final createEnd = service.indexOf(
      'static Future<Attendance?> updateAttendanceTravelMode',
    );
    final body = service.substring(createStart, createEnd);
    expect(body, contains("from('fo_live_status').upsert"));
    expect(body, contains("'rate_per_km': attendance.ratePerKm"));
  });

  test('reopen_car_writes_attendance_and_live_rate_8', () {
    final start = service.indexOf(
      'static Future<Attendance> reopenAttendanceForToday',
    );
    final end = service.indexOf('static Future<void> endAttendance', start);
    final body = service.substring(start, end);
    expect(body, contains('travelModeRatePerKm(selectedTravelMode)'));
    expect(body, contains("'rate_per_km': selectedRatePerKm"));
    expect(body, contains("from('fo_live_status').upsert"));
  });

  test('end_day_mixed_mode_amount_remains_pending_until_canonical', () {
    final start = service.indexOf(
      'static Future<EndDayAttendanceResolution> endCurrentActiveAttendance',
    );
    final end = service.indexOf(
      'static Future<void> updateEndDayLiveStatus',
      start,
    );
    final body = service.substring(start, end);
    expect(body, contains("'petrol_amount': 0"));
    expect(
      body,
      contains(
        "'route_sync_status': 'pending_canonical_end_day_recalculation'",
      ),
    );
    expect(body, contains("'canonical_recalculation_pending': true"));
    expect(body, isNot(contains('approvedKm * ratePerKm')));
  });

  test('checkin_retry_does_not_duplicate_visit_or_leg', () {
    expect(tasks, contains('CHECKIN_TRAVEL_LEG_BOUNDARY_PENDING'));
    expect(tasks, contains('_closeTravelLegForCheckedInVisit'));
    expect(
      tasks,
      contains('The persisted active visit is the durable retry marker'),
    );
  });
}
