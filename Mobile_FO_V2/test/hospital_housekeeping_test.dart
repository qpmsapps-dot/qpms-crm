import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_access_policy.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_controller.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_demo_auth.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_demo_repository.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_models.dart';
import 'package:myqpms_fo_v2/hospital_housekeeping/hospital_sla_policy.dart';
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

    test('Block A Supervisor sees the full active hospital queue', () {
      final tickets = controller('sup.blocka@qpmsdemo.com').visibleTickets;
      expect(tickets.any((ticket) => ticket.block != 'Block A'), isTrue);
      expect(tickets.every((ticket) => !ticket.isFinal), isTrue);
    });

    test('Block B Supervisor sees the full active hospital queue', () {
      final tickets = controller('sup.blockb@qpmsdemo.com').visibleTickets;
      expect(tickets.any((ticket) => ticket.block != 'Block B'), isTrue);
      expect(tickets.every((ticket) => !ticket.isFinal), isTrue);
    });

    test('Assigned to me remains personal inside the shared active queue', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      final all = value.filteredTickets();
      final mine = value.filteredTickets(assignedToMe: true);

      expect(all.any((ticket) => ticket.block == 'Block B'), isTrue);
      expect(mine, isNotEmpty);
      expect(mine.length, lessThan(all.length));
      expect(
        mine.every(
          (ticket) =>
              ticket.responsiblePerson.trim().toLowerCase() ==
              value.session.displayName.trim().toLowerCase(),
        ),
        isTrue,
      );
    });

    test(
      'role visibility is independent from management escalation ownership',
      () {
        const policy = HospitalAccessPolicy();
        const supervisor = HospitalDemoSession(
          loginId: 'sup@test',
          displayName: 'Supervisor',
          role: HospitalDemoRole.supervisor,
          assignedBlock: 'Block A',
        );
        const operations = HospitalDemoSession(
          loginId: 'ops@test',
          displayName: 'Operations',
          role: HospitalDemoRole.operationsExecutive,
          userId: 'ops-user',
        );
        const facility = HospitalDemoSession(
          loginId: 'fm@test',
          displayName: 'Facility',
          role: HospitalDemoRole.facilityManager,
          userId: 'facility-user',
        );
        const project = HospitalDemoSession(
          loginId: 'ph@test',
          displayName: 'Project',
          role: HospitalDemoRole.projectHead,
          userId: 'project-user',
        );
        final fresh = _policyTicket(
          status: HospitalTicketStatus.awaitingSupervisorAcceptance,
          role: 'housekeeping_supervisor',
        );
        final opsTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedOperationsExecutive,
          role: 'operations_executive',
          assigneeUserId: 'ops-user',
        );
        final facilityTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedFacilityManager,
          role: 'facility_manager',
          assigneeUserId: 'facility-user',
        );
        final projectTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedProjectHead,
          role: 'project_head',
          assigneeUserId: 'project-user',
        );

        expect(policy.canView(supervisor, fresh), isTrue);
        expect(policy.canView(operations, fresh), isTrue);
        expect(policy.canView(facility, fresh), isTrue);
        expect(policy.canView(project, fresh), isFalse);
        expect(policy.canView(operations, opsTicket), isTrue);
        expect(policy.canView(supervisor, opsTicket), isTrue);
        expect(policy.canView(facility, opsTicket), isTrue);
        expect(policy.canView(facility, facilityTicket), isTrue);
        expect(policy.canView(operations, facilityTicket), isTrue);
        expect(policy.canView(supervisor, facilityTicket), isTrue);
        expect(policy.canView(project, facilityTicket), isFalse);
        expect(policy.canView(project, projectTicket), isTrue);
        expect(policy.canView(operations, projectTicket), isTrue);
        expect(policy.canView(supervisor, projectTicket), isTrue);
      },
    );

    test(
      'higher escalation owners get takeover then work actions after acceptance',
      () {
        const policy = HospitalAccessPolicy();
        const operations = HospitalDemoSession(
          loginId: 'ops@test',
          displayName: 'Operations',
          role: HospitalDemoRole.operationsExecutive,
          userId: 'ops-user',
        );
        const facility = HospitalDemoSession(
          loginId: 'fm@test',
          displayName: 'Facility',
          role: HospitalDemoRole.facilityManager,
          userId: 'facility-user',
        );
        const project = HospitalDemoSession(
          loginId: 'ph@test',
          displayName: 'Project',
          role: HospitalDemoRole.projectHead,
          userId: 'project-user',
        );

        final opsTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedOperationsExecutive,
          role: 'operations_executive',
          assigneeUserId: 'ops-user',
          acceptanceStatus: 'accepted',
        );
        final awaitingOpsTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedOperationsExecutive,
          role: 'operations_executive',
          assigneeUserId: 'ops-user',
          acceptanceStatus: 'awaiting',
        );
        final facilityTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedFacilityManager,
          role: 'facility_manager',
          assigneeUserId: 'facility-user',
          acceptanceStatus: 'accepted',
        );
        final projectTicket = _policyTicket(
          status: HospitalTicketStatus.escalatedProjectHead,
          role: 'project_head',
          assigneeUserId: 'project-user',
          acceptanceStatus: 'accepted',
        );

        expect(
          policy.allowedActions(operations, awaitingOpsTicket),
          contains(HospitalTicketAction.takeOver),
        );

        for (final entry in [
          (operations, opsTicket),
          (facility, facilityTicket),
          (project, projectTicket),
        ]) {
          final actions = policy.allowedActions(entry.$1, entry.$2);
          expect(actions, isNot(contains(HospitalTicketAction.takeOver)));
          expect(actions, contains(HospitalTicketAction.startWork));
          expect(actions, contains(HospitalTicketAction.addProgress));
          expect(actions, contains(HospitalTicketAction.uploadCompletionPhoto));
          expect(actions, contains(HospitalTicketAction.resolve));
          expect(actions, contains(HospitalTicketAction.reassignSupervisor));
        }
      },
    );
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

    test('Operations owner uses completion photo before resolving', () {
      final value = controller('ops.exec@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0104';
      expect(
        value.actionsFor(value.ticketById(id)),
        contains(HospitalTicketAction.uploadCompletionPhoto),
      );
      value.uploadCompletionPhoto(id, photoPath: 'demo://oe-completion');
      value.resolve(
        id,
        actionTaken: 'Cleaned and disinfected the assigned area.',
        resolutionRemarks: 'Completion evidence uploaded and verified.',
      );
      final ticket = value.ticketById(id);
      expect(ticket.status, HospitalTicketStatus.resolvedAwaitingConfirmation);
      expect(ticket.completionPhotoPaths, contains('demo://oe-completion'));
    });

    test('Operations owner cannot resolve without completion evidence', () {
      final value = controller('ops.exec@qpmsdemo.com');
      expect(
        () => value.resolve(
          'QPMS-HH-2026-0104',
          actionTaken: 'Cleaned.',
          resolutionRemarks: 'Done.',
        ),
        throwsArgumentError,
      );
    });

    test('Facility Manager owner can resolve with completion evidence', () {
      final value = controller('facility.manager@qpmsdemo.com');
      const id = 'QPMS-HH-2026-0103';
      value.uploadCompletionPhoto(id, photoPath: 'demo://completion-$id');
      value.resolve(
        id,
        actionTaken: 'Completed housekeeping work.',
        resolutionRemarks: 'Area verified after completion.',
      );
      expect(
        value.ticketById(id).status,
        HospitalTicketStatus.resolvedAwaitingConfirmation,
      );
    });

    test('Project Head API action mapping supports completion workflow', () {
      final ticket = HospitalTicket.fromApi({
        'id': 'ticket-project',
        'block_name_snapshot': 'Block A',
        'floor_name': '3rd Floor',
        'location_text': 'Ward',
        'category': {'category_name': 'Housekeeping'},
        'priority': 'medium',
        'description': 'Delayed cleaning',
        'raised_by_name': 'Doctor',
        'raised_at': seed.toIso8601String(),
        'status_code': 'escalated_project_head',
        'current_assignee_role': 'project_head',
        'allowed_actions': ['progress', 'resolve'],
      });
      final value = HospitalController(
        session: const HospitalDemoSession(
          loginId: 'project@test',
          displayName: 'Project Head',
          role: HospitalDemoRole.projectHead,
          isDemo: false,
        ),
      );
      expect(
        value.actionsFor(ticket),
        contains(HospitalTicketAction.uploadCompletionPhoto),
      );
      expect(value.actionsFor(ticket), contains(HospitalTicketAction.resolve));
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

  group('hospital shell account access contract', () {
    test('Hospital shell exposes account and logout without demo tools', () {
      final source = File(
        'lib/hospital_housekeeping/hospital_shell.dart',
      ).readAsStringSync();
      expect(source, contains("tooltip: 'Account'"));
      expect(source, contains("label: const Text('Logout')"));
      expect(source, contains('await widget.onLogout()'));
      expect(source, contains('session.role.label'));
      expect(source, contains('session.clientName'));
    });

    test(
      'ticket detail labels completion flow without exposing close action',
      () {
        final source = File(
          'lib/hospital_housekeeping/hospital_ticket_detail_screen.dart',
        ).readAsStringSync();
        expect(source, contains("'Upload Completion Photo'"));
        expect(source, contains("'Completion Evidence'"));
        expect(source, contains("'Resolve Ticket'"));
        expect(
          source,
          contains('Work completion sent to client for confirmation.'),
        );
        expect(source, isNot(contains("'Close Ticket'")));
      },
    );
  });

  group('Phase 2B hospital ticket compatibility', () {
    test('room-backed ticket location display uses immutable snapshots', () {
      final ticket = HospitalTicket.fromApi({
        'id': 'QPMS-HK-2026-000008',
        'site_name_snapshot': 'NIMS Hyderabad',
        'block_name_snapshot': 'Speciality Block',
        'floor_name': '5th Floor',
        'department_name': 'Surgical Gastroenterology',
        'location_text': '503',
        'room_area_snapshot': '503',
        'exact_landmark_snapshot': 'Test landmark near Room 503',
        'location_path_snapshot':
            'NIMS Hyderabad > Speciality Block > 5th Floor > Surgical Gastroenterology > 503 > Test landmark near Room 503',
        'category': {'category_name': 'Housekeeping'},
        'priority': 'medium',
        'description': 'Test',
        'raised_by_name': 'Doctor',
        'raised_at': seed.toIso8601String(),
        'status_code': 'assigned',
        'current_assignee_role': 'housekeeping_supervisor',
        'assignee': {'display_name': 'Supervisor'},
        'supervisor_sla_due_at': seed
            .add(const Duration(minutes: 20))
            .toIso8601String(),
      });

      expect(ticket.fullLocationDisplay, contains('NIMS Hyderabad'));
      expect(ticket.conciseLocation, isNot(contains('Room 503')));
      expect(ticket.conciseLocation, contains('503'));
      expect(ticket.supervisorDueAt, isNotNull);
    });

    test('landmark-only ticket hides missing floor and dedupes landmark', () {
      final ticket = HospitalTicket.fromApi({
        'id': 'QPMS-HK-2026-000007',
        'site_name_snapshot': 'NIMS Hyderabad',
        'block_name_snapshot': 'Speciality Block',
        'floor_name': 'Not specified',
        'department_name': 'SPL Cardiology OP',
        'location_text': 'Opposite Nursing Station near Lift 2',
        'exact_landmark_snapshot': 'Opposite Nursing Station near Lift 2',
        'location_path_snapshot':
            'NIMS Hyderabad > Speciality Block > SPL Cardiology OP > Opposite Nursing Station near Lift 2',
        'category': {'category_name': 'Housekeeping'},
        'priority': 'medium',
        'description': 'Test',
        'raised_by_name': 'Doctor',
        'raised_at': seed.toIso8601String(),
        'status_code': 'open',
      });

      expect(ticket.floor, isEmpty);
      expect(ticket.fullLocationDisplay, isNot(contains('Not specified')));
      expect(
        'Opposite Nursing Station near Lift 2'
            .allMatches(ticket.fullLocationDisplay)
            .length,
        1,
      );
      expect(ticket.conciseLocation, contains('SPL Cardiology OP'));
    });

    test('unassigned ticket shows no false supervisor SLA', () {
      final ticket = HospitalTicket.fromApi({
        'id': 'QPMS-HK-2026-000009',
        'block_name_snapshot': 'Speciality Block',
        'department_name': 'Surgical Gastroenterology',
        'location_text': '503',
        'category': {'category_name': 'Housekeeping'},
        'priority': 'medium',
        'description': 'Test',
        'raised_by_name': 'Doctor',
        'raised_at': seed.toIso8601String(),
        'status_code': 'open',
      });

      final sla = const HospitalSlaPolicy().snapshot(ticket, seed);
      expect(ticket.responsiblePerson, 'Assignment pending');
      expect(sla.label, 'No supervisor SLA - unassigned');
    });

    test(
      'production actions derive helper buttons from backend permissions',
      () {
        final session = const HospitalDemoSession(
          loginId: 'sup@test',
          displayName: 'Supervisor',
          role: HospitalDemoRole.supervisor,
          assignedBlock: 'Speciality Block',
          isDemo: false,
        );
        final controller = HospitalController(session: session);
        final ticket = HospitalTicket.fromApi({
          'id': 'ticket-1',
          'block': {'block_name': 'Speciality Block'},
          'location_text': '503',
          'category': {'category_name': 'Housekeeping'},
          'priority': 'medium',
          'description': 'Test',
          'raised_by_name': 'Doctor',
          'raised_at': seed.toIso8601String(),
          'status_code': 'in_progress',
          'allowed_actions': ['progress', 'resolve'],
        });

        final actions = controller.actionsFor(ticket);
        expect(actions, contains(HospitalTicketAction.addProgress));
        expect(actions, contains(HospitalTicketAction.addRemarks));
        expect(actions, contains(HospitalTicketAction.uploadProgressPhoto));
        expect(actions, contains(HospitalTicketAction.resolve));
        expect(actions, isNot(contains(HospitalTicketAction.accept)));
      },
    );

    test('demo mode includes hierarchy and landmark-only ticket examples', () {
      final value = controller('sup.blocka@qpmsdemo.com');
      final landmark = value.ticketById('QPMS-HH-2026-0100');

      expect(landmark.site, 'NIMS Hyderabad');
      expect(landmark.floor, isEmpty);
      expect(landmark.exactLandmark, contains('Opposite Nursing Station'));
      expect(landmark.fullLocationDisplay, isNot(contains('null')));
      expect(value.visibleTickets, contains(landmark));
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

HospitalTicket _policyTicket({
  required HospitalTicketStatus status,
  required String role,
  String assigneeUserId = '',
  String acceptanceStatus = '',
  DateTime? workStartedAt,
}) => HospitalTicket(
  id: 'ticket-${status.code}',
  ticketNumber: 'QPMS-HK-2026-000001',
  block: 'Block A',
  floor: 'Second Floor',
  location: 'Ward',
  category: 'Housekeeping',
  priority: HospitalPriority.low,
  description: 'Test',
  reportedBy: 'Doctor',
  raisedAt: DateTime(2026, 7, 16, 10),
  status: status,
  responsiblePerson: 'Owner',
  responsibleRole: role,
  currentAssigneeUserId: assigneeUserId,
  acceptanceStatus: acceptanceStatus,
  workStartedAt: workStartedAt,
  supervisorName: 'Supervisor',
  supervisorDueAt: DateTime(2026, 7, 16, 10, 20),
  events: const [],
);
