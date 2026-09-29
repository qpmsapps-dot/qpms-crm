import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../ui/fo_ui.dart';
import '../models/training_attendee.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_attendee_card.dart';

class TrainingAttendeesStep extends StatefulWidget {
  const TrainingAttendeesStep({required this.controller, super.key});
  final TrainingFlowController controller;
  @override
  State<TrainingAttendeesStep> createState() => _TrainingAttendeesStepState();
}

class _TrainingAttendeesStepState extends State<TrainingAttendeesStep> {
  Timer? _debounce;
  final Set<String> _busyProfiles = {};
  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _search(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) widget.controller.searchStaff(value);
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final session = controller.session;
    return ListView(
      key: const PageStorageKey('training-attendees-step'),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
      children: [
        _SummaryLine(
          values: [
            session?.storeNameSnapshot ?? 'Current site',
            controller.selectedCategory?.name ?? 'Category',
            DateFormat('dd MMM yyyy').format(controller.trainingDate),
          ],
        ),
        const SizedBox(height: 14),
        FoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FoSectionTitle(
                title: 'Staff Attended',
                subtitle: 'Add the team members who attended this training',
                trailing: FoStatusBadge(
                  label: '${controller.attendeeCount} Staff Added',
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('staff-search-field'),
                onChanged: _search,
                decoration: InputDecoration(
                  hintText: 'Search by employee ID or name',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: controller.isSearchingStaff
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : null,
                ),
              ),
              if (controller.staffSearchError != null) ...[
                const SizedBox(height: 10),
                Text(
                  controller.staffSearchError!.message,
                  style: const TextStyle(
                    color: Color(0xFFB13A3A),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              if (controller.staffSuggestions.isNotEmpty) ...[
                const SizedBox(height: 14),
                ...controller.staffSuggestions.map((suggestion) {
                  final added = controller.attendees.any(
                    (item) => item.profileId == suggestion.profileId,
                  );
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: TrainingAttendeeCard.suggestion(
                      suggestion,
                      added: added,
                      onAdd: _busyProfiles.contains(suggestion.profileId)
                          ? null
                          : () => _add(suggestion),
                    ),
                  );
                }),
              ],
              if (!controller.isSearchingStaff &&
                  controller.staffSuggestions.isEmpty) ...[
                const SizedBox(height: 14),
                const _Empty(
                  icon: Icons.person_search_outlined,
                  text: 'Search for available Reliance Retail staff.',
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        const FoSectionTitle(title: 'Selected Staff'),
        const SizedBox(height: 10),
        if (controller.attendees.isEmpty)
          const _Empty(
            icon: Icons.groups_outlined,
            text: 'No attendees added yet.',
          )
        else
          ...controller.attendees.map(
            (attendee) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: TrainingAttendeeCard.attendee(
                attendee,
                onRemove: controller.isEditable
                    ? () => _remove(attendee)
                    : null,
              ),
            ),
          ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFF3F7FF),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text(
            'Search by employee code or select available Reliance Retail staff.',
            style: TextStyle(
              color: Color(0xFF4E6289),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _add(TrainingStaffSuggestion suggestion) async {
    setState(() => _busyProfiles.add(suggestion.profileId));
    try {
      await widget.controller.addAttendee(suggestion);
    } catch (error) {
      if (mounted) _snack(error);
    } finally {
      if (mounted) setState(() => _busyProfiles.remove(suggestion.profileId));
    }
  }

  Future<void> _remove(TrainingAttendee attendee) async {
    try {
      await widget.controller.removeAttendee(attendee.id);
    } catch (error) {
      if (mounted) _snack(error);
    }
  }

  void _snack(Object error) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(error.toString())));
}

class _SummaryLine extends StatelessWidget {
  const _SummaryLine({required this.values});
  final List<String> values;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: values
        .map(
          (value) => Chip(label: Text(value, overflow: TextOverflow.ellipsis)),
        )
        .toList(),
  );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: const Color(0xFFF8FAFD),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: foBorder),
    ),
    child: Column(
      children: [
        Icon(icon, color: const Color(0xFF8A96AD)),
        const SizedBox(height: 7),
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
