import 'tracking_flags.dart';

enum TrackingMotionState { moving, stationary, checkedIn }

class GpsBatchDecision {
  const GpsBatchDecision({required this.shouldFlush, required this.reason});

  final bool shouldFlush;
  final String reason;
}

class GpsBatchScheduler {
  DateTime? lastAttemptAt;
  DateTime? retryAfter;
  int consecutiveFailures = 0;

  static const retryDelays = <Duration>[
    Duration(seconds: 15),
    Duration(seconds: 30),
    Duration(seconds: 60),
    Duration(seconds: 120),
    Duration(seconds: 300),
  ];

  GpsBatchDecision decision({
    required DateTime now,
    required int queuedPoints,
    bool force = false,
  }) {
    if (queuedPoints <= 0) {
      return const GpsBatchDecision(shouldFlush: false, reason: 'empty');
    }
    if (force) {
      return const GpsBatchDecision(shouldFlush: true, reason: 'forced');
    }
    final blockedUntil = retryAfter;
    if (blockedUntil != null && now.isBefore(blockedUntil)) {
      return const GpsBatchDecision(
        shouldFlush: false,
        reason: 'retry_backoff',
      );
    }
    if (queuedPoints >= TrackingFlags.gpsBatchPointThreshold) {
      return const GpsBatchDecision(
        shouldFlush: true,
        reason: 'point_threshold',
      );
    }
    final last = lastAttemptAt;
    if (last == null ||
        now.difference(last) >= TrackingFlags.gpsBatchInterval) {
      return const GpsBatchDecision(
        shouldFlush: true,
        reason: 'scheduled_interval',
      );
    }
    return const GpsBatchDecision(shouldFlush: false, reason: 'not_due');
  }

  void markAttempt(DateTime now) {
    lastAttemptAt = now;
  }

  void markSuccess() {
    consecutiveFailures = 0;
    retryAfter = null;
  }

  Duration markFailure(DateTime now) {
    final index = consecutiveFailures.clamp(0, retryDelays.length - 1);
    final delay = retryDelays[index];
    consecutiveFailures += 1;
    retryAfter = now.add(delay);
    return delay;
  }

  void allowConnectivityRetry() {
    retryAfter = null;
  }
}

class WriteCadence {
  static Duration liveStatus(TrackingMotionState state) => switch (state) {
    TrackingMotionState.moving => TrackingFlags.movingLiveStatusInterval,
    TrackingMotionState.stationary =>
      TrackingFlags.stationaryLiveStatusInterval,
    TrackingMotionState.checkedIn => TrackingFlags.checkedInLiveStatusInterval,
  };

  static Duration attendanceKm(TrackingMotionState state) =>
      state == TrackingMotionState.moving
      ? TrackingFlags.movingAttendanceKmInterval
      : TrackingFlags.stationaryAttendanceKmInterval;

  static bool isDue({
    required DateTime now,
    required DateTime? lastWriteAt,
    required Duration interval,
  }) => lastWriteAt == null || now.difference(lastWriteAt) >= interval;
}
