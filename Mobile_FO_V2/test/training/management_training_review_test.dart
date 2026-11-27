import 'package:myqpms_fo_v2/theme/app_theme.dart';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/screens/management_training_shell.dart';
import 'package:myqpms_fo_v2/training/screens/mepc_training_screen.dart';
import 'management_training_test.dart' as fixture;

class ReviewApi extends fixture.ManagementApiFake {
  @override
  Future<List<TrainingSession>> getSessions({
    bool? mine,
    String? siteVisitId,
    String? status,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? categoryId,
    String? storeId,
    int? limit,
  }) async => [];
}

ThemeData reviewTheme() {
  final theme = buildAppTheme();
  return theme.copyWith(
    textTheme: theme.textTheme.apply(fontFamily: 'TrainingReview'),
    filledButtonTheme: FilledButtonThemeData(
      style: theme.filledButtonTheme.style!.copyWith(
        textStyle: const WidgetStatePropertyAll(
          TextStyle(fontFamily: 'TrainingReview', fontWeight: FontWeight.w800),
        ),
      ),
    ),
  );
}

Future<void> loadReviewFonts() async {
  final config = File('.dart_tool/package_config.json').absolute;
  final packages =
      (jsonDecode(config.readAsStringSync()) as Map)['packages'] as List;
  final packageRoot = config.uri.resolve(
    (packages.firstWhere((p) => p['name'] == 'flutter') as Map)['rootUri']
        as String,
  );
  final root = Uri.parse(
    '${packageRoot.toString().replaceFirst(RegExp(r'/$'), '')}/',
  );
  final fonts = Directory.fromUri(
    root.resolve('../../bin/cache/artifacts/material_fonts/'),
  );
  for (final pair in [
    ['TrainingReview', 'roboto-regular.ttf'],
    ['MaterialIcons', 'materialicons-regular.otf'],
  ]) {
    final matches = fonts
        .listSync()
        .whereType<File>()
        .where((f) => f.uri.pathSegments.last.toLowerCase() == pair[1])
        .toList();
    expect(matches.length, 1);
    await (FontLoader(pair[0])..addFont(
          Future.value(ByteData.sublistView(matches.single.readAsBytesSync())),
        ))
        .load();
  }
}

Future<void> capture(WidgetTester tester, GlobalKey key, String name) async {
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject() as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File(
      '../.phase4-test-output/screenshots/mepc-mobile-management-$name.png',
    );
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  for (final role in ['MIS_MEPC', 'Operations Manager']) {
    testWidgets('review management mobile navigation: $role', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(430, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(loadReviewFonts);
      final key = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: reviewTheme(),
            home: ManagementTrainingShell(
              user: FoUser(
                authUserId: 'synthetic-auth',
                employeeCode: 'SYN-MANAGEMENT',
                fullName:
                    'Sample ${role == 'MIS_MEPC' ? 'MEPC MIS' : 'Operations Manager'} (synthetic)',
                mobile: '',
                email: '',
                state: 'TN',
                role: role,
                business: 'Reliance Retail',
              ),
              api: ReviewApi(),
              onLogout: () {},
              operationalWorkspace: role == 'MIS_MEPC'
                  ? null
                  : (_) => const Scaffold(body: Text('Existing workspace')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Start Day'), findsNothing);
      expect(find.text('Check-In'), findsNothing);
      expect(
        find.text('Existing operational workspace'),
        role == 'MIS_MEPC' ? findsNothing : findsOneWidget,
      );
      await capture(tester, key, role == 'MIS_MEPC' ? 'mis-entry' : 'om-entry');
    });
  }
  testWidgets(
    'review shared management form, proof and camera/gallery options',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(430, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(loadReviewFonts);
      final c = fixture.managementController(
        ReviewApi(),
        fixture.ManagementRepoFake(),
      );
      final sql =
          File('../supabase/migrations_2_0/115_reliance_training_foundation.sql')
              .readAsStringSync()
              .split('-- Technical / MEP topics (15).')
              .last
              .split("where c.code = 'technical_mep'")
              .first;
      final matches = RegExp(
        r"\('([^']+)', '([^']+)'",
      ).allMatches(sql).toList();
      expect(matches.length, 15);
      c.setup['topics'] = matches
          .map(
            (m) => {
              'id': m.group(1),
              'category_id': 'technical',
              'code': m.group(1),
              'module_name': m.group(2),
            },
          )
          .toList();
      final key = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: reviewTheme(),
            home: MepcTrainingScreen(controller: c, management: true),
          ),
        ),
      );
      await capture(tester, key, 'form');
      await tester.tap(find.byType(CheckboxListTile).first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add required JPEG/PNG'));
      await tester.tap(find.text('Add required JPEG/PNG'));
      await tester.pumpAndSettle();
      expect(find.text('Camera'), findsOneWidget);
      expect(find.text('Gallery'), findsOneWidget);
      await capture(tester, key, 'photo-source');
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Choose completion proof'));
      await capture(tester, key, 'completion-proof');
    },
  );
}
