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

  test(
    'Check-In keeps a 100-metre default radius with matcher enforcement',
    () {
      final matcherSource = File(
        'lib/services/checkin_store_matcher.dart',
      ).readAsStringSync();
      final screenSource = File(
        'lib/tasks/tasks_screen.dart',
      ).readAsStringSync();

      expect(matcherSource, contains('defaultCheckInRadiusMeters = 100'));
      expect(
        matcherSource,
        contains('distance <= defaultCheckInRadiusMeters + 0.001'),
      );
      expect(screenSource, contains('_loadNearbyStoresForCheckIn'));
      expect(screenSource, contains('if (distance > 100) continue;'));
    },
  );

  test('activity images are resized before upload format is preserved', () {
    final source = File('lib/tasks/tasks_screen.dart').readAsStringSync();

    expect(source, contains('maxWidth: _activityImageMaxDimension'));
    expect(source, contains('maxHeight: _activityImageMaxDimension'));
    expect(source, contains('contentTypeForExtension(extension)'));
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

  group('Activity upload Phase 2A safeguards', () {
    late String source;

    setUp(() {
      source = File('lib/tasks/tasks_screen.dart').readAsStringSync();
    });

    test('builds an upload plan before reading bytes', () {
      expect(source, contains('List<_ActivityUploadSource>'));
      expect(
        source,
        contains('final uploadSources = _activityUploadSources()'),
      );
      expect(source, isNot(contains('Future<List<_ActivityUploadItem>>')));
    });

    test('captures GPS and saves activity before preparing image bytes', () {
      final gps = source.indexOf("step: 'gps_capture'");
      final submission = source.indexOf("step: 'submission_create'");
      final prepare = source.indexOf("step: 'image_prepare'", gps + 1);

      expect(gps, greaterThan(-1));
      expect(submission, greaterThan(gps));
      expect(prepare, greaterThan(submission));
    });

    test('tracks completed uploads and skips them on retry', () {
      expect(source, contains('final Set<String> _completedUploadKeys'));
      expect(source, contains('!_completedUploadKeys.contains(source.key)'));
      expect(source, contains('_completedUploadKeys.add(source.key)'));
    });

    test('marks upload complete only after attachment row creation', () {
      final link = source.indexOf('SupabaseService.createActivityUpload');
      final complete = source.indexOf('_completedUploadKeys.add(source.key)');

      expect(link, greaterThan(-1));
      expect(complete, greaterThan(link));
    });

    test('releases image bytes after success and failure', () {
      expect(
        RegExp(r'item\.releaseBytes\(\);').allMatches(source),
        hasLength(2),
      );
    });

    test('blocks navigation and duplicate submit while submitting', () {
      expect(source, contains('PopScope('));
      expect(source, contains('canPop: !_submitting'));
      expect(source, contains('if (_submitting) return;'));
      expect(
        source,
        contains('onPressed: _submitting ? null : _submitActivity'),
      );
    });
  });
}
