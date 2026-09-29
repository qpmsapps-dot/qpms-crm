import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../ui/fo_ui.dart';
import '../data/training_draft_cache.dart';

class TrainingStepper extends StatelessWidget {
  const TrainingStepper({required this.currentStep, super.key});

  final TrainingFlowStep currentStep;

  static const _labels = [
    'Details',
    'Attendees',
    'Topics',
    'Evidence',
    'Review',
  ];

  @override
  Widget build(BuildContext context) {
    final current = currentStep.index;
    return Semantics(
      label: 'Training step ${current + 1} of 5, ${_labels[current]}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(_labels.length, (index) {
          final active = index == current;
          final complete = index < current;
          final color = active || complete ? qpmsBlue : const Color(0xFFB7C0D4);
          return Expanded(
            child: Column(
              children: [
                Row(
                  children: [
                    if (index > 0)
                      Expanded(
                        child: Container(
                          height: 2,
                          color: complete || active ? qpmsBlue : foBorder,
                        ),
                      ),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: active ? 32 : 28,
                      height: active ? 32 : 28,
                      decoration: BoxDecoration(
                        color: complete
                            ? qpmsBlue
                            : active
                            ? const Color(0xFFEAF2FF)
                            : const Color(0xFFF2F4F8),
                        shape: BoxShape.circle,
                        border: Border.all(color: color, width: active ? 2 : 1),
                      ),
                      alignment: Alignment.center,
                      child: complete
                          ? const Icon(
                              Icons.check_rounded,
                              size: 17,
                              color: Colors.white,
                            )
                          : Text(
                              '${index + 1}',
                              style: TextStyle(
                                color: color,
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                              ),
                            ),
                    ),
                    if (index < _labels.length - 1)
                      Expanded(
                        child: Container(
                          height: 2,
                          color: complete ? qpmsBlue : foBorder,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  _labels[index],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: active ? foNavy : const Color(0xFF69748E),
                    fontSize: 11,
                    fontWeight: active ? FontWeight.w900 : FontWeight.w700,
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}
