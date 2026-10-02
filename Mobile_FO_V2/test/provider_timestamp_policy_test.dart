import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/tracking/provider_timestamp_policy.dart';

void main() {
  final received = DateTime.utc(2026, 9, 30, 12);

  test('provider timestamp is preserved separately from receipt time', () {
    final provider = received.subtract(const Duration(seconds: 3));
    final decision = ProviderTimestampPolicy.classify(
      providerTimestamp: provider,
      receivedAt: received,
    );
    expect(decision.accepted, isTrue);
    expect(decision.capturedAt, provider);
    expect(decision.receivedAt, received);
    expect(decision.quality, 'provider_timestamp');
  });

  test('stale cached provider fix is explicitly rejected', () {
    final decision = ProviderTimestampPolicy.classify(
      providerTimestamp: received.subtract(const Duration(days: 6)),
      receivedAt: received,
    );
    expect(decision.accepted, isFalse);
    expect(decision.quality, 'stale_provider_timestamp');
    expect(decision.capturedAt, isNot(received));
  });

  test('missing provider timestamp is compatibility-classified, not relabelled', () {
    final decision = ProviderTimestampPolicy.classify(
      providerTimestamp: null,
      receivedAt: received,
    );
    expect(decision.accepted, isFalse);
    expect(decision.quality, 'missing_provider_timestamp_compat');
    expect(decision.capturedAt.millisecondsSinceEpoch, 0);
  });

  test('offline serialization retains original timestamp and stable local id', () {
    final provider = received.subtract(const Duration(seconds: 4));
    final log = LocationLog(
      id: 'gps-stable-uuid',
      employeeCode: 'EMP1',
      attendanceId: 'attendance-1',
      latitude: 12.97,
      longitude: 77.59,
      capturedAt: provider,
      receivedAt: received,
      timestampQuality: 'provider_timestamp',
    );
    final retry = LocationLog.fromJson(log.toJson());
    expect(retry.id, 'gps-stable-uuid');
    expect(retry.capturedAt.toUtc(), provider);
    expect(retry.receivedAt.toUtc(), received);
    expect(retry.timestampQuality, 'provider_timestamp');
  });
}
