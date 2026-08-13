import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/mock_data.dart';
import '../models/notification_item.dart';
import '../services/app_config.dart';
import '../services/hospital_ticket_api.dart';

class NotificationController extends ChangeNotifier {
  NotificationController({this.preferences, bool? demoMode})
    : demoMode = demoMode ?? ClientAppConfig.demoMode {
    if (this.demoMode) {
      resetMockData();
    } else {
      _items = [];
    }
  }

  final SharedPreferences? preferences;
  final bool demoMode;
  late List<NotificationItem> _items;
  bool _loading = false;
  String? _errorMessage;

  List<NotificationItem> get items => List.unmodifiable(_items);
  int get unreadCount => _items.where((item) => !item.isRead).length;
  bool get isLoading => _loading;
  String? get errorMessage => _errorMessage;

  void addTicketRaisedNotification(String ticketNumber) {
    _items.insert(
      0,
      NotificationItem(
        id: 'raised-$ticketNumber-${DateTime.now().millisecondsSinceEpoch}',
        title: 'Ticket successfully raised',
        body: '$ticketNumber has been created.',
        time: 'Just now',
        iconKey: 'ticket',
        createdAt: DateTime.now(),
        ticketNumber: ticketNumber,
      ),
    );
    notifyListeners();
  }

  Future<void> markAllRead() async {
    if (!demoMode) {
      for (final item in _items.where((row) => !row.isRead)) {
        await HospitalTicketApi.request(
          'POST',
          '/api/hospital-tickets/notifications/${item.id}/read',
        );
        item.isRead = true;
      }
      notifyListeners();
      return;
    }
    for (final item in _items) {
      item.isRead = true;
    }
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setStringList(
      'qpms_read_notifications',
      _items.map((item) => item.id).toList(),
    );
    notifyListeners();
  }

  Future<void> markRead(NotificationItem item) async {
    if (item.isRead) return;
    if (!demoMode) {
      await HospitalTicketApi.request(
        'POST',
        '/api/hospital-tickets/notifications/${item.id}/read',
      );
      item.isRead = true;
      notifyListeners();
      return;
    }
    item.isRead = true;
    final prefs = preferences ?? await SharedPreferences.getInstance();
    final readIds =
        prefs.getStringList('qpms_read_notifications') ?? <String>[];
    if (!readIds.contains(item.id)) {
      readIds.add(item.id);
      await prefs.setStringList('qpms_read_notifications', readIds);
    }
    notifyListeners();
  }

  void resetMockData() {
    _items = initialNotifications();
    notifyListeners();
  }

  Future<void> load() async {
    if (demoMode) return;
    _loading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final response = await HospitalTicketApi.request(
        'GET',
        '/api/hospital-tickets/notifications',
      );
      final rows = response['notifications'] is List
          ? response['notifications'] as List
          : const [];
      _items = rows.whereType<Map>().map((row) {
        final created = DateTime.tryParse('${row['created_at'] ?? ''}');
        final ticket = row['ticket'] is Map ? row['ticket'] as Map : const {};
        final metadata = row['metadata'] is Map
            ? row['metadata'] as Map
            : const {};
        final beforeImageUrl = '${row['before_image_url'] ?? ''}'.trim();
        final ticketId = '${row['ticket_id'] ?? metadata['ticket_id'] ?? ''}'
            .trim();
        final ticketNumber =
            '${ticket['ticket_no'] ?? metadata['ticket_no'] ?? ''}'.trim();
        return NotificationItem(
          id: '${row['id'] ?? ''}',
          title: '${row['title'] ?? 'Ticket update'}',
          body: '${row['body'] ?? ''}',
          time: _friendlyNotificationTime(created?.toLocal()),
          iconKey: '${row['notification_type'] ?? 'ticket'}',
          createdAt: created?.toLocal(),
          beforeImageUrl: beforeImageUrl.isEmpty ? null : beforeImageUrl,
          ticketId: ticketId.isEmpty ? null : ticketId,
          ticketNumber: ticketNumber.isEmpty ? null : ticketNumber,
          isRead: row['read_at'] != null,
        );
      }).toList();
    } catch (_) {
      _errorMessage = "Couldn't refresh notifications.";
    } finally {
      _loading = false;
      notifyListeners();
    }
  }
}

String _friendlyNotificationTime(DateTime? value) {
  if (value == null) return '';
  final now = DateTime.now();
  final difference = now.difference(value);
  if (difference.inSeconds < 60) return 'Just now';
  if (difference.inMinutes < 60) return '${difference.inMinutes} min ago';
  final sameDay =
      now.year == value.year &&
      now.month == value.month &&
      now.day == value.day;
  if (sameDay) return 'Today, ${_clock(value)}';
  final yesterday = now.subtract(const Duration(days: 1));
  final wasYesterday =
      yesterday.year == value.year &&
      yesterday.month == value.month &&
      yesterday.day == value.day;
  if (wasYesterday) return 'Yesterday';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${value.day} ${months[value.month - 1]}, ${_clock(value)}';
}

String _clock(DateTime value) {
  final hour = value.hour == 0
      ? 12
      : value.hour > 12
      ? value.hour - 12
      : value.hour;
  final minute = value.minute.toString().padLeft(2, '0');
  final period = value.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $period';
}
