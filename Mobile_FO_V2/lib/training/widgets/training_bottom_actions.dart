import 'package:flutter/material.dart';

import '../../ui/fo_ui.dart';

class TrainingBottomActions extends StatelessWidget {
  const TrainingBottomActions({
    this.secondaryLabel,
    this.onSecondary,
    required this.primaryLabel,
    required this.onPrimary,
    this.primaryIcon = Icons.arrow_forward_rounded,
    this.busy = false,
    super.key,
  });
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final IconData primaryIcon;
  final bool busy;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: foBorder)),
        boxShadow: [
          BoxShadow(
            color: Color(0x12070F45),
            blurRadius: 18,
            offset: Offset(0, -6),
          ),
        ],
      ),
      child: Row(
        children: [
          if (secondaryLabel != null) ...[
            Expanded(
              child: FoOutlinedButton(
                label: secondaryLabel!,
                onPressed: busy ? null : onSecondary,
                icon: Icons.arrow_back_rounded,
              ),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: FoPrimaryButton(
              label: busy ? 'Please wait...' : primaryLabel,
              onPressed: busy ? null : onPrimary,
              icon: busy ? Icons.hourglass_top_rounded : primaryIcon,
            ),
          ),
        ],
      ),
    ),
  );
}
