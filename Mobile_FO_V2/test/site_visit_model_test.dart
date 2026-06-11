import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

void main() {
  group('FoUser.fromJson', () {
    test('maps nullable registration classification fields safely', () {
      final user = FoUser.fromJson({
        'auth_user_id': 'auth-1',
        'employee_code': 'FO001',
        'full_name': 'User 1',
        'mobile': '9999999999',
        'email': 'user@example.com',
        'state': 'TS',
        'role': null,
        'department': null,
        'designation': '',
        'business': ' Retail ',
      });

      expect(user.role, 'FO');
      expect(user.department, isNull);
      expect(user.designation, isNull);
      expect(user.business, 'Retail');
    });
  });

  group('SiteVisit.fromJson', () {
    test('maps Supabase row id to remoteId and local_id to id', () {
      final visit = SiteVisit.fromJson({
        'id': 'remote-uuid-123',
        'local_id': 'local-visit-123',
        'employee_code': 'FO001',
        'store_name': 'Store 1',
        'client_name': 'Client 1',
        'store_code': 'STORE001',
        'state': 'MH',
        'check_in_time': '2026-06-08T10:00:00.000Z',
      });

      expect(visit.id, 'local-visit-123');
      expect(visit.remoteId, 'remote-uuid-123');
    });

    test('maps local storage row id and remote_id correctly', () {
      final visit = SiteVisit.fromJson({
        'id': 'local-visit-123',
        'remote_id': 'remote-uuid-123',
        'employee_code': 'FO001',
        'store_name': 'Store 1',
        'client_name': 'Client 1',
        'store_code': 'STORE001',
        'state': 'MH',
        'check_in_time': '2026-06-08T10:00:00.000Z',
      });

      expect(visit.id, 'local-visit-123');
      expect(visit.remoteId, 'remote-uuid-123');
    });
  });
}
