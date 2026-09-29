import 'package:flutter/material.dart';

import '../../ui/fo_ui.dart';
import '../models/training_topic.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_topic_card.dart';

class TrainingTopicsStep extends StatefulWidget {
  const TrainingTopicsStep({required this.controller, super.key});
  final TrainingFlowController controller;
  @override
  State<TrainingTopicsStep> createState() => _TrainingTopicsStepState();
}

class _TrainingTopicsStepState extends State<TrainingTopicsStep> {
  String _query = '';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    if (widget.controller.topics.isEmpty) widget.controller.loadTopics();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final visible = controller.topics.where((topic) {
      final query = _query.trim().toLowerCase();
      return query.isEmpty ||
          topic.moduleName.toLowerCase().contains(query) ||
          (topic.topicDescription ?? '').toLowerCase().contains(query);
    }).toList();
    final selectedIds = controller.selectedSessionTopics
        .map((item) => item.topicId)
        .toSet();
    return ListView(
      key: const PageStorageKey('training-topics-step'),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
      children: [
        const FoSectionTitle(
          title: 'Select Training Topics',
          subtitle: 'Choose the modules covered in this session',
        ),
        const SizedBox(height: 12),
        if (controller.selectedCategory != null)
          FoStatusBadge(label: controller.selectedCategory!.name),
        const SizedBox(height: 14),
        TextField(
          key: const Key('topic-search-field'),
          onChanged: (value) => setState(() => _query = value),
          decoration: const InputDecoration(
            hintText: 'Search module',
            prefixIcon: Icon(Icons.search_rounded),
          ),
        ),
        const SizedBox(height: 14),
        if (visible.isEmpty)
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: foBorder),
            ),
            child: const Column(
              children: [
                Icon(
                  Icons.search_off_rounded,
                  color: Color(0xFF8A96AD),
                  size: 34,
                ),
                SizedBox(height: 8),
                Text(
                  'No topics match your search.',
                  style: TextStyle(
                    color: Color(0xFF68748D),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          )
        else
          ...visible.map((topic) {
            final selected = selectedIds.contains(topic.id);
            final sessionTopic = controller.selectedSessionTopics
                .where((item) => item.topicId == topic.id)
                .firstOrNull;
            final locked =
                selected &&
                sessionTopic != null &&
                controller.evidenceForTopic(sessionTopic.id).isNotEmpty;
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: TrainingTopicCard(
                topic: topic,
                selected: selected,
                locked: locked,
                onTap: controller.isEditable && !_saving
                    ? () => _toggle(topic, selected)
                    : null,
              ),
            );
          }),
        const SizedBox(height: 6),
        FoCard(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              const Icon(Icons.checklist_rounded, color: Color(0xFF2F6FED)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '${controller.selectedTopicCount} Topics Selected',
                  style: const TextStyle(
                    color: foNavy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (_saving)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _toggle(TrainingTopic topic, bool selected) async {
    final ids = widget.controller.selectedSessionTopics
        .map((item) => item.topicId)
        .toSet();
    selected ? ids.remove(topic.id) : ids.add(topic.id);
    setState(() => _saving = true);
    try {
      await widget.controller.setSelectedTopics(ids.toList());
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
