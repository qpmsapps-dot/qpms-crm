import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

void main() {
  group('Car travel mode', () {
    test('normalizes and labels Car consistently', () {
      expect(normalizeTravelMode('Car'), travelModeCar);
      expect(normalizeTravelMode('CAR'), travelModeCar);
      expect(normalizeTravelMode('car'), travelModeCar);
      expect(travelModeLabel(travelModeCar), 'Car');
      expect(allTravelModes, contains(travelModeCar));
    });

    test('Car is payable at eight rupees per km', () {
      expect(payableKmAllowedForTravelMode('Car'), isTrue);
      expect(travelModeRatePerKm('Car'), 8);
      expect(15 * travelModeRatePerKm('Car'), 120);
    });

    test('legacy null and unknown modes retain the bike fallback', () {
      expect(normalizeTravelMode(null), travelModeBike);
      expect(normalizeTravelMode('spaceship'), travelModeBike);
      expect(travelModeRatePerKm(null), defaultTravelModeRatePerKm);
      expect(payableKmAllowedForTravelMode(null), isTrue);
    });

    test('TravelLeg snapshots mode rate and payable amount', () {
      final bikeLeg = TravelLeg(
        id: 'bike-leg',
        attendanceId: 'attendance-1',
        employeeCode: 'QPMS001',
        startedAt: DateTime.utc(2026, 7, 24, 9),
        travelMode: travelModeBike,
        calculatedKm: 10,
        payableKm: 10,
        fareAmount: 40,
      );
      final carLeg = TravelLeg(
        id: 'car-leg',
        attendanceId: 'attendance-1',
        employeeCode: 'QPMS001',
        startedAt: DateTime.utc(2026, 7, 24, 10),
        travelMode: travelModeCar,
        calculatedKm: 15,
        payableKm: 15,
        ratePerKm: carTravelModeRatePerKm,
        payableAmount: 120,
        fareAmount: 120,
      );

      expect(bikeLeg.travelMode, travelModeBike);
      expect(bikeLeg.ratePerKm, defaultTravelModeRatePerKm);
      expect(bikeLeg.payableAmount, 40);
      expect(carLeg.travelMode, travelModeCar);
      expect(carLeg.ratePerKm, carTravelModeRatePerKm);
      expect(carLeg.payableAmount, 120);
      expect(bikeLeg.payableAmount + carLeg.payableAmount, 160);
      expect(carLeg.toJson(), containsPair('rate_per_km', 8));
      expect(carLeg.toJson(), containsPair('payable_amount', 120));
    });

    test('TravelLeg parses persisted car snapshots', () {
      final leg = TravelLeg.fromJson({
        'attendance_id': 'attendance-1',
        'travel_mode': 'CAR',
        'calculated_km': 15,
        'payable_km': 15,
        'rate_per_km': 8,
        'payable_amount': 120,
        'fare_amount': 120,
      });

      expect(leg.travelMode, travelModeCar);
      expect(leg.ratePerKm, 8);
      expect(leg.payableAmount, 120);
    });

    test('app_restart_restores_car_and_rate_8', () {
      final attendance = Attendance.fromJson({
        'id': 'attendance-car',
        'employee_code': 'FO-CAR',
        'start_time': '2026-07-26T08:00:00.000Z',
        'travel_mode': 'car',
        'rate_per_km': 8,
      });

      expect(attendance.travelMode, travelModeCar);
      expect(attendance.ratePerKm, carTravelModeRatePerKm);
      expect(attendance.toJson(), containsPair('rate_per_km', 8));
    });

    test('Car 20 KM equals 160 rupees', () {
      expect(20 * travelModeRatePerKm(travelModeCar), 160);
    });
  });
}
