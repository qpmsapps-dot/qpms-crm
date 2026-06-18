class NotificationItem {
  NotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.time,
    required this.iconKey,
    this.ticketNumber,
    this.isRead = false,
  });

  final String id;
  final String title;
  final String body;
  final String time;
  final String iconKey;
  final String? ticketNumber;
  bool isRead;
}
