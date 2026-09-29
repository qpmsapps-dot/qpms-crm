import 'package:flutter/material.dart';

import '../../ui/fo_ui.dart';
import '../models/training_session_topic.dart';

class TrainingEvidenceCard extends StatelessWidget {
  const TrainingEvidenceCard({
    required this.sessionTopic,
    required this.photoCount,
    required this.onAddPhoto,
    required this.onRemarks,
    required this.onCoverageChanged,
    required this.editable,
    this.busy = false,
    super.key,
  });
  final TrainingSessionTopic sessionTopic;
  final int photoCount;
  final VoidCallback? onAddPhoto;
  final VoidCallback? onRemarks;
  final ValueChanged<bool>? onCoverageChanged;
  final bool editable;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final topic = sessionTopic.topic;
    return FoCard(
      padding: const EdgeInsets.all(15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FoIconCircle(
                icon: Icons.school_outlined,
                color: sessionTopic.isCovered
                    ? foGreen
                    : const Color(0xFF6C7A98),
                size: 44,
                iconSize: 22,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      topic?.moduleName ?? 'Training topic',
                      style: const TextStyle(
                        color: foNavy,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (topic?.topicDescription?.trim().isNotEmpty == true) ...[
                      const SizedBox(height: 4),
                      Text(
                        topic!.topicDescription!,
                        style: const TextStyle(
                          color: Color(0xFF68748D),
                          height: 1.3,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              FoStatusBadge(
                label: sessionTopic.isCovered ? 'Covered' : 'Pending',
                color: sessionTopic.isCovered ? foGreen : foOrange,
              ),
            ],
          ),
          const SizedBox(height: 13),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _EvidenceMeta(
                icon: Icons.photo_outlined,
                label: '$photoCount photo${photoCount == 1 ? '' : 's'}',
              ),
              _EvidenceMeta(
                icon: Icons.notes_rounded,
                label: sessionTopic.hasRemarks ? 'Remarks added' : 'No remarks',
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: editable && !busy ? onAddPhoto : null,
                  icon: const Icon(Icons.add_a_photo_outlined),
                  label: const Text('Add Photo'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: editable && !busy ? onRemarks : null,
                  icon: const Icon(Icons.edit_note_rounded),
                  label: const Text('Remarks'),
                ),
              ),
            ],
          ),
          Material(
            color: Colors.transparent,
            child: SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: sessionTopic.isCovered,
              onChanged: editable && !busy ? onCoverageChanged : null,
              title: const Text(
                'Mark Covered',
                style: TextStyle(color: foNavy, fontWeight: FontWeight.w900),
              ),
              subtitle: busy ? const Text('Updating...') : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _EvidenceMeta extends StatelessWidget {
  const _EvidenceMeta({required this.icon, required this.label});
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0xFFF4F7FC),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: const Color(0xFF65738F)),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF596682),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    ),
  );
}
