import 'package:flutter/material.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../models/hospital_location_models.dart';
import '../../services/hospital_ticket_api.dart';

class LocationsScreen extends StatefulWidget {
  const LocationsScreen({super.key});

  @override
  State<LocationsScreen> createState() => _LocationsScreenState();
}

class _LocationsScreenState extends State<LocationsScreen> {
  final _search = TextEditingController();
  Future<_HierarchyViewData>? _future;

  @override
  void initState() {
    super.initState();
    _future = _loadHierarchy();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<_HierarchyViewData> _loadHierarchy() async {
    final hierarchy = await HospitalTicketApi.loadCompleteHierarchy();
    return _HierarchyViewData(
      blocks: hierarchy['blocks']!.cast<HospitalBlock>(),
      floors: hierarchy['floors']!.cast<HospitalFloor>(),
      departments: hierarchy['departments']!.cast<HospitalDepartment>(),
      locations: hierarchy['locations']!.cast<HospitalLocation>(),
    );
  }

  void _retry() {
    setState(() => _future = _loadHierarchy());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Locations')),
      bottomNavigationBar: const ClientBottomNav(currentRoute: AppRoutes.profile),
      body: SafeArea(
        child: FutureBuilder<_HierarchyViewData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _StateMessage(
                icon: Icons.cloud_off_rounded,
                title: 'Unable to load locations',
                message: 'Check the connection and try again.',
                actionLabel: 'Retry',
                onAction: _retry,
              );
            }
            final data = snapshot.data ?? const _HierarchyViewData();
            final rows = data.filtered(_search.text);
            return RefreshIndicator(
              onRefresh: () async => _retry(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                children: [
                  TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search_rounded),
                      hintText: 'Search block, floor, department or room',
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (rows.isEmpty)
                    const _StateMessage(
                      icon: Icons.location_off_rounded,
                      title: 'No locations found',
                      message:
                          'Your account may not have access to a location scope yet.',
                    )
                  else
                    for (final row in rows)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: AppCard(child: _LocationRow(row: row)),
                      ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _HierarchyViewData {
  const _HierarchyViewData({
    this.blocks = const [],
    this.floors = const [],
    this.departments = const [],
    this.locations = const [],
  });

  final List<HospitalBlock> blocks;
  final List<HospitalFloor> floors;
  final List<HospitalDepartment> departments;
  final List<HospitalLocation> locations;

  List<_LocationViewRow> filtered(String query) {
    final blockById = {for (final block in blocks) block.id: block};
    final floorById = {for (final floor in floors) floor.id: floor};
    final departmentById = {
      for (final department in departments) department.id: department,
    };
    final rows = <_LocationViewRow>[
      for (final location in locations.where(_selectableLocation))
        _LocationViewRow(
          block: blockById[location.blockId]?.name ?? '',
          floor: floorById[location.floorId]?.name ?? location.floorName,
          department:
              departmentById[location.departmentId]?.name ??
              location.departmentName,
          roomArea: location.displayName,
          verificationStatus: location.verificationStatus,
        ),
      for (final department in departments.where(_selectableDepartment))
        if (!locations.any((location) => location.departmentId == department.id))
          _LocationViewRow(
            block: blockById[department.blockId]?.name ?? '',
            floor: floorById[department.floorId]?.name ?? '',
            department: department.name,
            roomArea: '',
            verificationStatus: department.verificationStatus,
          ),
    ];
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) return rows;
    return rows.where((row) => row.searchText.contains(needle)).toList();
  }
}

class _LocationViewRow {
  const _LocationViewRow({
    required this.block,
    required this.floor,
    required this.department,
    required this.roomArea,
    required this.verificationStatus,
  });

  final String block;
  final String floor;
  final String department;
  final String roomArea;
  final String verificationStatus;

  String get title => roomArea.isNotEmpty ? roomArea : department;
  String get path => [block, floor, department]
      .where((value) => value.trim().isNotEmpty)
      .toSet()
      .join(' • ');
  String get searchText => '$title $path $verificationStatus'.toLowerCase();
}

class _LocationRow extends StatelessWidget {
  const _LocationRow({required this.row});
  final _LocationViewRow row;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      const CircleAvatar(
        backgroundColor: AppColors.paleBlue,
        child: Icon(Icons.location_on_rounded, color: AppColors.royalBlue),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              row.title,
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
            if (row.path.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                row.path,
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                ),
              ),
            ],
          ],
        ),
      ),
    ],
  );
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: AppColors.paleBlue,
            child: Icon(icon, color: AppColors.royalBlue, size: 30),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 14),
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    ),
  );
}

bool _selectableLocation(HospitalLocation location) =>
    location.isActive && !_hiddenStatus(location.verificationStatus);

bool _selectableDepartment(HospitalDepartment department) =>
    department.isActive && !_hiddenStatus(department.verificationStatus);

bool _hiddenStatus(String status) {
  final key = status.trim().toLowerCase();
  return key == 'inactive' || key == 'rejected';
}

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('About QPMS')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: const [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'QPMS Client Ticketing',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  SizedBox(height: 10),
                  Text(
                    'A clean mobile experience for raising and tracking hospital housekeeping complaints.',
                    style: TextStyle(fontWeight: FontWeight.w700, height: 1.4),
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Raise. Track. Resolve.',
                    style: TextStyle(
                      color: AppColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
