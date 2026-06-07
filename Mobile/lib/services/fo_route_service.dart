import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

class FoRouteResult {
  const FoRouteResult({
    required this.available,
    this.routeKm,
    this.durationMinutes,
    this.polyline,
    this.warning,
  });

  final bool available;
  final double? routeKm;
  final int? durationMinutes;
  final String? polyline;
  final String? warning;
}

class FoRouteService {
  FoRouteService._();

  static const _googleApiKey = String.fromEnvironment('GOOGLE_MAPS_API_KEY');

  static bool get isConfigured => _googleApiKey.isNotEmpty;

  static Future<FoRouteResult> fetchDrivingRoute({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  }) async {
    if (!isConfigured) {
      return const FoRouteResult(
        available: false,
        warning: 'Route distance unavailable. Google Maps API key missing.',
      );
    }

    final uri = Uri.https('maps.googleapis.com', '/maps/api/directions/json', {
      'origin': '$fromLat,$fromLng',
      'destination': '$toLat,$toLng',
      'mode': 'driving',
      'key': _googleApiKey,
    });
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 12);
    try {
      final request = await client.getUrl(uri);
      final response = await request.close().timeout(
        const Duration(seconds: 15),
      );
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return FoRouteResult(
          available: false,
          warning:
              'Route distance unavailable. Google API returned ${response.statusCode}.',
        );
      }
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (data['status'] != 'OK') {
        return FoRouteResult(
          available: false,
          warning:
              'Route distance unavailable. Google status: ${data['status'] ?? 'unknown'}.',
        );
      }
      final routes = data['routes'] as List<dynamic>? ?? [];
      if (routes.isEmpty) {
        return const FoRouteResult(
          available: false,
          warning: 'Route distance unavailable. No road route found.',
        );
      }
      final route = routes.first as Map<String, dynamic>;
      final legs = route['legs'] as List<dynamic>? ?? [];
      if (legs.isEmpty) {
        return const FoRouteResult(
          available: false,
          warning: 'Route distance unavailable. No route leg found.',
        );
      }
      final leg = legs.first as Map<String, dynamic>;
      final distanceMeters =
          ((leg['distance'] as Map<String, dynamic>?)?['value'] as num?)
              ?.toDouble();
      final durationSeconds =
          ((leg['duration'] as Map<String, dynamic>?)?['value'] as num?)
              ?.toInt();
      if (distanceMeters == null) {
        return const FoRouteResult(
          available: false,
          warning:
              'Route distance unavailable. Google response had no distance.',
        );
      }
      return FoRouteResult(
        available: true,
        routeKm: distanceMeters / 1000,
        durationMinutes: durationSeconds == null
            ? null
            : (durationSeconds / 60).ceil(),
        polyline:
            (route['overview_polyline'] as Map<String, dynamic>?)?['points']
                as String?,
      );
    } catch (error, stackTrace) {
      debugPrint('[myQPMS Route] Google route fetch failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return const FoRouteResult(
        available: false,
        warning: 'Route distance unavailable. Route KM pending.',
      );
    } finally {
      client.close(force: true);
    }
  }
}
