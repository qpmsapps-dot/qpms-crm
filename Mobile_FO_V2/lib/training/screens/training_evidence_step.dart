import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../ui/fo_ui.dart';
import '../data/training_draft_cache.dart';
import '../models/training_evidence.dart';
import '../models/training_session_topic.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_evidence_card.dart';

typedef TrainingEvidencePicker =
    Future<void> Function(TrainingEvidenceType type, String? sessionTopicId);

class TrainingEvidenceStep extends StatefulWidget {
  const TrainingEvidenceStep({
    required this.controller,
    this.evidencePicker,
    super.key,
  });
  final TrainingFlowController controller;
  final TrainingEvidencePicker? evidencePicker;
  @override
  State<TrainingEvidenceStep> createState() => _TrainingEvidenceStepState();
}

class _TrainingEvidenceStepState extends State<TrainingEvidenceStep> {
  final _imagePicker = ImagePicker();
  bool _picking = false;
  final Set<String> _busyTopics = {};
  final Map<String, Future<String>> _viewUrls = {};

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final percentage = (controller.topicProgress * 100).round();
    return ListView(
      key: const PageStorageKey('training-evidence-step'),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
      children: [
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(title: 'Training Progress'),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${controller.coveredTopicCount} of ${controller.selectedTopicCount} topics completed',
                      style: const TextStyle(
                        color: foNavy,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  Text(
                    '$percentage%',
                    style: const TextStyle(
                      color: Color(0xFF2F6FED),
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              LinearProgressIndicator(
                value: controller.topicProgress,
                minHeight: 9,
                borderRadius: BorderRadius.circular(8),
                backgroundColor: const Color(0xFFE7ECF5),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const FoSectionTitle(
          title: 'Topic Evidence',
          subtitle: 'Upload proof and mark coverage for each selected topic',
        ),
        const SizedBox(height: 12),
        if (controller.selectedSessionTopics.isEmpty)
          const _EvidenceEmpty(
            text: 'Select Training topics before adding evidence.',
          )
        else
          ...controller.selectedSessionTopics.map(
            (topic) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                children: [
                  TrainingEvidenceCard(
                    sessionTopic: topic,
                    photoCount: controller.topicPhotoCount(topic.id),
                    editable: controller.isEditable,
                    busy:
                        _busyTopics.contains(topic.id) ||
                        _picking ||
                        controller.isUploading,
                    onAddPhoto: () =>
                        _pick(TrainingEvidenceType.topicPhoto, topic.id),
                    onRemarks: () => _editRemarks(topic),
                    onCoverageChanged: (value) => _setCovered(topic, value),
                  ),
                  _PhotoStrip(
                    controller: controller,
                    sessionTopicId: topic.id,
                    viewUrls: _viewUrls,
                    onDelete: _deleteEvidence,
                  ),
                ],
              ),
            ),
          ),
        if (controller.pendingEvidence.isNotEmpty) ...[
          const SizedBox(height: 6),
          const FoSectionTitle(title: 'Pending Uploads'),
          const SizedBox(height: 10),
          ...controller.pendingEvidence.map(
            (item) => _PendingUploadTile(
              item: item,
              editable: controller.isEditable,
              onRetry:
                  !_picking &&
                      !controller.isUploading &&
                      (item.state == TrainingUploadState.failed ||
                          item.state == TrainingUploadState.pending)
                  ? () => _retry(item.localId)
                  : null,
              onRemove:
                  controller.isEditable && !_picking && !controller.isUploading
                  ? () => controller.removePendingUpload(item.localId)
                  : null,
            ),
          ),
        ],
        const SizedBox(height: 18),
        const FoSectionTitle(
          title: 'Supporting Proof',
          subtitle: 'Upload attendance sheets and training material',
        ),
        const SizedBox(height: 12),
        _SupportingCard(
          icon: Icons.photo_library_outlined,
          title: 'Group Training Photos',
          subtitle: 'Upload clear photos from the training session',
          value:
              '${controller.groupPhotoCount} / ${controller.session?.maxGroupPhotosSnapshot ?? 10}',
          actionLabel: 'Add Photos',
          enabled:
              controller.isEditable &&
              !_picking &&
              !controller.isUploading &&
              controller.groupPhotoCount <
                  (controller.session?.maxGroupPhotosSnapshot ?? 10),
          onAction: () => _pick(TrainingEvidenceType.groupPhoto, null),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final item in controller.pendingEvidence.where(
              (e) => e.evidenceType == TrainingEvidenceType.groupPhoto,
            ))
              _PendingPhoto(item: item),
          ],
        ),
        _SupportingCard(
          icon: Icons.fact_check_outlined,
          title: 'Attendance Sheet',
          subtitle: 'PDF, JPG or PNG',
          value: controller.hasAttendanceSheet ? 'Uploaded' : 'Not uploaded',
          actionLabel: controller.hasAttendanceSheet ? 'Replace' : 'Upload',
          enabled:
              controller.isEditable && !_picking && !controller.isUploading,
          onAction: () => _pick(TrainingEvidenceType.attendanceSheet, null),
        ),
        _SupportingCard(
          icon: Icons.picture_as_pdf_outlined,
          title: 'Training Document',
          subtitle: 'PDF only',
          value: controller.hasTrainingDocument ? 'Uploaded' : 'Not uploaded',
          actionLabel: controller.hasTrainingDocument ? 'Replace' : 'Upload',
          enabled:
              controller.isEditable && !_picking && !controller.isUploading,
          onAction: () => _pick(TrainingEvidenceType.trainingDocument, null),
        ),
        _SupportingCard(
          icon: Icons.attach_file_rounded,
          title: controller.requiresMepcCompletionProof
              ? 'Completion Proof (Required)'
              : 'Additional Documents',
          subtitle: controller.requiresMepcCompletionProof
              ? 'Verified PDF, JPG or PNG required before submission'
              : 'PDF, JPG or PNG',
          value:
              '${controller.supportingEvidenceByType(TrainingEvidenceType.additionalDocument).length} files',
          actionLabel: 'Add File',
          enabled:
              controller.isEditable && !_picking && !controller.isUploading,
          onAction: () => _pick(TrainingEvidenceType.additionalDocument, null),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFF0F6FF),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            _requirementMessage(controller),
            style: const TextStyle(
              color: Color(0xFF405A84),
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }

  String _requirementMessage(TrainingFlowController controller) {
    final required = <String>[];
    if (controller.session?.requireGroupPhotoSnapshot == true) {
      required.add('group photo');
    }
    if (controller.session?.requireAttendanceSheetSnapshot == true) {
      required.add('attendance sheet');
    }
    if (controller.session?.requireTrainingDocumentSnapshot == true) {
      required.add('training document');
    }
    return required.isEmpty
        ? 'Supporting proof is optional for this category. Add relevant evidence where available.'
        : 'Submit Training will be enabled when required ${required.join(', ')} evidence is uploaded.';
  }

  Future<void> _pick(TrainingEvidenceType type, String? topicId) async {
    if (_picking ||
        widget.controller.isUploading ||
        !widget.controller.isEditable) {
      return;
    }
    setState(() => _picking = true);
    Object? lastError;
    try {
      if (widget.evidencePicker != null) {
        await widget.evidencePicker!(type, topicId);
        return;
      }
      final selected = <({String path, String? name})>[];
      if (type == TrainingEvidenceType.groupPhoto) {
        final files = await _imagePicker.pickMultiImage(
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 78,
        );
        selected.addAll(
          files.map((file) => (path: file.path, name: file.name)),
        );
      } else if (type == TrainingEvidenceType.topicPhoto) {
        final file = await _imagePicker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 78,
        );
        if (file != null) selected.add((path: file.path, name: file.name));
      } else {
        final extensions = type == TrainingEvidenceType.trainingDocument
            ? ['pdf']
            : ['pdf', 'jpg', 'jpeg', 'png'];
        final result = await FilePicker.pickFiles(
          type: FileType.custom,
          allowedExtensions: extensions,
        );
        final file = result?.files.single;
        if (file?.path != null) {
          selected.add((path: file!.path!, name: file.name));
        }
      }
      // Persist every valid selection with its existing queue identity first.
      final queued = <String>[];
      for (final file in selected) {
        if (!mounted) return;
        try {
          queued.add(await _queue(file.path, type, topicId, name: file.name));
        } catch (error) {
          lastError = error;
        }
      }
      // Keep one upload in flight. Failed files remain in the durable retry queue.
      for (final localId in queued) {
        if (!mounted) return;
        try {
          await widget.controller.uploadQueued(localId);
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    } finally {
      if (mounted) setState(() => _picking = false);
    }
    if (mounted && lastError != null) _snack(lastError);
  }

  Future<String> _queue(
    String path,
    TrainingEvidenceType type,
    String? topicId, {
    String? name,
  }) async {
    final file = File(path);
    final length = await file.length();
    final fileName = name ?? file.uri.pathSegments.last;
    final mime = _mime(fileName);
    final localId = '${DateTime.now().microsecondsSinceEpoch}-$fileName';
    await widget.controller.queueEvidence(
      localId: localId,
      sessionTopicId: topicId,
      type: type,
      path: path,
      fileName: fileName,
      mimeType: mime,
      fileSize: length,
    );
    return localId;
  }

  String _mime(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.png')) return 'image/png';
    return 'image/jpeg';
  }

  Future<void> _setCovered(TrainingSessionTopic topic, bool value) async {
    setState(() => _busyTopics.add(topic.id));
    try {
      await widget.controller.updateTopic(
        topic.id,
        isCovered: value,
        remarks: topic.remarks,
      );
    } catch (error) {
      if (mounted) _snack(error);
    } finally {
      if (mounted) setState(() => _busyTopics.remove(topic.id));
    }
  }

  Future<void> _editRemarks(TrainingSessionTopic topic) async {
    var draft = topic.remarks ?? '';
    final value = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          20,
          20,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Topic Remarks',
              style: TextStyle(
                color: foNavy,
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 14),
            TextFormField(
              initialValue: draft,
              onChanged: (value) => draft = value,
              maxLength: 1000,
              minLines: 3,
              maxLines: 6,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'Add coverage notes...',
              ),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: () => Navigator.pop(context, draft),
              child: const Text('Save Remarks'),
            ),
          ],
        ),
      ),
    );
    if (value != null) {
      try {
        await widget.controller.updateTopic(
          topic.id,
          isCovered: topic.isCovered,
          remarks: value,
        );
      } catch (error) {
        if (mounted) _snack(error);
      }
    }
  }

  Future<void> _retry(String localId) async {
    if (_picking || widget.controller.isUploading) return;
    try {
      await widget.controller.uploadQueued(localId);
    } catch (error) {
      if (mounted) _snack(error);
    }
  }

  Future<void> _deleteEvidence(TrainingEvidence item) async {
    final confirmed =
        await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete evidence?'),
            content: Text('Remove ${item.fileName}?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Delete'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;
    try {
      await widget.controller.deleteEvidence(item.id);
    } catch (error) {
      if (mounted) _snack(error);
    }
  }

  void _snack(Object error) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(error.toString())));
}

class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({
    required this.controller,
    required this.sessionTopicId,
    required this.viewUrls,
    required this.onDelete,
  });
  final TrainingFlowController controller;
  final String sessionTopicId;
  final Map<String, Future<String>> viewUrls;
  final ValueChanged<TrainingEvidence> onDelete;
  @override
  Widget build(BuildContext context) {
    final photos = controller
        .evidenceForTopic(sessionTopicId)
        .where((item) => item.evidenceType == TrainingEvidenceType.topicPhoto)
        .toList();
    final pending = controller.pendingEvidence
        .where(
          (item) =>
              item.sessionTopicId == sessionTopicId &&
              item.evidenceType == TrainingEvidenceType.topicPhoto,
        )
        .toList();
    if (photos.isEmpty && pending.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 108,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: photos.length + pending.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          if (index >= photos.length) {
            return _PendingPhoto(item: pending[index - photos.length]);
          }
          final item = photos[index];
          final future = viewUrls.putIfAbsent(
            item.id,
            () async => (await controller.getEvidenceViewUrl(item.id)).url,
          );
          return Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 74,
                  height: 74,
                  child: FutureBuilder<String>(
                    future: future,
                    builder: (context, snapshot) => snapshot.hasData
                        ? Image.network(
                            snapshot.data!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const ColoredBox(
                              color: Color(0xFFF1F4F9),
                              child: Icon(Icons.broken_image_outlined),
                            ),
                          )
                        : const ColoredBox(
                            color: Color(0xFFF1F4F9),
                            child: Center(
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                  ),
                ),
              ),
              if (controller.isEditable)
                Positioned(
                  right: 2,
                  top: 2,
                  child: InkWell(
                    onTap: () => onDelete(item),
                    child: const CircleAvatar(
                      radius: 11,
                      backgroundColor: Colors.white,
                      child: Icon(
                        Icons.close,
                        size: 15,
                        color: Color(0xFFB13A3A),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _PendingPhoto extends StatelessWidget {
  const _PendingPhoto({required this.item});
  final TrainingPendingEvidence item;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 88,
    height: 108,
    child: Column(
      children: [
        Image.file(
          File(item.localFilePath),
          width: 88,
          height: 74,
          fit: BoxFit.cover,
          cacheWidth: (88 * MediaQuery.devicePixelRatioOf(context)).ceil(),
          semanticLabel: 'Local photo, not confirmed by server',
          errorBuilder: (_, _, _) => const SizedBox(
            width: 88,
            height: 74,
            child: Icon(Icons.broken_image_outlined),
          ),
        ),
        Text(
          item.state == TrainingUploadState.failed
              ? 'Upload failed'
              : 'Not confirmed',
          style: const TextStyle(fontSize: 11),
        ),
      ],
    ),
  );
}

class _PendingUploadTile extends StatelessWidget {
  const _PendingUploadTile({
    required this.item,
    required this.editable,
    this.onRetry,
    this.onRemove,
  });
  final TrainingPendingEvidence item;
  final bool editable;
  final VoidCallback? onRetry;
  final VoidCallback? onRemove;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      leading:
          item.mimeType.startsWith('image/') &&
              File(item.localFilePath).existsSync()
          ? ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(
                File(item.localFilePath),
                width: 44,
                height: 44,
                fit: BoxFit.cover,
              ),
            )
          : const Icon(Icons.insert_drive_file_outlined),
      title: Text(item.fileName, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(item.state.name),
      trailing: Wrap(
        spacing: 2,
        children: [
          if (onRetry != null)
            IconButton(
              tooltip: 'Retry upload',
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
            ),
          if (editable && onRemove != null)
            IconButton(
              tooltip: 'Remove pending upload',
              onPressed: onRemove,
              icon: const Icon(Icons.close_rounded),
            ),
        ],
      ),
    ),
  );
}

class _SupportingCard extends StatelessWidget {
  const _SupportingCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.actionLabel,
    required this.enabled,
    required this.onAction,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final String value;
  final String actionLabel;
  final bool enabled;
  final VoidCallback onAction;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: FoCard(
      padding: const EdgeInsets.all(15),
      child: Row(
        children: [
          FoIconCircle(
            icon: icon,
            color: const Color(0xFF2F6FED),
            size: 46,
            iconSize: 23,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFF68748D),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: const TextStyle(
                    color: Color(0xFF405A84),
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: enabled ? onAction : null,
            child: Text(actionLabel),
          ),
        ],
      ),
    ),
  );
}

class _EvidenceEmpty extends StatelessWidget {
  const _EvidenceEmpty({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: foBorder),
    ),
    child: Column(
      children: [
        const Icon(
          Icons.photo_library_outlined,
          color: Color(0xFF8793AA),
          size: 34,
        ),
        const SizedBox(height: 8),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Color(0xFF68748D),
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}
