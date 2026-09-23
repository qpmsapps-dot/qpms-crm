import 'hospital_models.dart';

class HospitalAccessPolicy {
  const HospitalAccessPolicy();

  bool canView(HospitalDemoSession session, HospitalTicket ticket) {
    if (session.role == HospitalDemoRole.admin) return true;
    if (session.role == HospitalDemoRole.facilityManager) return true;
    if (session.role == HospitalDemoRole.operationsExecutive ||
        session.role == HospitalDemoRole.supervisor) {
      return !ticket.isFinal;
    }
    if (!_withinScope(session, ticket)) return false;
    if (ticket.isAwaitingClient) return true;
    return _isCurrentOperationalOwner(session, ticket);
  }

  List<HospitalTicket> visibleTickets(
    HospitalDemoSession session,
    Iterable<HospitalTicket> tickets,
  ) => tickets.where((ticket) => canView(session, ticket)).toList();

  bool _withinScope(HospitalDemoSession session, HospitalTicket ticket) {
    if (session.hasAllBlocks) return true;
    if (session.assignedBlocks.isNotEmpty) {
      return session.assignedBlocks.contains(ticket.block);
    }
    return ticket.block == session.assignedBlock;
  }

  bool _isCurrentOperationalOwner(
    HospitalDemoSession session,
    HospitalTicket ticket,
  ) {
    if (session.role == HospitalDemoRole.supervisor) {
      final sessionUserId = session.userId.trim().isNotEmpty
          ? session.userId.trim()
          : session.loginId.trim();
      if (ticket.supervisorUserId.isNotEmpty) {
        return ticket.supervisorUserId == sessionUserId;
      }
      if (ticket.acceptedByUserId.isNotEmpty) {
        return ticket.acceptedByUserId == sessionUserId;
      }
      return ticket.responsiblePerson.trim().toLowerCase() ==
          session.displayName.trim().toLowerCase();
    }
    final expectedRole = _roleCodeForSession(session.role);
    if (expectedRole.isEmpty) return false;
    if (_ticketOwnerRole(ticket) != expectedRole) return false;
    return ticket.currentAssigneeUserId.isEmpty ||
        session.userId.isEmpty ||
        ticket.currentAssigneeUserId == session.userId;
  }

  String _ticketOwnerRole(HospitalTicket ticket) {
    final assignedRole = _normalizeRole(ticket.responsibleRole);
    if (_operationalRoles.contains(assignedRole)) return assignedRole;
    return switch (ticket.status) {
      HospitalTicketStatus.open ||
      HospitalTicketStatus.awaitingSupervisorAcceptance ||
      HospitalTicketStatus.assigned ||
      HospitalTicketStatus.accepted ||
      HospitalTicketStatus.inProgress ||
      HospitalTicketStatus.reopened => 'housekeeping_supervisor',
      HospitalTicketStatus.escalatedOperationsExecutive =>
        'operations_executive',
      HospitalTicketStatus.escalatedFacilityManager => 'facility_manager',
      HospitalTicketStatus.escalatedProjectHead => 'project_head',
      _ => '',
    };
  }

  String _roleCodeForSession(HospitalDemoRole role) => switch (role) {
    HospitalDemoRole.supervisor => 'housekeeping_supervisor',
    HospitalDemoRole.operationsExecutive => 'operations_executive',
    HospitalDemoRole.facilityManager => 'facility_manager',
    HospitalDemoRole.projectHead => 'project_head',
    HospitalDemoRole.admin => 'admin',
  };

  String _normalizeRole(String value) {
    final key = value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    return switch (key) {
      'hospital_supervisor' || 'supervisor' => 'housekeeping_supervisor',
      'operations_executive' || 'zonal_head' => 'operations_executive',
      'facility_manager' => 'facility_manager',
      'project_head' || 'projecthead' => 'project_head',
      _ => key,
    };
  }

  Set<HospitalTicketAction> allowedActions(
    HospitalDemoSession session,
    HospitalTicket ticket,
  ) {
    if (!canView(session, ticket) || ticket.isFinal) return const {};
    final common = <HospitalTicketAction>{
      HospitalTicketAction.addRemarks,
      HospitalTicketAction.addProgress,
      HospitalTicketAction.uploadProgressPhoto,
    };
    final completion = <HospitalTicketAction>{
      HospitalTicketAction.uploadCompletionPhoto,
      HospitalTicketAction.resolve,
    };

    switch (session.role) {
      case HospitalDemoRole.supervisor:
        if (ticket.isAwaitingClient) {
          return {
            HospitalTicketAction.simulateClientSatisfied,
            HospitalTicketAction.simulateClientNotSatisfied,
          };
        }
        final available = ticket.supervisorUserId.isEmpty;
        if (available &&
            ticket.status !=
                HospitalTicketStatus.resolvedAwaitingConfirmation) {
          return {
            HospitalTicketAction.accept,
            if (session.isDemo &&
                ticket.status !=
                    HospitalTicketStatus.escalatedOperationsExecutive &&
                ticket.status !=
                    HospitalTicketStatus.escalatedFacilityManager &&
                ticket.status != HospitalTicketStatus.escalatedProjectHead)
              HospitalTicketAction.simulateSupervisorBreach,
          };
        }
        if (!_isCurrentOperationalOwner(session, ticket)) return const {};
        return {
          ...common,
          if (ticket.status == HospitalTicketStatus.open ||
              ticket.status == HospitalTicketStatus.assigned ||
              ticket.status == HospitalTicketStatus.reopened)
            HospitalTicketAction.accept,
          if (ticket.status == HospitalTicketStatus.accepted)
            HospitalTicketAction.startWork,
          if (ticket.status == HospitalTicketStatus.inProgress ||
              ticket.status == HospitalTicketStatus.accepted ||
              ticket.status == HospitalTicketStatus.reopened)
            ...completion,
          HospitalTicketAction.requestAssistance,
          if (ticket.status !=
                  HospitalTicketStatus.escalatedOperationsExecutive &&
              ticket.status != HospitalTicketStatus.escalatedFacilityManager &&
              ticket.status != HospitalTicketStatus.escalatedProjectHead)
            HospitalTicketAction.escalateManually,
          if (ticket.status !=
                  HospitalTicketStatus.escalatedOperationsExecutive &&
              ticket.status != HospitalTicketStatus.escalatedFacilityManager &&
              ticket.status != HospitalTicketStatus.escalatedProjectHead)
            HospitalTicketAction.simulateSupervisorBreach,
        };
      case HospitalDemoRole.operationsExecutive:
        if (ticket.isAwaitingClient) {
          return {
            HospitalTicketAction.simulateClientSatisfied,
            HospitalTicketAction.simulateClientNotSatisfied,
          };
        }
        return {
          ...common,
          if (ticket.acceptanceStatus != 'accepted')
            HospitalTicketAction.takeOver,
          if (ticket.acceptanceStatus == 'accepted' &&
              ticket.workStartedAt == null)
            HospitalTicketAction.startWork,
          HospitalTicketAction.reassignSupervisor,
          ...completion,
          HospitalTicketAction.escalateFurther,
          if (ticket.status ==
              HospitalTicketStatus.escalatedOperationsExecutive)
            HospitalTicketAction.simulateOperationsBreach,
        };
      case HospitalDemoRole.facilityManager:
        if (ticket.isAwaitingClient) {
          return {
            HospitalTicketAction.simulateClientSatisfied,
            HospitalTicketAction.simulateClientNotSatisfied,
          };
        }
        return {
          ...common,
          if (ticket.acceptanceStatus != 'accepted')
            HospitalTicketAction.takeOver,
          if (ticket.acceptanceStatus == 'accepted' &&
              ticket.workStartedAt == null)
            HospitalTicketAction.startWork,
          HospitalTicketAction.reassignSupervisor,
          HospitalTicketAction.assignSupport,
          ...completion,
          if (ticket.status ==
              HospitalTicketStatus.escalatedOperationsExecutive)
            HospitalTicketAction.simulateOperationsBreach,
        };
      case HospitalDemoRole.projectHead:
        if (ticket.isAwaitingClient) {
          return {
            HospitalTicketAction.simulateClientSatisfied,
            HospitalTicketAction.simulateClientNotSatisfied,
          };
        }
        return {
          ...common,
          if (ticket.acceptanceStatus != 'accepted')
            HospitalTicketAction.takeOver,
          if (ticket.acceptanceStatus == 'accepted' &&
              ticket.workStartedAt == null)
            HospitalTicketAction.startWork,
          HospitalTicketAction.reassignSupervisor,
          ...completion,
        };
      case HospitalDemoRole.admin:
        if (ticket.isAwaitingClient) {
          return const {};
        }
        return {
          ...common,
          if ((ticket.status ==
                      HospitalTicketStatus.escalatedOperationsExecutive ||
                  ticket.status ==
                      HospitalTicketStatus.escalatedFacilityManager ||
                  ticket.status == HospitalTicketStatus.escalatedProjectHead) &&
              ticket.acceptanceStatus != 'accepted')
            HospitalTicketAction.takeOver,
          HospitalTicketAction.reassignSupervisor,
          HospitalTicketAction.assignSupport,
          if (ticket.status !=
                  HospitalTicketStatus.escalatedOperationsExecutive &&
              ticket.status != HospitalTicketStatus.escalatedFacilityManager &&
              ticket.status != HospitalTicketStatus.escalatedProjectHead)
            HospitalTicketAction.escalateManually,
          if (ticket.status ==
              HospitalTicketStatus.escalatedOperationsExecutive)
            HospitalTicketAction.escalateFurther,
          if (ticket.status == HospitalTicketStatus.accepted ||
              ticket.status == HospitalTicketStatus.inProgress ||
              ticket.status == HospitalTicketStatus.reopened ||
              ticket.status ==
                  HospitalTicketStatus.escalatedOperationsExecutive ||
              ticket.status == HospitalTicketStatus.escalatedFacilityManager ||
              ticket.status == HospitalTicketStatus.escalatedProjectHead)
            ...completion,
        };
    }
  }
}

const _operationalRoles = {
  'housekeeping_supervisor',
  'operations_executive',
  'facility_manager',
  'project_head',
};
