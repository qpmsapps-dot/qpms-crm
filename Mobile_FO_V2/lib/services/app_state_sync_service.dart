import '../models/fo_models.dart';
import '../tracking/tracking_service.dart';
import '../utils/date_utils.dart';
import 'crash_log_service.dart';
import 'local_store.dart';
import 'supabase_service.dart';

class AppStateSyncResult {
  const AppStateSyncResult({
    required this.message,
    this.previousDayAutoClosed = false,
    this.localAttendanceCleared = false,
    this.localVisitCleared = false,
    this.remoteAttendanceRestored = false,
    this.remoteVisitRestored = false,
  });

  final String message;
  final bool previousDayAutoClosed;
  final bool localAttendanceCleared;
  final bool localVisitCleared;
  final bool remoteAttendanceRestored;
  final bool remoteVisitRestored;
}

class AppStateSyncService {
  static Future<AppStateSyncResult> syncNow(FoUser user) async {
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'app_state_sync',
      action: 'manual_sync_started',
    );

    var localAttendanceCleared = false;
    var localVisitCleared = false;
    var previousDayAutoClosed = false;
    var remoteAttendanceRestored = false;
    var remoteVisitRestored = false;

    try {
      final todayKey = indiaDateKey(DateTime.now());

      if (SupabaseService.isReady) {
        final freshProfile = await SupabaseService.fetchCurrentProfile();
        if (freshProfile.employeeCode == user.employeeCode) {
          await LocalStore.saveUser(freshProfile);
        }
      }

      final localAttendance = await LocalStore.getAttendance();
      if (localAttendance != null) {
        final localDate = _attendanceDateKey(localAttendance);
        final employeeMismatch =
            localAttendance.employeeCode.trim() != user.employeeCode.trim();
        final previousDay = localDate != todayKey;
        if (employeeMismatch || previousDay) {
          await _stopTrackingSafely(user);
          await LocalStore.saveAttendance(null);
          await LocalStore.clearActiveVisits(employeeCode: user.employeeCode);
          await LocalStore.clearBackgroundTrackingSession();
          localAttendanceCleared = true;
          localVisitCleared = true;
          previousDayAutoClosed = previousDay;
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'app_state_sync',
            action: 'stale_local_attendance_cleared',
            error:
                'attendance_date=$localDate today=$todayKey employee_mismatch=$employeeMismatch',
          );
        }
      }

      if (!SupabaseService.isReady) {
        throw StateError('Supabase is not ready.');
      }

      final remoteActive = await SupabaseService.findActiveAttendanceForToday(
        user,
      );

      if (remoteActive == null) {
        final closed =
            await SupabaseService.findClosedAttendanceForToday(user) ??
            await SupabaseService.findCompletedAttendanceForToday(user);
        await _stopTrackingSafely(user);
        await LocalStore.clearActiveVisits(employeeCode: user.employeeCode);
        await LocalStore.clearBackgroundTrackingSession();
        localVisitCleared = true;
        if (closed != null) {
          await LocalStore.saveAttendance(closed);
        } else {
          await LocalStore.saveAttendance(null);
          localAttendanceCleared = true;
        }
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'app_state_sync',
          action: 'stale_local_visit_cleared',
          error: 'remote_active_attendance=false',
        );
      } else {
        await LocalStore.saveAttendance(remoteActive);
        remoteAttendanceRestored = true;

        final remoteVisit =
            await SupabaseService.findActiveSiteVisitForAttendance(
              user: user,
              attendance: remoteActive,
            );
        if (remoteVisit != null) {
          remoteVisit.synced = true;
          await LocalStore.saveVisit(remoteVisit);
          remoteVisitRestored = true;
        } else {
          await LocalStore.clearActiveVisitsForAttendance(
            remoteActive.remoteId ?? remoteActive.id,
          );
          localVisitCleared = true;
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'app_state_sync',
            action: 'stale_local_visit_cleared',
            error: 'remote_open_visit=false',
          );
        }
      }

      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'app_state_sync',
        action: 'manual_sync_success',
        error:
            'attendance_restored=$remoteAttendanceRestored visit_restored=$remoteVisitRestored local_attendance_cleared=$localAttendanceCleared local_visit_cleared=$localVisitCleared',
      );

      return AppStateSyncResult(
        message: previousDayAutoClosed
            ? 'Previous day was auto-closed. You can start a new day now.'
            : 'App state synced successfully.',
        previousDayAutoClosed: previousDayAutoClosed,
        localAttendanceCleared: localAttendanceCleared,
        localVisitCleared: localVisitCleared,
        remoteAttendanceRestored: remoteAttendanceRestored,
        remoteVisitRestored: remoteVisitRestored,
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'app_state_sync',
        action: 'manual_sync_failed',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static String _attendanceDateKey(Attendance attendance) {
    final value = attendance.attendanceDate?.trim();
    if (value != null && value.isNotEmpty) return value;
    return indiaDateKey(attendance.startTime);
  }

  static Future<void> _stopTrackingSafely(FoUser user) async {
    try {
      await TrackingService.stop(user: user, updateRemoteLiveStatus: false);
    } catch (_) {
      // Manual recovery must keep going even if tracking stop cleanup fails.
    }
  }
}
