import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/chips.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class TicketSubmittedScreen extends StatelessWidget {
  const TicketSubmittedScreen({required this.ticketNumber, super.key});

  final String ticketNumber;

  @override
  Widget build(BuildContext context) {
    final ticket = context.watch<TicketController>().findTicket(ticketNumber);
    if (ticket == null) {
      return const _SubmittedTicketMissing();
    }
    return Scaffold(
      backgroundColor: const Color(0xFFF8FBFF),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(22, 18, 22, 28),
          children: [
            const _SuccessHeaderBar(),
            const SizedBox(height: 22),
            const _SuccessArtwork(),
            const SizedBox(height: 18),
            const Text(
              'Your ticket has been raised\nsuccessfully!',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.deepBlue,
                fontSize: 26,
                height: 1.18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'Our QPMS team has been notified and will address your issue at the earliest.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.muted,
                fontSize: 16,
                height: 1.45,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 26),
            _TicketDetailsCard(ticket: ticket),
            const SizedBox(height: 18),
            const _SuccessNote(),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: () => Navigator.pushReplacementNamed(
                context,
                AppRoutes.ticketDetails,
                arguments: ticket.number,
              ),
              icon: const Icon(Icons.arrow_forward_rounded),
              label: const Text('Track Ticket'),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(58),
                backgroundColor: AppColors.royalBlue,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                textStyle: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.pushNamedAndRemoveUntil(
                context,
                AppRoutes.dashboard,
                (_) => false,
              ),
              icon: const Icon(Icons.home_outlined),
              label: const Text('Back to Home'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(58),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                textStyle: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubmittedTicketMissing extends StatelessWidget {
  const _SubmittedTicketMissing();

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF8FBFF),
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.confirmation_number_outlined,
                color: AppColors.royalBlue,
                size: 54,
              ),
              const SizedBox(height: 18),
              const Text(
                'Unable to load this ticket.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.deepBlue,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Please return to My Tickets and refresh.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: () => Navigator.pushNamedAndRemoveUntil(
                  context,
                  AppRoutes.tickets,
                  (route) => false,
                ),
                child: const Text('My Tickets'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _SuccessHeaderBar extends StatelessWidget {
  const _SuccessHeaderBar();

  @override
  Widget build(BuildContext context) => Row(
    children: [
      _HeaderButton(
        icon: Icons.arrow_back_rounded,
        onTap: () => Navigator.maybePop(context),
      ),
      const Expanded(
        child: Text(
          'Ticket Submitted',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.deepBlue,
            fontSize: 25,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      _HeaderButton(icon: Icons.support_agent_rounded, onTap: () {}),
    ],
  );
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: const Color(0xFFF1F6FF),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Icon(icon, color: AppColors.deepBlue, size: 26),
    ),
  );
}

class _SuccessArtwork extends StatelessWidget {
  const _SuccessArtwork();

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 210,
    child: CustomPaint(
      painter: _HospitalSuccessPainter(),
      child: Center(
        child: Container(
          width: 118,
          height: 118,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              colors: [Color(0xFF3B82F6), Color(0xFF005BFF)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.royalBlue.withValues(alpha: 0.22),
                blurRadius: 28,
                spreadRadius: 12,
              ),
            ],
            border: Border.all(color: Colors.white, width: 8),
          ),
          child: const Icon(Icons.check_rounded, color: Colors.white, size: 72),
        ),
      ),
    ),
  );
}

class _HospitalSuccessPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final blue = Paint()..color = const Color(0xFFBFDBFE);
    final blue2 = Paint()..color = const Color(0xFF93C5FD);
    final accent = Paint()..color = const Color(0xFF1D70F5);
    final amber = Paint()..color = const Color(0xFFF59E0B);
    final baseY = size.height * 0.78;

    void building(double x, double w, double h) {
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, baseY - h, w, h),
        const Radius.circular(3),
      );
      canvas.drawRRect(rect, blue);
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 4; j++) {
          canvas.drawRect(
            Rect.fromLTWH(x + 9 + i * 14, baseY - h + 12 + j * 16, 6, 8),
            Paint()..color = Colors.white.withValues(alpha: 0.72),
          );
        }
      }
    }

    building(28, 58, 94);
    building(size.width - 86, 58, 86);
    building(92, 46, 58);
    building(size.width - 138, 46, 54);

    final ground = Paint()
      ..color = const Color(0xFF93C5FD)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final path = Path()
      ..moveTo(24, baseY)
      ..quadraticBezierTo(size.width / 2, baseY + 16, size.width - 24, baseY);
    canvas.drawPath(path, ground);

    for (final x in [58.0, size.width - 58]) {
      canvas.drawCircle(Offset(x, baseY - 24), 16, blue2);
      canvas.drawRect(Rect.fromLTWH(x - 2, baseY - 24, 4, 25), blue2);
    }

    final confetti = [
      (Offset(98, 24), accent),
      (Offset(140, 36), blue2),
      (Offset(size.width - 112, 28), accent),
      (Offset(size.width - 74, 48), amber),
      (Offset(68, 62), amber),
      (Offset(size.width - 168, 46), blue2),
    ];
    for (final item in confetti) {
      canvas.save();
      canvas.translate(item.$1.dx, item.$1.dy);
      canvas.rotate(0.7);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          const Rect.fromLTWH(-4, -9, 8, 18),
          const Radius.circular(2),
        ),
        item.$2,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _TicketDetailsCard extends StatelessWidget {
  const _TicketDetailsCard({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) => AppCard(
    padding: const EdgeInsets.all(18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            _DetailIcon(Icons.article_rounded),
            SizedBox(width: 14),
            Text(
              'Ticket Details',
              style: TextStyle(
                color: AppColors.deepBlue,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            children: [
              _DetailRow(
                icon: Icons.confirmation_number_outlined,
                label: 'Ticket Number',
                value: ticket.number,
                valueColor: AppColors.royalBlue,
                compactValue: true,
              ),
              _DetailRow(
                icon: Icons.apartment_rounded,
                label: 'Block',
                value: ticket.block,
              ),
              if (ticket.floor.trim().isNotEmpty)
                _DetailRow(
                  icon: Icons.stairs_rounded,
                  label: 'Floor',
                  value: ticket.floor,
                ),
              if (ticket.location.trim().isNotEmpty)
                _DetailRow(
                  icon: Icons.bed_rounded,
                  label: 'Area / Ward',
                  value: ticket.location,
                ),
              if (ticket.exactLandmark.trim().isNotEmpty)
                _DetailRow(
                  icon: Icons.place_outlined,
                  label: 'Exact Location',
                  value: ticket.exactLandmark,
                ),
              _DetailRow(
                icon: Icons.cleaning_services_rounded,
                label: 'Service Category',
                value: clientServiceLabel(ticket.category),
              ),
              _DetailRow(
                icon: Icons.warning_rounded,
                label: 'Priority',
                value: priorityLabel(ticket.priority),
                valueColor: ticket.priority == TicketPriority.high
                    ? AppColors.red
                    : AppColors.ink,
                trailing: PriorityChip(ticket.priority),
              ),
              _DetailRow(
                icon: Icons.calendar_month_rounded,
                label: 'Raised On',
                value: formatTicketDateTime(ticket.raisedAt),
                isLast: true,
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _DetailIcon extends StatelessWidget {
  const _DetailIcon(this.icon);

  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
    width: 44,
    height: 44,
    decoration: BoxDecoration(
      color: AppColors.paleBlue,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Icon(icon, color: AppColors.royalBlue, size: 26),
  );
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor = AppColors.ink,
    this.trailing,
    this.isLast = false,
    this.compactValue = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color valueColor;
  final Widget? trailing;
  final bool isLast;
  final bool compactValue;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
    decoration: BoxDecoration(
      border: isLast
          ? null
          : const Border(bottom: BorderSide(color: AppColors.line)),
    ),
    child: Row(
      children: [
        _DetailIcon(icon),
        const SizedBox(width: 12),
        Flexible(
          flex: compactValue ? 0 : 1,
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: compactValue ? 3 : 2,
          child: trailing ??
              Text(
                value,
                textAlign: TextAlign.right,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: valueColor,
                  fontSize: compactValue ? 13.5 : null,
                  fontWeight: FontWeight.w900,
                ),
              ),
        ),
      ],
    ),
  );
}

class _SuccessNote extends StatelessWidget {
  const _SuccessNote();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.paleBlue,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFA7C7FF)),
    ),
    child: const Row(
      children: [
        Icon(Icons.verified_user_rounded, color: AppColors.royalBlue, size: 34),
        SizedBox(width: 14),
        Expanded(
          child: Text(
            'We appreciate your feedback. Your ticket helps us maintain a better and safer environment for everyone.',
            style: TextStyle(
              color: AppColors.muted,
              height: 1.35,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}
