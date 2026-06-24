import 'dart:convert';
import 'dart:io';

import 'config_service.dart';
import 'crash_log_service.dart';

class RouteDistanceResult {
  const RouteDistanceResult({
    required this.source,
    required this.provider,
    required this.api,
    required this.status,
    required this.calculatedAt,
    required this.originLat,
    required this.originLng,
    required this.destinationLat,
    required this.destinationLng,
    this.routeKm,
    this.distanceMeters,
    this.warning,
    this.needsReview = false,
  });

  final String source;
  final String provider;
  final String api;
  final String status;
  final DateTime calculatedAt;
  final double originLat;
  final double originLng;
  final double destinationLat;
  final double destinationLng;
  final double? routeKm;
  final double? distanceMeters;
  final String? warning;
  final bool needsReview;

  bool get available => routeKm != null;

  Map<String, dynamic> toMetadata({required String routeOriginSource}) => {
    'distance_source': source,
    'route_provider': provider,
    'route_api': api,
    'route_request_status': status,
    'route_calculated_at': calculatedAt.toUtc().toIso8601String(),
    'route_origin_source': routeOriginSource,
    'origin_lat': originLat,
    'origin_lng': originLng,
    'destination_lat': destinationLat,
    'destination_lng': destinationLng,
    if (distanceMeters != null) 'distance_meters': distanceMeters,
    if (needsReview) 'needs_review': true,
    if (warning?.trim().isNotEmpty == true) 'route_warning': warning,
  };
}

class RouteDistanceService {
  static Future<RouteDistanceResult> roadDistanceKm({
    required String employeeCode,
    required double originLat,
    required double originLng,
    required double destinationLat,
    required double destinationLng,
  }) async {
    await CrashLogService.record(
      employeeCode: employeeCode,
      screen: 'tracking',
      action: 'ROUTE_DISTANCE_REQUEST',
      error:
          'origin=$originLat,$originLng destination=$destinationLat,$destinationLng',
    );
    RouteDistanceResult unavailable(String status, {String? warning}) {
      return RouteDistanceResult(
        source: 'unavailable',
        provider: 'google',
        api: 'distance_matrix',
        status: status,
        calculatedAt: DateTime.now(),
        originLat: originLat,
        originLng: originLng,
        destinationLat: destinationLat,
        destinationLng: destinationLng,
        warning: warning,
        needsReview: true,
      );
    }

    if (!AppConfig.hasGoogleMaps) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_FAILED',
        error: 'Missing GOOGLE_MAPS_API_KEY.',
      );
      return unavailable(
        'missing_api_key',
        warning: 'Missing GOOGLE_MAPS_API_KEY.',
      );
    }
    final uri =
        Uri.https('maps.googleapis.com', '/maps/api/distancematrix/json', {
          'origins': '$originLat,$originLng',
          'destinations': '$destinationLat,$destinationLng',
          'mode': 'driving',
          'units': 'metric',
          'key': AppConfig.googleMapsApiKey,
        });
    final client = HttpClient();
    try {
      final request = await client.getUrl(uri);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return unavailable(
          'http_${response.statusCode}',
          warning: 'Google route distance HTTP ${response.statusCode}',
        );
      }
      final json = jsonDecode(body) as Map<String, dynamic>;
      final status = json['status']?.toString();
      if (status != 'OK') {
        return unavailable(
          'google_status_${status ?? 'unknown'}',
          warning: 'Google route distance status=$status',
        );
      }
      final rows = json['rows'];
      if (rows is! List || rows.isEmpty) {
        return unavailable(
          'no_rows',
          warning: 'Google route distance returned no rows.',
        );
      }
      final elements = (rows.first as Map<String, dynamic>)['elements'];
      if (elements is! List || elements.isEmpty) {
        return unavailable(
          'no_elements',
          warning: 'Google route distance returned no elements.',
        );
      }
      final element = elements.first as Map<String, dynamic>;
      final elementStatus = element['status']?.toString();
      if (elementStatus != 'OK') {
        return unavailable(
          'element_status_${elementStatus ?? 'unknown'}',
          warning: 'Google route distance element status=$elementStatus',
        );
      }
      final distance = element['distance'];
      final meters = distance is Map<String, dynamic>
          ? (distance['value'] as num?)?.toDouble()
          : null;
      if (meters == null) {
        return unavailable(
          'missing_distance_value',
          warning: 'Google route distance missing distance.value.',
        );
      }
      final km = double.parse((meters / 1000).toStringAsFixed(2));
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_SUCCESS',
        error: 'route_km=$km',
      );
      return RouteDistanceResult(
        source: 'google_distance_matrix',
        provider: 'google',
        api: 'distance_matrix',
        status: 'OK',
        calculatedAt: DateTime.now(),
        originLat: originLat,
        originLng: originLng,
        destinationLat: destinationLat,
        destinationLng: destinationLng,
        routeKm: km,
        distanceMeters: meters,
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return unavailable(
        error.runtimeType.toString(),
        warning: error.toString(),
      );
    } finally {
      client.close(force: true);
    }
  }
}
