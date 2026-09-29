import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../ui/fo_ui.dart';
import '../models/training_attendee.dart';

String trainingInitials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((item) => item.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  return parts.take(2).map((item) => item[0].toUpperCase()).join();
}

class TrainingAttendeeCard extends StatelessWidget {
  const TrainingAttendeeCard({
    required this.name,
    required this.employeeCode,
    this.designation,
    this.trailingLabel,
    this.onAction,
    this.selected = false,
    super.key,
  });
  factory TrainingAttendeeCard.attendee(
    TrainingAttendee attendee, {
    VoidCallback? onRemove,
  }) => TrainingAttendeeCard(
    name: attendee.employeeName,
    employeeCode: attendee.employeeCode,
    designation: attendee.designationSnapshot,
    trailingLabel: 'Remove',
    onAction: onRemove,
    selected: true,
    key: ValueKey('attendee-${attendee.id}'),
  );
  factory TrainingAttendeeCard.suggestion(
    TrainingStaffSuggestion suggestion, {
    required bool added,
    VoidCallback? onAdd,
  }) => TrainingAttendeeCard(
    name: suggestion.name,
    employeeCode: suggestion.employeeCode,
    designation: suggestion.designation ?? suggestion.role,
    trailingLabel: added ? 'Added' : 'Add',
    onAction: added ? null : onAdd,
    selected: added,
    key: ValueKey('suggestion-${suggestion.profileId}'),
  );

  final String name;
  final String employeeCode;
  final String? designation;
  final String? trailingLabel;
  final VoidCallback? onAction;
  final bool selected;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: selected ? const Color(0xFFF7FAFF) : Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: selected ? const Color(0xFFCFE0FF) : foBorder),
    ),
    child: Row(
      children: [
        CircleAvatar(
          radius: 22,
          backgroundColor: const Color(0xFFEAF2FF),
          child: Text(
            trainingInitials(name),
            style: const TextStyle(
              color: qpmsBlue,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: foNavy,
                  fontWeight: FontWeight.w900,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                [employeeCode, designation]
                    .where((value) => value?.trim().isNotEmpty == true)
                    .join(' • '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF68748D),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        if (trailingLabel != null)
          TextButton(
            onPressed: onAction,
            child: Text(
              trailingLabel!,
              style: TextStyle(
                color: onAction == null
                    ? const Color(0xFF7B879F)
                    : selected
                    ? const Color(0xFFD34A4A)
                    : qpmsBlue,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
      ],
    ),
  );
}
