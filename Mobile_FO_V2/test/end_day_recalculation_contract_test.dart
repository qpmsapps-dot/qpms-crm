import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

void main() {
  group('End Day backend KM recalculation contract', () {
    late String homeSource;
    late String supabaseSource;
    late String modelSource;

    setUpAll(() {
      homeSource = File('lib/home/home_screen.dart').readAsStringSync();
      supabaseSource = File(
        'lib/services/supabase_service.dart',
      ).readAsStringSync();
      modelSource = File('lib/models/fo_models.dart').readAsStringSync();
    });

    String endDayBody() {
      final start = homeSource.indexOf('Future<void> _endDay() async {');
      final end = homeSource.indexOf(
        'Future<bool> _restoreSameDayAttendanceAfterCreateFailure() async {',
      );
      expect(start, greaterThanOrEqualTo(0));
      expect(end, greaterThan(start));
      return homeSource.substring(start, end);
    }

    test(
      'attendance closes before recalculation and recalculation runs once',
      () {
        final body = endDayBody();

        expect(
          body.indexOf('SupabaseService.endCurrentActiveAttendance'),
          lessThan(body.indexOf('SupabaseService.triggerFoKmRecalculation')),
        );
        expect(
          'SupabaseService.triggerFoKmRecalculation'.allMatches(body),
          hasLength(1),
        );
        expect(body, contains('if (_busy) return;'));
      },
    );

    test('backend response is matched and exact attendance is refetched', () {
      final body = endDayBody();

      expect(body, contains('_recalculationResultBelongsToAttendance'));
      expect(body, contains("result['attendance_id']"));
      expect(
        body.indexOf('SupabaseService.triggerFoKmRecalculation'),
        lessThan(body.indexOf('SupabaseService.findAttendanceById')),
      );
      expect(body, contains('attendanceId: attendance.remoteId!'));
    });

    test('confirmed payable KM, including zero, comes from backend result', () {
      final body = endDayBody();

      expect(body, contains("recalcResult['approved_km']"));
      expect(body, contains("recalcResult['total_route_km']"));
      expect(body, contains("recalcResult['new_total_route_km']"));
      expect(body, isNot(contains('confirmedKm > 0')));
      expect(body, contains('Final payable KM:'));
    });

    test('refreshed attendance is saved and reused before final UI update', () {
      final body = endDayBody();
      final recalcStart = body.indexOf(
        'SupabaseService.triggerFoKmRecalculation',
      );
      final recalcBody = body.substring(recalcStart);

      expect(
        recalcBody.indexOf('_applyBackendAttendance'),
        lessThan(
          recalcBody.indexOf('await LocalStore.saveAttendance(attendance);'),
        ),
      );
      expect(
        recalcBody.indexOf('await LocalStore.saveAttendance(attendance);'),
        lessThan(recalcBody.indexOf('_showEndDayResult')),
      );
      expect(body, contains('_km = attendance.eligibleKm'));
    });

    test('failure keeps End Day complete and exposes Refresh KM action', () {
      final body = endDayBody();

      expect(
        body.indexOf('catch (error, stackTrace)'),
        lessThan(body.indexOf('recalcPending = true;')),
      );
      expect(
        homeSource,
        contains(
          'Day ended successfully. Final KM calculation is still processing.',
        ),
      );
      expect(homeSource, contains("label: 'Refresh KM'"));
      expect(homeSource, contains('Future<void> _refreshFinalKm'));
      expect(homeSource, contains('END_DAY_FINAL_KM_REFRESH_FAILED'));
    });

    test(
      'petrol amount is mapped from backend data, not calculated locally',
      () {
        expect(modelSource, contains('double? petrolAmount;'));
        expect(
          supabaseSource,
          contains("petrolAmount: _double(row['petrol_amount'])"),
        );
        expect(homeSource, contains("recalcResult['petrol_amount']"));
        expect(homeSource, contains('Petrol amount: \\u20B9'));
        expect(
          homeSource,
          isNot(contains('petrolAmount = attendance.eligibleKm *')),
        );
      },
    );

    test('Attendance local serialization preserves backend petrol amount', () {
      final attendance = Attendance(
        id: 'local-1',
        remoteId: '11111111-1111-1111-1111-111111111111',
        employeeCode: 'FO1',
        startTime: DateTime(2026, 7, 19, 9),
        eligibleKm: 0,
        totalRouteKm: 0,
        petrolAmount: 0,
      );

      final restored = Attendance.fromJson(attendance.toJson());

      expect(restored.eligibleKm, 0);
      expect(restored.totalRouteKm, 0);
      expect(restored.petrolAmount, 0);
    });
  });
}
