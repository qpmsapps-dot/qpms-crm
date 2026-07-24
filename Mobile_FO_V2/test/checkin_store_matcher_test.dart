import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/checkin_store_matcher.dart';

const _baseLatitude = 15.4508028;
const _baseLongitude = 75.0107111;

Store store({
  String id = 'store-1',
  String code = 'S001',
  String state = 'KA',
  String? business = 'Standalone',
  double? distanceMeters,
  double? latitude,
  double? longitude,
  String? status = 'Active',
  String? updatedAt,
  double? radiusMeters,
}) {
  final point = distanceMeters == null
      ? (lat: latitude ?? _baseLatitude, lng: longitude ?? _baseLongitude)
      : pointNorthOfBase(distanceMeters);
  return Store.fromJson({
    'id': id,
    'store_name': 'Store $code',
    'client_name': 'Client',
    'store_code': code,
    'state': state,
    'business': business,
    'latitude': point.lat,
    'longitude': point.lng,
    'gps_accuracy': 18,
    'status': status,
    'updated_at': updatedAt,
    // ignore: use_null_aware_elements
    if (radiusMeters case final radius?) 'geofence_radius_m': radius,
  });
}

({double lat, double lng}) pointNorthOfBase(double meters) {
  const earthRadiusMeters = 6371000.0;
  final deltaLatitude = meters / earthRadiusMeters * 180 / math.pi;
  return (lat: _baseLatitude + deltaLatitude, lng: _baseLongitude);
}

CheckInStoreResult match(Iterable<Store> stores) {
  return CheckInStoreMatcher.findNearbyStores(
    stores: stores,
    latitude: _baseLatitude,
    longitude: _baseLongitude,
  );
}

void main() {
  group('Check-In Store Master matching', () {
    test('store already present in fresh Store Master is nearby', () {
      final result = match([store(distanceMeters: 90)]);

      expect(result.nearby, hasLength(1));
      expect(result.nearby.single.store.storeCode, 'S001');
      expect(result.nearby.single.distanceMeters, lessThanOrEqualTo(100));
    });

    test(
      'newly added store missing from cache appears after forced refresh',
      () {
        final cached = match([
          store(id: 'old', code: 'OLD', distanceMeters: 220),
        ]);
        final refreshed = match([
          store(id: 'old', code: 'OLD', distanceMeters: 220),
          store(id: 'new', code: 'NEW', distanceMeters: 40),
        ]);

        expect(cached.nearby, isEmpty);
        expect(refreshed.nearby.map((item) => item.store.storeCode), ['NEW']);
      },
    );

    test('90 metres is inside the default 100 metre radius', () {
      expect(match([store(distanceMeters: 90)]).nearby, hasLength(1));
    });

    test('101 metres is outside the default 100 metre radius', () {
      final result = match([store(distanceMeters: 101)]);

      expect(result.nearby, isEmpty);
      expect(result.diagnostics.nearestStore?.distanceMeters, greaterThan(100));
    });

    test('exact boundary remains eligible', () {
      final result = match([store(distanceMeters: 100)]);

      expect(result.nearby, hasLength(1));
    });

    test(
      'duplicate Store Codes remain independent candidates like old Check-In',
      () {
        final result = match([
          store(id: 'inactive', code: 'DUP', status: 'Inactive'),
          store(id: 'active', code: 'DUP', status: 'Active'),
        ]);

        expect(result.nearby.map((item) => item.store.id), [
          'active',
          'inactive',
        ]);
      },
    );

    test('zero coordinate duplicate remains a candidate like old Check-In', () {
      final result = match([
        store(id: 'invalid', code: 'DUP', latitude: 0, longitude: 0),
        store(id: 'valid', code: 'DUP', distanceMeters: 30),
      ]);

      expect(result.diagnostics.validGpsStores, 2);
      expect(result.nearby.map((item) => item.store.id), contains('valid'));
    });

    test('latest duplicate Store Code does not replace older candidate', () {
      final result = match([
        store(
          id: 'older',
          code: 'DUP',
          distanceMeters: 45,
          updatedAt: '2026-01-01T00:00:00Z',
        ),
        store(
          id: 'newer',
          code: 'DUP',
          distanceMeters: 45,
          updatedAt: '2026-02-01T00:00:00Z',
        ),
      ]);

      expect(
        result.nearby.map((item) => item.store.id),
        containsAll(['older', 'newer']),
      );
    });

    test(
      'store in another state remains a distance candidate like old Check-In',
      () {
        final result = match([store(state: 'TG')]);

        expect(result.nearby, hasLength(1));
      },
    );

    test(
      'store in another business remains a distance candidate like old Check-In',
      () {
        final result = match([store(business: 'Retail')]);

        expect(result.nearby, hasLength(1));
      },
    );

    test(
      'recently edited duplicate coordinates do not hide either candidate',
      () {
        final result = match([
          store(
            id: 'old',
            code: 'EDIT',
            distanceMeters: 160,
            updatedAt: '2026-01-01T00:00:00Z',
          ),
          store(
            id: 'new',
            code: 'EDIT',
            distanceMeters: 60,
            updatedAt: '2026-01-02T00:00:00Z',
          ),
        ]);

        expect(result.nearby.map((item) => item.store.id), ['new']);
        expect(result.diagnostics.nearestStore?.store.id, 'new');
      },
    );

    test('per-store radius is not used by restored old Check-In matching', () {
      final result = match([store(distanceMeters: 140, radiusMeters: 150)]);

      expect(result.nearby, isEmpty);
      expect(result.diagnostics.nearestStore?.radiusMeters, 100);
    });

    test('refreshing stores keeps duplicate Store Code candidates visible', () {
      final result = match([
        store(id: 'a', code: 'DUP', distanceMeters: 40),
        store(id: 'b', code: 'DUP', distanceMeters: 40),
      ]);

      expect(result.diagnostics.validGpsStores, 2);
      expect(result.nearby, hasLength(2));
    });
  });

  group('Check-In GPS sample validation', () {
    test('old last-known location is rejected', () {
      final now = DateTime.utc(2026, 1, 1, 12);
      final sample = CheckInLocationSample(
        latitude: _baseLatitude,
        longitude: _baseLongitude,
        accuracyMeters: 20,
        timestamp: now.subtract(const Duration(minutes: 5)),
      );

      expect(
        CheckInStoreMatcher.hasUsableFreshLocation(sample, now: now),
        isFalse,
      );
    });

    test('fresh GPS location is accepted', () {
      final now = DateTime.utc(2026, 1, 1, 12);
      final sample = CheckInLocationSample(
        latitude: _baseLatitude,
        longitude: _baseLongitude,
        accuracyMeters: 20,
        timestamp: now.subtract(const Duration(seconds: 15)),
      );

      expect(
        CheckInStoreMatcher.hasUsableFreshLocation(sample, now: now),
        isTrue,
      );
    });

    test('poor GPS accuracy is rejected for retry behaviour', () {
      final now = DateTime.utc(2026, 1, 1, 12);
      final sample = CheckInLocationSample(
        latitude: _baseLatitude,
        longitude: _baseLongitude,
        accuracyMeters: 140,
        timestamp: now,
      );

      expect(
        CheckInStoreMatcher.hasUsableFreshLocation(sample, now: now),
        isFalse,
      );
    });

    test('zero coordinates are rejected', () {
      final now = DateTime.utc(2026, 1, 1, 12);
      final sample = CheckInLocationSample(
        latitude: 0,
        longitude: _baseLongitude,
        accuracyMeters: 20,
        timestamp: now,
      );

      expect(
        CheckInStoreMatcher.hasUsableFreshLocation(sample, now: now),
        isFalse,
      );
    });
  });
}
