import 'dart:math' as math;

import '../models/fo_models.dart';

const double defaultCheckInRadiusMeters = 100;
const double maxCheckInGpsAccuracyMeters = 100;
const Duration maxCheckInLocationAge = Duration(minutes: 2);

class CheckInLocationSample {
  const CheckInLocationSample({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.timestamp,
  });

  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final DateTime timestamp;
}

class CheckInStoreMatch {
  const CheckInStoreMatch({
    required this.store,
    required this.distanceMeters,
    required this.radiusMeters,
  });

  final Store store;
  final double distanceMeters;
  final double radiusMeters;
}

class CheckInStoreDiagnostics {
  const CheckInStoreDiagnostics({
    required this.totalLoaded,
    required this.validGpsStores,
    required this.excludedInvalidCoordinates,
    this.nearestStore,
  });

  final int totalLoaded;
  final int validGpsStores;
  final int excludedInvalidCoordinates;
  final CheckInStoreMatch? nearestStore;
}

class CheckInStoreResult {
  const CheckInStoreResult({required this.nearby, required this.diagnostics});

  final List<CheckInStoreMatch> nearby;
  final CheckInStoreDiagnostics diagnostics;
}

class CheckInStoreMatcher {
  const CheckInStoreMatcher._();

  static CheckInStoreResult findNearbyStores({
    required Iterable<Store> stores,
    required double latitude,
    required double longitude,
  }) {
    final validStores = <Store>[];
    var totalLoaded = 0;
    var excludedInvalidCoordinates = 0;

    for (final store in stores) {
      totalLoaded += 1;
      if (!hasValidCoordinates(store)) {
        excludedInvalidCoordinates += 1;
        continue;
      }
      validStores.add(store);
    }

    CheckInStoreMatch? nearest;
    final nearby = <CheckInStoreMatch>[];
    for (final store in validStores) {
      final distance = distanceMeters(
        latitude,
        longitude,
        store.latitude!,
        store.longitude!,
      );
      final match = CheckInStoreMatch(
        store: store,
        distanceMeters: distance,
        radiusMeters: defaultCheckInRadiusMeters,
      );
      if (nearest == null || distance < nearest.distanceMeters) {
        nearest = match;
      }
      if (distance <= defaultCheckInRadiusMeters + 0.001) {
        nearby.add(match);
      }
    }
    nearby.sort((a, b) {
      final byDistance = a.distanceMeters.compareTo(b.distanceMeters);
      if (byDistance != 0) return byDistance;
      return a.store.id.compareTo(b.store.id);
    });

    return CheckInStoreResult(
      nearby: nearby,
      diagnostics: CheckInStoreDiagnostics(
        totalLoaded: totalLoaded,
        validGpsStores: validStores.length,
        excludedInvalidCoordinates: excludedInvalidCoordinates,
        nearestStore: nearest,
      ),
    );
  }

  static bool hasUsableFreshLocation(
    CheckInLocationSample sample, {
    required DateTime now,
  }) {
    if (!_isValidLatitude(sample.latitude) ||
        !_isValidLongitude(sample.longitude) ||
        sample.latitude == 0 ||
        sample.longitude == 0) {
      return false;
    }
    if (!sample.accuracyMeters.isFinite ||
        sample.accuracyMeters <= 0 ||
        sample.accuracyMeters > maxCheckInGpsAccuracyMeters) {
      return false;
    }
    final age = now.difference(sample.timestamp.toUtc()).abs();
    return age <= maxCheckInLocationAge;
  }

  static bool hasValidCoordinates(Store store) {
    return store.latitude != null && store.longitude != null;
  }

  static double distanceMeters(
    double startLatitude,
    double startLongitude,
    double endLatitude,
    double endLongitude,
  ) {
    const earthRadiusMeters = 6371000.0;
    final dLat = _toRadians(endLatitude - startLatitude);
    final dLng = _toRadians(endLongitude - startLongitude);
    final startLat = _toRadians(startLatitude);
    final endLat = _toRadians(endLatitude);
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(startLat) *
            math.cos(endLat) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadiusMeters * c;
  }

  static bool _isValidLatitude(double value) {
    return value.isFinite && value >= -90 && value <= 90;
  }

  static bool _isValidLongitude(double value) {
    return value.isFinite && value >= -180 && value <= 180;
  }

  static double _toRadians(double degrees) => degrees * math.pi / 180;
}
