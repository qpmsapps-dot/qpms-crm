import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/utils/friendly_errors.dart';
import '../../core/widgets/app_card.dart';
import '../../state/ticket_controller.dart';

class FeedbackScreen extends StatefulWidget {
  const FeedbackScreen({required this.ticketNumber, super.key});
  final String ticketNumber;

  @override
  State<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends State<FeedbackScreen> {
  final _comments = TextEditingController();
  int? _rating;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _comments.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ticket = context.watch<TicketController>().ticketByNumber(
      widget.ticketNumber,
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Confirm Resolution')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 6, 18, 28),
          children: [
            const _RatingHeader(),
            const SizedBox(height: 16),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ticket.number,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.royalBlue,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    ticket.fullLocation,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    ticket.resolutionNotes,
                    style: const TextStyle(
                      height: 1.45,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            AppCard(
              child: Column(
                children: [
                  const Text(
                    'Rate the service',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      5,
                      (index) => IconButton(
                        iconSize: 38,
                        onPressed: _submitting
                            ? null
                            : () => setState(() {
                                _rating = index + 1;
                                _error = null;
                              }),
                        icon: Icon(
                          index < (_rating ?? 0)
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          size: 34,
                          color: index < (_rating ?? 0)
                              ? const Color(0xFFF59E0B)
                              : const Color(0xFFCBD5E1),
                        ),
                        tooltip: '${index + 1} star',
                      ),
                    ),
                  ),
                  Text(
                    _rating == null
                        ? 'Select a rating'
                        : '${_rating!} Star${_rating == 1 ? '' : 's'} - ${_ratingLabel(_rating!)}',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _comments,
                    minLines: 3,
                    maxLines: 5,
                    maxLength: 300,
                    enabled: !_submitting,
                    decoration: const InputDecoration(
                      labelText: 'Comments',
                      hintText: 'Tell us about the completed work',
                      alignLabelWithHint: true,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppColors.red,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _submitting ? null : () => _submit(satisfied: true),
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.star_rounded),
              label: const Text('Submit Rating'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _submitting ? null : _confirmReopen,
              icon: const Icon(Icons.replay_rounded),
              label: const Text('Not Satisfied / Reopen'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.red,
                side: const BorderSide(color: AppColors.red),
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Not satisfied keeps the same ticket open for another review. A duplicate complaint is not created.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmReopen() async {
    final reason = _comments.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'Please tell us what still needs attention.');
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reopen complaint?'),
        content: const Text(
          'This will mark the work as not satisfied and reopen the same complaint.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.red),
            child: const Text('Submit & Reopen'),
          ),
        ],
      ),
    );
    if (ok == true) await _submit(satisfied: false);
  }

  Future<void> _submit({required bool satisfied}) async {
    if (_rating == null) {
      setState(() => _error = 'Select a rating from 1 to 5 stars.');
      return;
    }
    if (!satisfied && _comments.text.trim().isEmpty) {
      setState(() => _error = 'Please tell us what still needs attention.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await context.read<TicketController>().submitFeedback(
        ticketNumber: widget.ticketNumber,
        rating: _rating!,
        comment: _comments.text,
        satisfied: satisfied,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = friendlyErrorMessage(
          error,
          fallback: 'Unable to submit feedback. Please try again.',
        );
      });
      return;
    }
    if (!mounted) return;
    final message = satisfied
        ? 'Thank you. The ticket is now closed.'
        : 'The same ticket has been reopened.';
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
    Navigator.pushNamedAndRemoveUntil(
      context,
      AppRoutes.ticketDetails,
      (route) => route.settings.name == AppRoutes.dashboard,
      arguments: widget.ticketNumber,
    );
  }
}

class _RatingHeader extends StatelessWidget {
  const _RatingHeader();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: const Color(0xFFECFDF5),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFA7F3D0)),
    ),
    child: const Column(
      children: [
        CircleAvatar(
          radius: 28,
          backgroundColor: Colors.white,
          child: Icon(Icons.verified_rounded, size: 30, color: AppColors.green),
        ),
        SizedBox(height: 12),
        Text(
          'How was the work completed?',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        SizedBox(height: 5),
        Text(
          'Rate the service before confirming the completed work.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
      ],
    ),
  );
}

String _ratingLabel(int rating) => switch (rating) {
  1 => 'Very Poor',
  2 => 'Poor',
  3 => 'Average',
  4 => 'Good',
  _ => 'Excellent',
};
