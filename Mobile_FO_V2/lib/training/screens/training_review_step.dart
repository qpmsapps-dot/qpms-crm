import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../ui/fo_ui.dart';
import '../data/training_draft_cache.dart';
import '../models/training_evidence.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_attendee_card.dart';

class TrainingReviewStep extends StatelessWidget {
  const TrainingReviewStep({required this.controller, super.key});
  final TrainingFlowController controller;

  @override
  Widget build(BuildContext context) {
    final ready = controller.canSubmitLocally;
    return ListView(
      key: const PageStorageKey('training-review-step'),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: ready ? const Color(0xFFECFBF4) : const Color(0xFFFFF7E8),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: ready ? const Color(0xFFBDEBD4) : const Color(0xFFFFDF9C),
            ),
          ),
          child: Row(
            children: [
              FoIconCircle(
                icon: ready
                    ? Icons.verified_outlined
                    : Icons.info_outline_rounded,
                color: ready ? foGreen : foOrange,
                size: 50,
                iconSize: 25,
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ready ? 'Ready to Submit' : 'Complete Required Details',
                      style: const TextStyle(
                        color: foNavy,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      ready
                          ? 'Review the session before final submission.'
                          : _missing(controller),
                      style: const TextStyle(
                        color: Color(0xFF5D6982),
                        fontWeight: FontWeight.w700,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            _Metric(
              label: 'Staff',
              value: '${controller.attendeeCount}',
              icon: Icons.groups_outlined,
            ),
            const SizedBox(width: 8),
            _Metric(
              label: 'Topics',
              value: '${controller.selectedTopicCount}',
              icon: Icons.menu_book_outlined,
            ),
            const SizedBox(width: 8),
            _Metric(
              label: 'Photos',
              value: '${controller.photoCount}',
              icon: Icons.photo_outlined,
            ),
            const SizedBox(width: 8),
            _Metric(
              label: 'Files',
              value: '${controller.fileCount}',
              icon: Icons.attach_file_rounded,
            ),
          ],
        ),
        const SizedBox(height: 14),
        _ReviewCard(
          title: 'Session Summary',
          onEdit: controller.isEditable
              ? () => controller.goTo(TrainingFlowStep.details)
              : null,
          child: Column(
            children: [
              _Row(
                label: 'Site',
                value: controller.session?.storeNameSnapshot ?? 'Current site',
              ),
              _Row(
                label: 'Category',
                value: controller.selectedCategory?.name ?? '—',
              ),
              _Row(
                label: 'Date',
                value: DateFormat(
                  'dd MMM yyyy',
                ).format(controller.trainingDate),
              ),
              _Row(label: 'Trainer', value: controller.trainerName),
              _Row(
                label: 'Training Type',
                value: controller.selectedTrainingType?.name ?? '—',
              ),
              if (controller.remarks.trim().isNotEmpty)
                _Row(label: 'Remarks', value: controller.remarks),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _ReviewCard(
          title: 'Attendees',
          count: '${controller.attendeeCount}',
          onEdit: controller.isEditable
              ? () => controller.goTo(TrainingFlowStep.attendees)
              : null,
          child: controller.attendees.isEmpty
              ? const _Empty(text: 'No attendees added.')
              : Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: controller.attendees
                      .take(6)
                      .map(
                        (item) => Chip(
                          avatar: CircleAvatar(
                            child: Text(
                              trainingInitials(item.employeeName),
                              style: const TextStyle(fontSize: 10),
                            ),
                          ),
                          label: Text(
                            item.employeeName,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                ),
        ),
        const SizedBox(height: 12),
        _ReviewCard(
          title: 'Topics Covered',
          count:
              '${controller.coveredTopicCount} / ${controller.selectedTopicCount}',
          onEdit: controller.isEditable
              ? () => controller.goTo(TrainingFlowStep.topics)
              : null,
          child: controller.selectedSessionTopics.isEmpty
              ? const _Empty(text: 'No topics selected.')
              : Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: controller.selectedSessionTopics
                      .map(
                        (item) => Chip(
                          avatar: Icon(
                            item.isCovered
                                ? Icons.check_circle
                                : Icons.schedule,
                            size: 17,
                            color: item.isCovered ? foGreen : foOrange,
                          ),
                          label: Text(item.topic?.moduleName ?? 'Topic'),
                        ),
                      )
                      .toList(),
                ),
        ),
        const SizedBox(height: 12),
        _ReviewCard(
          title: 'Evidence Uploaded',
          onEdit: controller.isEditable
              ? () => controller.goTo(TrainingFlowStep.evidence)
              : null,
          child: Column(
            children: [
              _EvidenceRow(
                label: 'Photos uploaded',
                value: '${controller.photoCount}',
                complete: controller.photoCount > 0,
              ),
              _EvidenceRow(
                label: 'Attendance sheet',
                value: controller.hasAttendanceSheet
                    ? 'Uploaded'
                    : 'Not uploaded',
                complete: controller.hasAttendanceSheet,
                required:
                    controller.session?.requireAttendanceSheetSnapshot ?? false,
              ),
              _EvidenceRow(
                label: 'Training PDF',
                value: controller.hasTrainingDocument
                    ? 'Uploaded'
                    : 'Not uploaded',
                complete: controller.hasTrainingDocument,
                required:
                    controller.session?.requireTrainingDocumentSnapshot ??
                    false,
              ),
              _EvidenceRow(
                label: 'Additional files',
                value:
                    '${controller.supportingEvidenceByType(TrainingEvidenceType.additionalDocument).length}',
                complete: controller
                    .supportingEvidenceByType(
                      TrainingEvidenceType.additionalDocument,
                    )
                    .isNotEmpty,
              ),
              if (controller.pendingUploadCount + controller.failedUploadCount >
                  0)
                _EvidenceRow(
                  label: 'Pending / failed uploads',
                  value:
                      '${controller.pendingUploadCount + controller.failedUploadCount}',
                  complete: false,
                  required: true,
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFF3F6FB),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text(
            'Please verify all details before submitting. After submission, this Training record cannot be edited by the submitting FO/Operations Manager.',
            style: TextStyle(
              color: Color(0xFF53617E),
              fontWeight: FontWeight.w700,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }

  String _missing(TrainingFlowController value) {
    final missing = <String>[];
    if (!value.canContinueDetails) missing.add('details');
    if (!value.canContinueAttendees) missing.add('attendees');
    if (!value.canContinueTopics) missing.add('topics');
    if (value.pendingUploadCount > 0) missing.add('pending uploads');
    if (value.failedUploadCount > 0) missing.add('failed uploads');
    return 'Complete ${missing.isEmpty ? 'the required evidence' : missing.join(', ')}.';
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.icon});
  final String label;
  final String value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: foBorder),
      ),
      child: Column(
        children: [
          Icon(icon, color: const Color(0xFF2F6FED), size: 20),
          const SizedBox(height: 5),
          Text(
            value,
            style: const TextStyle(
              color: foNavy,
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF6A7690),
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ),
  );
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({
    required this.title,
    required this.child,
    this.count,
    this.onEdit,
  });
  final String title;
  final Widget child;
  final String? count;
  final VoidCallback? onEdit;
  @override
  Widget build(BuildContext context) => FoCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: foNavy,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            if (count != null) FoStatusBadge(label: count!),
            if (onEdit != null)
              TextButton(onPressed: onEdit, child: const Text('Edit')),
          ],
        ),
        const SizedBox(height: 10),
        child,
      ],
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 105,
          child: Text(
            label,
            style: const TextStyle(
              color: Color(0xFF768198),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(color: foNavy, fontWeight: FontWeight.w800),
          ),
        ),
      ],
    ),
  );
}

class _EvidenceRow extends StatelessWidget {
  const _EvidenceRow({
    required this.label,
    required this.value,
    required this.complete,
    this.required = false,
  });
  final String label;
  final String value;
  final bool complete;
  final bool required;
  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    dense: true,
    leading: Icon(
      complete
          ? Icons.check_circle_rounded
          : required
          ? Icons.error_outline_rounded
          : Icons.remove_circle_outline,
      color: complete
          ? foGreen
          : required
          ? foOrange
          : const Color(0xFF9AA4B8),
    ),
    title: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
    trailing: Text(
      value,
      style: TextStyle(
        color: complete ? foGreen : const Color(0xFF6D7891),
        fontWeight: FontWeight.w900,
      ),
    ),
  );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      color: Color(0xFF7A859B),
      fontWeight: FontWeight.w700,
    ),
  );
}
