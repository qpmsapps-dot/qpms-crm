import 'package:flutter/material.dart';

import '../constants/app_assets.dart';

class LogoMark extends StatelessWidget {
  const LogoMark({super.key, this.size = 74});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.22),
      child: Image.asset(
        AppAssets.logo,
        width: size,
        height: size,
        fit: BoxFit.contain,
      ),
    );
  }
}
