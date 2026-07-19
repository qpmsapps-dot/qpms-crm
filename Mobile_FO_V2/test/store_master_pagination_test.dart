import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/local_store.dart';
import 'package:myqpms_fo_v2/services/supabase_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> storeRow(int index, {String? id, String? storeCode}) {
  return {
    'id': id ?? 'store-${index.toString().padLeft(4, '0')}',
    'store_name': 'Store $index',
    'client_name': 'Client $index',
    'store_code': storeCode ?? 'S$index',
    'state': 'KA',
    'business': 'Standalone',
    'latitude': 15.4508028,
    'longitude': 75.0107111,
    'gps_accuracy': 22.08,
  };
}

void main() {
  group('Store Master pagination', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('loads 500 then 218 rows and includes A364 beyond page one', () async {
      final sourceRows = List.generate(
        718,
        (index) => storeRow(index, storeCode: index == 600 ? 'A364' : null),
      );
      final requestedRanges = <(int, int)>[];

      final stores = await SupabaseService.collectStorePages(
        loadPage: (from, to) async {
          requestedRanges.add((from, to));
          final endExclusive = (to + 1).clamp(0, sourceRows.length);
          if (from >= sourceRows.length) return [];
          return sourceRows.sublist(from, endExclusive);
        },
      );

      expect(requestedRanges, [(0, 499), (500, 999)]);
      expect(stores, hasLength(718));
      expect(stores.first.id, 'store-0000');
      expect(stores.last.id, 'store-0717');
      expect(stores.any((store) => store.storeCode == 'A364'), isTrue);
    });

    test('deduplicates Store IDs across pages without reordering', () async {
      final pages = [
        [storeRow(0), storeRow(1), storeRow(2)],
        [storeRow(2), storeRow(3)],
      ];
      var page = 0;

      final stores = await SupabaseService.collectStorePages(
        pageSize: 3,
        loadPage: (_, _) async => pages[page++],
      );

      expect(stores.map((store) => store.id), [
        'store-0000',
        'store-0001',
        'store-0002',
        'store-0003',
      ]);
    });

    test(
      'requests an empty trailing page for an exact page multiple',
      () async {
        final pages = [
          [storeRow(0), storeRow(1)],
          [storeRow(2), storeRow(3)],
          <Map<String, dynamic>>[],
        ];
        var page = 0;

        final stores = await SupabaseService.collectStorePages(
          pageSize: 2,
          loadPage: (_, _) async => pages[page++],
        );

        expect(page, 3);
        expect(stores, hasLength(4));
      },
    );

    test('safety guard prevents an infinite sequence of full pages', () async {
      var requests = 0;

      final future = SupabaseService.collectStorePages(
        pageSize: 2,
        maxPages: 3,
        loadPage: (from, _) async {
          requests += 1;
          return [storeRow(from), storeRow(from + 1)];
        },
      );

      await expectLater(future, throwsStateError);
      expect(requests, 3);
    });

    test(
      'surfaces a later page failure instead of returning partial rows',
      () async {
        var requests = 0;

        final future = SupabaseService.collectStorePages(
          pageSize: 2,
          loadPage: (_, _) async {
            requests += 1;
            if (requests == 2) throw StateError('page request failed');
            return [storeRow(0), storeRow(1)];
          },
        );

        await expectLater(future, throwsA(isA<StateError>()));
        expect(requests, 2);
      },
    );

    test('production query retains active and non-null GPS filters', () {
      final source = File(
        'lib/services/supabase_service.dart',
      ).readAsStringSync();

      expect(source, contains(".not('latitude', 'is', null)"));
      expect(source, contains(".not('longitude', 'is', null)"));
      expect(source, contains(".eq('status', 'Active')"));
      expect(source, contains(".order('id', ascending: true)"));
      expect(source, contains('.range(from, to)'));
    });

    test('existing Store.fromJson parsing remains valid', () {
      final store = Store.fromJson(storeRow(600, storeCode: 'A364'));

      expect(store.id, 'store-0600');
      expect(store.storeCode, 'A364');
      expect(store.storeName, 'Store 600');
      expect(store.business, 'Standalone');
      expect(store.latitude, 15.4508028);
      expect(store.longitude, 75.0107111);
    });

    test('local Store Master cache preserves Store fields', () async {
      final stores = [
        Store.fromJson(storeRow(1, storeCode: 'A001')),
        Store.fromJson(storeRow(2, storeCode: 'A002')),
      ];

      await LocalStore.saveStoresWithGpsCache(stores);

      final cached = await LocalStore.getStoresWithGpsCache();
      final savedAt = await LocalStore.getStoresWithGpsCacheSavedAt();

      expect(cached.map((store) => store.storeCode), ['A001', 'A002']);
      expect(cached.first.latitude, 15.4508028);
      expect(savedAt, isNotNull);
    });

    test('remote failure preserves previous Store Master cache', () async {
      final cachedStore = Store.fromJson(storeRow(3, storeCode: 'A003'));
      await LocalStore.saveStoresWithGpsCache([cachedStore]);

      final stores = await SupabaseService.fetchStoresWithGps(
        forceRefresh: true,
      );

      expect(stores, hasLength(1));
      expect(stores.single.storeCode, 'A003');
    });
  });

  group('Store duplicate error handling', () {
    test('maps PostgreSQL 23505 to a friendly Store Code message', () {
      final message = SupabaseService.storeCreateErrorMessage(
        code: '23505',
        message: 'duplicate key value',
        storeCode: ' A364 ',
      );

      expect(
        message,
        'Store A364 already exists. Please close Add Site and use Check-In to Site.',
      );
    });

    test('maps HTTP-style 409 to a friendly Store Code message', () {
      final message = SupabaseService.storeCreateErrorMessage(
        code: '409',
        message: 'Conflict',
        storeCode: 'a364',
      );

      expect(message, startsWith('Store A364 already exists.'));
    });

    test('recognizes duplicate-key evidence without a usable code', () {
      final message = SupabaseService.storeCreateErrorMessage(
        message: 'duplicate key value violates unique constraint',
        storeCode: ' A364 ',
      );

      expect(message, startsWith('Store A364 already exists.'));
      expect(message, isNot(contains('constraint')));
    });

    test('preserves generic handling for an unrelated error', () {
      final message = SupabaseService.storeCreateErrorMessage(
        code: 'PGRST301',
        message: 'Unrelated failure',
        storeCode: 'A364',
      );

      expect(
        message,
        'Store could not be saved (error PGRST301). Please retry or contact support.',
      );
    });
  });

  test('the existing 100-metre nearby comparison remains unchanged', () {
    final source = File('lib/tasks/tasks_screen.dart').readAsStringSync();
    expect(source, contains('match.distanceMeters <= 100'));
    expect(source, contains('if (distance > 100) continue;'));
  });

  test('activity images are resized before upload format is preserved', () {
    final source = File('lib/tasks/tasks_screen.dart').readAsStringSync();

    expect(source, contains('maxWidth: _activityImageMaxDimension'));
    expect(source, contains('maxHeight: _activityImageMaxDimension'));
    expect(source, contains('_imageContentType(extension)'));
  });

  test('duplicate activity submit calls are ignored while submitting', () {
    final source = File('lib/tasks/tasks_screen.dart').readAsStringSync();

    expect(source, contains('if (_submitting) return;'));
    expect(source, contains('onPressed: _submitting ? null : _submitActivity'));
  });

  test('non-critical crash logging uses a non-blocking path', () {
    final source = File(
      'lib/services/crash_log_service.dart',
    ).readAsStringSync();

    expect(source, contains('unawaited('));
    expect(source, contains('_isImmediateAction(action)'));
  });
}
