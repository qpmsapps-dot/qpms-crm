import 'package:flutter/foundation.dart';

import '../models/ticket.dart';
import '../models/ticket_update.dart';
import '../models/hospital_location_models.dart';
import '../data/mock_data.dart';
import '../core/utils/friendly_errors.dart';
import '../services/app_config.dart';
import '../services/hospital_ticket_api.dart';

class ComplaintDraft {
  ComplaintDraft({
    this.site = 'Client Site',
    this.block = 'Block A',
    this.floor = 'Ground Floor',
    this.department = '',
    this.location = 'OPD Waiting Area',
    this.exactLandmark = '',
    this.category = '',
    this.priority = TicketPriority.medium,
    this.description = '',
    this.photoPaths = const [],
    String? idempotencyKey,
  }) : idempotencyKey =
           idempotencyKey ?? 'client-${DateTime.now().microsecondsSinceEpoch}';

  String site;
  String block;
  String blockId = '';
  String floor;
  String floorId = '';
  String department;
  String departmentId = '';
  String location;
  String locationId = '';
  String exactLandmark;
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
  List<Map<String, dynamic>> _floors = [];
  List<Map<String, dynamic>> _departments = [];
  List<Map<String, dynamic>> _locations = [];
  List<Map<String, dynamic>> _categories = [];
  int _hierarchyRequestVersion = 0;

  late List<Ticket> _tickets;
  int _nextTicketSequence = 6;

  List<Ticket> get tickets => List.unmodifiable(_tickets);
  bool get isLoading => _loading;
  String? get error => _error;
  List<Map<String, dynamic>> get blocks => List.unmodifiable(_blocks);
  List<Map<String, dynamic>> get floors => List.unmodifiable(_floors);
  List<Map<String, dynamic>> get departments => List.unmodifiable(_departments);
  List<Map<String, dynamic>> get locations => List.unmodifiable(_locations);
  List<Map<String, dynamic>> get categories => List.unmodifiable(_categories);

  List<HospitalBlock> get hospitalBlocks =>
      _blocks.map(HospitalBlock.fromJson).where(_isSelectable).toList();
  List<HospitalFloor> get hospitalFloors =>
      _floors.map(HospitalFloor.fromJson).where(_isSelectable).toList();
  List<HospitalDepartment> get hospitalDepartments => _departments
      .map(HospitalDepartment.fromJson)
      .where(_isSelectable)
      .toList();
  List<HospitalLocation> get hospitalLocations =>
      _locations.map(HospitalLocation.fromJson).where(_isSelectable).toList();

  @visibleForTesting
  void replaceMastersForTesting({
    required List<Map<String, dynamic>> blocks,
    required List<Map<String, dynamic>> locations,
    List<Map<String, dynamic>> floors = const [],
    List<Map<String, dynamic>> departments = const [],
    List<Map<String, dynamic>> categories = const [],
  }) {
    _blocks = blocks;
    _floors = floors;
    _departments = departments;
    _locations = locations;
    _categories = categories;
  }

  List<String> floorsForBlock(String blockName) {
    final matches = _blocks
        .where((row) => row['block_name'] == blockName)
        .toList();
    if (matches.isEmpty) return const [];
    final block = matches.first;
    final floorRows = _floors.isNotEmpty
        ? _floors.where((row) => row['block_id'] == block['id'])
        : _locations.where((row) => row['block_id'] == block['id']);
    return floorRows
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

  List<HospitalDepartment> departmentsFor({
    required String blockId,
    String floorId = '',
    bool includeUnconfirmed = true,
  }) => hospitalDepartments
      .where(
        (row) =>
            row.blockId == blockId &&
            (floorId.isEmpty ||
                row.floorId == floorId ||
                (includeUnconfirmed && row.floorId.isEmpty)),
      )
      .toList();

  List<HospitalLocation> locationsFor({
    required String blockId,
    String floorId = '',
    String departmentId = '',
  }) => hospitalLocations
      .where(
        (row) =>
            row.blockId == blockId &&
            (floorId.isEmpty || row.floorId == floorId) &&
            (departmentId.isEmpty || row.departmentId == departmentId),
      )
      .toList();

  String buildLocationSummary(ComplaintDraft draft) {
    final parts = <String>[
      draft.site,
      draft.block,
      draft.floor,
      draft.department,
      draft.location,
      draft.exactLandmark,
    ];
    final seen = <String>{};
    return parts
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .where((value) => seen.add(value.toLowerCase()))
        .join(' > ');
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
  int get inProgressCount => _tickets
      .where(
        (ticket) =>
            ticket.status == TicketStatus.accepted ||
            ticket.status == TicketStatus.inProgress,
      )
      .length;
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
        (draft.departmentId.trim().isNotEmpty ||
            draft.department.trim().isNotEmpty ||
            draft.locationId.trim().isNotEmpty ||
            draft.location.trim().isNotEmpty) &&
        (draft.locationId.trim().isNotEmpty ||
            draft.location.trim().isNotEmpty ||
            draft.exactLandmark.trim().isNotEmpty) &&
        draft.category.trim().isNotEmpty &&
        draft.description.trim().isNotEmpty;
    if (!basic || demoMode || _locations.isEmpty) {
      return basic;
    }
    if (draft.locationId.trim().isNotEmpty) {
      return hospitalLocations.any(
        (row) =>
            row.id == draft.locationId &&
            (draft.blockId.isEmpty || row.blockId == draft.blockId),
      );
    }
    if (draft.location.trim().isEmpty) return basic;
    return _locations.any((row) {
      final sameBlock = draft.blockId.isNotEmpty
          ? row['block_id'] == draft.blockId
          : row['block_name'] == draft.block || row['block'] == draft.block;
      final sameLocation = row['location_name'] == draft.location;
      final sameFloor =
          draft.floor.trim().isEmpty || row['floor_name'] == draft.floor;
      return sameBlock && sameLocation && sameFloor;
    });
  }

  @visibleForTesting
  Map<String, dynamic> createPayloadForTesting(ComplaintDraft draft) =>
      _createPayload(draft);

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
      _floors = _locations
          .where((row) => '${row['floor_id'] ?? ''}'.trim().isNotEmpty)
          .map(
            (row) => {
              'id': row['floor_id'],
              'block_id': row['block_id'],
              'floor_name': row['floor_name'],
              'is_active': row['is_active'] ?? true,
            },
          )
          .toList();
      _departments = _locations
          .where((row) => '${row['department_id'] ?? ''}'.trim().isNotEmpty)
          .map(
            (row) => {
              'id': row['department_id'],
              'block_id': row['block_id'],
              'floor_id': row['floor_id'] ?? '',
              'department_name': row['department_name'],
              'is_active': row['is_active'] ?? true,
            },
          )
          .toList();
    } catch (error) {
      _error = friendlyErrorMessage(
        error,
        fallback: 'Unable to load complaints. Please try again.',
      );
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> loadBlocks() async {
    if (demoMode) {
      _blocks = List<Map<String, dynamic>>.from(demoBlockRows);
      notifyListeners();
      return;
    }
    _blocks = (await HospitalTicketApi.loadBlocks())
        .map(
          (row) => {
            'id': row.id,
            'client_id': row.clientId,
            'block_code': row.code,
            'block_name': row.name,
            'verification_status': row.verificationStatus,
            'is_active': row.isActive,
          },
        )
        .toList();
    notifyListeners();
  }

  Future<void> loadCategories() async {
    if (demoMode) {
      _categories = housekeepingCategories
          .map((name) => {'id': name, 'category_name': name, 'is_active': true})
          .toList();
      notifyListeners();
      return;
    }
    final response = await HospitalTicketApi.request(
      'GET',
      '/api/hospital-tickets/categories',
    );
    _categories = _mapRows(response['categories']);
    notifyListeners();
  }

  Future<void> loadFloorsForBlock(String blockId) async {
    final version = ++_hierarchyRequestVersion;
    if (demoMode) {
      _floors = demoFloorRows
          .where((row) => row['block_id'] == blockId)
          .toList();
      _departments = [];
      _locations = [];
      notifyListeners();
      return;
    }
    final rows = await HospitalTicketApi.loadFloors(blockId);
    if (version != _hierarchyRequestVersion) return;
    _floors = rows
        .map(
          (row) => {
            'id': row.id,
            'block_id': row.blockId,
            'floor_name': row.name,
            'verification_status': row.verificationStatus,
            'is_active': row.isActive,
          },
        )
        .toList();
    _departments = [];
    _locations = [];
    notifyListeners();
  }

  Future<void> loadDepartmentsForBlock(
    String blockId, {
    String floorId = '',
  }) async {
    final version = ++_hierarchyRequestVersion;
    if (demoMode) {
      _departments = demoDepartmentRows
          .where(
            (row) =>
                row['block_id'] == blockId &&
                (floorId.isEmpty ||
                    row['floor_id'] == floorId ||
                    '${row['floor_id'] ?? ''}'.isEmpty),
          )
          .toList();
      _locations = [];
      notifyListeners();
      return;
    }
    final rows = await HospitalTicketApi.loadDepartments(
      blockId,
      floorId: floorId.isEmpty ? null : floorId,
    );
    if (version != _hierarchyRequestVersion) return;
    _departments = rows
        .map(
          (row) => {
            'id': row.id,
            'block_id': row.blockId,
            'floor_id': row.floorId,
            'department_name': row.name,
            'department_type': row.departmentType,
            'verification_status': row.verificationStatus,
            'is_active': row.isActive,
          },
        )
        .toList();
    _locations = [];
    notifyListeners();
  }

  Future<void> loadLocationsForSelection(
    String blockId, {
    String floorId = '',
    String departmentId = '',
  }) async {
    final version = ++_hierarchyRequestVersion;
    if (demoMode) {
      _locations = demoLocationRows
          .where(
            (row) =>
                row['block_id'] == blockId &&
                (floorId.isEmpty || row['floor_id'] == floorId) &&
                (departmentId.isEmpty || row['department_id'] == departmentId),
          )
          .toList();
      notifyListeners();
      return;
    }
    final rows = await HospitalTicketApi.loadHierarchyLocations(
      blockId,
      floorId: floorId.isEmpty ? null : floorId,
      departmentId: departmentId.isEmpty ? null : departmentId,
    );
    if (version != _hierarchyRequestVersion) return;
    _locations = rows
        .map(
          (row) => {
            'id': row.id,
            'client_id': row.clientId,
            'block_id': row.blockId,
            'floor_id': row.floorId,
            'department_id': row.departmentId,
            'location_code': row.code,
            'floor_name': row.floorName,
            'department_name': row.departmentName,
            'location_name': row.name,
            'room_number': row.roomNumber,
            'area_name': row.areaName,
            'ward_name': row.wardName,
            'location_type': row.locationType,
            'verification_status': row.verificationStatus,
            'is_active': row.isActive,
          },
        )
        .toList();
    notifyListeners();
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
      _error = friendlyErrorMessage(
        error,
        fallback: 'Unable to load complaint details.',
      );
      notifyListeners();
    }
  }

  Future<Ticket> submitComplaint(ComplaintDraft draft, {DateTime? now}) async {
    if (!isDraftValid(draft)) {
      throw ArgumentError('All required complaint fields must be completed.');
    }
    if (!demoMode) {
      if (_blocks.isEmpty || _categories.isEmpty) {
        throw const HospitalApiException(
          'Complaint master data is unavailable. Refresh and try again.',
        );
      }
      final payload = _createPayload(draft);
      final response = await HospitalTicketApi.request(
        'POST',
        '/api/hospital-tickets',
        headers: {'Idempotency-Key': draft.idempotencyKey},
        body: payload,
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

  Map<String, dynamic> _createPayload(ComplaintDraft draft) {
    final matchingBlocks = _blocks.where((row) {
      final id = '${row['id'] ?? ''}';
      return id == draft.blockId || row['block_name'] == draft.block;
    }).toList();
    if (matchingBlocks.length != 1) {
      throw const HospitalApiException('Select a valid hospital block.');
    }
    final block = matchingBlocks.single;
    Map<String, dynamic>? location;
    if (draft.locationId.trim().isNotEmpty ||
        draft.location.trim().isNotEmpty) {
      final blockLocations = _locations
          .where((row) => row['block_id'] == block['id'])
          .toList();
      final matchingLocations = blockLocations.where((row) {
        final id = '${row['id'] ?? ''}';
        return id == draft.locationId ||
            (row['location_name'] == draft.location &&
                (draft.floor.isEmpty || row['floor_name'] == draft.floor));
      }).toList();
      if (matchingLocations.length != 1) {
        throw const HospitalApiException(
          'This location is not available for your account.',
        );
      }
      location = matchingLocations.single;
    } else if (draft.exactLandmark.trim().isEmpty) {
      throw const HospitalApiException(
        'Select a room/area or provide an exact location landmark.',
      );
    }
    final matchingCategories = _categories
        .where((row) => row['category_name'] == draft.category)
        .toList();
    if (matchingCategories.length != 1) {
      throw const HospitalApiException('Please select a complaint category.');
    }
    final category = matchingCategories.single;
    return {
      'block_id': block['id'],
      'floor_id': draft.floorId.isEmpty ? null : draft.floorId,
      'department_id': draft.departmentId.isEmpty ? null : draft.departmentId,
      'location_id': location == null ? null : location['id'],
      'exact_landmark': draft.exactLandmark.trim(),
      'category_id': category['id'],
      'priority': draft.priority.name,
      'title': draft.description.trim().length > 100
          ? draft.description.trim().substring(0, 100)
          : draft.description.trim(),
      'description': draft.description.trim(),
    };
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

bool _isSelectable(dynamic row) {
  final active = row is HospitalBlock
      ? row.isActive
      : row is HospitalFloor
      ? row.isActive
      : row is HospitalDepartment
      ? row.isActive
      : row is HospitalLocation
      ? row.isActive
      : true;
  final status = row is HospitalBlock
      ? row.verificationStatus
      : row is HospitalFloor
      ? row.verificationStatus
      : row is HospitalDepartment
      ? row.verificationStatus
      : row is HospitalLocation
      ? row.verificationStatus
      : '';
  return active && !{'rejected', 'inactive'}.contains(status);
}
