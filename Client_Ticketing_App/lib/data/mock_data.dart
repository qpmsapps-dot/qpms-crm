import '../core/constants/app_assets.dart';
import '../models/client_site.dart';
import '../models/notification_item.dart';
import '../models/ticket.dart';
import '../models/ticket_update.dart';

const featuredTicketNumber = 'TKT-2026-001';

final demoSites = <ClientSite>[
  const ClientSite('Rajiv Gandhi Government Hospital, Chennai'),
  const ClientSite('Chennai Corporate Office'),
  const ClientSite('Bengaluru Retail Site'),
  const ClientSite('Hyderabad Hospital Site'),
  const ClientSite('Cochin Airport Facility'),
];

Ticket featuredTicket() => Ticket(
  number: featuredTicketNumber,
  category: 'Electrical',
  title: 'Lights Flickering in Main Corridor',
  site: 'Rajiv Gandhi Government Hospital, Chennai',
  description:
      'Lights in the main corridor are flickering continuously and require urgent inspection.',
  priority: TicketPriority.high,
  raisedBy: 'Client User',
  assignedTechnician: 'Ravi Kumar',
  raisedDate: '17 June 2026, 09:15 AM',
  status: TicketStatus.inProgress,
  photoAssets: const [
    AppAssets.photoPanel,
    AppAssets.photoLight,
    AppAssets.photoWiring,
  ],
);

List<Ticket> initialTickets() => [
  featuredTicket(),
  Ticket(
    number: 'TKT-2026-002',
    category: 'HVAC',
    title: 'AC Not Cooling - 3rd Floor',
    site: 'Chennai Corporate Office',
    description: 'The third-floor meeting room AC is running but not cooling.',
    priority: TicketPriority.medium,
    raisedBy: 'Client User',
    assignedTechnician: 'Unassigned',
    raisedDate: '17 June 2026, 10:05 AM',
    status: TicketStatus.open,
  ),
  Ticket(
    number: 'TKT-2026-003',
    category: 'Plumbing',
    title: 'Plumbing Leakage - Washroom',
    site: 'Bengaluru Retail Site',
    description: 'Water leakage noticed below the wash basin.',
    priority: TicketPriority.low,
    raisedBy: 'Client User',
    assignedTechnician: 'Suresh Mani',
    raisedDate: '17 June 2026, 08:45 AM',
    status: TicketStatus.closed,
  ),
  Ticket(
    number: 'TKT-2026-004',
    category: 'Electrical',
    title: 'Generator Maintenance',
    site: 'Hyderabad Hospital Site',
    description: 'Scheduled generator inspection needs approval.',
    priority: TicketPriority.medium,
    raisedBy: 'Client User',
    assignedTechnician: 'Ravi Kumar',
    raisedDate: '17 June 2026, 08:30 AM',
    status: TicketStatus.onHold,
  ),
];

final demoUpdates = <TicketUpdate>[
  const TicketUpdate(
    title: 'Ticket Raised',
    body: 'Client User raised this request',
    dateTime: '17 Jun 2026, 09:15 AM',
  ),
  const TicketUpdate(
    title: 'Assigned to Ravi Kumar',
    body: 'Ravi Kumar has been assigned',
    dateTime: '17 Jun 2026, 09:20 AM',
  ),
  const TicketUpdate(
    title: 'Work Started',
    body: 'Work has been started',
    dateTime: '17 Jun 2026, 10:15 AM',
  ),
  const TicketUpdate(
    title: 'Replacement electrical component required',
    body: 'Premium switch and connector are required',
    dateTime: '17 Jun 2026, 11:30 AM',
  ),
  const TicketUpdate(
    title: 'Issue Resolved',
    body: 'Issue has been resolved',
    dateTime: '17 Jun 2026, 02:15 PM',
  ),
];

List<String> initialComments() => [
  'Please prioritize this corridor because it is used by visitors.',
  'Ravi Kumar: Inspection started. I will update after checking the wiring.',
];

List<NotificationItem> initialNotifications() => [
  NotificationItem(
    id: 'n1',
    title: 'Ticket successfully raised',
    body: 'TKT-2026-001 has been created.',
    time: '17 Jun 2026, 09:16 AM',
    iconKey: 'ticket',
    ticketNumber: featuredTicketNumber,
  ),
  NotificationItem(
    id: 'n2',
    title: 'Ravi Kumar assigned',
    body: 'Ravi Kumar has been assigned to TKT-2026-001.',
    time: '17 Jun 2026, 09:20 AM',
    iconKey: 'person',
    ticketNumber: featuredTicketNumber,
  ),
  NotificationItem(
    id: 'n3',
    title: 'Work started',
    body: 'Electrical inspection has started.',
    time: '17 Jun 2026, 10:15 AM',
    iconKey: 'work',
    ticketNumber: featuredTicketNumber,
  ),
  NotificationItem(
    id: 'n4',
    title: 'New technician comment added',
    body: 'Ravi Kumar added a new work update.',
    time: '17 Jun 2026, 10:40 AM',
    iconKey: 'comment',
    ticketNumber: featuredTicketNumber,
  ),
  NotificationItem(
    id: 'n5',
    title: 'Ticket resolved',
    body: 'TKT-2026-001 has been resolved.',
    time: '17 Jun 2026, 11:45 AM',
    iconKey: 'done',
    ticketNumber: featuredTicketNumber,
  ),
  NotificationItem(
    id: 'n6',
    title: 'Ticket closed',
    body: 'Your ticket TKT-2026-001 has been closed.',
    time: '17 Jun 2026, 04:00 PM',
    iconKey: 'closed',
    ticketNumber: featuredTicketNumber,
  ),
];
