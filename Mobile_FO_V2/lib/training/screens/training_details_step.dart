import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../ui/fo_ui.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_category_card.dart';
import '../widgets/training_store_picker.dart';
import '../widgets/training_site_context.dart';

class TrainingDetailsStep extends StatefulWidget {
  const TrainingDetailsStep({
    required this.controller,
    required this.siteContext,
    super.key,
  });
  final TrainingFlowController controller;
  final TrainingSiteDisplayContext siteContext;

  @override
  State<TrainingDetailsStep> createState() => _TrainingDetailsStepState();
}

class _TrainingDetailsStepState extends State<TrainingDetailsStep> {
  late final TextEditingController _trainer;
  late final TextEditingController _remarks;

  @override
  void initState() {
    super.initState();
    _trainer = TextEditingController(text: widget.controller.trainerName);
    _remarks = TextEditingController(text: widget.controller.remarks);
  }

  @override
  void dispose() {
    _trainer.dispose();
    _remarks.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListView(
      key: const PageStorageKey('training-details-step'),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
      children: [
        ListTile(
          title: const Text('Training Store'),
          subtitle: Text(
            controller.selectedStore?['store_name']?.toString() ??
                'Select independently of your Check-In',
          ),
          trailing: controller.isEditable && controller.session == null
              ? const Icon(Icons.search)
              : null,
          onTap:
              controller.isEditable &&
                  controller.session == null &&
                  controller.selectedCategory != null
              ? () async {
                  final store = await showDialog<Map<String, dynamic>>(
                    context: context,
                    builder: (_) => TrainingStorePicker(controller: controller),
                  );
                  if (store != null) controller.selectStore(store);
                }
              : null,
        ),
        const Text(
          'Check-In authorizes this session; it does not select the Training store.',
        ),
        const SizedBox(height: 16),
        const FoSectionTitle(
          title: 'Training Category',
          subtitle: 'Select the training category for this session',
        ),
        const SizedBox(height: 12),
        ...controller.categories.map(
          (category) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TrainingCategoryCard(
              category: category,
              selected: controller.selectedCategory?.id == category.id,
              onTap: controller.isEditable
                  ? () => controller.selectCategory(category)
                  : null,
            ),
          ),
        ),
        const SizedBox(height: 8),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FoSectionTitle(title: 'Training Details'),
              const SizedBox(height: 16),
              TextFormField(
                key: ValueKey(
                  'training-date-field-${controller.trainingDate.toIso8601String()}',
                ),
                readOnly: true,
                initialValue: DateFormat(
                  'dd MMM yyyy',
                ).format(controller.trainingDate),
                decoration: const InputDecoration(
                  labelText: 'Training Date',
                  prefixIcon: Icon(Icons.calendar_today_outlined),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('trainer-name-field'),
                controller: _trainer,
                enabled: controller.isEditable,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Trainer Name',
                  prefixIcon: Icon(Icons.person_outline),
                ),
                onChanged: (value) => controller.setDetails(trainer: value),
              ),
              const SizedBox(height: 16),
              const Text(
                'Training Type',
                style: TextStyle(color: foNavy, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 9),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: controller.types
                    .map(
                      (type) => ChoiceChip(
                        key: ValueKey('training-type-${type.code}'),
                        label: Text(type.name),
                        selected:
                            controller.selectedTrainingType?.id == type.id,
                        onSelected: controller.isEditable
                            ? (selected) {
                                if (selected) {
                                  controller.selectTrainingType(type);
                                }
                              }
                            : null,
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('training-remarks-field'),
                controller: _remarks,
                enabled: controller.isEditable,
                minLines: 3,
                maxLines: 5,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Remarks (optional)',
                  alignLabelWithHint: true,
                ),
                onChanged: (value) => controller.setDetails(remarks: value),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(15),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline_rounded, color: Color(0xFF2F6FED)),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Save and complete evidence while your Check-In remains active.',
                  style: TextStyle(
                    color: Color(0xFF35527D),
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
