import 'package:flutter/material.dart';

import '../../ui/fo_ui.dart';
import '../data/training_draft_cache.dart';
import '../state/training_flow_controller.dart';
import '../widgets/training_bottom_actions.dart';
import '../widgets/training_site_context.dart';
import '../widgets/training_stepper.dart';
import 'training_attendees_step.dart';
import 'training_details_step.dart';
import 'training_evidence_step.dart';
import 'training_review_step.dart';
import 'training_topics_step.dart';

class TrainingFlowScreen extends StatefulWidget {
  const TrainingFlowScreen({
    required this.controller,
    required this.siteContext,
    super.key,
  });
  final TrainingFlowController controller;
  final TrainingSiteDisplayContext siteContext;

  @override
  State<TrainingFlowScreen> createState() => _TrainingFlowScreenState();
}

class _TrainingFlowScreenState extends State<TrainingFlowScreen> {
  bool _allowPop = false;

  TrainingFlowController get controller => widget.controller;
  TrainingSiteDisplayContext get siteContext => widget.siteContext;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => PopScope(
      canPop:
          _allowPop ||
          (!controller.isDirty && controller.pendingUploadCount == 0),
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _confirmLeave(context);
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFE),
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 14, 8),
                child: Row(
                  children: [
                    IconButton(
                      tooltip: 'Back',
                      onPressed: () => Navigator.maybePop(context),
                      icon: const Icon(Icons.arrow_back_rounded, color: foNavy),
                    ),
                    const SizedBox(width: 2),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Training',
                            style: TextStyle(
                              color: foNavy,
                              fontSize: 25,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 3),
                          Text(
                            'Conduct and record site training',
                            style: TextStyle(
                              color: Color(0xFF5B6884),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const CircleAvatar(
                      backgroundColor: Color(0xFFEAF2FF),
                      child: Icon(
                        Icons.person_outline_rounded,
                        color: Color(0xFF2F6FED),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 9),
                child: TrainingStepper(currentStep: controller.currentStep),
              ),
              if (controller.isSubmitted || controller.isCancelled)
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 2, 18, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FoStatusBadge(
                      label: controller.isSubmitted
                          ? 'Submitted • Read only'
                          : 'Cancelled • Read only',
                      color: controller.isSubmitted
                          ? foGreen
                          : const Color(0xFFD15A5A),
                      showDot: true,
                    ),
                  ),
                ),
              Expanded(child: _body()),
            ],
          ),
        ),
        bottomNavigationBar: controller.isLoading ? null : _actions(context),
      ),
    ),
  );

  Widget _body() {
    if (controller.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (controller.error != null &&
        controller.session == null &&
        controller.categories.isEmpty) {
      return _ErrorState(
        message: controller.error!.message,
        onRetry: controller.clearError,
      );
    }
    return switch (controller.currentStep) {
      TrainingFlowStep.details => TrainingDetailsStep(
        controller: controller,
        siteContext: siteContext,
      ),
      TrainingFlowStep.attendees => TrainingAttendeesStep(
        controller: controller,
      ),
      TrainingFlowStep.topics => TrainingTopicsStep(controller: controller),
      TrainingFlowStep.evidence => TrainingEvidenceStep(controller: controller),
      TrainingFlowStep.review => TrainingReviewStep(controller: controller),
    };
  }

  Widget _actions(BuildContext context) {
    if (!controller.isEditable) {
      if (controller.currentStep == TrainingFlowStep.review) {
        return TrainingBottomActions(
          primaryLabel: 'Done',
          primaryIcon: Icons.done_rounded,
          onPrimary: () => Navigator.maybePop(context),
        );
      }
      return TrainingBottomActions(
        secondaryLabel: controller.currentStep.index > 0 ? 'Back' : null,
        onSecondary: _back,
        primaryLabel: 'View Next',
        onPrimary: () => controller.goTo(
          TrainingFlowStep.values[controller.currentStep.index + 1],
        ),
      );
    }
    return switch (controller.currentStep) {
      TrainingFlowStep.details => TrainingBottomActions(
        secondaryLabel: 'Save Draft',
        onSecondary: () => _save(context),
        primaryLabel: 'Continue',
        busy: controller.isSaving,
        onPrimary: controller.canContinueDetails
            ? () => _continueDetails(context)
            : null,
      ),
      TrainingFlowStep.attendees => TrainingBottomActions(
        secondaryLabel: 'Back',
        onSecondary: _back,
        primaryLabel: 'Continue',
        onPrimary: controller.canContinueAttendees
            ? () => controller.goTo(TrainingFlowStep.topics)
            : null,
      ),
      TrainingFlowStep.topics => TrainingBottomActions(
        secondaryLabel: 'Back',
        onSecondary: _back,
        primaryLabel: 'Continue with ${controller.selectedTopicCount} topics',
        onPrimary: controller.canContinueTopics
            ? () => controller.goTo(TrainingFlowStep.evidence)
            : null,
      ),
      TrainingFlowStep.evidence => TrainingBottomActions(
        secondaryLabel: 'Back',
        onSecondary: _back,
        primaryLabel: 'Review',
        busy: controller.isUploading,
        onPrimary: controller.pendingUploadCount == 0
            ? () => controller.goTo(TrainingFlowStep.review)
            : null,
      ),
      TrainingFlowStep.review => TrainingBottomActions(
        secondaryLabel: 'Save Draft',
        onSecondary: () => _save(context),
        primaryLabel: 'Submit Training',
        primaryIcon: Icons.send_rounded,
        busy: controller.isSubmitting,
        onPrimary: controller.canSubmitLocally ? () => _submit(context) : null,
      ),
    };
  }

  void _back() {
    if (controller.currentStep.index > 0) {
      controller.goTo(
        TrainingFlowStep.values[controller.currentStep.index - 1],
      );
    }
  }

  Future<void> _save(BuildContext context) async {
    try {
      await controller.saveDraft();
      if (context.mounted) _snack(context, 'Training draft saved.');
    } catch (error) {
      if (context.mounted) _snack(context, error.toString());
    }
  }

  Future<void> _continueDetails(BuildContext context) async {
    try {
      await controller.saveDraft();
      controller.goTo(TrainingFlowStep.attendees);
    } catch (error) {
      if (context.mounted) _snack(context, error.toString());
    }
  }

  Future<void> _submit(BuildContext context) async {
    final confirmed =
        await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Submit Training?'),
            content: const Text(
              'Once submitted, this record cannot be edited.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Submit'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;
    try {
      await controller.submit();
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.check_circle_rounded,
            color: foGreen,
            size: 48,
          ),
          title: const Text('Training Submitted Successfully'),
          content: Text(
            '${siteContext.siteName}\n${controller.selectedCategory?.name ?? ''} • ${controller.selectedTopicCount} topics • ${controller.attendeeCount} staff',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (context.mounted) _snack(context, error.toString());
    }
  }

  Future<void> _confirmLeave(BuildContext context) async {
    final leave =
        await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Leave Training?'),
            content: const Text(
              'Unsaved changes or pending uploads may remain. Save your draft before leaving.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Stay'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Leave'),
              ),
            ],
          ),
        ) ??
        false;
    if (!leave || !context.mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.pop(context);
    });
  }

  void _snack(BuildContext context, String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            size: 48,
            color: Color(0xFF7F8AA2),
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: foNavy, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Try Again'),
          ),
        ],
      ),
    ),
  );
}
