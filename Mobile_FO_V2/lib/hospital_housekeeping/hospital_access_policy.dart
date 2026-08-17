import 'hospital_models.dart';

class HospitalAccessPolicy {
  const HospitalAccessPolicy();

  bool canView(HospitalDemoSession session, HospitalTicket ticket) {
    if (session.hasAllBlocks) return true;
    return ticket.block == session.assignedBlock;
  }

  List<HospitalTicket> visibleTickets(
    HospitalDemoSession session,
    Iterable<HospitalTicket> tickets,
  ) => tickets.where((ticket) => canView(session, ticket)).toList();

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
        if (ticket.status == HospitalTicketStatus.awaitingSupervisorAcceptance) {
          return {HospitalTicketAction.accept};
        }
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
          HospitalTicketAction.takeOver,
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
          HospitalTicketAction.takeOver,
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
          HospitalTicketAction.takeOver,
          ...completion,
        };
      case HospitalDemoRole.admin:
        if (ticket.isAwaitingClient) {
          return const {};
        }
        return {
          ...common,
          if (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive ||
              ticket.status == HospitalTicketStatus.escalatedFacilityManager ||
              ticket.status == HospitalTicketStatus.escalatedProjectHead)
            HospitalTicketAction.takeOver,
          HospitalTicketAction.reassignSupervisor,
          HospitalTicketAction.assignSupport,
          if (ticket.status !=
                  HospitalTicketStatus.escalatedOperationsExecutive &&
              ticket.status != HospitalTicketStatus.escalatedFacilityManager &&
              ticket.status != HospitalTicketStatus.escalatedProjectHead)
            HospitalTicketAction.escalateManually,
          if (ticket.status == HospitalTicketStatus.escalatedOperationsExecutive)
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
