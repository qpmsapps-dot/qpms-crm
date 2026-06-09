import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/fo_models.dart';
import 'local_db_service.dart';

class LocalStore {
  static const _userKey = 'fo_user';
  static const _attendanceKey = 'active_attendance';
  static const _backgroundSessionKey = 'background_tracking_session';
  static const _logsKey = 'location_logs';
  static const _visitsKey = 'site_visits';

  static Future<void> saveUser(FoUser user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_userKey, jsonEncode(user.toJson()));
  }

  static Future<FoUser?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_userKey);
    if (value == null || value.isEmpty) return null;
    return FoUser.fromJson(jsonDecode(value) as Map<String, dynamic>);
  }

  static Future<void> clearUser() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userKey);
  }

  static Future<void> saveAttendance(Attendance? attendance) async {
    final prefs = await SharedPreferences.getInstance();
    if (attendance == null) {
      await prefs.remove(_attendanceKey);
      debugPrint('[myQPMS FO V2] local_store/ATTENDANCE_SAVED_LOCAL cleared');
      return;
    }
    await prefs.setString(_attendanceKey, jsonEncode(attendance.toJson()));
    debugPrint(
      '[myQPMS FO V2] local_store/ATTENDANCE_SAVED_LOCAL '
      'attendance_id=${attendance.remoteId ?? attendance.id} '
      'remote_id=${attendance.remoteId ?? '--'} '
      'active=${attendance.isActive} '
      'end_time=${attendance.endTime?.toIso8601String() ?? '--'}',
    );
  }

  static Future<Attendance?> getAttendance() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_attendanceKey);
    if (value == null || value.isEmpty) {
      debugPrint('[myQPMS FO V2] local_store/ATTENDANCE_LOADED_MYTASKS null');
      return null;
    }
    final attendance = Attendance.fromJson(
      jsonDecode(value) as Map<String, dynamic>,
    );
    debugPrint(
      '[myQPMS FO V2] local_store/ATTENDANCE_LOADED_MYTASKS '
      'attendance_id=${attendance.remoteId ?? attendance.id} '
      'remote_id=${attendance.remoteId ?? '--'} '
      'active=${attendance.isActive} '
      'end_time=${attendance.endTime?.toIso8601String() ?? '--'}',
    );
    return attendance;
  }

  static Future<void> saveBackgroundTrackingSession({
    required FoUser user,
    required Attendance attendance,
    required String supabaseUrl,
    required String supabaseAnonKey,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _backgroundSessionKey,
      jsonEncode({
        'employee_code': user.employeeCode,
        'full_name': user.fullName,
        'attendance_id': attendance.remoteId ?? attendance.id,
        'remote_id': attendance.remoteId,
        'local_attendance_id': attendance.id,
        'supabase_url': supabaseUrl,
        'supabase_anon_key': supabaseAnonKey,
        'saved_at': DateTime.now().toUtc().toIso8601String(),
      }),
    );
  }

  static Future<Map<String, dynamic>?> getBackgroundTrackingSession() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_backgroundSessionKey);
    if (value == null || value.isEmpty) return null;
    return Map<String, dynamic>.from(jsonDecode(value) as Map);
  }

  static Future<void> clearBackgroundTrackingSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_backgroundSessionKey);
  }

  static Future<void> addLocationLog(
    LocationLog log, {
    String eventType = 'gps',
  }) async {
    await LocalDbService.upsertGpsLog(log, eventType: eventType);
  }

  static Future<List<LocationLog>> getLocationLogs() async {
    final dbLogs = await LocalDbService.getGpsLogs();
    final legacyLogs = (await _readList(
      _logsKey,
    )).map((e) => LocationLog.fromJson(e)).toList();
    final byId = <String, LocationLog>{};
    for (final log in legacyLogs) {
      if (log.id.isNotEmpty) byId[log.id] = log;
    }
    for (final log in dbLogs) {
      if (log.id.isNotEmpty) byId[log.id] = log;
    }
    final logs = byId.values.toList()
      ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    return logs;
  }

  static Future<void> saveLocationLogs(List<LocationLog> logs) async {
    for (final log in logs) {
      await LocalDbService.upsertGpsLog(
        log,
        localSynced: log.synced,
        syncStatus: log.synced ? 'synced' : 'pending',
      );
    }
    final compact = logs.length <= 250 ? logs : logs.sublist(logs.length - 250);
    await _saveList(_logsKey, compact.map((e) => e.toJson()).toList());
  }

  static Future<List<LocationLog>> getUnsyncedLocationLogs({int limit = 50}) {
    return LocalDbService.getUnsyncedGpsLogs(limit: limit);
  }

  static Future<int> countUnsyncedLocationLogs() {
    return LocalDbService.countUnsyncedGpsLogs();
  }

  static Future<void> markLocationLogsSynced(Map<String, String?> remoteIds) {
    return LocalDbService.markGpsLogsSynced(remoteIds);
  }

  static Future<void> markLocationLogsSyncFailed(
    List<String> ids,
    Object error,
  ) {
    return LocalDbService.markGpsLogsSyncFailed(ids, error);
  }

  static Future<void> cleanupOldSyncedLocationLogs({int keepDays = 10}) {
    return LocalDbService.cleanupOldSyncedGpsLogs(keepDays: keepDays);
  }

  static Future<void> saveVisit(SiteVisit visit) async {
    final visits = await getVisits();
    final index = visits.indexWhere((item) => item.id == visit.id);
    if (index >= 0) {
      visits[index] = visit;
    } else {
      visits.add(visit);
    }
    await _saveList(_visitsKey, visits.map((e) => e.toJson()).toList());
  }

  static Future<void> removeVisit(String id) async {
    final visits = await getVisits();
    visits.removeWhere((item) => item.id == id || item.remoteId == id);
    await _saveList(_visitsKey, visits.map((e) => e.toJson()).toList());
  }

  static Future<List<SiteVisit>> getVisits() async {
    return (await _readList(
      _visitsKey,
    )).map((e) => SiteVisit.fromJson(e)).toList();
  }

  static Future<SiteVisit?> activeVisit() async {
    for (final visit in await getVisits()) {
      if (visit.isActive) return visit;
    }
    return null;
  }

  static Future<void> clearActiveVisitsForAttendance(
    String attendanceId,
  ) async {
    final cleanAttendanceId = attendanceId.trim();
    if (cleanAttendanceId.isEmpty) return;
    final visits = await getVisits();
    visits.removeWhere(
      (visit) =>
          visit.isActive &&
          ((visit.attendanceId?.trim() ?? '').isEmpty ||
              visit.attendanceId?.trim() == cleanAttendanceId),
    );
    await _saveList(_visitsKey, visits.map((e) => e.toJson()).toList());
  }

  static Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userKey);
    await prefs.remove(_attendanceKey);
  }

  static Future<List<Map<String, dynamic>>> _readList(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(key);
    if (value == null || value.isEmpty) return [];
    return (jsonDecode(value) as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  static Future<void> _saveList(
    String key,
    List<Map<String, dynamic>> value,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, jsonEncode(value));
  }
}
