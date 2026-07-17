import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
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
  int _rating = 5;
  bool? _satisfied;
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
            Container(
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
                    child: Icon(
                      Icons.verified_rounded,
                      size: 30,
                      color: AppColors.green,
                    ),
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Has the issue been resolved?',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  SizedBox(height: 5),
                  Text(
                    'Please check the completed work before confirming.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.muted),
                  ),
                ],
              ),
            ),
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
                    'Rate the housekeeping service',
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
                        onPressed: () => setState(() => _rating = index + 1),
                        icon: Icon(
                          index < _rating
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          size: 34,
                          color: const Color(0xFFF59E0B),
                        ),
                        tooltip: '${index + 1} star',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _comments,
                    minLines: 3,
                    maxLines: 5,
                    decoration: const InputDecoration(
                      labelText: 'Comments',
                      hintText: 'Tell us about the completed work',
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: _DecisionButton(
                          label: 'Not Satisfied',
                          icon: Icons.replay_rounded,
                          selected: _satisfied == false,
                          color: AppColors.red,
                          onTap: () => setState(() {
                            _satisfied = false;
                            _error = null;
                          }),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _DecisionButton(
                          label: 'Satisfied',
                          icon: Icons.thumb_up_alt_rounded,
                          selected: _satisfied == true,
                          color: AppColors.green,
                          onTap: () => setState(() {
                            _satisfied = true;
                            _error = null;
                          }),
                        ),
                      ),
                    ],
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
            ElevatedButton(
              onPressed: _submit,
              child: Text(
                _satisfied == false
                    ? 'Reopen This Ticket'
                    : 'Submit Confirmation',
              ),
            ),
            if (_satisfied == false) ...[
              const SizedBox(height: 8),
              const Text(
                'This reopens the same ticket and restarts the Housekeeping Supervisor SLA. A duplicate ticket will not be created.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  height: 1.4,
                  color: AppColors.muted,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_satisfied == null) {
      setState(() => _error = 'Please select Satisfied or Not Satisfied.');
      return;
    }
    if (_satisfied == false && _comments.text.trim().isEmpty) {
      setState(() => _error = 'Please tell us what still needs attention.');
      return;
    }
    try {
      await context.read<TicketController>().submitFeedback(
        ticketNumber: widget.ticketNumber,
        rating: _rating,
        comment: _comments.text,
        satisfied: _satisfied!,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
      return;
    }
    if (!mounted) return;
    final message = _satisfied!
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

class _DecisionButton extends StatelessWidget {
  const _DecisionButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.color,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(14),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
      decoration: BoxDecoration(
        color: selected ? color.withValues(alpha: 0.1) : Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: selected ? color : AppColors.line,
          width: selected ? 2 : 1,
        ),
      ),
      child: Column(
        children: [
          Icon(icon, color: color),
          const SizedBox(height: 5),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              color: selected ? color : AppColors.ink,
            ),
          ),
        ],
      ),
    ),
  );
}
