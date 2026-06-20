import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

void main() {
  test('GPS JSON sends employee_code and fo_user_id together', () {
    final log = LocationLog(
      id: 'gps-1',
      employeeCode: 'QPMSTN15702',
      attendanceId: 'attendance-1',
      latitude: 11.0,
      longitude: 76.0,
      capturedAt: DateTime.utc(2026, 6, 19),
    );

    final json = log.toJson();
    expect(json['employee_code'], 'QPMSTN15702');
    expect(json['fo_user_id'], 'QPMSTN15702');
  });

  test('legacy queued GPS row derives employee_code from fo_user_id', () {
    final log = LocationLog.fromJson({
      'local_id': 'gps-legacy',
      'employee_code': null,
      'fo_user_id': 'QPMSTN15702',
      'attendance_id': 'attendance-1',
      'latitude': 11.0,
      'longitude': 76.0,
      'captured_at': '2026-06-19T00:00:00.000Z',
    });

    expect(log.employeeCode, 'QPMSTN15702');
    expect(log.toJson()['employee_code'], 'QPMSTN15702');
  });
}
