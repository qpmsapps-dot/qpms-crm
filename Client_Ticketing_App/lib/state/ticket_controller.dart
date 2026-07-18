import 'package:flutter/foundation.dart';

import '../models/ticket.dart';
import '../models/ticket_update.dart';
import '../data/mock_data.dart';
import '../services/app_config.dart';
import '../services/hospital_ticket_api.dart';

class ComplaintDraft {
  ComplaintDraft({
    this.block = 'Block A',
    this.floor = 'Ground Floor',
    this.location = 'OPD Waiting Area',
    this.category = 'Housekeeping',
    this.priority = TicketPriority.medium,
    this.description = '',
    this.photoPaths = const [],
    String? idempotencyKey,
  }) : idempotencyKey =
           idempotencyKey ?? 'client-${DateTime.now().microsecondsSinceEpoch}';

  String block;
  String floor;
  String location;
  String category;
  TicketPriority priority;
  String description;
  List<String> photoPaths;
  final String idempotencyKey;
}

class TicketController extends ChangeNotifier {
  TicketController({bool? demoMode})
    : demoMode = demoMode ?? ClientAppConfig.demoMode {
    if (this.demoMode) {
      resetMockData();
    } else {
      _tickets = [];
    }
  }

  final bool demoMode;
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _blocks = [];
  List<Map<String, dynamic>> _locations = [];
  List<Map<String, dynamic>> _categories = [];

  late List<Ticket> _tickets;
  int _nextTicketSequence = 6;

  List<Ticket> get tickets => List.unmodifiable(_tickets);
  bool get isLoading => _loading;
  String? get error => _error;
  List<Map<String, dynamic>> get blocks => List.unmodifiable(_blocks);
  List<Map<String, dynamic>> get locations => List.unmodifiable(_locations);
  List<Map<String, dynamic>> get categories => List.unmodifiable(_categories);

  @visibleForTesting
  void replaceMastersForTesting({
    required List<Map<String, dynamic>> blocks,
    required List<Map<String, dynamic>> locations,
    List<Map<String, dynamic>> categories = const [],
  }) {
    _blocks = blocks;
    _locations = locations;
    _categories = categories;
  }

  List<String> floorsForBlock(String blockName) {
    final matches = _blocks
        .where((row) => row['block_name'] == blockName)
        .toList();
    if (matches.isEmpty) return const [];
    final block = matches.first;
    return _locations
        .where((row) => row['block_id'] == block['id'])
        .map((row) => '${row['floor_name'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList();
  }

  List<String> locationsForBlockAndFloor(String blockName, String floorName) {
    final matches = _blocks
        .where((row) => row['block_name'] == blockName)
        .toList();
    if (matches.isEmpty) return const [];
    final block = matches.first;
    return _locations
        .where(
          (row) =>
              row['block_id'] == block['id'] && row['floor_name'] == floorName,
        )
        .map((row) => '${row['location_name'] ?? ''}'.trim())
        .where((value) => value.isNotEmpty)
        .toList();
  }

  int get openCount => _tickets
      .where(
        (ticket) =>
            ticketMatchesFilter(ticket, TicketListFilter.open) ||
            ticket.status == TicketStatus.inProgress,
      )
      .length;
  int get closedCount =>
      _tickets.where((ticket) => ticket.status == TicketStatus.closed).length;
  int get confirmationCount => _tickets
      .where((ticket) => ticket.status == TicketStatus.awaitingConfirmation)
      .length;

  Ticket ticketByNumber(String number) =>
      _tickets.firstWhere((ticket) => ticket.number == number);

  List<Ticket> filterTickets(TicketListFilter filter, {String query = ''}) {
    final needle = query.trim().toLowerCase();
    return _tickets.where((ticket) {
      final searchable =
          '${ticket.number} ${ticket.fullLocation} ${ticket.category} ${ticket.description}'
              .toLowerCase();
      return ticketMatchesFilter(ticket, filter) &&
          (needle.isEmpty || searchable.contains(needle));
    }).toList();
  }

  bool isDraftValid(ComplaintDraft draft) {
    final basic =
        draft.block.trim().isNotEmpty &&
        draft.floor.trim().isNotEmpty &&
        draft.location.trim().isNotEmpty &&
        draft.category.trim().isNotEmpty &&
        draft.description.trim().isNotEmpty;
    if (!basic || demoMode || _locations.isEmpty) return basic;
    return locationsForBlockAndFloor(
      draft.block,
      draft.floor,
    ).contains(draft.location);
  }

  Future<void> load() async {
    if (demoMode) return;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final responses = await Future.wait([
        HospitalTicketApi.request('GET', '/api/hospital-tickets'),
        HospitalTicketApi.request('GET', '/api/hospital-tickets/blocks'),
        HospitalTicketApi.request('GET', '/api/hospital-tickets/locations'),
        HospitalTicketApi.request('GET', '/api/hospital-tickets/categories'),
      ]);
      _tickets = _ticketRows(responses[0]['tickets']);
      _blocks = _mapRows(responses[1]['blocks']);
      _locations = _mapRows(responses[2]['locations']);
      _categories = _mapRows(responses[3]['categories']);
    } catch (error) {
      _error = error.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> loadDetail(String ticketNumber) async {
    if (demoMode) return;
    try {
      final response = await HospitalTicketApi.request(
        'GET',
        '/api/hospital-tickets/$ticketNumber',
      );
      var ticket = Ticket.fromApi(
        Map<String, dynamic>.from(response['ticket'] as Map),
        updates: _timeline(response['timeline']),
      );
      final complaintPhotos = <String>[];
      final completionPhotos = <String>[];
      for (final attachment in _mapRows(response['attachments'])) {
        final signed = await HospitalTicketApi.request(
          'GET',
          '/api/hospital-tickets/${ticket.id}/attachments/${attachment['id']}/sign-download',
        );
        final url = '${signed['signed_url'] ?? ''}';
        if (attachment['attachment_type'] == 'complaint_photo') {
          complaintPhotos.add(url);
        } else if (attachment['attachment_type'] == 'completion_photo') {
          completionPhotos.add(url);
        }
      }
      ticket = ticket.copyWith(
        complaintPhotoAssets: complaintPhotos,
        completionPhotoAssets: completionPhotos,
      );
      final index = _tickets.indexWhere((row) => row.number == ticket.number);
      if (index >= 0) {
        _tickets[index] = ticket;
      } else {
        _tickets.insert(0, ticket);
      }
      notifyListeners();
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  Future<Ticket> submitComplaint(ComplaintDraft draft, {DateTime? now}) async {
    if (!isDraftValid(draft)) {
      throw ArgumentError('All required complaint fields must be completed.');
    }
    if (!demoMode) {
      if (_blocks.isEmpty || _locations.isEmpty || _categories.isEmpty) {
        throw const HospitalApiException(
          'Complaint master data is unavailable. Refresh and try again.',
        );
      }
      final matchingBlocks = _blocks
          .where((row) => row['block_name'] == draft.block)
          .toList();
      if (matchingBlocks.length != 1) {
        throw const HospitalApiException('Select a valid hospital block.');
      }
      final block = matchingBlocks.single;
      final blockLocations = _locations
          .where((row) => row['block_id'] == block['id'])
          .toList();
      if (blockLocations.isEmpty) {
        throw const HospitalApiException(
          'No authorized complaint location is available for this block.',
        );
      }
      final matchingLocations = blockLocations
          .where(
            (row) =>
                row['location_name'] == draft.location &&
                row['floor_name'] == draft.floor,
          )
          .toList();
      if (matchingLocations.length != 1) {
        throw const HospitalApiException(
          'The selected location does not belong to the selected block and floor.',
        );
      }
      final location = matchingLocations.single;
      final matchingCategories = _categories
          .where((row) => row['category_name'] == draft.category)
          .toList();
      if (matchingCategories.length != 1) {
        throw const HospitalApiException('Select a valid complaint category.');
      }
      final category = matchingCategories.single;
      final response = await HospitalTicketApi.request(
        'POST',
        '/api/hospital-tickets',
        headers: {'Idempotency-Key': draft.idempotencyKey},
        body: {
          'block_id': block['id'],
          'location_id': location['id'],
          'category_id': category['id'],
          'priority': draft.priority.name,
          'title': draft.description.trim().length > 100
              ? draft.description.trim().substring(0, 100)
              : draft.description.trim(),
          'description': draft.description.trim(),
        },
      );
      final row = Map<String, dynamic>.from(response['ticket'] as Map);
      for (final photoPath in draft.photoPaths.take(3)) {
        await HospitalTicketApi.uploadPhoto(
          ticketId: '${row['id']}',
          filePath: photoPath,
          attachmentType: 'complaint_photo',
        );
      }
      final ticket = Ticket.fromApi(
        row,
        updates: _timeline(response['timeline']),
      );
      _tickets.insert(0, ticket);
      notifyListeners();
      return ticket;
    }
    final raisedAt = now ?? DateTime.now();
    final number =
        'QPMS-HK-${raisedAt.year}-${_nextTicketSequence.toString().padLeft(4, '0')}';
    _nextTicketSequence += 1;
    final ticket = Ticket(
      number: number,
      block: draft.block.trim(),
      floor: draft.floor.trim(),
      location: draft.location.trim(),
      category: draft.category.trim(),
      description: draft.description.trim(),
      priority: draft.priority,
      raisedBy: 'Hospital User',
      raisedAt: raisedAt,
      status: TicketStatus.open,
      assignedPerson: 'Assignment pending',
      assignedRole: 'Housekeeping Supervisor',
      slaLabel: 'Supervisor SLA • 20 minutes',
      complaintPhotoAssets: List.unmodifiable(draft.photoPaths),
      updates: [
        TicketUpdate(
          title: 'Complaint raised',
          body: 'Sent to the Housekeeping Supervisor. SLA: 20 minutes.',
          dateTime: raisedAt,
        ),
      ],
    );
    _tickets.insert(0, ticket);
    notifyListeners();
    return ticket;
  }

  Future<void> submitFeedback({
    required String ticketNumber,
    required int rating,
    required String comment,
    required bool satisfied,
    DateTime? now,
  }) async {
    final index = _tickets.indexWhere(
      (ticket) => ticket.number == ticketNumber,
    );
    if (index < 0) throw ArgumentError('Ticket not found.');
    final ticket = _tickets[index];
    if (ticket.status != TicketStatus.awaitingConfirmation) {
      throw StateError('Feedback is available only after resolution.');
    }
    if (!demoMode) {
      final response = await HospitalTicketApi.request(
        'POST',
        '/api/hospital-tickets/${ticket.id}/feedback',
        body: {
          'version': ticket.version,
          'rating': rating,
          'comments': comment.trim(),
          'satisfaction_status': satisfied ? 'satisfied' : 'not_satisfied',
        },
      );
      _tickets[index] = Ticket.fromApi(
        Map<String, dynamic>.from(response['ticket'] as Map),
        updates: _timeline(response['timeline']),
      );
      notifyListeners();
      return;
    }
    final submittedAt = now ?? DateTime.now();
    final update = satisfied
        ? TicketUpdate(
            title: 'Closed',
            body: 'Client confirmed satisfaction with the completed work.',
            dateTime: submittedAt,
          )
        : TicketUpdate(
            title: 'Reopened',
            body: comment.trim().isEmpty
                ? 'Client was not satisfied. Returned to Housekeeping Supervisor.'
                : 'Client was not satisfied: ${comment.trim()}',
            dateTime: submittedAt,
            isEscalation: true,
          );
    _tickets[index] = ticket.copyWith(
      status: satisfied ? TicketStatus.closed : TicketStatus.open,
      assignedPerson: satisfied ? ticket.assignedPerson : 'Assignment pending',
      assignedRole: satisfied ? ticket.assignedRole : 'Housekeeping Supervisor',
      slaLabel: satisfied
          ? 'Closed after client confirmation'
          : 'Reopened • Supervisor SLA restarted: 20 minutes',
      feedbackRating: rating,
      feedbackComment: comment.trim(),
      isSatisfied: satisfied,
      updates: [...ticket.updates, update],
    );
    notifyListeners();
  }

  void resetMockData() {
    _tickets = initialTickets();
    _nextTicketSequence = 6;
    notifyListeners();
  }

  static List<Map<String, dynamic>> _mapRows(dynamic value) => value is List
      ? value
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList()
      : [];

  static List<Ticket> _ticketRows(dynamic value) =>
      _mapRows(value).map(Ticket.fromApi).toList();

  static List<TicketUpdate> _timeline(dynamic value) => _mapRows(value)
      .map(
        (row) => TicketUpdate(
          title: '${row['event_type'] ?? 'Update'}'.replaceAll('_', ' '),
          body: '${row['remarks'] ?? ''}',
          dateTime:
              DateTime.tryParse('${row['created_at'] ?? ''}')?.toLocal() ??
              DateTime.now(),
          isEscalation:
              '${row['event_type'] ?? ''}'.contains('escalat') ||
              '${row['event_type'] ?? ''}'.contains('breach'),
        ),
      )
      .toList();
}
