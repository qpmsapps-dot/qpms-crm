import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/training_launcher.dart';

TrainingDraftRecord draft({String? sessionId = 'session-1'}) =>
    TrainingDraftRecord(
      cacheId: 'attendance:visit',
      sessionId: sessionId,
      attendanceId: 'attendance',
      siteVisitId: 'visit',
      trainingDate: DateTime(2026, 9, 29),
      trainerName: 'Trainer',
    );

TrainingLaunchMode route({
  required String role,
  String? business = 'Reliance Retail',
  String? clientName,
  String? storeName,
  bool current = true,
  TrainingDraftRecord? localDraft,
}) => resolveTrainingLaunchMode(
  role: role,
  business: business,
  clientName: clientName,
  storeName: storeName,
  contextAllowsNew: current,
  localDraft: localDraft,
);

void main() {
  group('structured Training routing matrix', () {
    test('Reliance FO with an active context opens structured new flow', () {
      expect(route(role: 'FO'), TrainingLaunchMode.structuredNew);
      expect(route(role: 'Field Officer'), TrainingLaunchMode.structuredNew);
    });

    test('Reliance Operations Manager aliases open structured flow', () {
      expect(
        route(role: 'Operations Manager'),
        TrainingLaunchMode.structuredNew,
      );
      expect(route(role: 'OM'), TrainingLaunchMode.structuredNew);
    });

    test('Reliance Admin opens structured flow for controlled testing', () {
      expect(route(role: 'Admin'), TrainingLaunchMode.structuredNew);
    });

    test('Reliance roles outside FO, OM, and Admin stay on legacy', () {
      for (final role in [
        'Branch Head',
        'KAM',
        'GM',
        'Management',
        'Unknown',
      ]) {
        expect(route(role: role), TrainingLaunchMode.legacy, reason: role);
      }
    });

    test('non-Reliance FO and Operations Manager stay on legacy', () {
      expect(route(role: 'FO', business: 'DME'), TrainingLaunchMode.legacy);
      expect(
        route(role: 'Operations Manager', business: 'Airport'),
        TrainingLaunchMode.legacy,
      );
      expect(route(role: 'Admin', business: 'DME'), TrainingLaunchMode.legacy);
    });

    test('established Reliance store representations normalize safely', () {
      expect(
        isRelianceStructuredTrainingStore(business: 'Reliance Retail'),
        isTrue,
      );
      expect(isRelianceStructuredTrainingStore(business: 'Reliance'), isTrue);
      expect(
        isRelianceStructuredTrainingStore(
          business: 'Retail',
          clientName: 'Reliance',
        ),
        isTrue,
      );
      expect(
        isRelianceStructuredTrainingStore(clientName: 'Reliance Retail'),
        isTrue,
      );
      for (final banner in [
        'Trends',
        'Digital',
        'Smart',
        'Smart Bazaar',
        'Smart Point',
      ]) {
        expect(
          isRelianceStructuredTrainingStore(
            business: 'Retail',
            storeName: '$banner 101',
          ),
          isTrue,
          reason: banner,
        );
      }
    });

    test('profile/display text cannot mark a non-Reliance store eligible', () {
      expect(
        route(
          role: 'FO',
          business: 'DME',
          clientName: 'Government Hospital',
          storeName: 'District Medical Store',
        ),
        TrainingLaunchMode.legacy,
      );
    });

    test('historical visit resumes only a matching cached server draft', () {
      expect(
        route(role: 'FO', current: false, localDraft: draft()),
        TrainingLaunchMode.structuredResume,
      );
      expect(route(role: 'FO', current: false), TrainingLaunchMode.legacy);
      expect(
        route(role: 'FO', current: false, localDraft: draft(sessionId: null)),
        TrainingLaunchMode.legacy,
      );
    });

    test('cached server draft wins over new-session routing', () {
      expect(
        route(role: 'Operations Manager', localDraft: draft()),
        TrainingLaunchMode.structuredResume,
      );
    });
  });

  group('Tasks and Recent Visits launcher contracts', () {
    late String tasks;
    late String visits;

    setUpAll(() async {
      tasks = await File('lib/tasks/tasks_screen.dart').readAsString();
      visits = await File('lib/visits/visits_screen.dart').readAsString();
    });

    test('Tasks keeps one Training card and delegates to central launcher', () {
      final activitySection = tasks.substring(
        tasks.indexOf('Widget _activitySection()'),
        tasks.indexOf('Widget _activityCard('),
      );
      expect(
        RegExp("title: 'Training'").allMatches(activitySection),
        hasLength(1),
      );
      expect(tasks, contains(': _openTraining,'));
      expect(tasks, contains('TrainingLauncher.openTrainingFlow('));
      expect(tasks, contains('historical: false'));
      expect(tasks, contains('type: FoActivityType.training'));
    });

    test('Admin module Training delegates through the central launcher', () {
      final homeShell = File('lib/home/home_shell.dart').readAsStringSync();
      expect(homeShell, contains('type == FoActivityType.training'));
      expect(homeShell, contains('TrainingLauncher.openTrainingFlow('));
      expect(homeShell, contains('historical: false'));
      expect(homeShell, contains('legacyBuilder: (_) => ActivityFormScreen('));
    });

    test('Inspection and Deep Cleaning Tasks routes remain unchanged', () {
      expect(tasks, contains('_openActivity(FoActivityType.inspection)'));
      expect(tasks, contains('_openActivity(FoActivityType.deepCleaning)'));
    });

    test('Recent Visits delegates Training and preserves legacy fallback', () {
      expect(visits, contains('_openTrainingFromVisit(context, visit)'));
      expect(visits, contains('TrainingLauncher.openTrainingFlow('));
      expect(visits, contains('historical: true'));
      expect(visits, contains('requireActiveVisit: false'));
      expect(visits, contains('type: FoActivityType.training'));
    });

    test('Recent Visits Inspection and Deep Cleaning remain unchanged', () {
      expect(visits, contains('FoActivityType.inspection'));
      expect(visits, contains('FoActivityType.deepCleaning'));
    });

    test(
      'launcher creates no server session before controller initialization',
      () {
        final launcher = File(
          'lib/training/training_launcher.dart',
        ).readAsStringSync();
        expect(launcher, contains('initializeNew('));
        expect(launcher, isNot(contains('createSession(')));
      },
    );
  });
}
