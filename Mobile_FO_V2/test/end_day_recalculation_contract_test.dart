import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('End Day background KM recalculation contract', () {
    late String homeSource;
    late String supabaseSource;
    late String backendServiceSource;

    setUpAll(() {
      homeSource = File('lib/home/home_screen.dart').readAsStringSync();
      supabaseSource = File(
        'lib/services/supabase_service.dart',
      ).readAsStringSync();
      backendServiceSource = File(
        '../backend/foKmRecalculationService.js',
      ).readAsStringSync();
    });

    String endDayBody() {
      final start = homeSource.indexOf('Future<void> _endDay() async {');
      final end = homeSource.indexOf(
        'Future<void> _refreshEndDayKmFromBackend({',
      );
      expect(start, greaterThanOrEqualTo(0));
      expect(end, greaterThan(start));
      return homeSource.substring(start, end);
    }

    String refreshBody() {
      final start = homeSource.indexOf(
        'Future<void> _refreshEndDayKmFromBackend({',
      );
      final end = homeSource.indexOf(
        'Future<bool> _restoreSameDayAttendanceAfterCreateFailure() async {',
      );
      expect(start, greaterThanOrEqualTo(0));
      expect(end, greaterThan(start));
      return homeSource.substring(start, end);
    }

    test('End Day triggers backend recalculation with exact attendance ID', () {
      final body = endDayBody();
      final refresh = refreshBody();

      final closureIndex = body.indexOf(
        'SupabaseService.endCurrentActiveAttendance',
      );
      expect(closureIndex, greaterThanOrEqualTo(0));
      expect(
        body.indexOf('_refreshEndDayKmFromBackend', closureIndex),
        greaterThan(closureIndex),
      );
      expect(body, contains('attendanceId: attendance.remoteId!'));
      expect(refresh, contains('attendanceId: id'));
      expect(refresh, contains('SupabaseService.triggerFoKmRecalculation'));
      expect(supabaseSource, contains("'/api/fo/km/recalculate'"));
      expect(
        backendServiceSource,
        contains('export async function recalculateFoKm'),
      );
    });

    test('attendance is refetched after successful recalculation', () {
      final refresh = refreshBody();

      expect(
        refresh.indexOf('SupabaseService.triggerFoKmRecalculation'),
        lessThan(refresh.indexOf('SupabaseService.findAttendanceById')),
      );
      expect(refresh, contains('attendanceId: id'));
      expect(refresh, contains('_recalculationResultBelongsToAttendance'));
      expect(refresh, contains('_applyBackendAttendance'));
      expect(refresh, contains('await LocalStore.saveAttendance'));
    });

    test('Today KM updates only from refreshed backend attendance', () {
      final body = endDayBody();
      final refresh = refreshBody();

      expect(
        body,
        contains('_finalKmAwaitingBackend = SupabaseService.isValidUuid'),
      );
      expect(body, isNot(contains('_km = attendance.eligibleKm;')));
      expect(refresh, contains('_km = current.eligibleKm;'));
      expect(refresh, contains('_km = refreshedAttendance.eligibleKm;'));
      expect(homeSource, contains("value: _todayKmLabel()"));
      expect(homeSource, contains("if (_finalKmAwaitingBackend) return '--';"));
    });

    test('Flutter local KM is not used as final End Day KM', () {
      final body = endDayBody();
      final refresh = refreshBody();

      expect(
        body,
        contains('final actualKm = await _calculateContinuedKm(attendance);'),
      );
      expect(
        body,
        contains('final routeKm = await _routeKmFromVisits(attendance);'),
      );
      expect(body, isNot(contains('Final payable KM:')));
      expect(refresh, isNot(contains("recalcResult['approved_km']")));
      expect(refresh, isNot(contains("recalcResult['total_route_km']")));
      expect(refresh, isNot(contains("recalcResult['new_total_route_km']")));
    });

    test(
      'no recalculation popup, processing dialog, or Refresh KM action is shown',
      () {
        expect(homeSource, isNot(contains('Calculating final travel KM')));
        expect(homeSource, isNot(contains('Updating final KM')));
        expect(homeSource, isNot(contains('_showEndDayResult')));
        expect(homeSource, isNot(contains('_refreshFinalKm')));
        expect(homeSource, isNot(contains("label: 'Refresh KM'")));
        expect(
          homeSource,
          isNot(contains('Final KM calculation is still processing')),
        );
      },
    );

    test('petrol and rupee values are not displayed from End Day result', () {
      expect(homeSource, isNot(contains('Petrol amount:')));
      expect(homeSource, isNot(contains(r'\u20B9')));
      expect(homeSource, isNot(contains('confirmedPetrolAmount')));
      expect(homeSource, isNot(contains("recalcResult['petrol_amount']")));
      expect(homeSource, isNot(contains("recalcResult['new_petrol_amount']")));
    });

    test(
      '409 or temporary failure retries silently without reopening attendance',
      () {
        final refresh = refreshBody();

        expect(refresh, contains('_endDayKmRecalculationRetryDelays'));
        expect(refresh, contains('Future<void>.delayed'));
        expect(refresh, contains('catch (error, stackTrace)'));
        expect(refresh, contains('END_DAY_KM_RECALCULATION_RETRY_PENDING'));
        expect(refresh, isNot(contains('reopenAttendanceForToday')));
        expect(refresh, isNot(contains('_toast(')));
      },
    );
  });
}
