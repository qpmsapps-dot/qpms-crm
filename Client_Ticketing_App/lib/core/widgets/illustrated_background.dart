import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../constants/app_assets.dart';

class IllustratedBackground extends StatelessWidget {
  const IllustratedBackground({
    required this.child,
    super.key,
    this.showWorker = true,
  });

  final Widget child;
  final bool showWorker;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          right: -36,
          top: 72,
          child: IgnorePointer(
            child: Opacity(
              opacity: 0.11,
              child: SvgPicture.asset(AppAssets.workerCorner, width: 180),
            ),
          ),
        ),
        if (showWorker)
          Positioned(
            left: -26,
            bottom: 10,
            child: IgnorePointer(
              child: Opacity(
                opacity: 0.09,
                child: SvgPicture.asset(AppAssets.facilityBanner, width: 260),
              ),
            ),
          ),
        child,
      ],
    );
  }
}
