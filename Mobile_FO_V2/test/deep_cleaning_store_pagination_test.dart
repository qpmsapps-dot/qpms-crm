import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_form_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_service.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

const _zones = [
  DeepCleaningZone(id: 'zone-1', code: 'ZONE-1', name: 'Zone 1'),
  DeepCleaningZone(id: 'zone-2', code: 'ZONE-2', name: 'Zone 2'),
];

RelianceDeepCleaningStore _store(int number, {String zoneId = 'zone-1'}) {
  final code = 'RR${number.toString().padLeft(2, '0')}';
  return RelianceDeepCleaningStore(
    id: '$zoneId-$code',
    storeCode: code,
    storeName: 'Store $number',
    clientName: 'Reliance Retail',
    state: 'TN',
    business: 'Reliance Retail',
    zoneId: zoneId,
  );
}

RelianceDeepCleaningStoreResult _page(
  List<RelianceDeepCleaningStore> rows, {
  required int page,
  required int total,
}) => RelianceDeepCleaningStoreResult(
  rows: rows,
  zones: _zones,
  page: page,
  limit: 20,
  total: total,
);

class _FakeStoreService extends DeepCleaningService {
  final calls = <({String query, String? zoneId, int page})>[];

  @override
  Future<RelianceDeepCleaningStoreResult> searchRelianceStores({
    String query = '',
    String? zoneId,
    int page = 1,
    int limit = 20,
  }) async {
    calls.add((query: query, zoneId: zoneId, page: page));
    final all = [for (var i = 1; i <= 32; i++) _store(i)];
    final filtered = all
        .where(
          (store) =>
              (zoneId == null || store.zoneId == zoneId) &&
              (query.isEmpty || store.storeCode.contains(query.toUpperCase())),
        )
        .toList();
    final start = (page - 1) * limit;
    return _page(
      start >= filtered.length ? [] : filtered.skip(start).take(limit).toList(),
      page: page,
      total: filtered.length,
    );
  }
}

class _StateStoreService extends DeepCleaningService {
  @override
  Future<RelianceDeepCleaningStoreResult> searchRelianceStores({
    String query = '',
    String? zoneId,
    int page = 1,
    int limit = 20,
  }) async => RelianceDeepCleaningStoreResult(
    rows: [
      RelianceDeepCleaningStore(
        id: 'ap',
        storeCode: 'AP-TEST',
        storeName: 'Authorized AP Store',
        clientName: 'Reliance Retail',
        state: 'AP-1',
      ),
    ],
    zones: const [],
    page: 1,
    limit: limit,
    total: 1,
    zoneRequired: false,
  );
}

void main() {
  testWidgets('server-authorized state store is selectable without a Zone', (
    tester,
  ) async {
    final user = FoUser.fromJson({
      'auth_user_id': 'synthetic',
      'employee_code': 'TEST_AP',
      'full_name': 'Test FO',
      'role': 'FO',
      'business': 'Reliance Retail',
      'state': 'AP',
    });
    await tester.pumpWidget(
      MaterialApp(
        home: DeepCleaningFormScreen(user: user, service: _StateStoreService()),
      ),
    );
    await tester.tap(find.text('Select').first);
    await tester.pumpAndSettle();
    expect(find.text('AP-TEST'), findsOneWidget);
    expect(
      find.text('No Zone assigned. Contact your administrator.'),
      findsNothing,
    );
    await tester.tap(find.text('AP-TEST'));
    await tester.pumpAndSettle();
    expect(find.text('AP-TEST'), findsOneWidget);
  });
  test(
    '32 authorized stores load across two pages without duplicates',
    () async {
      final service = _FakeStoreService();
      final pager = DeepCleaningStorePager(
        loadPage: ({required query, zoneId, required page, required limit}) =>
            service.searchRelianceStores(
              query: query,
              zoneId: zoneId,
              page: page,
              limit: limit,
            ),
      );
      addTearDown(pager.dispose);
      await pager.reset();
      expect(pager.stores, hasLength(20));
      expect(pager.total, 32);
      expect(pager.hasMore, isTrue);
      await pager.loadMore();
      expect(pager.stores, hasLength(32));
      expect(pager.stores.map((store) => store.id).toSet(), hasLength(32));
      expect(pager.hasMore, isFalse);
      await pager.loadMore();
      expect(service.calls.map((call) => call.page).toList(), [1, 2]);
    },
  );

  test(
    'zone switch and search clear previous pages while retaining filters',
    () async {
      final service = _FakeStoreService();
      final pager = DeepCleaningStorePager(
        loadPage: ({required query, zoneId, required page, required limit}) =>
            service.searchRelianceStores(
              query: query,
              zoneId: zoneId,
              page: page,
              limit: limit,
            ),
      );
      addTearDown(pager.dispose);
      await pager.reset(zoneId: 'zone-1');
      await pager.loadMore();
      await pager.reset(zoneId: 'zone-2');
      expect(pager.stores, isEmpty);
      expect(pager.page, 1);
      expect(pager.zoneId, 'zone-2');
      await pager.reset(query: 'RR32', zoneId: 'zone-1');
      expect(pager.stores.map((store) => store.storeCode), ['RR32']);
      expect(pager.query, 'RR32');
      expect(pager.zoneId, 'zone-1');
      expect(service.calls.map((call) => call.page), [1, 2, 1, 1]);
    },
  );

  test(
    'search and zone changes restart at page one and ignore stale results',
    () async {
      final stale = Completer<RelianceDeepCleaningStoreResult>();
      final calls = <({String query, String? zoneId, int page})>[];
      final pager = DeepCleaningStorePager(
        loadPage: ({required query, zoneId, required page, required limit}) {
          calls.add((query: query, zoneId: zoneId, page: page));
          if (query.isEmpty) return stale.future;
          return Future.value(
            _page([_store(32, zoneId: zoneId ?? 'zone-1')], page: 1, total: 1),
          );
        },
      );
      addTearDown(pager.dispose);
      final first = pager.reset(zoneId: 'zone-1');
      await pager.reset(query: 'RR32', zoneId: 'zone-2');
      stale.complete(_page([_store(1)], page: 1, total: 32));
      await first;
      expect(pager.query, 'RR32');
      expect(pager.zoneId, 'zone-2');
      expect(pager.stores.map((store) => store.id), ['zone-2-RR32']);
      expect(calls.map((call) => call.page), [1, 1]);
    },
  );

  test(
    'page failure keeps loaded stores and retries without duplicate requests',
    () async {
      final second = Completer<RelianceDeepCleaningStoreResult>();
      var calls = 0;
      final pager = DeepCleaningStorePager(
        loadPage: ({required query, zoneId, required page, required limit}) {
          calls += 1;
          if (page == 1) {
            return Future.value(
              _page(
                [for (var i = 1; i <= 20; i++) _store(i)],
                page: 1,
                total: 32,
              ),
            );
          }
          if (calls == 2) {
            return Future.error(const DeepCleaningApiException('Page failed'));
          }
          return second.future;
        },
      );
      addTearDown(pager.dispose);
      await pager.reset();
      await pager.loadMore();
      expect(pager.error, 'Page failed');
      expect(pager.stores, hasLength(20));
      await pager.loadMore();
      expect(calls, 2);
      final retry = pager.retry();
      await pager.loadMore();
      expect(calls, 3);
      second.complete(
        _page(
          [_store(20), for (var i = 21; i <= 32; i++) _store(i)],
          page: 2,
          total: 32,
        ),
      );
      await retry;
      expect(pager.error, isNull);
      expect(pager.stores, hasLength(32));
      expect(pager.stores.map((store) => store.id).toSet(), hasLength(32));
    },
  );

  test('first page failure exposes retry and recovers', () async {
    var calls = 0;
    final pager = DeepCleaningStorePager(
      loadPage: ({required query, zoneId, required page, required limit}) {
        calls += 1;
        if (calls == 1) {
          return Future.error(const DeepCleaningApiException('Offline'));
        }
        return Future.value(_page([_store(1)], page: 1, total: 1));
      },
    );
    addTearDown(pager.dispose);
    await pager.reset();
    expect(pager.error, 'Offline');
    expect(pager.stores, isEmpty);
    await pager.retry();
    expect(pager.stores, hasLength(1));
    expect(pager.error, isNull);
  });

  testWidgets('scrolling the picker requests page two automatically', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final service = _FakeStoreService();
    final user = FoUser.fromJson({
      'id': 'profile-1',
      'auth_user_id': 'auth-1',
      'employee_code': 'QPMSTN10465',
      'full_name': 'Retail FO',
      'role': 'FO',
      'business': 'Reliance Retail',
    });
    await tester.pumpWidget(
      MaterialApp(
        home: DeepCleaningFormScreen(user: user, service: service),
      ),
    );
    await tester.tap(find.text('Select').first);
    await tester.pumpAndSettle();
    expect(service.calls.map((call) => call.page), [1]);
    await tester.drag(find.byType(ListView).last, const Offset(0, -1200));
    await tester.pumpAndSettle();
    expect(service.calls.map((call) => call.page), [1, 2]);
    await tester.scrollUntilVisible(
      find.text('RR32'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('RR32'), findsOneWidget);
    await tester.tap(find.text('RR32'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'RR01');
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pumpAndSettle();
    Navigator.of(tester.element(find.text('Select Store'))).pop();
    await tester.pumpAndSettle();
    expect(find.text('RR32'), findsOneWidget);
  });
}
