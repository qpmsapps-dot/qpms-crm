import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/fo_models.dart';

class FoLocalStorage {
  FoLocalStorage._();

  static const _sessionKey = 'myqpms_fo_session';
  static const _sessionUserKey = 'myqpms_fo_session_user';
  static const _permissionSetupCompleteKey =
      'myqpms_fo_permission_setup_complete';
  static const _attendanceKey = 'fo_attendance';
  static const _activeAttendanceKey = 'fo_active_attendance';
  static const _locationLogsKey = 'fo_location_logs';
  static const _siteVisitsKey = 'fo_site_visits';
  static const _dailyTasksKey = 'fo_daily_tasks';
  static const _travelSegmentsKey = 'fo_travel_segments';
  static const _taskAttachmentsKey = 'fo_task_attachments';

  static Future<bool> hasSession() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_sessionKey) ?? false;
  }

  static Future<void> setSession({FoUser user = FoUser.demo}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_sessionKey, true);
    await prefs.setString(_sessionUserKey, jsonEncode(user.toJson()));
  }

  static Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
    await prefs.remove(_sessionUserKey);
  }

  static Future<FoUser> getSessionUser() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_sessionUserKey);
    if (value == null) return FoUser.demo;
    try {
      return FoUser.fromJson(jsonDecode(value) as Map<String, dynamic>);
    } catch (_) {
      return FoUser.demo;
    }
  }

  static Future<bool> hasCompletedPermissionSetup() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_permissionSetupCompleteKey) ?? false;
  }

  static Future<void> setPermissionSetupComplete() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_permissionSetupCompleteKey, true);
  }

  static Future<void> clearPermissionSetupComplete() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_permissionSetupCompleteKey);
  }

  static Future<void> saveAttendance(FoAttendance attendance) async {
    final prefs = await SharedPreferences.getInstance();
    final history = await getAttendanceHistory();
    final existingIndex = history.indexWhere(
      (record) => record.id == attendance.id,
    );
    if (existingIndex >= 0) {
      history[existingIndex] = attendance;
    } else {
      history.insert(0, attendance);
    }
    await prefs.setString(
      _attendanceKey,
      jsonEncode(history.map((record) => record.toJson()).toList()),
    );
    if (attendance.isActive) {
      await prefs.setString(
        _activeAttendanceKey,
        jsonEncode(attendance.toJson()),
      );
    } else {
      await prefs.remove(_activeAttendanceKey);
    }
  }

  static Future<FoAttendance?> getActiveAttendance() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_activeAttendanceKey);
    if (value == null) {
      return null;
    }
    return FoAttendance.fromJson(jsonDecode(value) as Map<String, dynamic>);
  }

  static Future<List<FoAttendance>> getAttendanceHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_attendanceKey);
    if (value == null) {
      return [];
    }
    return (jsonDecode(value) as List<dynamic>)
        .map((item) => FoAttendance.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  static Future<void> appendLocationLog(FoLocationLog log) async {
    final prefs = await SharedPreferences.getInstance();
    final logs = await getLocationLogs();
    logs.add(log);
    final retainedLogs = logs.length > 5000
        ? logs.sublist(logs.length - 5000)
        : logs;
    await prefs.setString(
      _locationLogsKey,
      jsonEncode(retainedLogs.map((entry) => entry.toJson()).toList()),
    );
  }

  static Future<void> saveLocationLogs(List<FoLocationLog> logs) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _locationLogsKey,
      jsonEncode(logs.map((entry) => entry.toJson()).toList()),
    );
  }

  static Future<List<FoLocationLog>> getLocationLogs() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_locationLogsKey);
    if (value == null) {
      return [];
    }
    return (jsonDecode(value) as List<dynamic>)
        .map((item) => FoLocationLog.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  static Future<double> totalDistanceKm({DateTime? since}) async {
    final logs = await getLocationLogs();
    final route = since == null
        ? logs
        : logs.where((log) => !log.timestamp.isBefore(since)).toList();
    if (route.length < 2) {
      return 0;
    }
    var distanceMeters = 0.0;
    for (var index = 1; index < route.length; index++) {
      distanceMeters += Geolocator.distanceBetween(
        route[index - 1].latitude,
        route[index - 1].longitude,
        route[index].latitude,
        route[index].longitude,
      );
    }
    return distanceMeters / 1000;
  }

  static Future<double> totalRouteKm({DateTime? since}) async {
    final segments = await getTravelSegments();
    final route = since == null
        ? segments
        : segments
              .where((segment) => !segment.createdAt.isBefore(since))
              .toList();
    return route.fold<double>(
      0,
      (total, segment) => total + (segment.routeKm ?? 0),
    );
  }

  static Future<void> saveTravelSegment(FoTravelSegment segment) async {
    final prefs = await SharedPreferences.getInstance();
    final segments = await getTravelSegments();
    final existingIndex = segments.indexWhere(
      (record) => record.id == segment.id,
    );
    if (existingIndex >= 0) {
      segments[existingIndex] = segment;
    } else {
      segments.add(segment);
    }
    await prefs.setString(
      _travelSegmentsKey,
      jsonEncode(segments.map((record) => record.toJson()).toList()),
    );
  }

  static Future<void> saveTravelSegments(List<FoTravelSegment> segments) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _travelSegmentsKey,
      jsonEncode(segments.map((record) => record.toJson()).toList()),
    );
  }

  static Future<List<FoTravelSegment>> getTravelSegments() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_travelSegmentsKey);
    if (value == null) {
      return [];
    }
    return (jsonDecode(value) as List<dynamic>)
        .map((item) => FoTravelSegment.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  static Future<void> saveSiteVisit(FoSiteVisit visit) async {
    final prefs = await SharedPreferences.getInstance();
    final visits = await getSiteVisits();
    final existingIndex = visits.indexWhere((record) => record.id == visit.id);
    if (existingIndex >= 0) {
      visits[existingIndex] = visit;
    } else {
      visits.insert(0, visit);
    }
    await prefs.setString(
      _siteVisitsKey,
      jsonEncode(visits.map((record) => record.toJson()).toList()),
    );
  }

  static Future<void> saveSiteVisits(List<FoSiteVisit> visits) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _siteVisitsKey,
      jsonEncode(visits.map((record) => record.toJson()).toList()),
    );
  }

  static Future<List<FoSiteVisit>> getSiteVisits() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_siteVisitsKey);
    if (value == null) {
      return [];
    }
    return (jsonDecode(value) as List<dynamic>)
        .map((item) => FoSiteVisit.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  static Future<void> saveDailyTask(FoDailyTask task) async {
    final prefs = await SharedPreferences.getInstance();
    final tasks = await getDailyTasks();
    final existingIndex = tasks.indexWhere((record) => record.id == task.id);
    if (existingIndex >= 0) {
      tasks[existingIndex] = task;
    } else {
      tasks.add(task);
    }
    tasks.sort((a, b) => a.plannedSequence.compareTo(b.plannedSequence));
    await prefs.setString(
      _dailyTasksKey,
      jsonEncode(tasks.map((record) => record.toJson()).toList()),
    );
  }

  static Future<void> saveDailyTasks(List<FoDailyTask> tasks) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _dailyTasksKey,
      jsonEncode(tasks.map((record) => record.toJson()).toList()),
    );
  }

  static Future<List<FoDailyTask>> getDailyTasks({DateTime? date}) async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_dailyTasksKey);
    if (value == null) {
      return [];
    }
    final tasks = (jsonDecode(value) as List<dynamic>)
        .map((item) => FoDailyTask.fromJson(item as Map<String, dynamic>))
        .toList();
    if (date == null) {
      return tasks;
    }
    return tasks.where((task) {
      return task.taskDate.year == date.year &&
          task.taskDate.month == date.month &&
          task.taskDate.day == date.day;
    }).toList();
  }

  static Future<int> nextTaskSequence(DateTime date) async {
    final tasks = await getDailyTasks(date: date);
    if (tasks.isEmpty) {
      return 1;
    }
    return tasks
            .map((task) => task.plannedSequence)
            .reduce((value, element) => value > element ? value : element) +
        1;
  }

  static Future<void> saveTaskAttachment(FoTaskAttachment attachment) async {
    final prefs = await SharedPreferences.getInstance();
    final attachments = await getTaskAttachments();
    final existingIndex = attachments.indexWhere(
      (record) => record.id == attachment.id,
    );
    if (existingIndex >= 0) {
      attachments[existingIndex] = attachment;
    } else {
      attachments.add(attachment);
    }
    await prefs.setString(
      _taskAttachmentsKey,
      jsonEncode(attachments.map((record) => record.toJson()).toList()),
    );
  }

  static Future<void> saveTaskAttachments(
    List<FoTaskAttachment> attachments,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _taskAttachmentsKey,
      jsonEncode(attachments.map((record) => record.toJson()).toList()),
    );
  }

  static Future<List<FoTaskAttachment>> getTaskAttachments() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_taskAttachmentsKey);
    if (value == null) {
      return [];
    }
    return (jsonDecode(value) as List<dynamic>)
        .map((item) => FoTaskAttachment.fromJson(item as Map<String, dynamic>))
        .toList();
  }
}
