import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_access_policy.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_controller.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_demo_auth.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_demo_repository.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_models.dart';
import 'package:myqpms_fo_v2/utils/mobile_roles.dart';

void main() {
  final seed = DateTime(2026, 7, 16, 10);

  HospitalDemoSession login(String id) => HospitalDemoAuth.authenticate(
    loginId: id,
    candidatePassword: 'test-only-password',
    testPasswordOverride: 'test-only-password',
  )!;

  HospitalController controller(String id) => HospitalController(
    session: login(id),
    repository: HospitalDemoRepository(seedTime: seed),
  );

  group('hospital demo authentication and scope', () {
    test('exact demo accounts authenticate locally', () {
      expect(HospitalDemoAuth.accounts.length, 4);
      expect(login('sup.blocka@qpmsdemo.com').assignedBlock, 'Block A');
      expect(login('sup.blockb@qpmsdemo.com').assignedBlock, 'Block B');
      expect(login('ops.exec@qpmsdemo.com').hasAllBlocks, isTrue);
      expect(login('facility.manager@qpmsdemo.com').hasAllBlocks, isTrue);
      expect(
        HospitalDemoAuth.authenticate(
          loginId: 'sup.blocka@qpmsdemo.com',
          candidatePassword: 'wrong',
          testPasswordOverride: 'test-only-password',
        ),
        isNull,
      );
    });

    test('Block A Supervisor sees only Block A tickets', () {
      expect(
        controller(
          'sup.blocka@qpmsdemo.com',
        ).visibleTickets.every((ticket) => ticket.block == 'Block A'),
        isTrue,
      );
    });

    test('Block B Supervisor sees only Block B tickets', () {
      expect(
        controller(
          'sup.blockb@qpmsdemo.com',
        ).visibleTickets.every((ticket) => ticket.block == 'Block B'),
        isTrue,
      );
    });

    test('Operations Executive and Facility Manager see all blocks', () {
      for (final id in [
        'ops.exec@qpmsdemo.com',
        'facility.manager@qpmsdemo.com',
      ]) {
        final blocks = controller(
          id,
        ).visibleTickets.map((t) => t.block).toSet();
        expect(blocks, {'Block A', 'Block B'});
      }
    });
  });

  group('ticket workflow', () {
    test('Supervisor can accept and start work', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0108';
      value.accept(id);
      expect(value.ticketById(id).status, HospitalTicketStatus.accepted);
      value.startWork(id);
      expect(value.ticketById(id).status, HospitalTicketStatus.inProgress);
    });

    test('Supervisor SLA breach escalates same ticket to Operations', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0108';
      value.simulateSupervisorBreach(id);
      expect(value.ticketById(id).id, id);
      expect(
        value.ticketById(id).status,
        HospitalTicketStatus.escalatedOperationsExecutive,
      );
    });

    test('Operations SLA breach escalates same ticket to Facility Manager', () {
      final value = controller('ops.exec@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0104';
      value.simulateOperationsBreach(id);
      expect(value.ticketById(id).id, id);
      expect(
        value.ticketById(id).status,
        HospitalTicketStatus.escalatedFacilityManager,
      );
    });

    test('Resolution awaits client confirmation and requires photo', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0108';
      value.accept(id);
      value.startWork(id);
      value.resolve(
        id,
        actionTaken: 'Cleaned and sanitized bathroom.',
        resolutionRemarks: 'Area inspected after cleaning.',
        completionPhotoPath: 'demo://completion',
      );
      expect(
        value.ticketById(id).status,
        HospitalTicketStatus.resolvedAwaitingConfirmation,
      );
      expect(value.ticketById(id).completionPhotoPaths, isNotEmpty);
    });

    test('Satisfied feedback closes same ticket', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0106';
      value.simulateClientFeedback(
        id,
        satisfied: true,
        rating: 5,
        comments: 'Clean and ready.',
      );
      expect(value.ticketById(id).status, HospitalTicketStatus.closed);
      expect(value.ticketById(id).id, id);
    });

    test('Not Satisfied reopens same ticket without duplication', () {
      final value = controller('facility.manager@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0106';
      final count = value.allTickets.length;
      value.simulateClientFeedback(
        id,
        satisfied: false,
        rating: 2,
        comments: 'Soap dispenser still does not operate.',
      );
      expect(value.allTickets.length, count);
      expect(value.ticketById(id).status, HospitalTicketStatus.reopened);
      expect(value.ticketById(id).reopenedCount, 1);
      expect(value.ticketById(id).events.last.action, 'Reopen');
    });

    test('automatic time advance keeps one ticket and applies both SLAs', () {
      final value = controller('facility.manager@qpmsdemo.com');
      final ticket = value.simulateNewClientComplaint(block: 'Block A');
      final count = value.allTickets.length;
      value.advanceDemoTime(const Duration(minutes: 21));
      expect(
        value.ticketById(ticket.id).status,
        HospitalTicketStatus.escalatedOperationsExecutive,
      );
      value.advanceDemoTime(const Duration(minutes: 31));
      expect(
        value.ticketById(ticket.id).status,
        HospitalTicketStatus.escalatedFacilityManager,
      );
      expect(value.allTickets.length, count);
    });
  });

  test('non-demo login IDs remain outside the isolated demo authenticator', () {
    expect(HospitalDemoAuth.isDemoLoginId('existing.user@qpms.com'), isFalse);
    expect(
      HospitalDemoAuth.authenticate(
        loginId: 'existing.user@qpms.com',
        candidatePassword: 'anything',
        testPasswordOverride: 'test-only-password',
      ),
      isNull,
    );
  });

  test('existing myQPMS mobile roles keep their current module access', () {
    for (final role in [
      'FO',
      'KAM',
      'Operations Manager',
      'Branch Head',
      'Admin',
      'Developer',
    ]) {
      expect(isMobileLoginRole(role), isTrue, reason: role);
    }
    expect(const HospitalAccessPolicy(), isNotNull);
  });
}
