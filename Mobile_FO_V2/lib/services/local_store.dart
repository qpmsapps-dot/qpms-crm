import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/fo_models.dart';

class LocalStore {
  static const _userKey = 'fo_user';
  static const _attendanceKey = 'active_attendance';
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
      return;
    }
    await prefs.setString(_attendanceKey, jsonEncode(attendance.toJson()));
  }

  static Future<Attendance?> getAttendance() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_attendanceKey);
    if (value == null || value.isEmpty) return null;
    return Attendance.fromJson(jsonDecode(value) as Map<String, dynamic>);
  }

  static Future<void> addLocationLog(LocationLog log) async {
    final logs = await getLocationLogs();
    logs.add(log);
    await _saveList(_logsKey, logs.map((e) => e.toJson()).toList());
  }

  static Future<List<LocationLog>> getLocationLogs() async {
    return (await _readList(
      _logsKey,
    )).map((e) => LocationLog.fromJson(e)).toList();
  }

  static Future<void> saveLocationLogs(List<LocationLog> logs) =>
      _saveList(_logsKey, logs.map((e) => e.toJson()).toList());

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
