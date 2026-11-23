import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/services/crash_log_dispatcher.dart';
import 'package:myqpms_fo_v2/services/crash_log_outbox.dart';
import 'package:myqpms_fo_v2/services/crash_log_policy.dart';
import 'package:myqpms_fo_v2/services/crash_log_upload.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:sqflite/sqflite.dart' show Sqflite;
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  // Real disposable SQLite and loopback HTTP only; no widget network overrides.
  sqfliteFfiInit();
  late CrashLogOutbox outbox;
  late CrashLogDispatcher dispatcher;
  late DateTime now;
  late bool ready;
  late List<Map<String, dynamic>> uploads;

  setUp(() async {
    outbox = await CrashLogOutbox.open(
      factory: databaseFactoryFfi,
      databasePath: inMemoryDatabasePath,
    );
    now = DateTime.utc(2026, 11, 23);
    ready = false;
    uploads = [];
    dispatcher = CrashLogDispatcher(
      openOutbox: () async => outbox,
      upload: (row) async {
        uploads.add(row);
      },
      isReady: () => ready,
      resolveEmployee: () async => 'SYNTHETIC-FO',
      clock: () => now,
    );
  });
  tearDown(() async {
    ready = false;
    await dispatcher.sync();
    await outbox.database.close();
  });

  test(
    'routine diagnostics and 30,000 GPS rejections never touch persistence or Supabase',
    () async {
      final diagnostic = CrashLogDispatcher(
        openOutbox: () => throw StateError('Diagnostics must not open SQLite'),
        upload: (_) => throw StateError('Diagnostics must not upload'),
        isReady: () =>
            throw StateError('Diagnostics must not inspect network state'),
        resolveEmployee: () =>
            throw StateError('Diagnostics must not read preferences'),
        clock: () => now,
      );
      for (final action in CrashLogPolicy.diagnostics) {
        await diagnostic.record(
          screen: 'tracking',
          action: action,
          error: 'routine detail',
        );
      }
      for (final action in CrashLogPolicy.rejections) {
        for (var n = 0; n < 10000; n++) {
          await diagnostic.record(
            screen: 'tracking',
            action: action,
            error: 'segment_m=$n',
          );
        }
      }
      for (var n = 0; n < 100; n++) {
        await diagnostic.record(
          screen: 'tracking',
          action: 'OTHER_DIAGNOSTIC_$n',
          level: CrashLogLevel.diagnostic,
        );
      }
      expect(diagnostic.diagnosticSummaries.length, lessThanOrEqualTo(32));
      for (final action in CrashLogPolicy.rejections) {
        expect(diagnostic.diagnosticSummaries[action]!['count'], 10000);
      }
      expect(uploads, isEmpty);
    },
  );

  test(
    'GPS and tracking failures cannot be demoted; unknown events remain errors',
    () {
      for (final action in [
        'GPS_FETCH_FAILED',
        'TRACKING_SYNC_ERROR',
        'BACKGROUND_SERVICE_DISABLED',
        'DATABASE_EXCEPTION',
      ]) {
        expect(
          CrashLogPolicy.classify(action, level: CrashLogLevel.diagnostic),
          CrashLogLevel.error,
        );
      }
      for (final action in CrashLogPolicy.diagnostics) {
        expect(
          CrashLogPolicy.classify(action, error: Exception('real failure')),
          isNot(CrashLogLevel.diagnostic),
        );
        expect(
          CrashLogPolicy.classify(action, stackTrace: StackTrace.current),
          isNot(CrashLogLevel.diagnostic),
        );
      }
      expect(CrashLogPolicy.classify('NEW_UNKNOWN_EVENT'), CrashLogLevel.error);
      for (final action in [
        'FATAL_CRASH',
        'DATABASE_CORRUPTION',
        'UNRECOVERABLE_ERROR',
        'BOOTSTRAP_FAILED',
        'END_DAY_FAILED',
        'END_DAY_FINAL_GPS_FETCH_FAILED',
      ]) {
        expect(CrashLogPolicy.classify(action), CrashLogLevel.critical);
      }
    },
  );

  test(
    'critical errors upload immediately without a diagnostic batch',
    () async {
      ready = true;
      await dispatcher.record(
        screen: 'global',
        action: 'BOOTSTRAP_FAILED',
        error: StateError('bootstrap'),
      );
      expect(uploads.single['action'], 'BOOTSTRAP_FAILED');
      expect(await outbox.pendingCount(), 0);
      expect(uploads.single.keys.toSet(), {
        'id',
        'fo_user_id',
        'employee_code',
        'stage',
        'screen',
        'action',
        'error_message',
        'stack_trace',
        'created_at',
      });
    },
  );

  test(
    'offline errors survive until reconnect and critical records are sent first',
    () async {
      for (var n = 0; n < 3; n++) {
        await dispatcher.record(
          screen: 'tracking',
          action: 'GPS_SERVICE_FAILED',
          error: 'failure $n',
        );
      }
      await dispatcher.record(
        screen: 'home',
        action: 'END_DAY_FAILED',
        error: 'not completed',
      );
      expect(await outbox.pendingCount(), 4);
      expect(uploads, isEmpty);
      ready = true;
      await dispatcher.sync();
      expect(uploads.first['action'], 'END_DAY_FAILED');
      expect(uploads.length, 4);
      expect(await outbox.pendingCount(), 0);
      await dispatcher.sync();
      expect(
        uploads.length,
        4,
        reason: 'Acknowledged records must not be inserted again',
      );
    },
  );

  test(
    'different GPS errors are not collapsed by GPS/TRACKING names',
    () async {
      await dispatcher.record(
        screen: 'tracking',
        action: 'GPS_SERVICE_FAILED',
        error: 'service A',
      );
      await dispatcher.record(
        screen: 'tracking',
        action: 'GPS_SERVICE_FAILED',
        error: 'service B',
      );
      await dispatcher.record(
        screen: 'tracking',
        action: 'GPS_SERVICE_FAILED',
        error: 'service A',
      );
      expect(await outbox.pendingCount(), 2);
    },
  );

  test(
    'diagnostic storms and bounded fingerprint history cannot evict unsent errors',
    () async {
      await dispatcher.record(
        screen: 'global',
        action: 'FATAL_CRASH',
        error: 'original fatal',
      );
      await Future.wait(
        List.generate(
          300,
          (n) => dispatcher.record(
            screen: 'sync',
            action: 'SYNC_FAILED',
            error: 'distinct failure $n',
          ),
        ),
      );
      for (var n = 0; n < 1000; n++) {
        await dispatcher.record(
          screen: 'tracking',
          action: 'GPS_FETCH_SUCCESS',
        );
      }
      expect(await outbox.pendingCount(), 301);
      expect((await outbox.nextDue(now))!['action'], 'FATAL_CRASH');
      expect(
        Sqflite.firstIntValue(
          await outbox.database.rawQuery('SELECT count(*) FROM fingerprints'),
        ),
        lessThanOrEqualTo(256),
      );
    },
  );

  test(
    'single-flight sync and durable cross-connection lease preserve concurrent enqueues',
    () async {
      await dispatcher.record(
        screen: 'sync',
        action: 'SYNC_FAILED',
        error: 'queued',
      );
      final entered = Completer<void>(), release = Completer<void>();
      var attempts = 0;
      final sender = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (row) async {
          attempts++;
          if (!entered.isCompleted) entered.complete();
          await release.future;
          uploads.add(row);
        },
        isReady: () => true,
        resolveEmployee: () async => 'SYNTHETIC',
        clock: () => now,
      );
      final calls = List.generate(20, (_) => sender.sync());
      await entered.future;
      final other = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (_) async {
          fail('Another dispatcher must respect the persisted lease');
        },
        isReady: () => true,
        resolveEmployee: () async => 'SYNTHETIC',
        clock: () => now,
      );
      await other.sync();
      expect(attempts, 1);
      await dispatcher.record(
        screen: 'sync',
        action: 'SYNC_FAILED',
        error: 'new while uploading',
      );
      release.complete();
      await Future.wait(calls);
      expect(uploads.length, 2);
      expect(await outbox.pendingCount(), 0);
    },
  );

  test(
    'an expired sync lease can recover without an old owner clearing the new lease',
    () async {
      expect(await outbox.acquireLease('old', now), isTrue);
      expect(await outbox.acquireLease('new', now), isFalse);
      now = now.add(const Duration(minutes: 2));
      expect(await outbox.acquireLease('new', now), isTrue);
      await outbox.releaseLease('old');
      expect(await outbox.acquireLease('third', now), isFalse);
      await outbox.releaseLease('new');
    },
  );

  test(
    'legacy import is atomic and idempotent, retaining original error fields and dates',
    () async {
      final payload = {
        'id': newCrashLogId(),
        'action': 'END_DAY_FAILED',
        'created_at': '2026-11-01T01:02:03Z',
        'error_message': 'Original error',
      };
      final row = {
        'id': payload['id'],
        'priority': 2,
        'payload': jsonEncode(payload),
        'fingerprint': 'legacy',
        'created_ms': 1,
      };
      await expectLater(
        outbox.importLegacy([
          row,
          {...row, 'id': null},
        ]),
        throwsA(anything),
      );
      expect(await outbox.pendingCount(), 0);
      await outbox.importLegacy([row]);
      await outbox.importLegacy([row]);
      expect(await outbox.pendingCount(), 1);
      expect(await outbox.nextDue(now), payload);
    },
  );

  test(
    'uncertain server acknowledgment retries stable ID once; only known PK conflict acknowledges it',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final remote = <String, Map<String, dynamic>>{};
      var requests = 0;
      server.listen((request) async {
        final payload =
            jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>;
        requests++;
        request.response.headers.contentType = ContentType.json;
        if (remote.containsKey(payload['id'])) {
          request.response.statusCode = 409;
          request.response.write(
            jsonEncode({
              'code': '23505',
              'message':
                  'duplicate key value violates unique constraint "mobile_crash_logs_pkey"',
            }),
          );
        } else {
          remote[payload['id'] as String] = payload;
          request.response.statusCode =
              500; // Committed but response is uncertain.
          request.response.write(
            jsonEncode({
              'code': 'synthetic_ack_lost',
              'message': 'Synthetic acknowledgment lost',
            }),
          );
        }
        await request.response.close();
      });
      final client = SupabaseClient(
        'http://127.0.0.1:${server.port}',
        'synthetic-test-key',
      );
      final sender = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (row) => uploadCrashLog(client, row),
        isReady: () => true,
        resolveEmployee: () async => 'SYNTHETIC',
        clock: () => now,
      );
      try {
        await sender.record(
          screen: 'home',
          action: 'END_DAY_FAILED',
          error: 'synthetic failure',
        );
        expect(requests, 1);
        expect(await outbox.pendingCount(), 1);
        await sender.sync();
        expect(
          requests,
          1,
          reason: 'Backoff prevents immediate repeated inserts',
        );
        now = now.add(const Duration(seconds: 31));
        await sender.sync();
        expect(requests, 2);
        expect(remote.length, 1);
        expect(await outbox.pendingCount(), 0);
        await sender.sync();
        expect(requests, 2);
      } finally {
        await client.dispose();
        await server.close(force: true);
      }
    },
  );

  test(
    'pending errors retry after reconnection without any new diagnostic event',
    () async {
      final scheduled = Completer<_ManualTimer>();
      final sender = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (row) async {
          uploads.add(row);
        },
        isReady: () => ready,
        resolveEmployee: () async => 'SYNTHETIC',
        clock: () => now,
        scheduleRetry: (delay, callback) {
          expect(delay, const Duration(seconds: 30));
          final timer = _ManualTimer(callback);
          if (!scheduled.isCompleted) scheduled.complete(timer);
          return timer;
        },
      );
      await sender.record(
        screen: 'sync',
        action: 'SYNC_FAILED',
        error: 'offline',
      );
      final retry = await scheduled.future;
      ready = true;
      now = now.add(const Duration(seconds: 30));
      retry.fire();
      await sender.sync();
      sender.cancelScheduledRetry();
      expect(uploads.length, 1);
      expect(await outbox.pendingCount(), 0);
    },
  );

  test(
    'SQLite survives reopening and coordinates independent connections',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'qpms-crash-test-',
      );
      final location = '${directory.path}/outbox.db';
      final first = await CrashLogOutbox.open(
        factory: databaseFactoryFfi,
        databasePath: location,
      );
      final payload = {
        'id': newCrashLogId(),
        'action': 'BOOTSTRAP_FAILED',
        'created_at': now.toIso8601String(),
      };
      await first.enqueue(payload, 'original', 2, now);
      await first.database.close();
      final reopened = await CrashLogOutbox.open(
        factory: databaseFactoryFfi,
        databasePath: location,
      );
      final independent = CrashLogOutbox(
        await databaseFactoryFfi.openDatabase(
          location,
          options: OpenDatabaseOptions(singleInstance: false),
        ),
      );
      try {
        expect(await reopened.nextDue(now), payload);
        expect(await reopened.acquireLease('foreground', now), isTrue);
        expect(await independent.acquireLease('background', now), isFalse);
        await reopened.releaseLease('foreground');
        await Future.wait(
          List.generate(20, (n) {
            final row = {
              'id': newCrashLogId(),
              'action': 'SYNC_FAILED',
              'created_at': now.toIso8601String(),
            };
            return (n.isEven ? reopened : independent).enqueue(
              row,
              'concurrent-$n',
              1,
              now,
            );
          }),
        );
        expect(await reopened.pendingCount(), 21);
      } finally {
        await reopened.database.close();
        await independent.database.close();
        expect(
          directory.absolute.path.startsWith(
            Directory.systemTemp.absolute.path,
          ),
          isTrue,
        );
        await directory.delete(recursive: true);
      }
    },
  );
  test(
    'empty-detail critical events remain compatible with the existing server noise filter',
    () async {
      ready = true;
      await dispatcher.record(
        screen: 'database',
        action: 'DATABASE_CORRUPTION',
      );
      expect(
        uploads.single['error_message'],
        contains('CRITICAL event: DATABASE_CORRUPTION'),
      );
      expect(
        uploads.single['error_message'],
        contains('no error detail supplied'),
      );
    },
  );

  test(
    'unavailable employee preferences cannot prevent a critical error from queuing',
    () async {
      final sender = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (row) async {
          uploads.add(row);
        },
        isReady: () => true,
        resolveEmployee: () async =>
            throw StateError('preferences unavailable'),
        clock: () => now,
      );
      await sender.record(
        screen: 'global',
        action: 'BOOTSTRAP_FAILED',
        error: 'original bootstrap failure',
      );
      expect(uploads.single['employee_code'], isNull);
      expect(uploads.single['error_message'], 'original bootstrap failure');
    },
  );

  test(
    'failed records retain capped retry deadlines instead of immediate repeated inserts',
    () async {
      await dispatcher.record(
        screen: 'sync',
        action: 'SYNC_FAILED',
        error: 'offline',
      );
      final id = (await outbox.nextDue(now))!['id'] as String;
      for (final seconds in [30, 60, 120, 240, 480, 960, 1800, 1800]) {
        await outbox.retryLater(id, now);
        expect(
          (await outbox.nextRetryTime())!.difference(now),
          Duration(seconds: seconds),
        );
        expect(await outbox.pendingCount(), 1);
      }
    },
  );

  test(
    'unrelated unique conflicts are not mistaken for accepted crash records',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      var requests = 0;
      server.listen((request) async {
        await request.drain<void>();
        requests++;
        request.response.statusCode = 409;
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'code': '23505',
            'message': 'duplicate key on some_other_constraint',
          }),
        );
        await request.response.close();
      });
      final client = SupabaseClient(
        'http://127.0.0.1:${server.port}',
        'synthetic-test-key',
      );
      final sender = CrashLogDispatcher(
        openOutbox: () async => outbox,
        upload: (row) => uploadCrashLog(client, row),
        isReady: () => true,
        resolveEmployee: () async => 'SYNTHETIC',
        clock: () => now,
      );
      try {
        await sender.record(
          screen: 'global',
          action: 'BOOTSTRAP_FAILED',
          error: 'synthetic failure',
        );
        expect(requests, 1);
        expect(await outbox.pendingCount(), 1);
      } finally {
        await client.dispose();
        await server.close(force: true);
      }
    },
  );
}

class _ManualTimer implements Timer {
  _ManualTimer(this.callback);
  final void Function() callback;
  bool _active = true;
  @override
  bool get isActive => _active;
  @override
  int get tick => _active ? 0 : 1;
  @override
  void cancel() {
    _active = false;
  }

  void fire() {
    if (_active) {
      _active = false;
      callback();
    }
  }
}
