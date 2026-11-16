import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import 'deep_cleaning_models.dart';

/// Presentation only: the server remains the authority for final submission.
class DeepCleaningReadiness {
  DeepCleaningReadiness({
    required this.hasStore,
    required this.hasDate,
    required this.uploads,
    required this.paired,
    this.expectedPairIds,
    this.hasLocalFiles = false,
    this.busy = false,
    this.verified = true,
  });

  factory DeepCleaningReadiness.fromSubmission(DeepCleaningSubmission value) =>
      DeepCleaningReadiness(
        hasStore: value.storeCode.isNotEmpty,
        hasDate: value.deepCleaningDate?.isNotEmpty == true,
        uploads: value.uploads,
        paired: value.evidenceFormat == 'paired_v1',
      );

  final bool hasStore, hasDate, paired, hasLocalFiles, busy, verified;
  final List<DeepCleaningUpload> uploads;
  final List<String>? expectedPairIds;
  List<DeepCleaningUpload> get photos => uploads
      .where(
        (u) =>
            u.isUploaded &&
            (u.uploadType == DeepCleaningUploadType.before ||
                u.uploadType == DeepCleaningUploadType.after),
      )
      .toList();
  int get documents => uploads
      .where(
        (u) =>
            u.isUploaded &&
            (u.uploadType == DeepCleaningUploadType.document ||
                u.uploadType == DeepCleaningUploadType.checklist),
      )
      .length;
  bool get photosComplete {
    if (photos.isEmpty) return false;
    if (!paired) {
      return photos.any((u) => u.uploadType == DeepCleaningUploadType.before) &&
          photos.any((u) => u.uploadType == DeepCleaningUploadType.after);
    }
    final ids =
        expectedPairIds ??
        photos.map((u) => u.pairId).whereType<String>().toSet().toList();
    return ids.isNotEmpty &&
        photos.every((u) => ids.contains(u.pairId)) &&
        ids.every(
          (id) =>
              photos
                      .where(
                        (u) =>
                            u.pairId == id &&
                            u.uploadType == DeepCleaningUploadType.before,
                      )
                      .length ==
                  1 &&
              photos
                      .where(
                        (u) =>
                            u.pairId == id &&
                            u.uploadType == DeepCleaningUploadType.after,
                      )
                      .length ==
                  1,
        );
  }

  bool get uploadsSettled => !hasLocalFiles && !busy;
  List<({String label, bool complete})> get checks => [
    (label: 'Authorized store selected', complete: hasStore),
    (label: 'Actual cleaning date selected', complete: hasDate),
    (label: 'Before / After photos confirmed', complete: photosComplete),
    (
      label: 'Exactly one supporting document confirmed',
      complete: documents == 1,
    ),
    (label: 'No pending or failed uploads', complete: uploadsSettled),
  ];
  bool get ready => verified && checks.every((c) => c.complete);
  double get progress => checks.where((c) => c.complete).length / checks.length;
  String get nextAction => !verified
      ? 'Refresh the record to verify evidence.'
      : ready
      ? 'All local checks met. Server validation follows.'
      : checks.firstWhere((c) => !c.complete).label;
}

class DeepCleaningReadinessCard extends StatelessWidget {
  const DeepCleaningReadinessCard({required this.readiness, super.key});
  final DeepCleaningReadiness readiness;
  @override
  Widget build(BuildContext context) => FoCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const FoSectionTitle(title: 'Readiness Checklist'),
        const SizedBox(height: 12),
        for (final check in readiness.checks)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  check.complete
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked,
                  size: 21,
                  color: check.complete ? foGreen : qpmsMuted,
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(check.label)),
              ],
            ),
          ),
        if (!readiness.verified)
          const Text('Evidence could not be refreshed. Please retry.'),
        const SizedBox(height: 8),
        const Text(
          'Remarks are optional and do not affect readiness.',
          style: TextStyle(color: qpmsMuted),
        ),
      ],
    ),
  );
}
