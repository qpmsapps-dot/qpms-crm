import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/mock_data.dart';
import '../models/notification_item.dart';

class NotificationController extends ChangeNotifier {
  NotificationController({this.preferences}) {
    resetMockData();
  }

  final SharedPreferences? preferences;
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
}
