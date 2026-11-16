import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/training_repository.dart';
import '../models/training_evidence.dart';
import '../models/training_type.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_store_picker.dart';

bool compatibleHkMaster(TrainingFlowController c) {
  final category = c.selectedCategory;
  return category != null &&
      category.code == 'hk' &&
      !category.requireAttendee &&
      !category.requireGroupPhoto &&
      !category.requireAttendanceSheet &&
      !category.requireTrainingDocument &&
      const ['required', 'optional'].contains(category.topicEvidencePolicy);
}

class HkTrainingScreen extends StatefulWidget {
  const HkTrainingScreen({required this.controller, super.key});
  final TrainingFlowController controller;
  @override
  State<HkTrainingScreen> createState() => _HkTrainingScreenState();
}

class _HkTrainingScreenState extends State<HkTrainingScreen> {
  TrainingFlowController get c => widget.controller;
  final Set<String> _topics = {};
  final Map<String, List<PlatformFile>> _photos = {};
  PlatformFile? _proof;
  bool _busy = false;
  String? _message;
  String _progress = '';

  @override
  void initState() {
    super.initState();
    _topics.addAll(c.selectedSessionTopics.map((t) => t.topicId));
  }

  String _mime(PlatformFile file) => switch (file.extension?.toLowerCase()) {
    'pdf' => 'application/pdf',
    'png' => 'image/png',
    _ => 'image/jpeg',
  };

  Future<void> _pick({String? topicId}) async {
    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: topicId == null
            ? ['pdf', 'jpg', 'jpeg', 'png']
            : ['jpg', 'jpeg', 'png'],
      );
      if (result == null || !mounted) return;
      final file = result.files.single;
      if (file.path == null) {
        throw StateError('The selected file cannot be read.');
      }
      TrainingRepository.validateEvidence(
        type: topicId == null
            ? TrainingEvidenceType.additionalDocument
            : TrainingEvidenceType.topicPhoto,
        mimeType: _mime(file),
        fileSize: file.size,
        sessionTopicId: topicId,
      );
      setState(() {
        if (topicId == null) {
          _proof = file;
        } else {
          (_photos[topicId] ??= []).add(file);
        }
        _message = null;
      });
    } catch (error) {
      if (mounted) setState(() => _message = '$error');
    }
  }

  Future<void> _upload(PlatformFile file, String? sessionTopicId) async {
    final localId =
        '${c.session!.id}:${sessionTopicId ?? 'proof'}:${file.path}';
    await c.queueEvidence(
      localId: localId,
      sessionTopicId: sessionTopicId,
      type: sessionTopicId == null
          ? TrainingEvidenceType.additionalDocument
          : TrainingEvidenceType.topicPhoto,
      path: file.path!,
      fileName: file.name,
      mimeType: _mime(file),
      fileSize: file.size,
    );
    await c.uploadQueued(localId);
  }

  Future<void> _submit() async {
    if (_busy || !c.isEditable) return;
    var submitAttempted = false;
    setState(() {
      _busy = true;
      _message = null;
      _progress = 'Saving Training details…';
    });
    try {
      if (c.session == null && !compatibleHkMaster(c)) {
        throw StateError(
          'HK master policy requires additional evidence or attendees. Contact your administrator.',
        );
      }
      if (!c.canContinueDetails || _topics.isEmpty) {
        throw StateError('Select a store, training type and required topics.');
      }
      if (_proof == null &&
          !c.evidence.any(
            (e) => e.evidenceType == TrainingEvidenceType.additionalDocument,
          ) &&
          !c.pendingEvidence.any(
            (e) => e.evidenceType == TrainingEvidenceType.additionalDocument,
          )) {
        throw StateError(
          'Select one completion proof (PDF/JPEG/PNG, maximum 5 MB).',
        );
      }
      // Submitted retries are reads. Do not PATCH an already accepted submission.
      if (c.isSubmitted) return;
      await c.saveDraft();
      if (c.session!.hkTrainingPolicy != 'hk_single_page_v1' &&
          c.session!.topicEvidencePolicySnapshot != 'required') {
        throw StateError(
          'The HK evidence policy is unavailable. Contact your administrator.',
        );
      }
      await c.setSelectedTopics(_topics.toList());
      if (mounted) setState(() => _progress = 'Uploading evidence…');
      if (c.pendingEvidence.isNotEmpty) {
        final retriedPaths = c.pendingEvidence
            .map((e) => e.localFilePath)
            .toSet();
        await c.retryUploads();
        final remainingPaths = c.pendingEvidence
            .map((e) => e.localFilePath)
            .toSet();
        for (final files in _photos.values) {
          files.removeWhere(
            (file) =>
                retriedPaths.contains(file.path) &&
                !remainingPaths.contains(file.path),
          );
        }
        if (retriedPaths.contains(_proof?.path) &&
            !remainingPaths.contains(_proof?.path)) {
          _proof = null;
        }
        if (c.pendingEvidence.isNotEmpty) {
          throw StateError(
            'Evidence upload failed. Check your connection and retry Submit.',
          );
        }
      }
      for (final topicId in _photos.keys.toList()) {
        final sessionTopic = c.selectedSessionTopics.firstWhere(
          (t) => t.topicId == topicId,
        );
        final files = _photos[topicId]!;
        while (files.isNotEmpty) {
          await _upload(files.first, sessionTopic.id);
          files.removeAt(0);
        }
      }
      if (_proof != null) {
        await _upload(_proof!, null);
        _proof = null;
      }
      for (final topic in c.selectedSessionTopics.toList()) {
        if (!topic.isCovered) await c.updateTopic(topic.id, isCovered: true);
      }
      if (c.pendingEvidence.isNotEmpty) {
        throw StateError(
          'Evidence upload failed. Retry the pending uploads before submitting.',
        );
      }
      if (c.session!.topicEvidencePolicySnapshot == 'required' &&
          c.selectedSessionTopics.any(
            (topic) => !c
                .evidenceForTopic(topic.id)
                .any(
                  (e) =>
                      e.isUploaded &&
                      e.evidenceType == TrainingEvidenceType.topicPhoto &&
                      const ['image/jpeg', 'image/png'].contains(e.mimeType) &&
                      e.fileSize > 0,
                ),
          )) {
        throw StateError(
          'Upload a JPEG/PNG photo for every selected topic before submitting.',
        );
      }
      if (!c.evidence.any(
        (e) =>
            e.isUploaded &&
            e.evidenceType == TrainingEvidenceType.additionalDocument,
      )) {
        throw StateError('Upload the completion proof before submitting.');
      }
      if (mounted) setState(() => _progress = 'Submitting Training…');
      submitAttempted = true;
      await c.submit();
      if (mounted) {
        setState(() => _message = 'Training submitted successfully.');
      }
    } catch (error) {
      // Resolve an ambiguous submit response before allowing another attempt.
      if (submitAttempted && c.session != null) {
        try {
          await c.refresh();
        } catch (_) {
          /* Keep durable queue for explicit retry. */
        }
      }
      if (mounted) {
        setState(
          () => _message = c.isSubmitted
              ? 'Training submitted successfully.'
              : '$error',
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _progress = '';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: c,
    builder: (context, _) {
      final editable = c.isEditable && !_busy;
      final proofExists =
          c.evidence.any(
            (e) => e.evidenceType == TrainingEvidenceType.additionalDocument,
          ) ||
          c.pendingEvidence.any(
            (e) => e.evidenceType == TrainingEvidenceType.additionalDocument,
          );
      return PopScope(
        canPop: !_busy,
        child: Scaffold(
          appBar: AppBar(title: const Text('HK Training')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (!c.isEditable)
                const Text('Read only — submitted or Check-In ended.'),
              if (c.session == null && !compatibleHkMaster(c))
                const Text(
                  'HK master policy is incompatible. Contact your administrator.',
                ),
              ListTile(
                title: const Text('Store Code'),
                subtitle: Text(
                  '${c.selectedStore?['store_code'] ?? c.session?.storeCodeSnapshot ?? 'Select store'} — ${c.selectedStore?['store_name'] ?? c.session?.storeNameSnapshot ?? ''}',
                ),
                trailing: const Icon(Icons.search),
                onTap: editable && c.session == null
                    ? () async {
                        final store = await showDialog<Map<String, dynamic>>(
                          context: context,
                          builder: (_) => TrainingStorePicker(controller: c),
                        );
                        if (store != null && mounted) c.selectStore(store);
                      }
                    : null,
              ),
              ListTile(
                title: const Text('Training Date (IST)'),
                subtitle: Text(
                  c.trainingDate.toIso8601String().split('T').first,
                ),
              ),
              ListTile(
                title: const Text('Trainer'),
                subtitle: Text(c.trainerName),
              ),
              DropdownButtonFormField<TrainingType>(
                key: ValueKey(c.selectedTrainingType?.id),
                initialValue: c.selectedTrainingType,
                decoration: const InputDecoration(labelText: 'Training Type'),
                items: c.types
                    .map(
                      (type) =>
                          DropdownMenuItem(value: type, child: Text(type.name)),
                    )
                    .toList(),
                onChanged: editable
                    ? (value) {
                        if (value != null) c.selectTrainingType(value);
                      }
                    : null,
              ),
              const SizedBox(height: 16),
              const Text(
                'HK Topics',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              for (final topic in c.topics) ...[
                CheckboxListTile(
                  title: Text(topic.moduleName),
                  value: _topics.contains(topic.id),
                  onChanged:
                      editable &&
                          !c.selectedSessionTopics.any(
                            (t) =>
                                t.topicId == topic.id &&
                                c.evidenceForTopic(t.id).isNotEmpty,
                          )
                      ? (value) => setState(() {
                          if (value == true) {
                            _topics.add(topic.id);
                          } else {
                            _topics.remove(topic.id);
                            _photos.remove(topic.id);
                          }
                        })
                      : null,
                ),
                if (_topics.contains(topic.id))
                  Padding(
                    padding: const EdgeInsets.only(left: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        TextButton.icon(
                          onPressed: editable
                              ? () => _pick(topicId: topic.id)
                              : null,
                          icon: const Icon(Icons.add_photo_alternate_outlined),
                          label: Text(
                            c.selectedCategory?.topicEvidencePolicy ==
                                    'required'
                                ? 'Add required JPEG/PNG'
                                : 'Add optional JPEG/PNG',
                          ),
                        ),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final file
                                in _photos[topic.id] ?? <PlatformFile>[])
                              _selectedImage(file),
                          ],
                        ),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 16),
              const Text(
                'Completion Proof — exactly one PDF/JPEG/PNG, maximum 5 MB',
              ),
              TextButton.icon(
                onPressed: editable && !proofExists ? () => _pick() : null,
                icon: const Icon(Icons.attach_file),
                label: Text(_proof?.name ?? 'Choose completion proof'),
              ),
              if (_proof != null && _proof!.extension?.toLowerCase() != 'pdf')
                Align(
                  alignment: Alignment.centerLeft,
                  child: _selectedImage(_proof!),
                ),
              for (final evidence in c.evidence)
                ListTile(
                  title: Text(evidence.fileName),
                  subtitle: Text(
                    evidence.evidenceType ==
                            TrainingEvidenceType.additionalDocument
                        ? 'Completion proof'
                        : 'Topic image',
                  ),
                  onTap: () async {
                    try {
                      final view = await c.getEvidenceViewUrl(evidence.id);
                      await launchUrl(
                        Uri.parse(view.url),
                        mode: LaunchMode.externalApplication,
                      );
                    } catch (error) {
                      if (mounted) setState(() => _message = '$error');
                    }
                  },
                  trailing: editable
                      ? IconButton(
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () async {
                            try {
                              await c.deleteEvidence(evidence.id);
                            } catch (error) {
                              if (mounted) setState(() => _message = '$error');
                            }
                          },
                        )
                      : null,
                ),
              for (final pending in c.pendingEvidence)
                Text('Pending: ${pending.fileName} (${pending.state.name})'),
              if (_busy) ...[const LinearProgressIndicator(), Text(_progress)],
              if (_message != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(_message!),
                ),
              if (c.isEditable)
                FilledButton(
                  onPressed:
                      editable && (c.session != null || compatibleHkMaster(c))
                      ? _submit
                      : null,
                  child: const Text('Submit'),
                ),
            ],
          ),
        ),
      );
    },
  );

  Widget _selectedImage(PlatformFile file) => SizedBox(
    width: 104,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.file(
            File(file.path!),
            width: 104,
            height: 84,
            fit: BoxFit.cover,
            cacheWidth: (104 * MediaQuery.devicePixelRatioOf(context)).ceil(),
            semanticLabel: 'Selected image, not yet uploaded',
            errorBuilder: (_, _, _) => const SizedBox(
              width: 104,
              height: 84,
              child: Icon(Icons.broken_image_outlined),
            ),
          ),
        ),
        Text(file.name, maxLines: 2, overflow: TextOverflow.ellipsis),
        const Text('Selected · not uploaded', style: TextStyle(fontSize: 11)),
      ],
    ),
  );
}
