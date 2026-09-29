import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../ui/fo_ui.dart';
import '../models/training_category.dart';

class TrainingCategoryCard extends StatelessWidget {
  const TrainingCategoryCard({
    required this.category,
    required this.selected,
    required this.onTap,
    super.key,
  });
  final TrainingCategory category;
  final bool selected;
  final VoidCallback? onTap;

  String get _helper => category.code.toLowerCase() == 'hk'
      ? 'Cleaning, hygiene, SOP, PPE'
      : category.code.toLowerCase() == 'technical_mep'
      ? 'Electrical, HVAC, DG, safety'
      : category.description ?? '';
  IconData get _icon => category.code.toLowerCase() == 'hk'
      ? Icons.cleaning_services_outlined
      : Icons.electrical_services_outlined;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: '${category.name}, ${selected ? 'selected' : 'not selected'}',
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFF0F6FF) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? qpmsBlue : foBorder,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            FoIconCircle(
              icon: _icon,
              color: selected ? qpmsBlue : const Color(0xFF6B7896),
              size: 48,
              iconSize: 24,
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    category.name,
                    style: const TextStyle(
                      color: foNavy,
                      fontWeight: FontWeight.w900,
                      fontSize: 16,
                    ),
                  ),
                  if (_helper.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      _helper,
                      style: const TextStyle(
                        color: Color(0xFF68748D),
                        fontWeight: FontWeight.w600,
                        height: 1.3,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Icon(
              selected
                  ? Icons.check_circle_rounded
                  : Icons.radio_button_unchecked_rounded,
              color: selected ? qpmsBlue : const Color(0xFFB2BACB),
            ),
          ],
        ),
      ),
    ),
  );
}
