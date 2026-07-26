import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/services/travel_leg_lifecycle_service.dart';

class _FakeGateway implements TravelLegGateway {
  final List<TravelLeg> legs = [];

  @override
  Future<TravelLeg?> active(String attendanceId) async {
    return legs.cast<TravelLeg?>().firstWhere(
      (leg) => leg?.attendanceId == attendanceId && leg!.isActive,
      orElse: () => null,
    );
  }

  @override
  Future<TravelLeg> create(TravelLeg leg) async {
    final existing = legs.cast<TravelLeg?>().firstWhere(
      (item) =>
          item?.attendanceId == leg.attendanceId &&
          item?.startedAt.toUtc() == leg.startedAt.toUtc(),
      orElse: () => null,
    );
    if (existing != null) return existing;
    legs.add(leg);
    return leg;
  }

  @override
  Future<TravelLeg?> close(
    TravelLeg leg, {
    required TravelLegBoundary boundary,
  }) async {
    if (!leg.isActive) return leg;
    leg
      ..endedAt = boundary.at
      ..endLat = boundary.latitude
      ..endLng = boundary.longitude
      ..status = 'completed';
    return leg;
  }

  @override
  Future<List<TravelLeg>> forAttendance(String attendanceId) async {
    return legs.where((leg) => leg.attendanceId == attendanceId).toList();
  }
}

class _FailOnceCloseGateway extends _FakeGateway {
  var closeAttempts = 0;

  @override
  Future<TravelLeg?> close(
    TravelLeg leg, {
    required TravelLegBoundary boundary,
  }) async {
    closeAttempts += 1;
    if (closeAttempts == 1) throw StateError('temporary network failure');
    return super.close(leg, boundary: boundary);
  }
}

const attendanceId = '11111111-1111-4111-8111-111111111111';
const employeeCode = 'FO-TEST-001';

TravelLegBoundary boundary(int minute, {double lat = 13, double lng = 80}) {
  return TravelLegBoundary(
    at: DateTime.utc(2026, 7, 25, 9, minute),
    latitude: lat,
    longitude: lng,
  );
}

TravelLegLifecycleService _service(_FakeGateway gateway) {
  var sequence = 0;
  return TravelLegLifecycleService(
    gateway: gateway,
    idFactory: () => 'leg-${sequence++}',
  );
}

void main() {
  test('start_day_opens_travel_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);

    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );

    expect(gateway.legs, hasLength(1));
    expect(gateway.legs.single.travelMode, travelModeBike);
    expect(gateway.legs.single.ratePerKm, 4);
    expect(gateway.legs.single.isActive, isTrue);
  });

  test('checkin_closes_current_travel_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );

    await lifecycle.checkIn(attendanceId: attendanceId, boundary: boundary(10));

    expect(gateway.legs.single.isActive, isFalse);
    expect(gateway.legs.single.endedAt, boundary(10).at);
  });

  test('checkout_opens_next_travel_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);

    await lifecycle.checkOut(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeCar,
      boundary: boundary(20),
    );

    expect(gateway.legs.single.travelMode, travelModeCar);
    expect(gateway.legs.single.ratePerKm, 8);
  });

  test('mode_change_closes_old_leg_and_opens_new_mode_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );

    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: boundary(10),
    );

    expect(gateway.legs, hasLength(2));
    expect(gateway.legs.first.travelMode, travelModeBike);
    expect(gateway.legs.first.isActive, isFalse);
    expect(gateway.legs.last.travelMode, travelModeCar);
    expect(gateway.legs.last.isActive, isTrue);
  });

  test('end_day_closes_final_travel_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.checkOut(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeCar,
      boundary: boundary(20),
    );

    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(50));

    expect(gateway.legs.single.isActive, isFalse);
    expect(gateway.legs.single.endedAt, boundary(50).at);
  });

  test('repeated_end_day_keeps_the_same_completed_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.checkOut(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeCar,
      boundary: boundary(20),
    );

    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(50));
    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(50));

    expect(gateway.legs, hasLength(1));
    expect(gateway.legs.single.endedAt, boundary(50).at);
  });

  test('reopen_opens_new_leg_without_modifying_completed_legs', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );
    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(10));
    final originalEnd = gateway.legs.single.endedAt;

    await lifecycle.reopen(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeCar,
      boundary: boundary(20),
    );

    expect(gateway.legs, hasLength(2));
    expect(gateway.legs.first.endedAt, originalEnd);
    expect(gateway.legs.last.travelMode, travelModeCar);
  });

  test('duplicate_boundary_call_does_not_create_duplicate_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    final start = boundary(0);

    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: start,
    );
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: start,
    );

    expect(gateway.legs, hasLength(1));
  });

  test('repeated_mode_switch_does_not_create_duplicate_leg', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );
    final switchBoundary = boundary(10);

    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: switchBoundary,
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: switchBoundary,
    );

    expect(gateway.legs, hasLength(2));
    expect(gateway.legs.last.travelMode, travelModeCar);
    expect(gateway.legs.last.isActive, isTrue);
  });

  test('bike_to_car_preserves_distinct_modes_and_rates', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: boundary(10),
    );
    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(30));

    expect(gateway.legs.map((leg) => leg.travelMode), ['bike', 'car']);
    expect(gateway.legs.map((leg) => leg.ratePerKm), [4, 8]);
  });

  test('bike_to_car_to_bike_preserves_all_mode_boundaries', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: boundary(10),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeCar,
      newMode: travelModeBike,
      boundary: boundary(20),
    );
    await lifecycle.endDay(attendanceId: attendanceId, boundary: boundary(30));

    expect(gateway.legs.map((leg) => leg.travelMode), ['bike', 'car', 'bike']);
    expect(gateway.legs.map((leg) => leg.ratePerKm), [4, 8, 4]);
  });

  test('bike_car_bike_car_preserves_all_four_boundaries', () async {
    final gateway = _FakeGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeBike,
      boundary: boundary(0),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: boundary(10),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeCar,
      newMode: travelModeBike,
      boundary: boundary(20),
    );
    await lifecycle.changeMode(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      oldMode: travelModeBike,
      newMode: travelModeCar,
      boundary: boundary(30),
    );

    expect(gateway.legs.map((leg) => leg.travelMode), [
      'bike',
      'car',
      'bike',
      'car',
    ]);
    expect(gateway.legs.map((leg) => leg.ratePerKm), [4, 8, 4, 8]);
  });

  test('checkin_leg_closure_failure_is_retried', () async {
    final gateway = _FailOnceCloseGateway();
    final lifecycle = _service(gateway);
    await lifecycle.startDay(
      attendanceId: attendanceId,
      employeeCode: employeeCode,
      mode: travelModeCar,
      boundary: boundary(0),
    );

    await expectLater(
      lifecycle.checkIn(attendanceId: attendanceId, boundary: boundary(10)),
      throwsStateError,
    );
    await lifecycle.checkIn(attendanceId: attendanceId, boundary: boundary(10));

    expect(gateway.closeAttempts, 2);
    expect(gateway.legs, hasLength(1));
    expect(gateway.legs.single.isActive, isFalse);
  });
}
