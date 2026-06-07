import 'dart:convert';
import 'dart:io';

import 'config_service.dart';
import 'crash_log_service.dart';

class RouteDistanceService {
  static Future<double?> roadDistanceKm({
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
    if (!AppConfig.hasGoogleMaps) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_FAILED',
        error: 'Missing GOOGLE_MAPS_API_KEY.',
      );
      return null;
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
        throw HttpException(
          'Google route distance HTTP ${response.statusCode}',
        );
      }
      final json = jsonDecode(body) as Map<String, dynamic>;
      final status = json['status']?.toString();
      if (status != 'OK') {
        throw StateError('Google route distance status=$status');
      }
      final rows = json['rows'];
      if (rows is! List || rows.isEmpty) {
        throw StateError('Google route distance returned no rows.');
      }
      final elements = (rows.first as Map<String, dynamic>)['elements'];
      if (elements is! List || elements.isEmpty) {
        throw StateError('Google route distance returned no elements.');
      }
      final element = elements.first as Map<String, dynamic>;
      final elementStatus = element['status']?.toString();
      if (elementStatus != 'OK') {
        throw StateError('Google route distance element status=$elementStatus');
      }
      final distance = element['distance'];
      final meters = distance is Map<String, dynamic>
          ? (distance['value'] as num?)?.toDouble()
          : null;
      if (meters == null) {
        throw StateError('Google route distance missing distance.value.');
      }
      final km = double.parse((meters / 1000).toStringAsFixed(2));
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_SUCCESS',
        error: 'route_km=$km',
      );
      return km;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'ROUTE_DISTANCE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    } finally {
      client.close(force: true);
    }
  }
}
