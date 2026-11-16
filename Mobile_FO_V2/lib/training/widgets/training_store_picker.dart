import 'package:flutter/material.dart';

import '../state/training_flow_controller.dart';

class TrainingStorePicker extends StatefulWidget {
  const TrainingStorePicker({required this.controller, super.key});
  final TrainingFlowController controller;

  @override
  State<TrainingStorePicker> createState() => _TrainingStorePickerState();
}

class _TrainingStorePickerState extends State<TrainingStorePicker> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _zones = [];
  List<Map<String, dynamic>> _stores = [];
  String? _zone;
  String? _error;
  bool _supervisor = false;
  bool _zoneRequired = true;
  bool _busy = true;
  bool _more = false;
  int _generation = 0;
  String? _categoryCode;

  @override
  void initState() {
    super.initState();
    _categoryCode = widget.controller.selectedCategory?.code;
    widget.controller.addListener(_categoryChanged);
    _loadZones();
  }

  @override
  void didUpdateWidget(covariant TrainingStorePicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_categoryChanged);
      widget.controller.addListener(_categoryChanged);
      _categoryCode = widget.controller.selectedCategory?.code;
      _loadZones();
    } else {
      _categoryChanged();
    }
  }

  void _categoryChanged() {
    final categoryCode = widget.controller.selectedCategory?.code;
    if (categoryCode == _categoryCode) return;
    _categoryCode = categoryCode;
    _loadZones();
  }

  Future<void> _loadZones() async {
    final generation = ++_generation;
    setState(() {
      _zones = [];
      _stores = [];
      _zone = null;
      _supervisor = false;
      _zoneRequired = true;
      _more = false;
      _error = null;
      _busy = true;
      _search.clear();
    });
    try {
      final zones = await widget.controller.getZones();
      if (!mounted || generation != _generation) return;
      setState(() {
        _zones = zones;
        _busy = false;
      });
      if (zones.isEmpty) await _load();
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _error = 'Unable to load authorized zones. Please reopen and retry.';
          _busy = false;
        });
      }
    }
  }

  Future<void> _load({bool next = false}) async {
    final generation = ++_generation;
    setState(() {
      _busy = true;
      _error = null;
      if (!next) {
        _stores = [];
        _more = false;
      }
    });
    try {
      final page = await widget.controller.searchStores(
        zoneId: _zone,
        supervisorOnly: _supervisor,
        query: _search.text,
        offset: next ? _stores.length : 0,
      );
      if (!mounted || generation != _generation) return;
      final rows = (page['stores'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      setState(() {
        _stores = next ? [..._stores, ...rows] : rows;
        _more = page['has_more'] == true;
        _zoneRequired = page['zone_required'] != false;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(
          () => _error =
              'Unable to load stores. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_categoryChanged);
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Select Training Store'),
    content: SizedBox(
      width: 440,
      height: 480,
      child: Column(
        children: [
          if (_zoneRequired &&
              widget.controller.selectedCategory?.code == 'technical_mep')
            SwitchListTile(
              title: const Text('Supervisor-only stores (no zone)'),
              value: _supervisor,
              onChanged: _busy
                  ? null
                  : (value) {
                      setState(() {
                        _supervisor = value;
                        _stores = [];
                        _more = false;
                      });
                      if (value || _zone != null) _load();
                    },
            ),
          if (_zoneRequired && !_supervisor)
            DropdownButtonFormField<String>(
              key: ValueKey(_categoryCode),
              initialValue: _zone,
              decoration: const InputDecoration(labelText: 'Authorized zone'),
              items: _zones
                  .map(
                    (z) => DropdownMenuItem(
                      value: z['id'] as String,
                      child: Text('${z['zone_name']}'),
                    ),
                  )
                  .toList(),
              onChanged: _busy
                  ? null
                  : (value) {
                      setState(() => _zone = value);
                      _load();
                    },
            ),
          TextField(
            controller: _search,
            decoration: const InputDecoration(labelText: 'Store name or code'),
            onSubmitted: (_) {
              if (!_busy && (!_zoneRequired || _supervisor || _zone != null)) {
                _load();
              }
            },
          ),
          TextButton(
            onPressed: _busy || (_zoneRequired && !_supervisor && _zone == null)
                ? null
                : () => _load(),
            child: const Text('Search'),
          ),
          if (_error != null) Text(_error!),
          if (!_busy &&
              _error == null &&
              _zoneRequired &&
              _zones.isEmpty &&
              widget.controller.selectedCategory?.code == 'hk')
            const Text(
              'No active zone assignment. Contact your administrator.',
            ),
          if (_busy) const LinearProgressIndicator(),
          Expanded(
            child: ListView(
              children: [
                for (final store in _stores)
                  ListTile(
                    title: Text('${store['store_name']}'),
                    subtitle: Text(
                      '${store['store_code']} • ${store['state']}',
                    ),
                    onTap: _busy ? null : () => Navigator.pop(context, store),
                  ),
                if (_more)
                  TextButton(
                    onPressed: _busy ? null : () => _load(next: true),
                    child: const Text('Load more'),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
    ],
  );
}
