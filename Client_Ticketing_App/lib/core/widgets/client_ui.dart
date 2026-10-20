import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../constants/app_colors.dart';

class ClientSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const page = 18.0;
}

class ClientSectionTitle extends StatelessWidget {
  const ClientSectionTitle({
    required this.title,
    super.key,
    this.action,
    this.onAction,
  });

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
        ),
        if (action != null)
          TextButton(onPressed: onAction, child: Text(action!)),
      ],
    );
  }
}

class ClientEmptyState extends StatelessWidget {
  const ClientEmptyState({
    required this.icon,
    required this.title,
    required this.message,
    super.key,
    this.action,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppColors.paleBlue,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(icon, color: AppColors.royalBlue, size: 32),
          ),
          const SizedBox(height: ClientSpacing.lg),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          const SizedBox(height: ClientSpacing.sm),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              height: 1.45,
              fontWeight: FontWeight.w600,
              color: AppColors.muted,
            ),
          ),
          if (action != null && onAction != null) ...[
            const SizedBox(height: ClientSpacing.lg),
            FilledButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.add_rounded),
              label: Text(action!),
            ),
          ],
        ],
      ),
    );
  }
}

class ClientHeroCard extends StatelessWidget {
  const ClientHeroCard({
    required this.image,
    required this.child,
    super.key,
    this.height = 176,
  });

  final String image;
  final Widget child;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: SizedBox(
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(image, fit: BoxFit.cover),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [
                    const Color(0xFF031B4E).withValues(alpha: 0.94),
                    const Color(0xFF062A8F).withValues(alpha: 0.72),
                    const Color(0xFF0B5CFF).withValues(alpha: 0.18),
                  ],
                ),
              ),
            ),
            Padding(padding: const EdgeInsets.all(20), child: child),
          ],
        ),
      ),
    );
  }
}

class ClientPhotoThumbnail extends StatelessWidget {
  const ClientPhotoThumbnail({
    required this.url,
    super.key,
    this.width = 210,
    this.height = 142,
    this.label,
  });

  final String url;
  final double width;
  final double height;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => _PhotoPreviewDialog(url: url, label: label),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Stack(
          children: [
            _PreviewImage(
              url: url,
              width: width,
              height: height,
              fit: BoxFit.cover,
            ),
            if (label != null)
              Positioned(
                left: 10,
                bottom: 10,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.58),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    label!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PhotoPreviewDialog extends StatelessWidget {
  const _PhotoPreviewDialog({required this.url, this.label});

  final String url;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Dialog.fullscreen(
      backgroundColor: const Color(0xFF020617),
      child: SafeArea(
        child: Stack(
          children: [
            Center(
              child: InteractiveViewer(
                minScale: 0.8,
                maxScale: 4,
                child: _PreviewImage(
                  url: url,
                  fit: BoxFit.contain,
                ),
              ),
            ),
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Row(
                children: [
                  IconButton.filled(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                  if (label != null) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        label!,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PreviewImage extends StatelessWidget {
  const _PreviewImage({
    required this.url,
    required this.fit,
    this.width,
    this.height,
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return Image.network(
        url,
        width: width,
        height: height,
        fit: fit,
        loadingBuilder: (context, child, loading) {
          if (loading == null) return child;
          return _placeholder();
        },
        errorBuilder: (_, _, _) => _placeholder(error: true),
      );
    }
    if (url.endsWith('.svg')) {
      return SvgPicture.asset(
        url,
        width: width,
        height: height,
        fit: fit,
      );
    }
    if (url.startsWith('assets/')) {
      return Image.asset(
        url,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, _, _) => _placeholder(error: true),
      );
    }
    return Image.file(
      File(url),
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (_, _, _) => _placeholder(error: true),
    );
  }

  Widget _placeholder({bool error = false}) => Container(
    width: width,
    height: height,
    color: AppColors.paleBlue,
    child: Center(
      child: error
          ? const Icon(Icons.broken_image_outlined, color: AppColors.muted)
          : const CircularProgressIndicator(strokeWidth: 2),
    ),
  );
}
