import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class SiteAwayNotificationService {
  static const notificationId = 15703;
  static const channelId = 'myqpms_site_away';
  static const _androidNotificationIcon = 'ic_notification';
  static const body =
      'You are away from the checked-in site. Please check out if your site visit is completed.';

  static final FlutterLocalNotificationsPlugin _notifications =
      FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> show() async {
    if (!_initialized) {
      await _notifications.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings(_androidNotificationIcon),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: false,
            requestBadgePermission: false,
            requestSoundPermission: false,
          ),
        ),
      );
      _initialized = true;
    }

    await _notifications.show(
      id: notificationId,
      title: 'Away from checked-in site',
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          'Site-away reminders',
          channelDescription: 'Reminders to check out after leaving a site',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }
}
