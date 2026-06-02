import 'package:intl/intl.dart';

final _date = DateFormat('dd MMM yyyy');
final _time = DateFormat('hh:mm a');

String formatDate(DateTime? value) => value == null ? '-' : _date.format(value);
String formatTime(DateTime? value) => value == null ? '-' : _time.format(value);

DateTime startOfToday() {
  return startOfIndiaDay(DateTime.now());
}

DateTime endOfDay(DateTime date) =>
    DateTime(date.year, date.month, date.day, 23, 59, 59, 999);

DateTime indiaNow() =>
    DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));

DateTime startOfIndiaDay(DateTime value) {
  final india = value.toUtc().add(const Duration(hours: 5, minutes: 30));
  return DateTime(india.year, india.month, india.day);
}

String indiaDateKey(DateTime value) {
  final india = value.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${india.year.toString().padLeft(4, '0')}-'
      '${india.month.toString().padLeft(2, '0')}-'
      '${india.day.toString().padLeft(2, '0')}';
}
