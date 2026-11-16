import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_errors.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/state/training_flow_controller.dart';
import 'package:myqpms_fo_v2/training/widgets/training_store_picker.dart';

import 'training_flow_controller_test.dart' show FakeRepository, category, type;

class StoreRepository extends FakeRepository {
  final offsets = <int>[];
  @override
  Future<List<Map<String, dynamic>>> getZones({
    required String categoryCode,
  }) async => [
    {'id': 'zone', 'zone_name': 'KA Zone'},
  ];
  @override
  Future<Map<String, dynamic>> searchStores({
    required String categoryCode,
    String? zoneId,
    bool supervisorOnly = false,
    String query = '',
    int offset = 0,
  }) async {
    offsets.add(offset);
    return {
      'stores': [
        {
          'id': 'retail-$offset',
          'store_name': 'Training $offset',
          'store_code': 'R$offset',
          'state': 'KA',
        },
      ],
      'has_more': offset == 0,
    };
  }
}

class StateStoreRepository extends StoreRepository {
  @override
  Future<List<Map<String, dynamic>>> getZones({
    required String categoryCode,
  }) async => [];
  @override
  Future<Map<String, dynamic>> searchStores({
    required String categoryCode,
    String? zoneId,
    bool supervisorOnly = false,
    String query = '',
    int offset = 0,
  }) async => {
    'stores': [
      {
        'id': 'ap',
        'store_name': 'Authorized AP Store',
        'store_code': 'AP-TEST',
        'state': 'AP-2',
      },
    ],
    'zone_required': false,
    'has_more': false,
  };
}

class CaptureTransport implements TrainingTransport {
  Map<String, String>? query;
  Map<String, dynamic>? body;
  @override
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    this.query = query;
    this.body = body;
    return const TrainingHttpResponse(200, {
      'sessions': [],
      'session': {'id': 'session', 'status': 'draft', 'can_edit': true},
    });
  }

  @override
  Future<void> upload(
    String signedUrl,
    Uint8List bytes,
    String mimeType,
  ) async {}
}

const technicalCategory = TrainingCategory(
  id: 'technical',
  code: 'technical_mep',
  name: 'Technical',
);

class CategoryStoreRepository extends StoreRepository {
  final zoneRequests = <String>[];
  final storeRequests =
      <({String category, bool supervisor, String query, int offset})>[];
  final delayedZones = <String, Completer<List<Map<String, dynamic>>>>{};
  final delayedStores = <String, Completer<Map<String, dynamic>>>{};

  @override
  Future<List<Map<String, dynamic>>> getZones({
    required String categoryCode,
  }) async {
    zoneRequests.add(categoryCode);
    return delayedZones[categoryCode]?.future ??
        [
          {'id': '$categoryCode-zone', 'zone_name': '$categoryCode Zone'},
        ];
  }

  @override
  Future<Map<String, dynamic>> searchStores({
    required String categoryCode,
    String? zoneId,
    bool supervisorOnly = false,
    String query = '',
    int offset = 0,
  }) async {
    storeRequests.add((
      category: categoryCode,
      supervisor: supervisorOnly,
      query: query,
      offset: offset,
    ));
    return delayedStores[categoryCode]?.future ??
        {
          'stores': [
            {
              'id': categoryCode,
              'store_name': '$categoryCode Store',
              'store_code': 'R',
              'state': 'KA',
            },
          ],
          'has_more': true,
        };
  }
}

Future<void> chooseZone(WidgetTester tester, String name) async {
  await tester.tap(find.byType(DropdownButtonFormField<String>));
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'state-scoped Training opens null-Zone stores and enables search',
    (tester) async {
      final controller = TrainingFlowController(
        repository: StateStoreRepository(),
      )..selectCategory(category);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TrainingStorePicker(controller: controller)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Authorized AP Store'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      final search = tester.widget<TextButton>(
        find.widgetWithText(TextButton, 'Search'),
      );
      expect(search.onPressed, isNotNull);
      expect(
        find.text('No active zone assignment. Contact your administrator.'),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
    },
  );
  test(
    'controller does not silently request HK zones without a selected category',
    () async {
      final repository = CategoryStoreRepository();
      final controller = TrainingFlowController(repository: repository);
      expect(await controller.getZones(), isEmpty);
      expect(repository.zoneRequests, isEmpty);
      controller.selectCategory(category);
      await controller.getZones();
      controller.selectCategory(technicalCategory);
      await controller.getZones();
      expect(repository.zoneRequests, ['hk', 'technical_mep']);
      controller.dispose();
    },
  );

  testWidgets(
    'category switches refresh zones and clear stores, search, pagination and supervisor mode',
    (tester) async {
      final repository = CategoryStoreRepository();
      final controller = TrainingFlowController(repository: repository)
        ..selectCategory(category);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TrainingStorePicker(controller: controller)),
        ),
      );
      await tester.pumpAndSettle();
      await chooseZone(tester, 'hk Zone');
      expect(find.text('hk Store'), findsOneWidget);
      controller.selectStore({'id': 'old-store'});
      await tester.enterText(find.byType(TextField), 'old search');
      controller.selectCategory(technicalCategory);
      await tester.pumpAndSettle();
      expect(controller.retailStoreId, isNull);
      expect(repository.zoneRequests, ['hk', 'technical_mep']);
      expect(find.text('hk Store'), findsNothing);
      expect(find.text('Load more'), findsNothing);
      expect(find.text('old search'), findsNothing);
      expect(
        tester
            .widget<DropdownButtonFormField<String>>(
              find.byType(DropdownButtonFormField<String>),
            )
            .initialValue,
        isNull,
      );
      await chooseZone(tester, 'technical_mep Zone');
      expect(find.text('technical_mep Store'), findsOneWidget);
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      expect(repository.storeRequests.last.supervisor, isTrue);
      controller.selectCategory(category);
      await tester.pumpAndSettle();
      expect(find.byType(SwitchListTile), findsNothing);
      expect(find.text('technical_mep Store'), findsNothing);
      await chooseZone(tester, 'hk Zone');
      expect(repository.storeRequests.last, (
        category: 'hk',
        supervisor: false,
        query: '',
        offset: 0,
      ));
      expect(repository.zoneRequests, ['hk', 'technical_mep', 'hk']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('late zone response cannot replace the new category zones', (
    tester,
  ) async {
    final repository = CategoryStoreRepository();
    final pending = Completer<List<Map<String, dynamic>>>();
    repository.delayedZones['hk'] = pending;
    final controller = TrainingFlowController(repository: repository)
      ..selectCategory(category);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: TrainingStorePicker(controller: controller)),
      ),
    );
    controller.selectCategory(technicalCategory);
    await tester.pumpAndSettle();
    pending.complete([
      {'id': 'old-zone', 'zone_name': 'Stale HK Zone'},
    ]);
    await tester.pumpAndSettle();
    await chooseZone(tester, 'technical_mep Zone');
    expect(find.text('Stale HK Zone'), findsNothing);
    expect(find.text('technical_mep Store'), findsOneWidget);
  });

  testWidgets(
    'late store response cannot restore stores from the previous category',
    (tester) async {
      final repository = CategoryStoreRepository();
      final pending = Completer<Map<String, dynamic>>();
      repository.delayedStores['hk'] = pending;
      final controller = TrainingFlowController(repository: repository)
        ..selectCategory(category);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TrainingStorePicker(controller: controller)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('hk Zone').last);
      await tester.pump();
      controller.selectCategory(technicalCategory);
      await tester.pumpAndSettle();
      await chooseZone(tester, 'technical_mep Zone');
      pending.complete({
        'stores': [
          {
            'id': 'old',
            'store_name': 'Stale HK Store',
            'store_code': 'OLD',
            'state': 'KA',
          },
        ],
        'has_more': true,
      });
      await tester.pumpAndSettle();
      expect(find.text('Stale HK Store'), findsNothing);
      expect(find.text('technical_mep Store'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  test('IST date changes at 18:30 UTC, independently of device timezone', () {
    expect(
      TrainingFlowController.indiaDate(DateTime.parse('2026-10-19T18:29:59Z')),
      DateTime(2026, 10, 19),
    );
    expect(
      TrainingFlowController.indiaDate(DateTime.parse('2026-10-19T18:30:00Z')),
      DateTime(2026, 10, 20),
    );
  });

  test(
    'new draft requires independent store selection and date editing is ignored',
    () async {
      final repository = FakeRepository();
      final controller = TrainingFlowController(repository: repository);
      await controller.initializeNew(
        attendanceId: 'a',
        siteVisitId: 'v',
        trainerName: 'Trainer',
      );
      controller.selectCategory(category);
      controller.selectTrainingType(type);
      expect(controller.canContinueDetails, false);
      final date = controller.trainingDate;
      controller.setDetails(date: DateTime(2000));
      expect(controller.trainingDate, date);
      controller.selectStore({
        'id': 'independent',
        'store_name': 'Selected Store',
      });
      expect(controller.retailStoreId, 'independent');
      expect(controller.canContinueDetails, true);
      await controller.saveDraft();
      expect(repository.creates, 1);
    },
  );

  test(
    'HK can continue without participants even with an old mandatory snapshot',
    () async {
      final controller = TrainingFlowController(repository: FakeRepository());
      await controller.resume('s');
      expect(controller.session!.requireAttendeeSnapshot, true);
      expect(controller.attendees, isEmpty);
      expect(controller.canContinueAttendees, true);
      controller.selectCategory(
        const TrainingCategory(
          id: 'technical',
          code: 'technical_mep',
          name: 'Technical',
          requireAttendee: true,
        ),
      );
      expect(controller.canContinueAttendees, false);
    },
  );

  test(
    'Check-Out or End Day blocks local editing actions and submission without a write',
    () async {
      final repository = FakeRepository();
      final controller = TrainingFlowController(
        repository: repository,
        activeContextCheck: () async => false,
      );
      await controller.resume('s');
      final original = controller.trainingDate;
      await expectLater(
        controller.submit(),
        throwsA(isA<TrainingConflictException>()),
      );
      expect(controller.isEditable, false);
      expect(controller.trainingDate, original);
      expect(repository.creates, 0);
    },
  );

  test(
    'server can_edit false makes a resumed draft read-only; missing capability fails closed',
    () {
      expect(
        TrainingSession.fromJson({
          'session': {'id': 's', 'status': 'draft', 'can_edit': false},
        }).isEditable,
        false,
      );
      expect(
        TrainingSession.fromJson({
          'session': {'id': 's', 'status': 'draft'},
        }).isEditable,
        false,
      );
    },
  );

  test(
    'history query identifies the server visit and creation carries an independent retail ID',
    () async {
      final transport = CaptureTransport();
      final api = TrainingApi(
        user: const FoUser(
          authUserId: 'fo',
          mobile: '',
          email: '',
          state: 'KA',
          employeeCode: 'FO1',
          fullName: 'FO',
          role: 'FO',
        ),
        transport: transport,
      );
      await api.getSessions(mine: true, siteVisitId: 'visit');
      expect(transport.query!['site_visit_id'], 'visit');
      await api.createSession(
        attendanceId: 'day',
        siteVisitId: 'visit',
        categoryId: 'hk',
        trainingTypeId: 'type',
        trainingDate: DateTime(2026, 10, 20),
        trainerName: 'FO',
        retailStoreId: 'independent',
      );
      expect(transport.body!['retail_store_id'], 'independent');
      expect(transport.body!.containsKey('store_id'), false);
    },
  );

  testWidgets(
    'zone store picker loads the next page without dropping the previous one',
    (tester) async {
      final repository = StoreRepository();
      final controller = TrainingFlowController(repository: repository);
      await controller.initializeNew(
        attendanceId: 'day',
        siteVisitId: 'visit',
        trainerName: 'Trainer',
      );
      controller.selectCategory(category);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TrainingStorePicker(controller: controller)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('KA Zone').last);
      await tester.pumpAndSettle();
      expect(find.text('Training 0'), findsOneWidget);
      await tester.tap(find.text('Load more'));
      await tester.pumpAndSettle();
      expect(repository.offsets, [0, 1]);
      expect(find.text('Training 0'), findsOneWidget);
      expect(find.text('Training 1'), findsOneWidget);
    },
  );
}
