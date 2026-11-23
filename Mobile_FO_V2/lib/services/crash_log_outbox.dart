import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

/// Logging-only database. Never opens or changes attendance/GPS databases.
class CrashLogOutbox {
  CrashLogOutbox(this.database);
  final Database database;

  // Yield between SQLITE_BUSY retries so another isolate/connection can commit.
  // A blocking busy timeout can otherwise starve that commit on an FFI worker.
  Future<T> _retryBusy<T>(Future<T> Function() operation) async {
    for (var attempt = 0; ; attempt++) {
      try {
        return await operation();
      } on DatabaseException catch (error) {
        final code = error.getResultCode();
        if (attempt >= 40 ||
            !(code == 5 ||
                code == 6 ||
                error.toString().contains('database is locked'))) {
          rethrow;
        }
        await Future<void>.delayed(
          Duration(milliseconds: min(250, 10 * (attempt + 1))),
        );
      }
    }
  }

  Future<T> _transaction<T>(Future<T> Function(Transaction) operation) =>
      _retryBusy(() => database.transaction(operation));

  static Future<CrashLogOutbox> open({
    DatabaseFactory? factory,
    String? databasePath,
  }) async {
    factory ??= databaseFactory;
    databasePath ??= path.join(
      await factory.getDatabasesPath(),
      'mobile_crash_log_outbox_v1.db',
    );
    final db = await factory.openDatabase(
      databasePath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE outbox (id TEXT PRIMARY KEY NOT NULL, '
            'fingerprint TEXT NOT NULL, priority INTEGER NOT NULL, '
            'payload TEXT NOT NULL, created_ms INTEGER NOT NULL, '
            'attempts INTEGER NOT NULL DEFAULT 0, next_ms INTEGER NOT NULL DEFAULT 0)',
          );
          await db.execute(
            'CREATE TABLE fingerprints (fingerprint TEXT PRIMARY KEY, recorded_ms INTEGER NOT NULL)',
          );
          await db.execute(
            'CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
          );
          await db.execute(
            'CREATE TABLE sync_lease (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, until_ms INTEGER NOT NULL)',
          );
          await db.execute("INSERT INTO sync_lease VALUES (1, '', 0)");
        },
      ),
    );
    return CrashLogOutbox(db);
  }

  Future<bool> enqueue(
    Map<String, dynamic> payload,
    String fingerprint,
    int priority,
    DateTime now, {
    Duration dedupe = const Duration(minutes: 10),
  }) {
    return _transaction((tx) async {
      final ms = now.millisecondsSinceEpoch;
      final previous = await tx.query(
        'fingerprints',
        where: 'fingerprint = ?',
        whereArgs: [fingerprint],
        limit: 1,
      );
      if (dedupe > Duration.zero &&
          previous.isNotEmpty &&
          ms - (previous.single['recorded_ms'] as int) <
              dedupe.inMilliseconds) {
        return false;
      }
      await tx.insert('outbox', {
        'id': payload['id'],
        'fingerprint': fingerprint,
        'priority': priority,
        'payload': jsonEncode(payload),
        'created_ms': ms,
      });
      await tx.insert('fingerprints', {
        'fingerprint': fingerprint,
        'recorded_ms': ms,
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      // Only throttle history is bounded. Unsent errors are NEVER trimmed.
      await tx.rawDelete(
        'DELETE FROM fingerprints WHERE fingerprint IN '
        '(SELECT fingerprint FROM fingerprints ORDER BY recorded_ms DESC LIMIT -1 OFFSET 256)',
      );
      return true;
    });
  }

  Future<Map<String, dynamic>?> nextDue(DateTime now) async {
    final rows = await _retryBusy(
      () => database.query(
        'outbox',
        where: 'next_ms <= ?',
        whereArgs: [now.millisecondsSinceEpoch],
        orderBy: 'priority DESC, created_ms ASC, id ASC',
        limit: 1,
      ),
    );
    return rows.isEmpty
        ? null
        : Map<String, dynamic>.from(
            jsonDecode(rows.single['payload'] as String) as Map,
          );
  }

  Future<void> acknowledge(String id) async {
    await _retryBusy(
      () => database.delete('outbox', where: 'id = ?', whereArgs: [id]),
    );
  }

  Future<void> retryLater(String id, DateTime now) => _transaction((tx) async {
    final rows = await tx.query('outbox', where: 'id = ?', whereArgs: [id]);
    if (rows.isEmpty) return;
    final attempts = (rows.single['attempts'] as int) + 1;
    final delaySeconds = min(1800, 30 * (1 << min(6, attempts - 1)));
    await tx.update(
      'outbox',
      {
        'attempts': attempts,
        'next_ms': now
            .add(Duration(seconds: delaySeconds))
            .millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  });

  Future<bool> acquireLease(String owner, DateTime now) async =>
      await _retryBusy(
        () => database.rawUpdate(
          'UPDATE sync_lease SET owner = ?, until_ms = ? '
          'WHERE id = 1 AND (until_ms <= ? OR owner = ?)',
          [
            owner,
            now.add(const Duration(minutes: 1)).millisecondsSinceEpoch,
            now.millisecondsSinceEpoch,
            owner,
          ],
        ),
      ) ==
      1;

  Future<void> releaseLease(String owner) async {
    await _retryBusy(
      () => database.rawUpdate(
        "UPDATE sync_lease SET owner = '', until_ms = 0 WHERE id = 1 AND owner = ?",
        [owner],
      ),
    );
  }

  Future<int> pendingCount() async =>
      Sqflite.firstIntValue(
        await _retryBusy(
          () => database.rawQuery('SELECT count(*) FROM outbox'),
        ),
      ) ??
      0;

  Future<DateTime?> nextRetryTime() async {
    final rows = await _retryBusy(
      () => database.rawQuery('SELECT min(next_ms) AS next_ms FROM outbox'),
    );
    final value = rows.single['next_ms'] as int?;
    return value == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
  }

  /// Atomic, one-time import. Keep the old preferences until this commits.
  Future<void> importLegacy(List<Map<String, dynamic>> rows) =>
      _transaction((tx) async {
        if ((await tx.query(
          'metadata',
          where: 'name = ?',
          whereArgs: ['legacy_imported'],
        )).isNotEmpty) {
          return;
        }
        for (final row in rows) {
          await tx.insert('outbox', row);
        }
        await tx.insert('metadata', {'name': 'legacy_imported', 'value': '1'});
      });
}
