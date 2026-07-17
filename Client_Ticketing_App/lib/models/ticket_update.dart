class TicketUpdate {
  const TicketUpdate({
    required this.title,
    required this.body,
    required this.dateTime,
    this.isEscalation = false,
  });

  final String title;
  final String body;
  final DateTime dateTime;
  final bool isEscalation;
}
