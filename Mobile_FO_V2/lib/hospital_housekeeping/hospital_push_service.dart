import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'hospital_ticket_api.dart';

@pragma('vm:entry-point')
Future<void> hospitalTicketBackgroundMessageHandler(
  RemoteMessage message,
) async {
  await HospitalPushService.ensureFirebaseReady();
}

class HospitalPushMessage {
  const HospitalPushMessage({
    required this.title,
    required this.body,
    required this.data,
    this.openImmediately = false,
  });

  final String title;
  final String body;
  final Map<String, dynamic> data;
  final bool openImmediately;

  String get ticketId => '${data['ticket_id'] ?? ''}';
  String get ticketNumber => '${data['ticket_number'] ?? ''}';
  String get targetScreen => '${data['target_screen'] ?? ''}';
}

class HospitalPushService {
  static const appScope = 'myqpms_internal';
  static const _deviceKey = 'hospital_push_device_id_myqpms';
  static const _channel = AndroidNotificationChannel(
    'hospital_tickets',
    'Hospital ticket alerts',
    description: 'High-priority hospital ticket alerts',
    importance: Importance.high,
    playSound: true,
    enableVibration: true,
  );
  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  static final StreamController<HospitalPushMessage> _foregroundMessages =
      StreamController<HospitalPushMessage>.broadcast();
  static final List<HospitalPushMessage> _pendingMessages =
      <HospitalPushMessage>[];
  static bool _configured = false;
  static bool _firebaseReady = false;
  static bool _localNotificationsReady = false;
  static StreamSubscription<String>? _tokenRefreshSubscription;
  static String? _deviceId;

  static Stream<HospitalPushMessage> get foregroundMessages =>
      _foregroundMessages.stream;

  static List<HospitalPushMessage> takePendingMessages() {
    final messages = List<HospitalPushMessage>.from(_pendingMessages);
    _pendingMessages.clear();
    return messages;
  }

  static Future<void> ensureFirebaseReady() async {
    if (_firebaseReady) return;
    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (error) {
      debugPrint('Hospital push Firebase unavailable: $error');
    }
  }

  static Future<void> configure() async {
    if (_configured) return;
    _configured = true;
    await ensureFirebaseReady();
    if (!_firebaseReady) return;
    FirebaseMessaging.onBackgroundMessage(
      hospitalTicketBackgroundMessageHandler,
    );
    await _configureLocalNotifications();
    FirebaseMessaging.onMessage.listen((message) {
      final push = _fromRemoteMessage(message);
      _emit(push);
      unawaited(_showForegroundNotification(push));
    });
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _emit(_fromRemoteMessage(message, openImmediately: true));
    });
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) {
      _emit(_fromRemoteMessage(initial, openImmediately: true));
    }
  }

  static Future<void> registerAuthenticatedDevice() async {
    await configure();
    if (!_firebaseReady) return;
    final messaging = FirebaseMessaging.instance;
    final permission = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    final token = await messaging.getToken();
    if (token == null || token.isEmpty) return;
    await _registerToken(
      token,
      _permissionName(permission.authorizationStatus),
    );
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = messaging.onTokenRefresh.listen((freshToken) {
      unawaited(_registerToken(freshToken, 'granted'));
    });
  }

  static Future<void> unregisterAuthenticatedDevice() async {
    final deviceId = await _getDeviceId();
    try {
      await HospitalTicketApi.request(
        'DELETE',
        '/api/hospital-tickets/me/push-devices/$deviceId',
      );
    } catch (error) {
      debugPrint('Hospital push unregister skipped: $error');
    }
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;
  }

  static Future<void> _registerToken(String token, String permission) async {
    try {
      await HospitalTicketApi.request(
        'POST',
        '/api/hospital-tickets/me/push-devices',
        body: {
          'app_scope': appScope,
          'platform': Platform.isIOS
              ? 'ios'
              : Platform.isAndroid
              ? 'android'
              : 'unknown',
          'device_id': await _getDeviceId(),
          'fcm_token': token,
          'notification_permission': permission,
        },
      );
    } catch (error) {
      debugPrint('Hospital push registration skipped: $error');
    }
  }

  static Future<String> _getDeviceId() async {
    if (_deviceId != null) return _deviceId!;
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_deviceKey);
    if (id == null || id.isEmpty) {
      id = 'myqpms-${DateTime.now().microsecondsSinceEpoch}';
      await prefs.setString(_deviceKey, id);
    }
    _deviceId = id;
    return id;
  }

  static Future<void> _configureLocalNotifications() async {
    if (_localNotificationsReady) return;
    await _localNotifications.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        final push = _fromPayload(response.payload);
        if (push != null) _emit(push);
      },
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(_channel);
    await FirebaseMessaging.instance
        .setForegroundNotificationPresentationOptions(
          alert: true,
          badge: true,
          sound: true,
        );
    _localNotificationsReady = true;
  }

  static Future<void> _showForegroundNotification(
    HospitalPushMessage push,
  ) async {
    if (!_localNotificationsReady) return;
    final title = push.title.trim();
    final body = push.body.trim();
    if (title.isEmpty && body.isEmpty) return;
    await _localNotifications.show(
      id: DateTime.now().millisecondsSinceEpoch.remainder(2147483647),
      title: title.isEmpty ? 'Hospital Ticket Update' : title,
      body: body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          enableVibration: true,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: jsonEncode({
        'title': push.title,
        'body': push.body,
        'data': push.data,
      }),
    );
  }

  static HospitalPushMessage? _fromPayload(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final decoded = jsonDecode(payload);
      if (decoded is! Map) return null;
      return HospitalPushMessage(
        title: '${decoded['title'] ?? 'Hospital Ticket Update'}',
        body: '${decoded['body'] ?? ''}',
        data: decoded['data'] is Map
            ? Map<String, dynamic>.from(decoded['data'] as Map)
            : const <String, dynamic>{},
        openImmediately: true,
      );
    } catch (_) {
      return null;
    }
  }

  static void _emit(HospitalPushMessage message) {
    if (_foregroundMessages.hasListener) {
      _foregroundMessages.add(message);
    } else {
      _pendingMessages.add(message);
    }
  }

  static HospitalPushMessage _fromRemoteMessage(
    RemoteMessage message, {
    bool openImmediately = false,
  }) => HospitalPushMessage(
    title: message.notification?.title ?? 'Hospital Ticket Update',
    body: message.notification?.body ?? '',
    data: Map<String, dynamic>.from(message.data),
    openImmediately: openImmediately,
  );

  static String _permissionName(AuthorizationStatus status) => switch (status) {
    AuthorizationStatus.authorized => 'granted',
    AuthorizationStatus.provisional => 'provisional',
    AuthorizationStatus.denied => 'denied',
    AuthorizationStatus.notDetermined => 'unknown',
  };
}
