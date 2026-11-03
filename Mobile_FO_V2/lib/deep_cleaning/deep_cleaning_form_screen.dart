import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/fo_models.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'deep_cleaning_models.dart';
import 'deep_cleaning_service.dart';

class DeepCleaningFormScreen extends StatefulWidget {
  const DeepCleaningFormScreen({
    required this.user,
    this.initialSubmission,
    this.schedule,
    this.service = const DeepCleaningService(),
    super.key,
  });

  final FoUser user;
  final DeepCleaningSubmission? initialSubmission;
  final DeepCleaningSchedule? schedule;
  final DeepCleaningService service;

  @override
  State<DeepCleaningFormScreen> createState() => _DeepCleaningFormScreenState();
}

class _DeepCleaningFormScreenState extends State<DeepCleaningFormScreen> {
  DeepCleaningService get _service => widget.service;
  final _picker = ImagePicker();
  final _vendor = TextEditingController();
  final _remarks = TextEditingController();
  final _storeSearch = TextEditingController();
  final _localUploads = <DeepCleaningLocalUpload>[];
  final _viewUrls = <String, DeepCleaningViewUrl>{};

  DeepCleaningSubmission? _submission;
  RelianceDeepCleaningStore? _store;
  DateTime? _date;
  var _remoteUploads = <DeepCleaningUpload>[];
  late final DeepCleaningStorePager _storePager;
  Timer? _storeSearchDebounce;
  final _pairIds = <String>[newDeepCleaningPairId()];
  final _pairOrders = <String, int>{};
  final _bulkImages = <_SelectedBulkImage>[];
  var _loading = false;
  var _submitting = false;
  String? _error;

  bool get _isScheduled =>
      widget.schedule != null || _submission?.scheduleId != null;
  bool get _isSubmitted =>
      _submission?.isSubmitted == true ||
      widget.schedule?.status == 'Completed' ||
      widget.schedule?.status == 'Not Done' ||
      widget.schedule?.status == 'NotDone';
  bool get _hasActiveUploads =>
      _localUploads.any((upload) => upload.isActive) || _loading || _submitting;
  bool get _hasBefore => _confirmedUploads(DeepCleaningUploadType.before) > 0;
  bool get _hasAfter => _confirmedUploads(DeepCleaningUploadType.after) > 0;
  bool get _hasPendingRemoteUploads =>
      _remoteUploads.any((upload) => !upload.isUploaded);
  int get _documentCount => _remoteUploads
      .where(
        (upload) =>
            upload.isUploaded &&
            (upload.uploadType == DeepCleaningUploadType.document ||
                upload.uploadType == DeepCleaningUploadType.checklist),
      )
      .length;
  bool get _canComplete =>
      _hasBefore &&
      _hasAfter &&
      _documentCount == 1 &&
      !_hasActiveUploads &&
      !_hasPendingRemoteUploads;
  bool get _canSubmit => canSubmitDeepCleaningEvidence(
    hasConfirmedBefore: _hasBefore && _pairsComplete,
    hasConfirmedAfter: _hasAfter && _pairsComplete,
    hasSingleSupportingDocument: _documentCount == 1,
    hasActiveUploads: _hasActiveUploads || _hasPendingRemoteUploads,
  );
  bool get _usesPairs =>
      _submission == null || _submission?.evidenceFormat == 'paired_v1';
  bool get _pairsComplete =>
      !_usesPairs ||
      (_pairIds.isNotEmpty &&
          _remoteUploads
              .where(
                (upload) =>
                    upload.isUploaded &&
                    (upload.uploadType == DeepCleaningUploadType.before ||
                        upload.uploadType == DeepCleaningUploadType.after),
              )
              .every((upload) => _pairIds.contains(upload.pairId)) &&
          _pairIds.every(
            (id) =>
                _remoteUploads
                        .where(
                          (upload) =>
                              upload.isUploaded &&
                              upload.pairId == id &&
                              upload.uploadType ==
                                  DeepCleaningUploadType.before,
                        )
                        .length ==
                    1 &&
                _remoteUploads
                        .where(
                          (upload) =>
                              upload.isUploaded &&
                              upload.pairId == id &&
                              upload.uploadType == DeepCleaningUploadType.after,
                        )
                        .length ==
                    1,
          ));

  DeepCleaningUpload? _pairUpload(String id, DeepCleaningUploadType type) {
    for (final upload in _remoteUploads) {
      if (upload.isUploaded &&
          upload.pairId == id &&
          upload.uploadType == type) {
        return upload;
      }
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _storePager = DeepCleaningStorePager(
      loadPage: ({required query, zoneId, required page, required limit}) =>
          _service.searchRelianceStores(
            query: query,
            zoneId: zoneId,
            page: page,
            limit: limit,
          ),
    );
    _pairOrders[_pairIds.first] = 1;
    final schedule = widget.schedule;
    if (schedule != null) {
      _store = RelianceDeepCleaningStore(
        id: schedule.retailStoreId,
        storeCode: schedule.storeCode,
        storeName: schedule.storeName,
        clientName: deepCleaningBusiness,
        state: '',
        business: deepCleaningBusiness,
      );
      _date = _parseDate(schedule.scheduledDate);
      _initializeScheduledReport();
      return;
    }
    final initial = widget.initialSubmission;
    if (initial != null) {
      _submission = initial;
      _applySubmission(initial);
      _reloadSubmission();
    }
  }

  Future<void> _initializeScheduledReport() async {
    final schedule = widget.schedule;
    if (schedule == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final existing = await _service.findSubmissionForSchedule(schedule.id);
      if (!mounted || existing == null) return;
      setState(() => _applySubmission(existing));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _storeSearchDebounce?.cancel();
    _storePager.dispose();
    _vendor.dispose();
    _remarks.dispose();
    _storeSearch.dispose();
    super.dispose();
  }

  Future<void> _reloadSubmission() async {
    final id = _submission?.id;
    if (id == null || id.isEmpty) return;
    setState(() => _loading = true);
    try {
      final fresh = await _service.getSubmission(id);
      if (!mounted) return;
      setState(() => _applySubmission(fresh));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applySubmission(DeepCleaningSubmission submission) {
    _submission = submission;
    _remoteUploads = submission.uploads;
    _vendor.text = submission.vendorName ?? '';
    _remarks.text = submission.remarks ?? '';
    _date = _parseDate(submission.deepCleaningDate);
    _store = RelianceDeepCleaningStore(
      id: submission.storeId ?? '',
      storeCode: submission.storeCode,
      storeName: submission.storeName ?? '',
      clientName: submission.clientName ?? '',
      state: submission.state ?? '',
      city: submission.city,
      storeFormat: submission.storeFormat,
      business: submission.business,
      zoneId: submission.zoneId,
      zoneCode: submission.zoneCode,
      zoneName: submission.zoneName,
    );
    if (submission.evidenceFormat == 'paired_v1') {
      final ordered =
          submission.uploads
              .where(
                (upload) => upload.pairId != null && upload.pairOrder != null,
              )
              .toList()
            ..sort((a, b) => a.pairOrder!.compareTo(b.pairOrder!));
      final ids = ordered.map((upload) => upload.pairId!).toSet().toList();
      if (ids.isNotEmpty) {
        _pairIds
          ..clear()
          ..addAll(ids);
        _pairOrders
          ..clear()
          ..addEntries(
            ordered.map(
              (upload) => MapEntry(upload.pairId!, upload.pairOrder!),
            ),
          );
      }
    }
  }

  Future<void> _selectStore() async {
    unawaited(
      _storePager.reset(query: _storeSearch.text, zoneId: _storePager.zoneId),
    );
    final selected = await showModalBottomSheet<RelianceDeepCleaningStore>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => AnimatedBuilder(
        animation: _storePager,
        builder: (context, _) => SafeArea(
          child: Padding(
            padding: EdgeInsets.only(
              left: 18,
              right: 18,
              bottom: MediaQuery.of(context).viewInsets.bottom + 18,
            ),
            child: SizedBox(
              height: MediaQuery.of(context).size.height * 0.72,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Select Store',
                    style: TextStyle(
                      color: foNavy,
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_storePager.zones.length > 1) ...[
                    DropdownButtonFormField<String?>(
                      key: ValueKey(_storePager.zoneId),
                      isExpanded: true,
                      initialValue: _storePager.zoneId,
                      decoration: const InputDecoration(
                        labelText: 'Assigned Zone',
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('All my Zones'),
                        ),
                        for (final zone in _storePager.zones)
                          DropdownMenuItem<String?>(
                            value: zone.id,
                            child: Text('${zone.code} - ${zone.name}'),
                          ),
                      ],
                      onChanged: (value) {
                        _storeSearchDebounce?.cancel();
                        unawaited(
                          _storePager.reset(
                            query: _storeSearch.text,
                            zoneId: value,
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 10),
                  ],
                  TextField(
                    controller: _storeSearch,
                    decoration: const InputDecoration(
                      labelText: 'Search Store Code / Store Name',
                      prefixIcon: Icon(Icons.search_rounded),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    onChanged: (value) {
                      _storeSearchDebounce?.cancel();
                      _storeSearchDebounce = Timer(
                        const Duration(milliseconds: 300),
                        () {
                          if (context.mounted &&
                              value.trim() != _storePager.query) {
                            unawaited(
                              _storePager.reset(
                                query: value,
                                zoneId: _storePager.zoneId,
                              ),
                            );
                          }
                        },
                      );
                    },
                    onSubmitted: (value) {
                      _storeSearchDebounce?.cancel();
                      if (value.trim() != _storePager.query) {
                        unawaited(
                          _storePager.reset(
                            query: value,
                            zoneId: _storePager.zoneId,
                          ),
                        );
                      }
                    },
                  ),
                  const SizedBox(height: 10),
                  Expanded(
                    child: _storePager.loading
                        ? const Center(child: CircularProgressIndicator())
                        : _storePager.error != null &&
                              _storePager.stores.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(_storePager.error!),
                                TextButton(
                                  onPressed: () =>
                                      unawaited(_storePager.retry()),
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          )
                        : _storePager.stores.isEmpty
                        ? const Center(child: Text('No stores found.'))
                        : NotificationListener<ScrollNotification>(
                            onNotification: (notification) {
                              if (notification.depth == 0 &&
                                  notification.metrics.extentAfter < 240 &&
                                  _storePager.hasMore) {
                                unawaited(_storePager.loadMore());
                              }
                              return false;
                            },
                            child: ListView.separated(
                              itemCount:
                                  _storePager.stores.length +
                                  (_storePager.loadingMore ||
                                          _storePager.error != null
                                      ? 1
                                      : 0),
                              separatorBuilder: (_, _) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                if (index == _storePager.stores.length) {
                                  if (_storePager.error != null) {
                                    return ListTile(
                                      title: Text(_storePager.error!),
                                      trailing: TextButton(
                                        onPressed: () =>
                                            unawaited(_storePager.retry()),
                                        child: const Text('Retry'),
                                      ),
                                    );
                                  }
                                  return const Padding(
                                    padding: EdgeInsets.all(16),
                                    child: Center(
                                      child: CircularProgressIndicator(),
                                    ),
                                  );
                                }
                                final store = _storePager.stores[index];
                                return ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(
                                    store.storeCode,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  subtitle: Text(
                                    [
                                          store.storeName,
                                          store.zoneName ??
                                              store.zoneCode ??
                                              '',
                                          store.city ?? '',
                                          store.state,
                                        ]
                                        .where((part) => part.isNotEmpty)
                                        .join(' - '),
                                  ),
                                  trailing: const Icon(
                                    Icons.chevron_right_rounded,
                                  ),
                                  onTap: () => Navigator.of(context).pop(store),
                                );
                              },
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    _storeSearchDebounce?.cancel();
    if (selected == null) return;
    setState(() {
      _store = selected;
      _submission = null;
      _remoteUploads = [];
      _localUploads.clear();
      _pairIds
        ..clear()
        ..add(newDeepCleaningPairId());
      _pairOrders
        ..clear()
        ..[_pairIds.first] = 1;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 1),
    );
    if (picked == null) return;
    setState(() => _date = picked);
    if (_submission != null && !_isSubmitted) {
      await _saveDraft();
    }
  }

  Future<void> _saveDraft() async {
    final id = _submission?.id;
    if (id == null || (!_isScheduled && _date == null)) return;
    setState(() => _loading = true);
    try {
      final updated = await _service.updateDraft(
        id: id,
        deepCleaningDate: _isScheduled ? null : _dateValue,
        vendorName: _isScheduled ? null : _vendor.text,
        remarks: _remarks.text,
      );
      if (!mounted) return;
      setState(() => _submission = updated);
    } catch (error) {
      if (!mounted) return;
      _snack(_message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<DeepCleaningSubmission?> _ensureDraft() async {
    if (_submission != null) return _submission;
    final schedule = widget.schedule;
    if (schedule != null) {
      if (!schedule.canExecute) {
        _snack('This Deep Cleaning schedule has already been finalized.');
        return null;
      }
      setState(() => _loading = true);
      try {
        final created = await _service.createScheduledDraft(
          scheduleId: schedule.id,
          remarks: _remarks.text,
        );
        if (!mounted) return null;
        setState(() => _applySubmission(created));
        return created;
      } on DeepCleaningApiException catch (error) {
        if (error.code == 'schedule_submission_exists') {
          final existing = await _service.findSubmissionForSchedule(
            schedule.id,
          );
          if (!mounted || existing == null) return null;
          setState(() => _applySubmission(existing));
          return existing;
        }
        if (mounted) _snack(error.message);
        return null;
      } catch (error) {
        if (mounted) _snack(_message(error));
        return null;
      } finally {
        if (mounted) setState(() => _loading = false);
      }
    }
    final store = _store;
    if (store == null) {
      _snack('Select a Reliance Retail store first.');
      return null;
    }
    if (_date == null) {
      _snack('Select the Deep Cleaning date first.');
      return null;
    }
    setState(() => _loading = true);
    try {
      final created = await _service.createDraft(
        storeCode: store.storeCode,
        deepCleaningDate: _dateValue!,
        vendorName: _vendor.text,
        remarks: _remarks.text,
      );
      if (!mounted) return null;
      setState(() => _applySubmission(created));
      return created;
    } catch (error) {
      if (mounted) _snack(_message(error));
      return null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _addPhotos(DeepCleaningUploadType type) async {
    if (_isSubmitted) return;
    final submission = await _ensureDraft();
    if (submission == null) return;
    final files = await _picker.pickMultiImage(
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 78,
    );
    for (final file in files) {
      final local = await _localUploadFromPath(type, file.path);
      if (local == null) continue;
      setState(() => _localUploads.add(local));
      await _uploadLocal(submission.id, local);
    }
  }

  Future<bool> _pickPairImage(
    String pairId,
    DeepCleaningUploadType type, {
    String? path,
  }) async {
    if (_isSubmitted || _hasActiveUploads) return false;
    var selectedPath = path;
    if (selectedPath == null) {
      final source = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: const Text('Gallery'),
                onTap: () => Navigator.pop(context, 'gallery'),
              ),
              ListTile(
                title: const Text('Files'),
                onTap: () => Navigator.pop(context, 'files'),
              ),
            ],
          ),
        ),
      );
      if (source == 'gallery') {
        selectedPath = (await _picker.pickImage(
          source: ImageSource.gallery,
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 78,
        ))?.path;
      } else if (source == 'files') {
        selectedPath = (await FilePicker.pickFiles(
          type: FileType.image,
        ))?.files.single.path;
      }
    }
    if (selectedPath == null || !mounted) return false;
    final order = _pairOrders[pairId] ?? -1;
    if (order < 1) return false;
    final local = await _localUploadFromPath(
      type,
      selectedPath,
      pairId: pairId,
      pairOrder: order,
    );
    if (local == null || !mounted) return false;
    final existing = _pairUpload(pairId, type);
    if (existing != null) {
      final replace = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Replace ${type.label} image?'),
          content: const Text(
            'The current image will remain until its replacement is uploaded.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Replace'),
            ),
          ],
        ),
      );
      if (replace != true || !mounted) {
        return false;
      }
      local.replacesUploadId = existing.id;
    }
    final submission = await _ensureDraft();
    if (submission == null || !mounted) return false;
    setState(() => _localUploads.add(local));
    await _uploadLocal(submission.id, local);
    return local.isUploaded;
  }

  Future<void> _selectBulkImages() async {
    final source = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: const Text('Select multiple from Gallery'),
              onTap: () => Navigator.pop(context, 'gallery'),
            ),
            ListTile(
              title: const Text('Select multiple from Files'),
              onTap: () => Navigator.pop(context, 'files'),
            ),
            if (Platform.isAndroid)
              ListTile(
                title: const Text('Select a readable image folder'),
                onTap: () => Navigator.pop(context, 'folder'),
              ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final selected = <_SelectedBulkImage>[];
    if (source == 'gallery') {
      final files = await _picker.pickMultiImage(
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 78,
      );
      selected.addAll(
        files.map((file) => _SelectedBulkImage(file.path, file.name)),
      );
    } else if (source == 'folder') {
      final path = await FilePicker.getDirectoryPath();
      if (path == null) return;
      if (path == '/' || !await Directory(path).exists()) {
        if (mounted) {
          _snack(
            'This folder cannot be read. Select images using Files instead.',
          );
        }
        return;
      }
      try {
        await for (final item in Directory(path).list(followLinks: false)) {
          if (item is File &&
              _mimeForPath(item.path)?.startsWith('image/') == true) {
            selected.add(
              _SelectedBulkImage(item.path, item.uri.pathSegments.last),
            );
            if (selected.length >= 100) break;
          }
        }
      } on FileSystemException {
        if (mounted) {
          _snack(
            'This folder cannot be read. Select images using Files instead.',
          );
        }
        return;
      }
      if (selected.isEmpty && mounted) {
        _snack('No supported images found in this folder.');
      }
    } else {
      final result = await FilePicker.pickFiles(
        type: FileType.image,
        allowMultiple: true,
      );
      selected.addAll(
        (result?.files ?? [])
            .where((file) => file.path != null)
            .map((file) => _SelectedBulkImage(file.path!, file.name)),
      );
    }
    if (mounted) setState(() => _bulkImages.addAll(selected));
  }

  Future<void> _assignBulkImage(_SelectedBulkImage image) async {
    final target = await showModalBottomSheet<(String, DeepCleaningUploadType)>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (var index = 0; index < _pairIds.length; index++) ...[
              ListTile(
                title: Text('Pair ${index + 1} - Before'),
                onTap: () => Navigator.pop(context, (
                  _pairIds[index],
                  DeepCleaningUploadType.before,
                )),
              ),
              ListTile(
                title: Text('Pair ${index + 1} - After'),
                onTap: () => Navigator.pop(context, (
                  _pairIds[index],
                  DeepCleaningUploadType.after,
                )),
              ),
            ],
          ],
        ),
      ),
    );
    if (target == null || !mounted) return;
    final assigned = await _pickPairImage(
      target.$1,
      target.$2,
      path: image.path,
    );
    if (mounted && assigned) {
      setState(() => _bulkImages.remove(image));
    }
  }

  Future<void> _removePair(String pairId) async {
    if (_pairIds.length <= 1 || _hasActiveUploads) return;
    for (final upload
        in _remoteUploads.where((item) => item.pairId == pairId).toList()) {
      if (!await _deleteRemoteUpload(upload)) return;
    }
    if (mounted) {
      setState(() {
        _pairIds.remove(pairId);
        _pairOrders.remove(pairId);
      });
    }
  }

  Future<void> _addChecklist() async {
    if (_isSubmitted) return;
    final local = await _pickSupportingFile(DeepCleaningUploadType.checklist);
    if (local == null) return;
    final submission = await _ensureDraft();
    if (submission == null) return;
    setState(() => _localUploads.add(local));
    await _uploadLocal(submission.id, local);
  }

  Future<void> _addOrReplaceSupportingDocument() async {
    if (_isSubmitted || _hasActiveUploads) return;
    final local = await _pickSupportingFile(DeepCleaningUploadType.document);
    if (local == null || !mounted) return;
    final existing = _remoteUploads
        .where(
          (upload) =>
              upload.isUploaded &&
              (upload.uploadType == DeepCleaningUploadType.document ||
                  upload.uploadType == DeepCleaningUploadType.checklist),
        )
        .toList();
    if (existing.isNotEmpty) {
      final replace = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Replace supporting document?'),
          content: const Text(
            'The current supporting document will be removed before the new file is uploaded.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Replace'),
            ),
          ],
        ),
      );
      if (replace != true || !mounted) return;
      final removed = await _deleteRemoteUpload(existing.first);
      if (!removed || !mounted) return;
    }
    _localUploads.removeWhere(
      (upload) =>
          upload.uploadType == DeepCleaningUploadType.document ||
          upload.uploadType == DeepCleaningUploadType.checklist,
    );
    final submission = await _ensureDraft();
    if (submission == null) return;
    setState(() => _localUploads.add(local));
    await _uploadLocal(submission.id, local);
  }

  Future<DeepCleaningLocalUpload?> _pickSupportingFile(
    DeepCleaningUploadType type,
  ) async {
    final result = await FilePicker.pickFiles(
      allowMultiple: false,
      type: FileType.custom,
      allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
    );
    final file = result?.files.single;
    final path = file?.path;
    if (path == null) return null;
    return _localUploadFromPath(type, path, originalFilename: file?.name);
  }

  Future<void> _retryUpload(DeepCleaningLocalUpload upload) async {
    final submission = await _ensureDraft();
    if (submission == null) return;
    await _uploadLocal(submission.id, upload);
  }

  Future<void> _uploadLocal(
    String submissionId,
    DeepCleaningLocalUpload upload,
  ) async {
    setState(() {
      upload.status = DeepCleaningLocalUploadStatus.uploading;
      upload.error = null;
    });
    try {
      final intent = await _service.requestUploadUrl(
        submissionId: submissionId,
        uploadType: upload.uploadType,
        filename: upload.originalFilename,
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        pairId: upload.pairId,
        pairOrder: upload.pairOrder,
        uploadId: upload.intent?.uploadId,
        requestId: upload.requestId,
      );
      upload.intent = intent;
      // A PUT or completion response may have been lost. Confirm the original
      // server-issued object before retrying; never create a second intent.
      DeepCleaningUpload? recovered;
      try {
        recovered = await _service.completeUpload(
          submissionId: submissionId,
          intent: intent,
          originalFilename: upload.originalFilename,
          fileSize: upload.fileSize,
        );
      } on DeepCleaningApiException catch (error) {
        if (![
          'storage_object_missing',
          'storage_object_not_found',
          'upload_object_missing',
        ].contains(error.code)) {
          rethrow;
        }
      }
      if (recovered == null) {
        await _service.uploadToSignedUrl(
          intent: intent,
          file: upload.file,
          onProgress: (progress) {
            if (mounted) setState(() => upload.progress = progress);
          },
        );
      }
      final completed =
          recovered ??
          await _service.completeUpload(
            submissionId: submissionId,
            intent: intent,
            originalFilename: upload.originalFilename,
            fileSize: upload.fileSize,
          );
      if (!mounted) return;
      setState(() {
        upload.uploadId = completed.id;
        upload.storagePath = completed.storagePath;
        upload.remoteUpload = completed;
        upload.status = DeepCleaningLocalUploadStatus.uploaded;
        _localUploads.remove(upload);
        _remoteUploads = [..._remoteUploads, completed];
      });
      final replacedId = upload.replacesUploadId;
      if (replacedId != null) {
        final old = _remoteUploads
            .where((item) => item.id == replacedId)
            .firstOrNull;
        if (old != null && !await _deleteRemoteUpload(old) && mounted) {
          _snack(
            'Replacement uploaded. Remove one duplicate before submitting.',
          );
        }
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        upload.status = DeepCleaningLocalUploadStatus.failed;
        upload.error = _message(error);
      });
    }
  }

  Future<void> _submit() async {
    if (_submitting || !_canSubmit || _isSubmitted) return;
    final submission = await _ensureDraft();
    if (submission == null) return;
    setState(() => _submitting = true);
    try {
      final submitted = await _service.submitSubmission(submission.id);
      if (!mounted) return;
      setState(() => _applySubmission(submitted));
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Deep Cleaning Submitted'),
          content: Text(
            'Store Code: ${submitted.storeCode}\n\nVendor Deep Cleaning evidence submitted.',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Done'),
            ),
          ],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) _snack(_message(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitCompleted() async {
    if (_submitting || !_canComplete || _isSubmitted) return;
    final submission = await _ensureDraft();
    if (submission == null) return;
    await _saveDraft();
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Review Completed Report'),
        content: Text(
          'Store: ${submission.storeCode}\n'
          'Before images: ${_confirmedUploads(DeepCleaningUploadType.before)}\n'
          'After images: ${_confirmedUploads(DeepCleaningUploadType.after)}\n'
          'Supporting document: $_documentCount\n\n'
          '${_remarks.text.trim().isEmpty ? 'No remarks added.' : 'Remarks: ${_remarks.text.trim()}'}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Go Back'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirm Completed'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _finalizeScheduled(outcome: 'Completed');
    }
  }

  Future<void> _submitNotDone() async {
    if (_submitting || _hasActiveUploads || _isSubmitted) return;
    final reasonController = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Why was cleaning not done?'),
          content: TextField(
            controller: reasonController,
            autofocus: true,
            minLines: 3,
            maxLines: 5,
            onChanged: (_) => setDialogState(() {}),
            decoration: const InputDecoration(
              labelText: 'Reason',
              hintText: 'Type the reason',
              alignLabelWithHint: true,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: reasonController.text.trim().isEmpty
                  ? null
                  : () =>
                        Navigator.of(context).pop(reasonController.text.trim()),
              child: const Text('Review'),
            ),
          ],
        ),
      ),
    );
    reasonController.dispose();
    if (reason == null || !mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm Not Done'),
        content: Text(
          'Store: ${widget.schedule?.storeCode ?? _submission?.storeCode ?? '--'}\n\n'
          'Reason: $reason\n\n'
          'Evidence is not required for this outcome.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Go Back'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFE11D48),
            ),
            child: const Text('Submit Not Done'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _finalizeScheduled(outcome: 'Not Done', notDoneReason: reason);
    }
  }

  Future<void> _finalizeScheduled({
    required String outcome,
    String? notDoneReason,
  }) async {
    final submission = await _ensureDraft();
    if (submission == null || _submitting || _isSubmitted) return;
    setState(() => _submitting = true);
    try {
      final submitted = await _service.submitSubmission(
        submission.id,
        outcome: outcome,
        notDoneReason: notDoneReason,
      );
      if (!mounted) return;
      setState(() => _applySubmission(submitted));
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          icon: Icon(
            outcome == 'Completed'
                ? Icons.check_circle_rounded
                : Icons.info_rounded,
            color: outcome == 'Completed' ? foGreen : const Color(0xFFE11D48),
            size: 46,
          ),
          title: Text('Deep Cleaning $outcome'),
          content: Text(
            outcome == 'Completed'
                ? 'The report and all required evidence were submitted successfully.'
                : 'The Not Done outcome and reason were submitted successfully.',
            textAlign: TextAlign.center,
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Done'),
            ),
          ],
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      _snack(_message(error));
      if (error is DeepCleaningApiException &&
          error.code == 'schedule_already_finalized') {
        await _initializeScheduledReport();
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final readOnly =
        _isSubmitted ||
        (widget.schedule != null && !widget.schedule!.canExecute);
    return Scaffold(
      body: FoPage(
        children: [
          FoHeader(
            title: _isScheduled ? 'Cleaning Report' : 'Deep Cleaning',
            subtitle: _isScheduled
                ? 'Reliance Retail scheduled job'
                : 'Vendor cleaning evidence',
            leading: IconButton(
              onPressed: () => Navigator.of(context).pop(_submission != null),
              icon: const Icon(Icons.arrow_back_rounded, color: qpmsBlue),
            ),
            trailing: FoStatusBadge(label: _displayStatus, color: _statusColor),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFFE11D48))),
          ],
          const SizedBox(height: 16),
          if (!readOnly && _hasPendingRemoteUploads) ...[
            FoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Incomplete uploads',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const Text(
                    'Remove an incomplete upload before selecting its replacement and completing this report.',
                  ),
                  for (final upload in _remoteUploads.where(
                    (item) => !item.isUploaded,
                  ))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        upload.originalFilename ?? upload.uploadType.label,
                      ),
                      trailing: TextButton(
                        onPressed: _hasActiveUploads
                            ? null
                            : () => _deleteRemoteUpload(upload),
                        child: const Text('Remove incomplete upload'),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (_isScheduled)
            _scheduledSummaryCard()
          else ...[
            _storeCard(readOnly),
            const SizedBox(height: 12),
            _dateCard(readOnly),
          ],
          const SizedBox(height: 12),
          _textCard(readOnly),
          const SizedBox(height: 12),
          if (_usesPairs)
            _comparisonPairsCard(readOnly)
          else ...[
            _uploadSection(DeepCleaningUploadType.before, readOnly),
            const SizedBox(height: 12),
            _uploadSection(DeepCleaningUploadType.after, readOnly),
          ],
          const SizedBox(height: 12),
          _supportingDocumentSection(readOnly),
          const SizedBox(height: 18),
          if (!readOnly && _isScheduled) ...[
            FilledButton.icon(
              onPressed: _canComplete ? _submitCompleted : null,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check_circle_outline_rounded),
              label: Text(
                _hasActiveUploads
                    ? 'Please wait for uploads to finish'
                    : 'Submit as Completed',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                textStyle: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _hasActiveUploads ? null : _submitNotDone,
              icon: const Icon(Icons.cancel_outlined),
              label: const Text('Mark as Not Done'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFE11D48),
                side: const BorderSide(color: Color(0xFFE11D48)),
                minimumSize: const Size.fromHeight(52),
                textStyle: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ] else if (!readOnly)
            FilledButton.icon(
              onPressed: _canSubmit ? _submit : null,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.cloud_done_outlined),
              label: Text(
                _hasActiveUploads
                    ? 'Please wait for uploads to finish'
                    : 'Submit Evidence',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                textStyle: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
        ],
      ),
    );
  }

  Widget _storeCard(bool readOnly) {
    final store = _store;
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoSectionTitle(
            title: 'Store',
            trailing: readOnly
                ? null
                : TextButton.icon(
                    onPressed: _loading ? null : _selectStore,
                    icon: const Icon(Icons.search_rounded),
                    label: Text(store == null ? 'Select' : 'Change'),
                  ),
          ),
          const SizedBox(height: 10),
          if (store == null)
            const Text(
              'Select Store Code / Store Name',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w800),
            )
          else ...[
            _detail('Store Code', store.storeCode),
            _detail('Store Name', store.storeName),
            _detail('State', store.state),
            if (store.zoneName?.isNotEmpty == true)
              _detail('Zone', '${store.zoneCode ?? ''} ${store.zoneName}'),
            if (store.clientName.isNotEmpty)
              _detail('Client', store.clientName),
            if (store.storeFormat?.isNotEmpty == true)
              _detail('Format', store.storeFormat!),
            if (store.city?.isNotEmpty == true)
              _detail('Location', store.city!),
          ],
        ],
      ),
    );
  }

  Widget _dateCard(bool readOnly) {
    return FoCard(
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'Deep Cleaning Date',
              style: TextStyle(color: foNavy, fontWeight: FontWeight.w900),
            ),
          ),
          TextButton.icon(
            onPressed: readOnly ? null : _pickDate,
            icon: const Icon(Icons.calendar_month_outlined),
            label: Text(_dateValue ?? 'Select Date'),
          ),
        ],
      ),
    );
  }

  Widget _textCard(bool readOnly) {
    return FoCard(
      child: Column(
        children: [
          if (readOnly && _vendor.text.trim().isNotEmpty) ...[
            _detail('Vendor', _vendor.text.trim()),
            const SizedBox(height: 10),
          ],
          TextField(
            controller: _remarks,
            enabled: !readOnly,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Remarks (optional)'),
            onEditingComplete: _saveDraft,
          ),
        ],
      ),
    );
  }

  Widget _scheduledSummaryCard() {
    final schedule = widget.schedule;
    final storeCode = schedule?.storeCode ?? _submission?.storeCode ?? '--';
    final storeName = schedule?.storeName ?? _submission?.storeName ?? '--';
    final date = schedule?.scheduledDate ?? _submission?.deepCleaningDate ?? '';
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: qpmsBlue,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x290A43D1),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'STORE CODE',
            style: TextStyle(
              color: Color(0xFFBFD4FF),
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            storeCode,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            storeName,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (schedule != null)
            Text(
              [
                schedule.locationLabel,
                schedule.zoneLabel,
                schedule.geographicState,
                schedule.assignmentStatus,
                schedule.notes,
              ].whereType<String>().where((v) => v.isNotEmpty).join(' · '),
              style: const TextStyle(color: Colors.white),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.event_outlined, color: Colors.white, size: 19),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _displayDate(date),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              FoStatusBadge(
                label: _displayStatus,
                color: _displayStatus == 'Completed'
                    ? foGreen
                    : _displayStatus == 'Not Done'
                    ? const Color(0xFFE11D48)
                    : Colors.white,
              ),
            ],
          ),
          if ((_submission?.notDoneReason ?? schedule?.notDoneReason)
                  ?.isNotEmpty ==
              true) ...[
            const SizedBox(height: 14),
            Text(
              'Reason: ${_submission?.notDoneReason ?? schedule?.notDoneReason}',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _uploadSection(DeepCleaningUploadType type, bool readOnly) {
    final remote = _remoteUploads
        .where((upload) => upload.uploadType == type && upload.isUploaded)
        .toList();
    final local = _localUploads.where((upload) => upload.uploadType == type);
    final required =
        type == DeepCleaningUploadType.before ||
        type == DeepCleaningUploadType.after;
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoSectionTitle(
            title: type.label.toUpperCase(),
            subtitle: required ? 'Required: at least 1' : 'Optional',
            trailing: readOnly
                ? null
                : TextButton.icon(
                    onPressed: _hasActiveUploads
                        ? null
                        : () => type == DeepCleaningUploadType.checklist
                              ? _addChecklist()
                              : _addPhotos(type),
                    icon: const Icon(Icons.add_rounded),
                    label: Text(
                      remote.isEmpty && local.isEmpty
                          ? 'Add Images'
                          : 'Add More',
                    ),
                  ),
          ),
          const SizedBox(height: 8),
          if (remote.isEmpty && local.isEmpty)
            const Text(
              'No evidence uploaded yet.',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
            ),
          for (final upload in remote) _remoteUploadRow(upload, readOnly),
          for (final upload in local) _localUploadRow(upload),
        ],
      ),
    );
  }

  Widget _comparisonPairsCard(bool readOnly) {
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FoSectionTitle(
            title: 'COMPARISON PAIRS',
            subtitle: 'At least one complete Before / After pair is required',
          ),
          const SizedBox(height: 12),
          for (var index = 0; index < _pairIds.length; index++) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Pair ${index + 1}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: foNavy,
                    ),
                  ),
                ),
                if (!readOnly && _pairIds.length > 1)
                  IconButton(
                    tooltip: 'Remove pair',
                    onPressed: _hasActiveUploads
                        ? null
                        : () => _removePair(_pairIds[index]),
                    icon: const Icon(Icons.delete_outline_rounded),
                  ),
              ],
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _pairSlot(
                    _pairIds[index],
                    DeepCleaningUploadType.before,
                    readOnly,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _pairSlot(
                    _pairIds[index],
                    DeepCleaningUploadType.after,
                    readOnly,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
          ],
          if (!readOnly) ...[
            if (!_pairsComplete)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                  'Complete every Before / After pair before submitting.',
                  style: TextStyle(
                    color: Color(0xFFE11D48),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            OutlinedButton.icon(
              onPressed: _hasActiveUploads
                  ? null
                  : () => setState(() {
                      final id = newDeepCleaningPairId();
                      _pairOrders[id] =
                          (_pairOrders.values.fold<int>(
                            0,
                            (max, value) => value > max ? value : max,
                          )) +
                          1;
                      _pairIds.add(id);
                    }),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add Another Pair'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _hasActiveUploads ? null : _selectBulkImages,
              icon: const Icon(Icons.photo_library_outlined),
              label: const Text('Bulk Select Images'),
            ),
            for (final image in _bulkImages)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Image.file(
                  File(image.path),
                  width: 40,
                  height: 40,
                  fit: BoxFit.cover,
                ),
                title: Text(
                  image.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: const Text('Choose its pair and Before / After side'),
                trailing: TextButton(
                  onPressed: _hasActiveUploads
                      ? null
                      : () => _assignBulkImage(image),
                  child: const Text('Assign'),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _pairSlot(String pairId, DeepCleaningUploadType type, bool readOnly) {
    final remote = _pairUpload(pairId, type);
    final duplicates = _remoteUploads
        .where(
          (upload) =>
              upload.isUploaded &&
              upload.pairId == pairId &&
              upload.uploadType == type &&
              upload.id != remote?.id,
        )
        .toList();
    DeepCleaningLocalUpload? local;
    for (final upload in _localUploads) {
      if (upload.pairId == pairId && upload.uploadType == type) {
        local = upload;
        break;
      }
    }
    final localUpload = local;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          type == DeepCleaningUploadType.before ? 'Before' : 'After',
          style: const TextStyle(fontWeight: FontWeight.w800, color: foNavy),
        ),
        const SizedBox(height: 5),
        AspectRatio(
          aspectRatio: 1.2,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: remote != null
                ? FutureBuilder<String>(
                    future: _signedUrlFor(remote),
                    builder: (context, snapshot) => snapshot.hasData
                        ? InkWell(
                            onTap: () => _previewRemoteUpload(remote),
                            child: Image.network(
                              snapshot.data!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) =>
                                  const Icon(Icons.broken_image_outlined),
                            ),
                          )
                        : const Center(
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                  )
                : localUpload != null
                ? Image.file(localUpload.file, fit: BoxFit.cover)
                : const ColoredBox(
                    color: Color(0xFFE9EEF5),
                    child: Center(
                      child: Icon(Icons.add_photo_alternate_outlined),
                    ),
                  ),
          ),
        ),
        if (localUpload != null) ...[
          const SizedBox(height: 4),
          Text(
            localUpload.status == DeepCleaningLocalUploadStatus.uploading
                ? 'Uploading ${(localUpload.progress * 100).round()}%'
                : localUpload.error ?? _localStatus(localUpload),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (localUpload.status == DeepCleaningLocalUploadStatus.failed)
            TextButton(
              onPressed: () => _retryUpload(localUpload),
              child: const Text('Retry'),
            ),
        ],
        if (!readOnly)
          Wrap(
            spacing: 4,
            children: [
              TextButton(
                onPressed: _hasActiveUploads
                    ? null
                    : () => _pickPairImage(pairId, type),
                child: Text(remote == null ? 'Add' : 'Replace'),
              ),
              if (remote != null)
                TextButton(
                  onPressed: _hasActiveUploads
                      ? null
                      : () => _deleteRemoteUpload(remote),
                  child: const Text('Remove'),
                ),
              if (localUpload?.status == DeepCleaningLocalUploadStatus.failed)
                TextButton(
                  onPressed: () => _discardLocalUpload(localUpload!),
                  child: const Text('Remove'),
                ),
            ],
          ),
        for (final duplicate in duplicates)
          TextButton.icon(
            onPressed: readOnly || _hasActiveUploads
                ? null
                : () => _deleteRemoteUpload(duplicate),
            icon: const Icon(Icons.delete_outline_rounded),
            label: const Text('Remove duplicate image'),
          ),
      ],
    );
  }

  Widget _supportingDocumentSection(bool readOnly) {
    final documents = _remoteUploads
        .where(
          (upload) =>
              upload.isUploaded &&
              (upload.uploadType == DeepCleaningUploadType.document ||
                  upload.uploadType == DeepCleaningUploadType.checklist),
        )
        .toList();
    final localDocuments = _localUploads
        .where(
          (upload) =>
              upload.uploadType == DeepCleaningUploadType.document ||
              upload.uploadType == DeepCleaningUploadType.checklist,
        )
        .toList();
    return FoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FoSectionTitle(
            title: 'SUPPORTING DOCUMENT',
            subtitle: 'Required: exactly 1 image or PDF',
            trailing: readOnly
                ? null
                : TextButton.icon(
                    onPressed: _hasActiveUploads
                        ? null
                        : _addOrReplaceSupportingDocument,
                    icon: Icon(
                      documents.isEmpty
                          ? Icons.upload_file_rounded
                          : Icons.sync_rounded,
                    ),
                    label: Text(documents.isEmpty ? 'Add File' : 'Replace'),
                  ),
          ),
          const SizedBox(height: 8),
          if (documents.isEmpty && localDocuments.isEmpty)
            const Text(
              'No supporting document uploaded yet.',
              style: TextStyle(color: qpmsMuted, fontWeight: FontWeight.w700),
            ),
          for (final upload in documents) _remoteUploadRow(upload, readOnly),
          for (final upload in localDocuments) _localUploadRow(upload),
        ],
      ),
    );
  }

  Widget _remoteUploadRow(DeepCleaningUpload upload, bool readOnly) {
    final isPdf = upload.mimeType == 'application/pdf';
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: isPdf
          ? const Icon(Icons.picture_as_pdf_outlined, color: qpmsBlue)
          : FutureBuilder<String>(
              future: _signedUrlFor(upload),
              builder: (context, snapshot) {
                final url = snapshot.data;
                if (url == null || url.isEmpty) {
                  return const SizedBox(
                    width: 46,
                    height: 46,
                    child: Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  );
                }
                return InkWell(
                  onTap: () => _previewRemoteUpload(upload),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      url,
                      width: 46,
                      height: 46,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => IconButton(
                        tooltip: 'Refresh preview',
                        onPressed: () => _refreshRemotePreview(upload),
                        icon: const Icon(
                          Icons.refresh_rounded,
                          color: qpmsBlue,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
      title: Text(upload.originalFilename ?? 'Uploaded evidence'),
      subtitle: Text(isPdf ? 'Private document' : 'Private image'),
      trailing: readOnly
          ? (isPdf
                ? TextButton(
                    onPressed: () => _openRemoteUpload(upload),
                    child: const Text('View'),
                  )
                : null)
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Preview',
                  onPressed: () => _previewRemoteUpload(upload),
                  icon: const Icon(Icons.visibility_outlined),
                ),
                IconButton(
                  tooltip: 'Remove',
                  onPressed: _hasActiveUploads
                      ? null
                      : () => _deleteRemoteUpload(upload),
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            ),
    );
  }

  Widget _localUploadRow(DeepCleaningLocalUpload upload) {
    final failed = upload.status == DeepCleaningLocalUploadStatus.failed;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: upload.mimeType == 'application/pdf'
          ? const Icon(Icons.picture_as_pdf_outlined, color: qpmsBlue)
          : InkWell(
              onTap: () => _previewLocalUpload(upload),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(
                  upload.file,
                  width: 46,
                  height: 46,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) =>
                      const Icon(Icons.image_outlined, color: qpmsBlue),
                ),
              ),
            ),
      title: Text(
        upload.originalFilename,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        failed ? upload.error ?? 'Upload failed' : _localStatus(upload),
      ),
      trailing: failed
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton(
                  onPressed: () => _retryUpload(upload),
                  child: const Text('Retry'),
                ),
                IconButton(
                  tooltip: 'Remove',
                  onPressed: () => _discardLocalUpload(upload),
                  icon: const Icon(Icons.delete_outline_rounded),
                ),
              ],
            )
          : null,
    );
  }

  Future<DeepCleaningLocalUpload?> _localUploadFromPath(
    DeepCleaningUploadType type,
    String path, {
    String? originalFilename,
    String? pairId,
    int? pairOrder,
  }) async {
    final file = File(path);
    final exists = await file.exists();
    if (!exists) return null;
    final size = await file.length();
    final mime = _mimeForPath(path);
    if (mime == null) {
      _snack('Unsupported file type.');
      return null;
    }
    if (size < 1 || size > deepCleaningMaxUploadBytes) {
      _snack('Each file must be 5 MB or less after processing.');
      return null;
    }
    return DeepCleaningLocalUpload(
      uploadType: type,
      file: file,
      mimeType: mime,
      fileSize: size,
      originalFilename: originalFilename ?? file.uri.pathSegments.last,
      pairId: pairId,
      pairOrder: pairOrder,
    );
  }

  int _confirmedUploads(DeepCleaningUploadType type) {
    final remote = _remoteUploads
        .where((upload) => upload.uploadType == type && upload.isUploaded)
        .length;
    final local = _localUploads
        .where((upload) => upload.uploadType == type && upload.isUploaded)
        .length;
    return remote + local;
  }

  Future<String> _signedUrlFor(DeepCleaningUpload upload) async {
    final cached = _viewUrls[upload.id];
    if (cached != null && cached.isFresh) return cached.signedUrl;
    final submissionId = _submission?.id;
    if (submissionId == null || submissionId.isEmpty) return '';
    final view = await _service.viewUploadUrl(
      submissionId: submissionId,
      uploadId: upload.id,
    );
    _viewUrls[upload.id] = view;
    return view.signedUrl;
  }

  void _refreshRemotePreview(DeepCleaningUpload upload) {
    setState(() => _viewUrls.remove(upload.id));
  }

  Future<void> _openRemoteUpload(DeepCleaningUpload upload) async {
    try {
      final url = await _signedUrlFor(upload);
      final uri = Uri.tryParse(url);
      if (uri == null) {
        throw const DeepCleaningApiException('File is not ready.');
      }
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (error) {
      if (mounted) _snack(_message(error));
    }
  }

  Future<void> _previewRemoteUpload(DeepCleaningUpload upload) async {
    if (upload.mimeType == 'application/pdf') {
      await _openRemoteUpload(upload);
      return;
    }
    try {
      final url = await _signedUrlFor(upload);
      if (!mounted || url.isEmpty) return;
      await showDialog<void>(
        context: context,
        builder: (context) => Dialog(
          insetPadding: const EdgeInsets.all(18),
          child: Stack(
            children: [
              InteractiveViewer(
                minScale: 0.8,
                maxScale: 4,
                child: Image.network(url, fit: BoxFit.contain),
              ),
              Positioned(
                top: 6,
                right: 6,
                child: IconButton.filled(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
            ],
          ),
        ),
      );
    } catch (error) {
      if (mounted) _snack(_message(error));
    }
  }

  Future<void> _previewLocalUpload(DeepCleaningLocalUpload upload) async {
    if (upload.mimeType == 'application/pdf') return;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(18),
        child: Stack(
          children: [
            InteractiveViewer(
              minScale: 0.8,
              maxScale: 4,
              child: Image.file(upload.file, fit: BoxFit.contain),
            ),
            Positioned(
              top: 6,
              right: 6,
              child: IconButton.filled(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _discardLocalUpload(DeepCleaningLocalUpload upload) async {
    final submissionId = _submission?.id;
    if (_hasActiveUploads || submissionId == null) return;
    setState(() => _loading = true);
    try {
      final intentId = upload.intent?.uploadId;
      if (intentId != null) {
        await _service.deleteUpload(
          submissionId: submissionId,
          uploadId: intentId,
        );
        if (!mounted) return;
        _remoteUploads = _remoteUploads
            .where((item) => item.id != intentId)
            .toList();
      } else {
        // A lost intent response has no local upload ID. Refresh first so the
        // server's pending row stays visible for explicit removal.
        final fresh = await _service.getSubmission(submissionId);
        if (!mounted) return;
        _applySubmission(fresh);
      }
      setState(() => _localUploads.remove(upload));
    } catch (error) {
      if (mounted) _snack(_message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _deleteRemoteUpload(DeepCleaningUpload upload) async {
    final submissionId = _submission?.id;
    if (submissionId == null || _isSubmitted) return false;
    setState(() => _loading = true);
    try {
      await _service.deleteUpload(
        submissionId: submissionId,
        uploadId: upload.id,
      );
      if (!mounted) return false;
      setState(() {
        _remoteUploads = _remoteUploads
            .where((remote) => remote.id != upload.id)
            .toList();
        _viewUrls.remove(upload.id);
      });
      return true;
    } catch (error) {
      if (mounted) _snack(_message(error));
      return false;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _localStatus(DeepCleaningLocalUpload upload) {
    switch (upload.status) {
      case DeepCleaningLocalUploadStatus.uploading:
        return 'Uploading';
      case DeepCleaningLocalUploadStatus.uploaded:
        return 'Uploaded';
      case DeepCleaningLocalUploadStatus.failed:
        return 'Failed';
      case DeepCleaningLocalUploadStatus.pending:
        return 'Pending';
    }
  }

  Widget _detail(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: const TextStyle(
                color: qpmsMuted,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? '--' : value,
              style: const TextStyle(
                color: foNavy,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String? _mimeForPath(String path) {
    final clean = path.toLowerCase();
    if (clean.endsWith('.png')) return 'image/png';
    if (clean.endsWith('.webp')) return 'image/webp';
    if (clean.endsWith('.pdf')) return 'application/pdf';
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
    return null;
  }

  String get _displayStatus {
    final outcome = _submission?.finalOutcome;
    if (outcome != null && outcome.isNotEmpty) return outcome;
    final scheduleStatus = widget.schedule?.status;
    if (scheduleStatus != null && scheduleStatus.isNotEmpty) {
      return scheduleStatus;
    }
    return deepCleaningStatusLabel(_submission?.status ?? 'draft');
  }

  Color get _statusColor {
    switch (_displayStatus) {
      case 'Completed':
      case 'Submitted':
        return foGreen;
      case 'Not Done':
        return const Color(0xFFE11D48);
      default:
        return qpmsBlue;
    }
  }

  String _displayDate(String value) {
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return value.isEmpty ? '--' : value;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${parsed.day.toString().padLeft(2, '0')} '
        '${months[parsed.month - 1]} ${parsed.year}';
  }

  String? get _dateValue {
    final value = _date;
    if (value == null) return null;
    return '${value.year.toString().padLeft(4, '0')}-'
        '${value.month.toString().padLeft(2, '0')}-'
        '${value.day.toString().padLeft(2, '0')}';
  }

  DateTime? _parseDate(String? value) {
    if (value == null || value.isEmpty) return null;
    return DateTime.tryParse(value);
  }

  void _snack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  String _message(Object error) {
    if (error is DeepCleaningApiException) return error.message;
    return 'Please check the details and try again.';
  }
}

class _SelectedBulkImage {
  const _SelectedBulkImage(this.path, this.name);
  final String path;
  final String name;
}
