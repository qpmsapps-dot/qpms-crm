import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_topic.dart';
import 'package:myqpms_fo_v2/training/screens/mepc_training_screen.dart';
import 'package:myqpms_fo_v2/training/training_launcher.dart';
import 'package:myqpms_fo_v2/training/state/training_flow_controller.dart';
import 'training_ui_test_support.dart';

const category = TrainingCategory(
  id: 'technical',
  code: 'technical_mep',
  name: 'Technical / MEP',
  topicEvidencePolicy: 'optional',
);
const topic = TrainingSessionTopic(
  id: 'session-topic',
  trainingSessionId: 'session',
  topicId: 'topic',
  topic: testTopic,
  isCovered: true,
);
TrainingEvidence evidence(
  String id,
  TrainingEvidenceType type, {
  bool uploaded = true,
}) => TrainingEvidence(
  id: id,
  trainingSessionId: 'session',
  trainingSessionTopicId: type == TrainingEvidenceType.topicPhoto
      ? topic.id
      : null,
  evidenceType: type,
  fileName: '$id.png',
  mimeType: 'image/png',
  fileSize: 10,
  isUploaded: uploaded,
);

class PendingSubmit extends TrainingUiFakeRepository {
  final completion = Completer<void>();
  int submissions = 0;
  @override
  Future<TrainingSession> submit(String sessionId) async {
    submissions++;
    await completion.future;
    return remote = remote.copyWith(status: TrainingSessionStatus.submitted);
  }
}

void main() {
  for (final failure in [
    'missing proof',
    'pending photo',
    'version 1',
    'success',
  ]) {
    testWidgets('single-page MEPC submission: $failure', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repo = TrainingUiFakeRepository();
      final files = [
        evidence(
          'photo',
          TrainingEvidenceType.topicPhoto,
          uploaded: failure != 'pending photo',
        ),
        if (failure != 'missing proof')
          evidence('proof', TrainingEvidenceType.additionalDocument),
      ];
      final c = uiController(repo, topics: [topic], evidence: files)
        ..selectedCategory = category;
      repo.remote = TrainingSession(
        id: 'session',
        status: TrainingSessionStatus.draft,
        category: category,
        trainingType: testType,
        trainerName: 'Synthetic FO',
        storeId: 'store',
        completionPolicyVersion: failure == 'version 1' ? 1 : 2,
        requireAttendeeSnapshot: false,
        requireSelectedTopicSnapshot: true,
        topicEvidencePolicySnapshot: 'required',
        selectedTopics: [topic],
        evidence: files,
      );
      c.session = repo.remote;
      await tester.pumpWidget(
        MaterialApp(home: MepcTrainingScreen(controller: c)),
      );
      expect(find.text('MEPC Training'), findsOneWidget);
      expect(find.text('Next'), findsNothing);
      await tester.ensureVisible(find.text('Submit'));
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(repo.submitted, failure == 'success');
      if (failure == 'success') expect(find.text('Submit'), findsNothing);
    });
  }
  testWidgets(
    'rapid MEPC submission serializes requests and locks successful history',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1000, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repo = PendingSubmit(),
          files = [
            evidence('photo', TrainingEvidenceType.topicPhoto),
            evidence('proof', TrainingEvidenceType.additionalDocument),
          ];
      final c = uiController(repo, topics: [topic], evidence: files)
        ..selectedCategory = category;
      repo.remote = TrainingSession(
        id: 'session',
        status: TrainingSessionStatus.draft,
        category: category,
        trainingType: testType,
        trainerName: 'Synthetic FO',
        storeId: 'store',
        completionPolicyVersion: 2,
        requireAttendeeSnapshot: false,
        topicEvidencePolicySnapshot: 'required',
        selectedTopics: [topic],
        evidence: files,
      );
      c.session = repo.remote;
      await tester.pumpWidget(
        MaterialApp(home: MepcTrainingScreen(controller: c)),
      );
      await tester.ensureVisible(find.text('Submit'));
      await tester.tap(find.text('Submit'));
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Submit'));
      await tester.pump(const Duration(milliseconds: 200));
      expect(repo.submissions, 1);
      repo.completion.complete();
      await tester.pumpAndSettle();
      expect(find.text('Submit'), findsNothing);
    },
  );
  test(
    'new and policy-2 MEPC use single-page; historical policy 1 remains on its original flow',
    () {
      final c = uiController(TrainingUiFakeRepository())
        ..selectedCategory = category;
      expect(usesMepcSinglePage(c), isFalse);
      c.session = null;
      expect(usesMepcSinglePage(c), isTrue);
    },
  );
  testWidgets(
    'MEPC review screenshots use the existing 15 topic names and synthetic identity',
    (tester) async {
      tester.view.physicalSize = const Size(430, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(() async {
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
        final fonts = root.resolve('../../bin/cache/artifacts/material_fonts/');
        for (final pair in [
          ['TrainingReview', 'roboto-regular.ttf'],
          ['MaterialIcons', 'materialicons-regular.otf'],
        ]) {
          final bytes = File.fromUri(fonts.resolve(pair[1])).readAsBytesSync();
          await (FontLoader(
            pair[0],
          )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
        }
      });
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
      final c = uiController(TrainingUiFakeRepository())
        ..session = null
        ..selectedCategory = category
        ..trainerName = 'Sample FO (synthetic)'
        ..trainingDate = TrainingFlowController.indiaDate()
        ..selectedStore = {
          'id': 'sample',
          'store_code': 'SYN-MEPC-01',
          'store_name': 'Sample Retail Store (synthetic)',
        }
        ..topics = matches
            .map(
              (m) => TrainingTopic(
                id: m.group(1)!,
                categoryId: category.id,
                code: m.group(1)!,
                moduleName: m.group(2)!,
                topicDescription: 'Existing master topic',
              ),
            )
            .toList();
      final capture = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(fontFamily: 'TrainingReview'),
          home: RepaintBoundary(
            key: capture,
            child: MepcTrainingScreen(controller: c),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final folder = Directory(
        Platform.environment['TRAINING_UI_SCREENSHOT_DIR'] ??
            '../.phase4-test-output/screenshots',
      );
      Future<void> shot(String name) async {
        final boundary =
            capture.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await folder.create(recursive: true);
          await File(
            '${folder.path}/$name',
          ).writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }

      await shot('mepc-mobile-top.png');
      await tester.scrollUntilVisible(
        find.text('Choose completion proof'),
        500,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await shot('mepc-mobile-proof.png');
      expect(tester.takeException(), isNull);
    },
  );
}
