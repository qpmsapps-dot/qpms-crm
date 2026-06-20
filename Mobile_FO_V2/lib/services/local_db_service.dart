import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/fo_models.dart';

class LocalDbService {
  static const _dbName = 'myqpms_fo_v2.db';
  static const _dbVersion = 1;

  static Database? _database;

  static Future<Database> get database async {
    final existing = _database;
    if (existing != null) return existing;
    final dbPath = await getDatabasesPath();
    final db = await openDatabase(
      p.join(dbPath, _dbName),
      version: _dbVersion,
      onCreate: _create,
    );
    _database = db;
    return db;
  }

  static Future<void> _create(Database db, int version) async {
    await db.execute('''
      CREATE TABLE local_gps_logs (
        id TEXT PRIMARY KEY,
        remote_id TEXT,
        fo_user_id TEXT NOT NULL,
        username TEXT,
        attendance_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        speed REAL,
        battery_percentage INTEGER,
        logged_at TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'mobile',
        sync_status TEXT NOT NULL DEFAULT 'pending',
        local_synced INTEGER NOT NULL DEFAULT 0,
        sync_attempt_count INTEGER NOT NULL DEFAULT 0,
        last_sync_error TEXT,
        created_at TEXT NOT NULL,
        event_type TEXT
      )
    ''');
    await db.execute(
      'CREATE INDEX idx_local_gps_logs_attendance_time '
      'ON local_gps_logs(attendance_id, captured_at)',
    );
    await db.execute(
      'CREATE INDEX idx_local_gps_logs_sync '
      'ON local_gps_logs(local_synced, captured_at)',
    );
    await db.execute('''
      CREATE TABLE local_route_legs (
        id TEXT PRIMARY KEY,
        attendance_id TEXT NOT NULL,
        site_visit_id TEXT,
        origin_lat REAL,
        origin_lng REAL,
        destination_lat REAL,
        destination_lng REAL,
        route_km REAL,
        actual_gps_km REAL,
        source TEXT,
        calculated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending'
      )
    ''');
    await db.execute(
      'CREATE INDEX idx_local_route_legs_attendance_time '
      'ON local_route_legs(attendance_id, calculated_at)',
    );
  }

  static Future<void> upsertGpsLog(
    LocationLog log, {
    String eventType = 'gps',
    bool? localSynced,
    String? syncStatus,
  }) async {
    final employeeCode = log.employeeCode.trim();
    if (employeeCode.isEmpty) {
      throw StateError('GPS log employee_code is missing.');
    }
    final db = await database;
    final now = DateTime.now().toUtc().toIso8601String();
    final synced = localSynced ?? log.synced;
    final row = <String, Object?>{
      'id': log.id,
      'remote_id': log.remoteId,
      'fo_user_id': employeeCode,
      'username': employeeCode,
      'attendance_id': log.attendanceId,
      'latitude': log.latitude,
      'longitude': log.longitude,
      'accuracy': log.accuracy,
      'speed': log.speed,
      'battery_percentage': log.battery,
      'logged_at': log.capturedAt.toUtc().toIso8601String(),
      'captured_at': log.capturedAt.toUtc().toIso8601String(),
      'source': 'mobile',
      'sync_status': syncStatus ?? (synced ? 'synced' : 'pending'),
      'local_synced': synced ? 1 : 0,
      'created_at': now,
      'event_type': eventType,
    };
    await db.insert(
      'local_gps_logs',
      row,
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
    await db.update(
      'local_gps_logs',
      {
        'remote_id': log.remoteId,
        'fo_user_id': employeeCode,
        'username': employeeCode,
        'sync_status': row['sync_status'],
        'local_synced': row['local_synced'],
        'event_type': eventType,
      },
      where: 'id = ?',
      whereArgs: [log.id],
    );
  }

  static Future<List<LocationLog>> getGpsLogs({
    String? attendanceId,
    bool unsyncedOnly = false,
    int? limit,
  }) async {
    final db = await database;
    final where = <String>[];
    final args = <Object?>[];
    if (attendanceId != null && attendanceId.trim().isNotEmpty) {
      where.add('attendance_id = ?');
      args.add(attendanceId);
    }
    if (unsyncedOnly) {
      where.add('local_synced = 0');
    }
    final rows = await db.query(
      'local_gps_logs',
      where: where.isEmpty ? null : where.join(' AND '),
      whereArgs: args,
      orderBy: 'captured_at ASC',
      limit: limit,
    );
    return rows.map(_logFromRow).toList();
  }

  static Future<List<LocationLog>> getUnsyncedGpsLogs({int limit = 50}) {
    return getGpsLogs(unsyncedOnly: true, limit: limit);
  }

  static Future<int> countUnsyncedGpsLogs() async {
    final db = await database;
    final rows = await db.rawQuery(
      'SELECT COUNT(*) AS count FROM local_gps_logs WHERE local_synced = 0',
    );
    return Sqflite.firstIntValue(rows) ?? 0;
  }

  static Future<void> markGpsLogsSynced(Map<String, String?> remoteIds) async {
    if (remoteIds.isEmpty) return;
    final db = await database;
    final batch = db.batch();
    for (final entry in remoteIds.entries) {
      batch.update(
        'local_gps_logs',
        {
          'remote_id': entry.value,
          'sync_status': 'synced',
          'local_synced': 1,
          'last_sync_error': null,
        },
        where: 'id = ?',
        whereArgs: [entry.key],
      );
    }
    await batch.commit(noResult: true);
  }

  static Future<void> markGpsLogsSyncFailed(
    List<String> ids,
    Object error,
  ) async {
    if (ids.isEmpty) return;
    final db = await database;
    final batch = db.batch();
    for (final id in ids) {
      batch.rawUpdate(
        '''
        UPDATE local_gps_logs
        SET sync_status = ?, sync_attempt_count = sync_attempt_count + 1,
            last_sync_error = ?
        WHERE id = ?
        ''',
        ['pending', error.toString(), id],
      );
    }
    await batch.commit(noResult: true);
  }

  static Future<void> saveRouteLeg({
    required String id,
    required String attendanceId,
    String? siteVisitId,
    double? originLat,
    double? originLng,
    double? destinationLat,
    double? destinationLng,
    double? routeKm,
    double? actualGpsKm,
    String? source,
    DateTime? calculatedAt,
    String syncStatus = 'pending',
  }) async {
    final db = await database;
    await db.insert('local_route_legs', {
      'id': id,
      'attendance_id': attendanceId,
      'site_visit_id': siteVisitId,
      'origin_lat': originLat,
      'origin_lng': originLng,
      'destination_lat': destinationLat,
      'destination_lng': destinationLng,
      'route_km': routeKm,
      'actual_gps_km': actualGpsKm,
      'source': source,
      'calculated_at': (calculatedAt ?? DateTime.now())
          .toUtc()
          .toIso8601String(),
      'sync_status': syncStatus,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  static Future<void> cleanupOldSyncedGpsLogs({int keepDays = 10}) async {
    final db = await database;
    final cutoff = DateTime.now()
        .subtract(Duration(days: keepDays))
        .toUtc()
        .toIso8601String();
    await db.delete(
      'local_gps_logs',
      where: 'local_synced = 1 AND captured_at < ?',
      whereArgs: [cutoff],
    );
  }

  static LocationLog _logFromRow(Map<String, Object?> row) => LocationLog(
    id: row['id']?.toString() ?? '',
    remoteId: row['remote_id']?.toString(),
    employeeCode: row['fo_user_id']?.toString() ?? '',
    attendanceId: row['attendance_id']?.toString() ?? '',
    latitude: _double(row['latitude']) ?? 0,
    longitude: _double(row['longitude']) ?? 0,
    accuracy: _double(row['accuracy']),
    speed: _double(row['speed']),
    battery: _int(row['battery_percentage']),
    capturedAt:
        DateTime.tryParse(row['captured_at']?.toString() ?? '')?.toLocal() ??
        DateTime.now(),
    synced: row['local_synced'] == 1,
  );

  static double? _double(Object? value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }

  static int? _int(Object? value) {
    if (value == null) return null;
    if (value is num) return value.toInt();
    return int.tryParse(value.toString());
  }
}
