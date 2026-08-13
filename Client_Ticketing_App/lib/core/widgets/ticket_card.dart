import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../models/ticket.dart';
import 'app_card.dart';
import 'chips.dart';

class TicketCard extends StatelessWidget {
  const TicketCard({required this.ticket, super.key, this.onTap});

  final Ticket ticket;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(12),
      radius: 20,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _TicketThumbnail(ticket: ticket),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        ticket.number,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 14.5,
                          color: Color(0xFF0757D8),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusChip(ticket.status),
                  ],
                ),
                const SizedBox(height: 9),
                Text(
                  clientServiceLabel(ticket.category),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF0F172A),
                    fontSize: 17,
                  ),
                ),
                const SizedBox(height: 11),
                _TicketMeta(
                  icon: Icons.location_on_outlined,
                  text: ticket.conciseLocation,
                  iconColor: const Color(0xFF0069FF),
                ),
                const SizedBox(height: 9),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: _TicketMeta(
                        icon: Icons.calendar_month_outlined,
                        text: formatTicketDateTime(ticket.raisedAt),
                      ),
                    ),
                    const SizedBox(width: 8),
                    PriorityChip(ticket.priority),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TicketThumbnail extends StatelessWidget {
  const _TicketThumbnail({required this.ticket});

  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final photo = ticket.complaintPhotoAssets.isNotEmpty
        ? ticket.complaintPhotoAssets.first.trim()
        : '';
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        width: 92,
        height: 92,
        child: photo.isEmpty
            ? const _PhotoPlaceholder()
            : _TicketPhoto(path: photo),
      ),
    );
  }
}

class _TicketPhoto extends StatelessWidget {
  const _TicketPhoto({required this.path});

  final String path;

  @override
  Widget build(BuildContext context) {
    const fallback = _PhotoPlaceholder();
    if (path.startsWith('http')) {
      return Image.network(
        path,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
        loadingBuilder: (context, child, loading) =>
            loading == null ? child : fallback,
      );
    }
    if (path.toLowerCase().endsWith('.svg')) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: SvgPicture.asset(
          path,
          fit: BoxFit.contain,
          placeholderBuilder: (_) => fallback,
        ),
      );
    }
    if (path.startsWith('assets/')) {
      return Image.asset(
        path,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => fallback,
      );
    }
    return Image.file(
      File(path),
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => fallback,
    );
  }
}

class _PhotoPlaceholder extends StatelessWidget {
  const _PhotoPlaceholder();
  @override
  Widget build(BuildContext context) {
    const color = Color(0xFF64748B);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Center(
        child: Container(
          width: 58,
          height: 58,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.82),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.image_outlined, color: color, size: 32),
        ),
      ),
    );
  }
}

class _TicketMeta extends StatelessWidget {
  const _TicketMeta({
    required this.icon,
    required this.text,
    this.iconColor = const Color(0xFF475569),
  });

  final IconData icon;
  final String text;
  final Color iconColor;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 17, color: iconColor),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFF475569),
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ],
  );
}
