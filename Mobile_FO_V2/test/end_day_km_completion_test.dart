import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import '../lib/services/end_day_km_completion.dart';

void main() {
  const id = 'cb8c582e-76b4-423d-99f8-0b38ef6305c4';
  const receipt = '00000000-0000-4000-8000-000000000001';
  final end = DateTime.parse('2026-10-26T14:35:59Z');
  Map<String, dynamic> saved() => {
    'attendance_id': id, 'status': 'persisted', 'updated': true,
    'dry_run': false, 'financial_posted': true,
    'route_sync_status': 'canonical_v2_incremental_persisted',
    'receipt_id': receipt, 'input_digest': List.filled(64, 'a').join(),
    'logout_time': end.toIso8601String(), 'last_reopened_at': null,
    'total_approved_km': 11.42, 'petrol_amount': 45.68,
  };
  bool matches(Map<String, dynamic> result, {DateTime? closed, double km = 11.42,
      double? petrol = 45.68, Map<String, dynamic>? metadata}) => endDayKmSnapshotMatches(
    result: result, attendanceId: id, endTime: closed ?? end,
    savedKm: km, savedPetrol: petrol,
    metadata: metadata ?? {'shared_km_last_receipt': receipt},
  );
  test('pending and delayed worker responses never become successful zero', () {
    for (var elapsed = 0; elapsed < 900; elapsed += 30) {
      expect(endDayKmResultIsPersisted({'attendance_id': id, 'status': 'pending',
        'updated': false, 'financial_posted': false, 'total_approved_km': 0}, id), isFalse);
    }
    expect(matches(saved()), isTrue);
  });
  test('partial saved eligible legs survive pending metadata', () {
    expect(matches(saved(), metadata: {'shared_km_last_receipt': receipt,
      'canonical_recalculation_pending': true, 'km_recalculation_status': 'partial'}), isTrue);
  });
  test('different or reopened attendance and old receipts cannot refresh final KM', () {
    expect(endDayKmResultIsPersisted({...saved(), 'attendance_id': 'other'}, id), isFalse);
    expect(matches(saved(), closed: end.add(const Duration(minutes: 1))), isFalse);
    expect(matches(saved(), metadata: {'shared_km_last_receipt': 'old'}), isFalse);
    expect(matches(saved(), metadata: {'shared_km_last_receipt': receipt,
      'last_reopened_at': '2026-10-26T14:35:17Z'}), isFalse);
  });
  test('refetch must contain the exact saved KM and petrol, never a local estimate', () {
    expect(matches(saved(), km: 58.27), isFalse);
    expect(matches(saved(), petrol: 0), isFalse);
    expect(matches(saved(), petrol: null), isFalse);
    expect(matches({...saved(), 'total_approved_km': double.nan}), isFalse);
  });
  test('missing or malformed receipt/run evidence cannot confirm persistence', () {
    expect(endDayKmResultIsPersisted({...saved(), 'receipt_id': null}, id), isFalse);
    expect(endDayKmResultIsPersisted({...saved(), 'input_digest': 'bad'}, id), isFalse);
    expect(endDayKmResultIsPersisted({...saved(), 'financial_posted': false}, id), isFalse);
  });
  test('verified canonical zero for non-payable travel can complete', () {
    final zero = {...saved(), 'route_sync_status': 'canonical_v2_persisted',
      'receipt_id': null, 'calculation_run_id': receipt, 'total_approved_km': 0,
      'petrol_amount': 0};
    expect(matches(zero, km: 0, petrol: 0,
      metadata: {'km_calculation_run_id': receipt}), isTrue);
  });
  test('retry cadence is bounded and supports the five-minute worker', () {
    expect(endDayKmRetryDelay({'retry_after_seconds': 120}), const Duration(seconds: 120));
    expect(endDayKmRetryDelay({'retry_after_seconds': 0}), const Duration(seconds: 15));
    expect(endDayKmRetryDelay({'retry_after_seconds': 9999}), const Duration(seconds: 300));
    expect(endDayKmRetryDelay(null), const Duration(seconds: 30));
  });
  test('home keeps refresh asynchronous and cancels polling on disposal', () {
    final source = File('lib/home/home_screen.dart').readAsStringSync();
    expect(source, contains('Timer(delay'));
    expect(source, contains('_endDayKmRefreshTimer?.cancel()'));
    expect(source, contains('if (!_recalculationResultBelongsToAttendance(recalcResult, id)) return;'));
    expect(source, contains('endDayKmSnapshotMatches('));
    expect(source, isNot(contains('_endDayKmRecalculationRetryDelays')));
  });
}
