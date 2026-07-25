import '../models/fo_models.dart';
import '../utils/local_id.dart';
import 'supabase_service.dart';

class TravelLegBoundary {
  const TravelLegBoundary({
    required this.at,
    required this.latitude,
    required this.longitude,
  });

  final DateTime at;
  final double? latitude;
  final double? longitude;
}

abstract class TravelLegGateway {
  Future<TravelLeg?> active(String attendanceId);
  Future<TravelLeg> create(TravelLeg leg);
  Future<TravelLeg?> close(
    TravelLeg leg, {
    required TravelLegBoundary boundary,
  });
  Future<List<TravelLeg>> forAttendance(String attendanceId);
}

class SupabaseTravelLegGateway implements TravelLegGateway {
  const SupabaseTravelLegGateway(this.user);

  final FoUser user;

  @override
  Future<TravelLeg?> active(String attendanceId) {
    return SupabaseService.fetchActiveTravelLeg(attendanceId: attendanceId);
  }

  @override
  Future<TravelLeg> create(TravelLeg leg) async {
    leg.remoteId = await SupabaseService.createTravelLeg(
      user: user,
      travelLeg: leg,
    );
    return leg;
  }

  @override
  Future<TravelLeg?> close(
    TravelLeg leg, {
    required TravelLegBoundary boundary,
  }) {
    final id = leg.remoteId ?? leg.id;
    return SupabaseService.closeTravelLeg(
      user: user,
      travelLegId: id,
      endedAt: boundary.at,
      endLat: boundary.latitude,
      endLng: boundary.longitude,
    );
  }

  @override
  Future<List<TravelLeg>> forAttendance(String attendanceId) {
    return SupabaseService.fetchTravelLegsForAttendance(attendanceId);
  }
}

class TravelLegLifecycleService {
  TravelLegLifecycleService({
    required this.gateway,
    String Function()? idFactory,
  }) : _idFactory = idFactory ?? (() => newLocalId('travel-leg'));

  final TravelLegGateway gateway;
  final String Function() _idFactory;

  Future<TravelLeg> _open({
    required String attendanceId,
    required String employeeCode,
    required String mode,
    required TravelLegBoundary boundary,
  }) async {
    final current = await gateway.active(attendanceId);
    if (current != null) return current;
    return gateway.create(
      TravelLeg(
        id: _idFactory(),
        attendanceId: attendanceId,
        employeeCode: employeeCode,
        startedAt: boundary.at.toUtc(),
        startLat: boundary.latitude,
        startLng: boundary.longitude,
        travelMode: mode,
        ratePerKm: travelModeRatePerKm(mode),
      ),
    );
  }

  Future<TravelLeg> startDay({
    required String attendanceId,
    required String employeeCode,
    required String mode,
    required TravelLegBoundary boundary,
  }) {
    return _open(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: mode,
      boundary: boundary,
    );
  }

  Future<TravelLeg?> checkIn({
    required String attendanceId,
    required TravelLegBoundary boundary,
  }) async {
    final current = await gateway.active(attendanceId);
    if (current == null) return null;
    return gateway.close(current, boundary: boundary);
  }

  Future<TravelLeg> checkOut({
    required String attendanceId,
    required String employeeCode,
    required String mode,
    required TravelLegBoundary boundary,
  }) {
    return _open(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: mode,
      boundary: boundary,
    );
  }

  Future<TravelLeg> changeMode({
    required String attendanceId,
    required String employeeCode,
    required String oldMode,
    required String newMode,
    required TravelLegBoundary boundary,
  }) async {
    final current = await gateway.active(attendanceId);
    if (current != null &&
        normalizeTravelMode(current.travelMode) !=
            normalizeTravelMode(newMode)) {
      await gateway.close(current, boundary: boundary);
    } else if (current != null) {
      return current;
    }
    return _open(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: newMode,
      boundary: boundary,
    );
  }

  Future<TravelLeg?> endDay({
    required String attendanceId,
    required TravelLegBoundary boundary,
  }) {
    return checkIn(attendanceId: attendanceId, boundary: boundary);
  }

  Future<TravelLeg> reopen({
    required String attendanceId,
    required String employeeCode,
    required String mode,
    required TravelLegBoundary boundary,
  }) {
    return _open(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: mode,
      boundary: boundary,
    );
  }
}
