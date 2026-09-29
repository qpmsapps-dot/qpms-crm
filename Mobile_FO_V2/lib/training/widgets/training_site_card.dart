import 'package:flutter/material.dart';

import '../../ui/fo_ui.dart';

class TrainingSiteCard extends StatelessWidget {
  const TrainingSiteCard({
    required this.siteName,
    this.state,
    this.business,
    this.checkedIn = false,
    this.checkInTime,
    super.key,
  });
  final String siteName;
  final String? state;
  final String? business;
  final bool checkedIn;
  final String? checkInTime;

  @override
  Widget build(BuildContext context) => FoCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const FoSectionTitle(title: 'Site Information'),
        const SizedBox(height: 16),
        Row(
          children: [
            const FoIconCircle(
              icon: Icons.location_on_outlined,
              color: Color(0xFF2F6FED),
              size: 52,
              iconSize: 26,
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    siteName.trim().isEmpty ? 'Current site' : siteName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: foNavy,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    [state, business]
                        .where((value) => value?.trim().isNotEmpty == true)
                        .join(' • '),
                    style: const TextStyle(
                      color: Color(0xFF63708C),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            if (checkedIn)
              const FoStatusBadge(
                label: 'Checked In',
                color: foGreen,
                showDot: true,
              ),
          ],
        ),
        if (checkInTime?.trim().isNotEmpty == true) ...[
          const SizedBox(height: 13),
          Row(
            children: [
              const Icon(
                Icons.schedule_rounded,
                size: 18,
                color: Color(0xFF63708C),
              ),
              const SizedBox(width: 7),
              Text(
                'Checked in at $checkInTime',
                style: const TextStyle(
                  color: Color(0xFF63708C),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ],
    ),
  );
}
