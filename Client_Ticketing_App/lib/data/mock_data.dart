import '../core/constants/app_assets.dart';
import '../models/client_site.dart';
import '../models/notification_item.dart';
import '../models/ticket.dart';
import '../models/ticket_update.dart';

const demoBlocks = ['Block A', 'Block B', 'Block C', 'Main Building'];
const demoFloors = [
  'Ground Floor',
  '1st Floor',
  '2nd Floor',
  '3rd Floor',
  '4th Floor',
];
const demoLocations = [
  'OPD Waiting Area',
  'Nurse Station',
  'ICU Washroom',
  'Staff Washroom',
  'General Ward',
  'Emergency Corridor',
];
const housekeepingCategories = [
  'Housekeeping',
  'Washroom Cleaning',
  'General Cleaning',
  'Consumables',
  'Odor Issue',
  'Wet Area',
];

final demoSites = <ClientSite>[
  for (final block in demoBlocks) ClientSite(block),
];

List<Ticket> initialTickets() {
  final now = DateTime.now();
  return [
    Ticket(
      number: 'QPMS-HK-2026-0005',
      block: 'Block A',
      floor: '3rd Floor',
      location: 'Staff Washroom',
      category: 'Odor Issue',
      description: 'Bad smell in 3rd floor washroom.',
      priority: TicketPriority.high,
      raisedBy: 'Hospital User',
      raisedAt: now.subtract(const Duration(minutes: 48)),
      status: TicketStatus.escalatedOperations,
      assignedPerson: 'Anand S.',
      assignedRole: 'Operations Executive',
      slaLabel: 'Supervisor SLA breached • Operations response due in 12 min',
      complaintPhotoAssets: const [AppAssets.washroom],
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Housekeeping complaint logged.',
          dateTime: now.subtract(const Duration(minutes: 48)),
        ),
        TicketUpdate(
          title: 'Assigned to Housekeeping Supervisor',
          body: 'Supervisor SLA started: 20 minutes.',
          dateTime: now.subtract(const Duration(minutes: 46)),
        ),
        TicketUpdate(
          title: 'Escalated to Operations Executive',
          body: 'Supervisor SLA exceeded.',
          dateTime: now.subtract(const Duration(minutes: 26)),
          isEscalation: true,
        ),
      ],
    ),
    Ticket(
      number: 'QPMS-HK-2026-0004',
      block: 'Block B',
      floor: 'Ground Floor',
      location: 'OPD Waiting Area',
      category: 'Housekeeping',
      description: 'Dustbin not cleared in OPD waiting area.',
      priority: TicketPriority.medium,
      raisedBy: 'Hospital User',
      raisedAt: now.subtract(const Duration(hours: 2, minutes: 12)),
      status: TicketStatus.inProgress,
      assignedPerson: 'Meena R.',
      assignedRole: 'Housekeeping Supervisor',
      slaLabel: 'Work in progress • Update expected in 8 min',
      complaintPhotoAssets: const [AppAssets.consumables],
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Complaint logged from OPD.',
          dateTime: now.subtract(const Duration(hours: 2, minutes: 12)),
        ),
        TicketUpdate(
          title: 'Assigned to Housekeeping Supervisor',
          body: 'Meena R. acknowledged the complaint.',
          dateTime: now.subtract(const Duration(hours: 2, minutes: 10)),
        ),
        TicketUpdate(
          title: 'In Progress',
          body: 'Housekeeping team dispatched.',
          dateTime: now.subtract(const Duration(minutes: 12)),
        ),
      ],
    ),
    Ticket(
      number: 'QPMS-HK-2026-0003',
      block: 'Main Building',
      floor: '2nd Floor',
      location: 'Nurse Station',
      category: 'Washroom Cleaning',
      description: 'Bathroom not cleaned properly near nurse station.',
      priority: TicketPriority.high,
      raisedBy: 'Hospital User',
      raisedAt: now.subtract(const Duration(hours: 4, minutes: 20)),
      status: TicketStatus.awaitingConfirmation,
      assignedPerson: 'Rajesh K.',
      assignedRole: 'Housekeeping Supervisor',
      slaLabel: 'Resolved • Waiting for your confirmation',
      complaintPhotoAssets: const [AppAssets.washroom],
      completionPhotoAssets: const [AppAssets.washroom],
      resolutionNotes:
          'Washroom deep-cleaned, floor dried and consumables replenished.',
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Cleaning complaint logged.',
          dateTime: now.subtract(const Duration(hours: 4, minutes: 20)),
        ),
        TicketUpdate(
          title: 'Assigned to Housekeeping Supervisor',
          body: 'Rajesh K. assigned.',
          dateTime: now.subtract(const Duration(hours: 4, minutes: 18)),
        ),
        TicketUpdate(
          title: 'In Progress',
          body: 'Deep cleaning started.',
          dateTime: now.subtract(const Duration(hours: 4)),
        ),
        TicketUpdate(
          title: 'Resolved – Awaiting Confirmation',
          body: 'Please verify the completed work.',
          dateTime: now.subtract(const Duration(minutes: 35)),
        ),
      ],
    ),
    Ticket(
      number: 'QPMS-HK-2026-0002',
      block: 'Block A',
      floor: '1st Floor',
      location: 'ICU Washroom',
      category: 'Wet Area',
      description: 'Wet floor near ICU washroom.',
      priority: TicketPriority.high,
      raisedBy: 'Hospital User',
      raisedAt: now.subtract(const Duration(days: 1, hours: 2)),
      status: TicketStatus.closed,
      assignedPerson: 'Meena R.',
      assignedRole: 'Housekeeping Supervisor',
      slaLabel: 'Closed after client confirmation',
      complaintPhotoAssets: const [AppAssets.wetFloor],
      completionPhotoAssets: const [AppAssets.wetFloor],
      resolutionNotes:
          'Area mopped and dried. Wet-floor caution signage removed after verification.',
      feedbackRating: 5,
      feedbackComment: 'Resolved quickly. Thank you.',
      isSatisfied: true,
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Safety cleaning request logged.',
          dateTime: now.subtract(const Duration(days: 1, hours: 2)),
        ),
        TicketUpdate(
          title: 'Resolved – Awaiting Confirmation',
          body: 'Area cleaned and made safe.',
          dateTime: now.subtract(
            const Duration(days: 1, hours: 1, minutes: 38),
          ),
        ),
        TicketUpdate(
          title: 'Closed',
          body: 'Client confirmed satisfaction.',
          dateTime: now.subtract(
            const Duration(days: 1, hours: 1, minutes: 25),
          ),
        ),
      ],
    ),
    Ticket(
      number: 'QPMS-HK-2026-0001',
      block: 'Block C',
      floor: '4th Floor',
      location: 'Staff Washroom',
      category: 'Consumables',
      description: 'Soap dispenser empty in staff washroom.',
      priority: TicketPriority.low,
      raisedBy: 'Hospital User',
      raisedAt: now.subtract(const Duration(days: 2, hours: 1)),
      status: TicketStatus.closed,
      assignedPerson: 'Rajesh K.',
      assignedRole: 'Housekeeping Supervisor',
      slaLabel: 'Closed after client confirmation',
      complaintPhotoAssets: const [AppAssets.consumables],
      completionPhotoAssets: const [AppAssets.consumables],
      resolutionNotes: 'Soap dispenser refilled and tested.',
      feedbackRating: 4,
      feedbackComment: 'Completed satisfactorily.',
      isSatisfied: true,
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Consumables request logged.',
          dateTime: now.subtract(const Duration(days: 2, hours: 1)),
        ),
        TicketUpdate(
          title: 'Closed',
          body: 'Client confirmed satisfaction.',
          dateTime: now.subtract(const Duration(days: 2, minutes: 25)),
        ),
      ],
    ),
  ];
}

List<NotificationItem> initialNotifications() => [
  NotificationItem(
    id: 'n1',
    title: 'Confirmation required',
    body: 'QPMS-HK-2026-0003 has been resolved. Please verify the work.',
    time: '35 min ago',
    iconKey: 'done',
    ticketNumber: 'QPMS-HK-2026-0003',
  ),
  NotificationItem(
    id: 'n2',
    title: 'Complaint escalated',
    body: 'QPMS-HK-2026-0005 is now assigned to the Operations Executive.',
    time: '26 min ago',
    iconKey: 'alert',
    ticketNumber: 'QPMS-HK-2026-0005',
  ),
  NotificationItem(
    id: 'n3',
    title: 'Housekeeping team assigned',
    body: 'Meena R. is working on QPMS-HK-2026-0004.',
    time: '2 hr ago',
    iconKey: 'person',
    ticketNumber: 'QPMS-HK-2026-0004',
  ),
];
