enum TicketStatus { open, inProgress, onHold, closed }

enum TicketPriority { low, medium, high }

class Ticket {
  Ticket({
    required this.number,
    required this.category,
    required this.title,
    required this.site,
    required this.description,
    required this.priority,
    required this.raisedBy,
    required this.assignedTechnician,
    required this.raisedDate,
    required this.status,
    this.photoAssets = const [],
  });

  final String number;
  final String category;
  final String title;
  final String site;
  final String description;
  final TicketPriority priority;
  final String raisedBy;
  final String assignedTechnician;
  final String raisedDate;
  final TicketStatus status;
  final List<String> photoAssets;

  Ticket copyWith({
    String? number,
    String? category,
    String? title,
    String? site,
    String? description,
    TicketPriority? priority,
    String? raisedBy,
    String? assignedTechnician,
    String? raisedDate,
    TicketStatus? status,
    List<String>? photoAssets,
  }) {
    return Ticket(
      number: number ?? this.number,
      category: category ?? this.category,
      title: title ?? this.title,
      site: site ?? this.site,
      description: description ?? this.description,
      priority: priority ?? this.priority,
      raisedBy: raisedBy ?? this.raisedBy,
      assignedTechnician: assignedTechnician ?? this.assignedTechnician,
      raisedDate: raisedDate ?? this.raisedDate,
      status: status ?? this.status,
      photoAssets: photoAssets ?? this.photoAssets,
    );
  }
}

String statusLabel(TicketStatus status) {
  return switch (status) {
    TicketStatus.open => 'Open',
    TicketStatus.inProgress => 'In Progress',
    TicketStatus.onHold => 'On Hold',
    TicketStatus.closed => 'Closed',
  };
}

String priorityLabel(TicketPriority priority) {
  return switch (priority) {
    TicketPriority.low => 'Low',
    TicketPriority.medium => 'Medium',
    TicketPriority.high => 'High',
  };
}
