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

  List<NotificationItem> get items => List.unmodifiable(_items);
  int get unreadCount => _items.where((item) => !item.isRead).length;

  void addTicketRaisedNotification(String ticketNumber) {
    _items.insert(
      0,
      NotificationItem(
        id: 'raised-$ticketNumber-${DateTime.now().millisecondsSinceEpoch}',
        title: 'Ticket successfully raised',
        body: '$ticketNumber has been created.',
        time: 'Just now',
        iconKey: 'ticket',
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

  void resetMockData() {
    _items = initialNotifications();
    notifyListeners();
  }

  Future<void> load() async {
    if (demoMode) return;
    final response = await HospitalTicketApi.request(
      'GET',
      '/api/hospital-tickets/notifications',
    );
    final rows = response['notifications'] is List
        ? response['notifications'] as List
        : const [];
    _items = rows.whereType<Map>().map((row) {
      final created = DateTime.tryParse('${row['created_at'] ?? ''}');
      return NotificationItem(
        id: '${row['id'] ?? ''}',
        title: '${row['title'] ?? 'Ticket update'}',
        body: '${row['body'] ?? ''}',
        time: created?.toLocal().toString() ?? '',
        iconKey: '${row['notification_type'] ?? 'ticket'}',
        ticketNumber: row['ticket'] is Map
            ? '${(row['ticket'] as Map)['ticket_no'] ?? ''}'
            : null,
        isRead: row['read_at'] != null,
      );
    }).toList();
    notifyListeners();
  }
}
