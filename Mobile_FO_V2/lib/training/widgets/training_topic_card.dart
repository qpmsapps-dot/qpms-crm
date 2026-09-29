import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../ui/fo_ui.dart';
import '../models/training_topic.dart';

class TrainingTopicCard extends StatelessWidget {
  const TrainingTopicCard({
    required this.topic,
    required this.selected,
    required this.onTap,
    this.locked = false,
    super.key,
  });
  final TrainingTopic topic;
  final bool selected;
  final VoidCallback? onTap;
  final bool locked;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    checked: selected,
    label:
        '${topic.moduleName}, ${selected ? 'selected' : 'not selected'}${locked ? ', locked because evidence exists' : ''}',
    child: InkWell(
      onTap: locked ? null : onTap,
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFF1F6FF) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? qpmsBlue : foBorder,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FoIconCircle(
              icon: Icons.menu_book_outlined,
              color: selected ? qpmsBlue : const Color(0xFF73809D),
              size: 46,
              iconSize: 23,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    topic.moduleName,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  if (topic.topicDescription?.trim().isNotEmpty == true) ...[
                    const SizedBox(height: 5),
                    Text(
                      topic.topicDescription!,
                      style: const TextStyle(
                        color: Color(0xFF68748D),
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                  if (locked) ...[
                    const SizedBox(height: 6),
                    const Text(
                      'Remove evidence before deselecting',
                      style: TextStyle(
                        color: Color(0xFF9A6300),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Icon(
              locked
                  ? Icons.lock_outline_rounded
                  : selected
                  ? Icons.check_box_rounded
                  : Icons.check_box_outline_blank_rounded,
              color: selected ? qpmsBlue : const Color(0xFF9CA6BA),
            ),
          ],
        ),
      ),
    ),
  );
}
