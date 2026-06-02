import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../utils/date_utils.dart';

class TasksScreen extends StatefulWidget {
  const TasksScreen({required this.user, super.key});

  final FoUser user;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen>
    with AutomaticKeepAliveClientMixin<TasksScreen> {
  Attendance? _attendance;
  SiteVisit? _activeVisit;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final attendance = await LocalStore.getAttendance();
    final activeVisit = await LocalStore.activeVisit();
    if (!mounted) return;
    setState(() {
      _attendance = attendance;
      _activeVisit = activeVisit;
    });
  }

  Future<void> _checkIn() async {
    if (_attendance?.isActive != true) {
      _toast('Please Start Day before checking into a store.');
      return;
    }
    if (await LocalStore.activeVisit() != null) {
      _toast('Please Check Out from current store before checking in again.');
      return;
    }
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_GPS_FETCH_START',
      );
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_GPS_FETCH_SUCCESS',
      );
      if (position.accuracy > 100) {
        _toast(
          'GPS accuracy is weak. Please move to an open area and try again.',
        );
        return;
      }

      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_MATCH_START',
      );
      final stores = await SupabaseService.fetchStoresWithGps();
      final nearby =
          stores
              .where(
                (store) => store.latitude != null && store.longitude != null,
              )
              .map(
                (store) => _NearbyStore(
                  store: store,
                  distanceMeters: Geolocator.distanceBetween(
                    position.latitude,
                    position.longitude,
                    store.latitude!,
                    store.longitude!,
                  ),
                ),
              )
              .where((match) => match.distanceMeters <= 100)
              .toList()
            ..sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));

      Store? store;
      if (nearby.isNotEmpty) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_SITE_MATCH_FOUND',
        );
        if (!mounted) return;
        final selected = nearby.length == 1
            ? nearby.first
            : await showDialog<_NearbyStore?>(
                context: context,
                builder: (_) => _NearbySitesDialog(matches: nearby),
              );
        if (selected == null || !mounted) return;
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (_) =>
              _WelcomeSiteDialog(match: selected, accuracy: position.accuracy),
        );
        if (confirmed != true || !mounted) return;
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_EXISTING_SITE_CONFIRMED',
        );
        store = selected.store;
      } else {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKIN_SITE_MATCH_NOT_FOUND',
        );
        if (!mounted) return;
        final addNew = await showDialog<bool>(
          context: context,
          builder: (_) => const _NoSiteFoundDialog(),
        );
        if (addNew != true || !mounted) return;
        store = await showDialog<Store?>(
          context: context,
          builder: (_) => _AddStoreDialog(
            user: widget.user,
            attendance: _attendance!,
            latitude: position.latitude,
            longitude: position.longitude,
            accuracy: position.accuracy,
          ),
        );
        if (store == null || !mounted) return;
      }

      final visit = await _createVisit(store, position);
      setState(() => _activeVisit = visit);
      _toast(
        nearby.isEmpty
            ? 'New site added and checked in: ${store.storeName}'
            : 'Checked in at ${store.storeName}',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      _toast('Check In failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<SiteVisit> _createVisit(Store store, Position position) async {
    final visit = SiteVisit(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      employeeCode: widget.user.employeeCode,
      attendanceId: _attendance!.remoteId ?? _attendance!.id,
      storeId: store.id,
      fullName: widget.user.fullName,
      storeName: store.storeName,
      clientName: store.clientName,
      storeCode: store.storeCode,
      state: store.state,
      checkInTime: DateTime.now(),
      currentLatitude: position.latitude,
      currentLongitude: position.longitude,
      currentGpsAccuracy: position.accuracy,
      checkInAccuracy: position.accuracy,
      status: 'Checked In',
    );
    await LocalStore.saveVisit(visit);
    try {
      visit.remoteId = await SupabaseService.insertVisit(visit);
      visit.synced = true;
      await LocalStore.saveVisit(visit);
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_VISIT_INSERT_SUCCESS',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_SITE_VISIT_INSERT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
    return visit;
  }

  Future<void> _checkOut() async {
    final visit = _activeVisit;
    if (visit == null) return;
    setState(() => _busy = true);
    try {
      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 15),
          ),
        );
      } catch (_) {
        position = null;
      }
      final end = DateTime.now();
      visit
        ..checkOutTime = end
        ..checkOutLatitude = position?.latitude
        ..checkOutLongitude = position?.longitude
        ..checkOutAccuracy = position?.accuracy
        ..durationMinutes = end.difference(visit.checkInTime).inMinutes
        ..status = 'Checked Out';
      await LocalStore.saveVisit(visit);
      try {
        await SupabaseService.updateVisitCheckout(visit);
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: widget.user.employeeCode,
          screen: 'tasks',
          action: 'CHECKOUT_SYNC_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
      setState(() => _activeVisit = null);
      _toast('Checked out successfully');
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKOUT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      _toast('Check Out failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final activeDay = _attendance?.isActive == true;
    return Scaffold(
      appBar: AppBar(title: const Text('My Tasks')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _activeVisit == null
                        ? 'No active store visit'
                        : 'Active Store Visit',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  if (_activeVisit != null) ...[
                    const SizedBox(height: 10),
                    Text(_activeVisit!.storeName),
                    Text(_activeVisit!.clientName),
                    Text('Code: ${_activeVisit!.storeCode}'),
                    Text('State: ${_activeVisit!.state}'),
                    Text('Check-In: ${formatTime(_activeVisit!.checkInTime)}'),
                    Text(
                      'GPS Accuracy: ${_activeVisit!.checkInAccuracy?.toStringAsFixed(1) ?? '-'} m',
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          if (!activeDay)
            const Text(
              'Please Start Day before checking into a store.',
              style: TextStyle(color: qpmsMuted),
            ),
          const SizedBox(height: 10),
          FilledButton(
            onPressed: _busy || !activeDay || _activeVisit != null
                ? null
                : _checkIn,
            child: const Text('Check In'),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _busy || _activeVisit == null ? null : _checkOut,
            child: const Text('Check Out'),
          ),
        ],
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}

class _StoreSearchDialog extends StatefulWidget {
  const _StoreSearchDialog({required this.user, required this.attendance});

  final FoUser user;
  final Attendance attendance;

  @override
  State<_StoreSearchDialog> createState() => _StoreSearchDialogState();
}

class _StoreSearchDialogState extends State<_StoreSearchDialog> {
  final _query = TextEditingController();
  List<Store> _stores = [];
  bool _busy = false;

  Future<void> _search() async {
    setState(() => _busy = true);
    try {
      _stores = await SupabaseService.searchStores(_query.text);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Search Store'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _query,
              decoration: const InputDecoration(labelText: 'Store Name / Code'),
              onSubmitted: (_) => _search(),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _busy ? null : _search,
              child: const Text('Search'),
            ),
            const SizedBox(height: 10),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final store in _stores)
                    ListTile(
                      title: Text(store.storeName),
                      subtitle: Text(
                        '${store.clientName} • ${store.storeCode}',
                      ),
                      onTap: () => Navigator.of(context).pop(store),
                    ),
                  if (!_busy && _stores.isEmpty)
                    TextButton(
                      onPressed: _addStore,
                      child: const Text('Store not found - Add New Store'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addStore() async {
    final store = await showDialog<Store?>(
      context: context,
      builder: (_) =>
          _AddStoreDialog(user: widget.user, attendance: widget.attendance),
    );
    if (store != null && mounted) Navigator.of(context).pop(store);
  }
}

class _NearbyStore {
  const _NearbyStore({required this.store, required this.distanceMeters});

  final Store store;
  final double distanceMeters;
}

class _NearbySitesDialog extends StatelessWidget {
  const _NearbySitesDialog({required this.matches});

  final List<_NearbyStore> matches;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Nearby Sites'),
      content: SizedBox(
        width: 360,
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final match in matches)
              ListTile(
                title: Text(match.store.storeName),
                subtitle: Text(
                  '${match.store.clientName} • ${match.store.storeCode}\n'
                  '${match.distanceMeters.toStringAsFixed(1)} m away',
                ),
                onTap: () => Navigator.of(context).pop(match),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}

class _WelcomeSiteDialog extends StatelessWidget {
  const _WelcomeSiteDialog({required this.match, required this.accuracy});

  final _NearbyStore match;
  final double accuracy;

  @override
  Widget build(BuildContext context) {
    final store = match.store;
    return AlertDialog(
      title: Text('Welcome to ${store.storeName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Site Name: ${store.storeName}'),
          Text('Client Name: ${store.clientName}'),
          Text('Store Code: ${store.storeCode}'),
          Text('Distance: ${match.distanceMeters.toStringAsFixed(1)} m'),
          Text('GPS Accuracy: ${accuracy.toStringAsFixed(1)} m'),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Check In'),
        ),
      ],
    );
  }
}

class _NoSiteFoundDialog extends StatelessWidget {
  const _NoSiteFoundDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('No registered site found within 100 meters.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Add New Site'),
        ),
      ],
    );
  }
}

class _AddStoreDialog extends StatefulWidget {
  const _AddStoreDialog({
    required this.user,
    required this.attendance,
    this.latitude,
    this.longitude,
    this.accuracy,
  });

  final FoUser user;
  final Attendance attendance;
  final double? latitude;
  final double? longitude;
  final double? accuracy;

  @override
  State<_AddStoreDialog> createState() => _AddStoreDialogState();
}

class _AddStoreDialogState extends State<_AddStoreDialog> {
  final _name = TextEditingController();
  final _client = TextEditingController();
  final _code = TextEditingController();
  final _state = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_NEW_SITE_CREATE_START',
      );
      double? latitude = widget.latitude;
      double? longitude = widget.longitude;
      double? accuracy = widget.accuracy;
      if (latitude == null || longitude == null) {
        final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 15),
          ),
        );
        latitude = position.latitude;
        longitude = position.longitude;
        accuracy = position.accuracy;
      }
      final id = await SupabaseService.createStore(
        user: widget.user,
        attendance: widget.attendance,
        storeName: _name.text.trim(),
        clientName: _client.text.trim(),
        storeCode: _code.text.trim(),
        state: _state.text.trim(),
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
      );
      await CrashLogService.record(
        employeeCode: widget.user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_NEW_SITE_CREATE_SUCCESS',
      );
      if (!mounted) return;
      Navigator.of(context).pop(
        Store(
          id: id ?? '',
          storeName: _name.text.trim(),
          clientName: _client.text.trim(),
          storeCode: _code.text.trim(),
          state: _state.text.trim(),
          latitude: latitude,
          longitude: longitude,
          gpsAccuracy: accuracy,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add New Store'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Store Name'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _client,
            decoration: const InputDecoration(labelText: 'Client Name'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _code,
            decoration: const InputDecoration(
              labelText: 'Store Code / Site Code',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _state,
            decoration: const InputDecoration(labelText: 'State'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Save & Check In'),
        ),
      ],
    );
  }
}
