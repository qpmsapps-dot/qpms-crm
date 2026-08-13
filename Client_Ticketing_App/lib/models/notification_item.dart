class NotificationItem {
  NotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.time,
    required this.iconKey,
    this.createdAt,
    this.beforeImageUrl,
    this.ticketId,
    this.ticketNumber,
    this.isRead = false,
  });

  final String id;
  final String title;
  final String body;
  final String time;
  final String iconKey;
  final DateTime? createdAt;
  final String? beforeImageUrl;
  final String? ticketId;
  final String? ticketNumber;
  bool isRead;

  bool get isActionRequired => iconKey == 'awaiting_confirmation';
}
