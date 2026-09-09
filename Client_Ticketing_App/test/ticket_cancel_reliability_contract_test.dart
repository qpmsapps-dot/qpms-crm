import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File('lib/features/tickets/ticket_details_screen.dart')
      .readAsStringSync();

  test('cancel action is locked while a request is in flight', () {
    expect(source, contains('bool _isCancelling = false;'));
    expect(source, contains('if (_isCancelling) return;'));
    expect(source, contains('setState(() => _isCancelling = true);'));
    expect(source, contains('setState(() => _isCancelling = false);'));
    expect(source, contains('onCancel: _isCancelling ? null'));
  });

  test('safe backend cancellation messages are shown to the requester', () {
    expect(source, contains('error is HospitalApiException'));
    expect(source, contains('error.message'));
    expect(source, contains('resolveTicket(ticket.number)'));
  });
}
