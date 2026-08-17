import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/supabase_service.dart';
import 'hospital_ticket_api.dart';

@pragma('vm:entry-point')
Future<void> hospitalTicketBackgroundMessageHandler(
  RemoteMessage message,
) async {
  await HospitalPushService.ensureFirebaseReady();
  await HospitalPushService.showRemoteMessageNotification(message);
}

@pragma('vm:entry-point')
void hospitalNotificationResponseBackgroundHandler(
  NotificationResponse response,
) {
  HospitalPushService.handleNotificationResponse(response, background: true);
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
  String get eventType => '${data['event_type'] ?? ''}';
  String get notificationId => '${data['notification_id'] ?? ''}';
  DateTime? get acceptanceDueAt =>
      DateTime.tryParse('${data['acceptance_due_at'] ?? ''}')?.toLocal();
}

class HospitalPushService {
  static const appScope = 'myqpms_internal';
  static const acceptActionId = 'hospital_accept_ticket';
  static const viewActionId = 'hospital_view_ticket';
  static const _deviceKey = 'hospital_push_device_id_myqpms';
  static const _androidNotificationIcon = 'ic_notification';
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
      unawaited(_showNotification(push));
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
    try {
      await _localNotifications.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings(_androidNotificationIcon),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: false,
            requestBadgePermission: false,
            requestSoundPermission: false,
          ),
        ),
        onDidReceiveNotificationResponse: (response) {
          handleNotificationResponse(response);
        },
        onDidReceiveBackgroundNotificationResponse:
            hospitalNotificationResponseBackgroundHandler,
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
    } catch (error, stackTrace) {
      _localNotificationsReady = false;
      debugPrint('Hospital push local notification setup failed: $error');
      debugPrint('$stackTrace');
    }
  }

  static Future<void> showRemoteMessageNotification(RemoteMessage message) async {
    if (message.notification != null) return;
    if (!_localNotificationsReady) await _configureLocalNotifications();
    await _showNotification(_fromRemoteMessage(message));
  }

  static Future<void> _showNotification(HospitalPushMessage push) async {
    if (!_localNotificationsReady) return;
    final incoming = push.eventType == 'incoming_supervisor_ticket';
    if (incoming && !_isAcceptanceActionable(push)) return;
    final title = incoming ? 'New Housekeeping Complaint' : push.title.trim();
    final body = incoming ? _incomingTicketBody(push) : push.body.trim();
    if (title.isEmpty && body.isEmpty) return;
    await _localNotifications.show(
      id: _notificationId(push),
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
          when: incoming
              ? push.acceptanceDueAt?.millisecondsSinceEpoch
              : null,
          usesChronometer: incoming,
          chronometerCountDown: incoming,
          timeoutAfter: incoming ? _remainingMs(push) : null,
          subText: incoming ? 'Accept before timeout' : null,
          actions: incoming
              ? const [
                  AndroidNotificationAction(
                    acceptActionId,
                    'ACCEPT',
                    showsUserInterface: false,
                    cancelNotification: true,
                    semanticAction: SemanticAction.markAsRead,
                  ),
                  AndroidNotificationAction(
                    viewActionId,
                    'VIEW',
                    showsUserInterface: true,
                    cancelNotification: true,
                  ),
                ]
              : null,
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

  static void handleNotificationResponse(
    NotificationResponse response, {
    bool background = false,
  }) {
    final push = _fromPayload(response.payload);
    if (push == null) return;
    if (response.actionId == acceptActionId) {
      unawaited(_acceptFromNotification(push));
      return;
    }
    _emit(push);
  }

  static Future<void> _acceptFromNotification(HospitalPushMessage push) async {
    final ticketId = push.ticketId.isNotEmpty ? push.ticketId : push.ticketNumber;
    if (ticketId.isEmpty) return;
    if (!_isAcceptanceActionable(push)) {
      await _showStatusNotification(
        'Acceptance window expired',
        'Ticket has moved to Operations.',
      );
      await _localNotifications.cancel(id: _notificationId(push));
      return;
    }
    try {
      await SupabaseService.initialize();
      var version = int.tryParse('${push.data['ticket_version'] ?? ''}');
      if (version == null || version < 1) {
        final detail = await HospitalTicketApi.fetchDetail(ticketId);
        final row = detail['ticket'] is Map
            ? Map<String, dynamic>.from(detail['ticket'] as Map)
            : const <String, dynamic>{};
        version = int.tryParse('${row['version'] ?? ''}');
      }
      if (version == null || version < 1) {
        throw const HospitalTicketApiException(
          'Open myQPMS to accept this ticket.',
        );
      }
      await HospitalTicketApi.action(ticketId, 'accept', version, {
        'confirmed_location': true,
      });
      await _localNotifications.cancel(id: _notificationId(push));
      await _showStatusNotification(
        'Ticket accepted',
        push.ticketNumber.isEmpty
            ? 'Housekeeping complaint accepted.'
            : '${push.ticketNumber} accepted.',
      );
    } catch (error) {
      final text = error.toString().toLowerCase();
      final message = text.contains('expired') ||
              text.contains('timeout') ||
              text.contains('moved') ||
              text.contains('not allowed')
          ? 'Acceptance window has expired. Ticket has moved to Operations.'
          : text.contains('accepted') || text.contains('conflict')
          ? 'Ticket has already been accepted by another Supervisor.'
          : text.contains('session') || text.contains('sign in')
          ? 'Please open myQPMS and sign in to accept this ticket.'
          : 'Unable to accept now. Open myQPMS to retry.';
      await _showStatusNotification('Ticket not accepted', message);
    }
  }

  static Future<void> _showStatusNotification(String title, String body) async {
    if (!_localNotificationsReady) await _configureLocalNotifications();
    if (!_localNotificationsReady) return;
    await _localNotifications.show(
      id: DateTime.now().millisecondsSinceEpoch.remainder(2147483647),
      title: title,
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
    );
  }

  static bool _isAcceptanceActionable(HospitalPushMessage push) {
    final dueAt = push.acceptanceDueAt;
    return dueAt != null && dueAt.isAfter(DateTime.now());
  }

  static int? _remainingMs(HospitalPushMessage push) {
    final dueAt = push.acceptanceDueAt;
    if (dueAt == null) return null;
    final remaining = dueAt.difference(DateTime.now()).inMilliseconds;
    return remaining > 0 ? remaining : 1;
  }

  static int _notificationId(HospitalPushMessage push) {
    final key = push.notificationId.isNotEmpty
        ? push.notificationId
        : push.ticketId.isNotEmpty
        ? push.ticketId
        : push.ticketNumber;
    return key.hashCode.abs().remainder(2147483647);
  }

  static String _incomingTicketBody(HospitalPushMessage push) {
    final block = '${push.data['block_name'] ?? ''}'.trim();
    final floor = '${push.data['floor_name'] ?? ''}'.trim();
    final category = '${push.data['category_name'] ?? 'General Housekeeping'}'
        .trim();
    final priority = '${push.data['priority'] ?? ''}'.trim().toUpperCase();
    final firstLine = [
      if (block.isNotEmpty) block,
      if (floor.isNotEmpty) floor,
    ].join(' • ');
    final secondLine = [
      if (category.isNotEmpty) category,
      if (priority.isNotEmpty) priority,
    ].join(' • ');
    return [
      if (firstLine.isNotEmpty) firstLine,
      if (secondLine.isNotEmpty) secondLine,
    ].join('\n');
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
