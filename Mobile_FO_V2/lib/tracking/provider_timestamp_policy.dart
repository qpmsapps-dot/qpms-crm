class ProviderTimestampDecision {
  const ProviderTimestampDecision({
    required this.accepted,
    required this.capturedAt,
    required this.receivedAt,
    required this.quality,
  });

  final bool accepted;
  final DateTime capturedAt;
  final DateTime receivedAt;
  final String quality;
}

class ProviderTimestampPolicy {
  static const maxProviderAge = Duration(minutes: 10);
  static const futureTolerance = Duration(minutes: 2);

  static ProviderTimestampDecision classify({
    required DateTime? providerTimestamp,
    DateTime? receivedAt,
  }) {
    final receipt = (receivedAt ?? DateTime.now()).toUtc();
    if (providerTimestamp == null || providerTimestamp.year < 2000) {
      return ProviderTimestampDecision(
        accepted: false,
        capturedAt: providerTimestamp?.toUtc() ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        receivedAt: receipt,
        quality: 'missing_provider_timestamp_compat',
      );
    }

    final captured = providerTimestamp.toUtc();
    if (captured.isAfter(receipt.add(futureTolerance))) {
      return ProviderTimestampDecision(
        accepted: false,
        capturedAt: captured,
        receivedAt: receipt,
        quality: 'future_provider_timestamp',
      );
    }
    if (receipt.difference(captured) > maxProviderAge) {
      return ProviderTimestampDecision(
        accepted: false,
        capturedAt: captured,
        receivedAt: receipt,
        quality: 'stale_provider_timestamp',
      );
    }
    return ProviderTimestampDecision(
      accepted: true,
      capturedAt: captured,
      receivedAt: receipt,
      quality: 'provider_timestamp',
    );
  }
}
