import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/app_config.dart';
import '../services/client_push_service.dart';
import '../services/hospital_ticket_api.dart';

class AuthController extends ChangeNotifier {
  static const _loggedInKey = 'qpms_logged_in';
  static const _contactTokenKey = 'qpms_contact_token';
  static const _contactNameKey = 'qpms_contact_name';
  static const _contactMobileKey = 'qpms_contact_mobile';
  static const _contactProfileKey = 'qpms_contact_profile';

  AuthController({this.preferences, bool? demoMode, this.onSessionCleared})
    : demoMode = demoMode ?? ClientAppConfig.demoMode;

  final SharedPreferences? preferences;
  final bool demoMode;
  final VoidCallback? onSessionCleared;
  Map<String, dynamic>? _profile;
  bool _isAuthenticated = false;
  bool _isLoading = true;
  bool _bootstrapped = false;
  String? _errorMessage;
  Future<void>? _bootstrapFuture;
  Map<String, dynamic>? _pendingProfile;
  String? _pendingToken;
  int _identityRequestVersion = 0;

  @visibleForTesting
  static Future<void> Function()? registerPushDeviceForTesting;

  @visibleForTesting
  static Future<void> Function()? unregisterPushDeviceForTesting;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;
  bool get isBootstrapped => _bootstrapped;
  String? get errorMessage => _errorMessage;
  Map<String, dynamic>? get profile => _profile;
  Map<String, dynamic>? get pendingProfile => _pendingProfile;

  Future<void> load() => _bootstrapFuture ??= _bootstrap();

  Future<void> _bootstrap() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();
    final prefs = preferences ?? await SharedPreferences.getInstance();
    if (demoMode) {
      _isAuthenticated = prefs.getBool(_loggedInKey) ?? false;
    } else if (!ClientAppConfig.isConfigured) {
      _errorMessage = 'Client Ticketing is not configured for this build.';
    } else {
      final token = prefs.getString(_contactTokenKey) ?? '';
      if (token.isNotEmpty) {
        HospitalTicketApi.contactSessionToken = token;
        try {
          await loadProfile();
          _isAuthenticated = isAllowedClientProfile(_profile);
          if (!_isAuthenticated) {
            _errorMessage =
                'This registered mobile number is not authorised for Client Ticketing.';
          } else {
            await _registerPushDevice();
          }
        } catch (error) {
          _isAuthenticated = false;
          _profile = null;
          HospitalTicketApi.contactSessionToken = null;
          _errorMessage = _friendlyError(error);
        }
      }
    }
    _bootstrapped = true;
    _isLoading = false;
    notifyListeners();
  }

  Future<bool> login(String userId, String password) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();
    if (demoMode) {
      await Future<void>.delayed(const Duration(milliseconds: 300));
      final ok = userId.trim() == 'admin' && password == 'admin';
      if (ok) {
        _isAuthenticated = true;
        final prefs = preferences ?? await SharedPreferences.getInstance();
        await prefs.setBool(_loggedInKey, true);
      }
      _isLoading = false;
      notifyListeners();
      return ok;
    }
    if (!ClientAppConfig.isConfigured) {
      _isLoading = false;
      notifyListeners();
      return false;
    }
    return identifyRegisteredMobile(userId);
  }

  Future<bool> identifyRegisteredMobile(String mobile) async {
    final found = await lookupRegisteredMobile(mobile);
    if (!found) return false;
    await confirmRegisteredContact();
    return _isAuthenticated;
  }

  Future<bool> lookupRegisteredMobile(String mobile) async {
    final version = ++_identityRequestVersion;
    _isLoading = true;
    _errorMessage = null;
    _pendingProfile = null;
    _pendingToken = null;
    notifyListeners();
    var ok = false;
    try {
      final result = await HospitalTicketApi.identifyRegisteredMobile(mobile);
      if (version != _identityRequestVersion) return false;
      final token = '${result['token'] ?? ''}';
      final contact = result['contact'] is Map
          ? Map<String, dynamic>.from(result['contact'] as Map)
          : <String, dynamic>{};
      final client = result['client'] is Map
          ? Map<String, dynamic>.from(result['client'] as Map)
          : <String, dynamic>{};
      _pendingProfile = {
        ...contact,
        'client_id': client['id'],
        'client_name': client['name'],
        'client_code': client['code'],
        'client_short_name': client['short_name'],
        'client_logo_url': client['logo_url'],
        'client_banner_url': client['banner_url'],
        'client_configuration_version': client['configuration_version'],
        'profile_type': 'client_contact',
        'role_code': 'client_contact',
        'is_active': true,
      };
      _pendingToken = token;
      ok = token.isNotEmpty && isAllowedClientProfile(_pendingProfile);
      if (!ok) {
        _errorMessage =
            'This mobile number is not authorised for Client Ticketing.';
      }
    } catch (error) {
      if (version != _identityRequestVersion) return false;
      ok = false;
      _errorMessage = _friendlyError(error);
    }
    _isLoading = false;
    notifyListeners();
    return ok;
  }

  Future<void> confirmRegisteredContact() async {
    final pending = _pendingProfile;
    final token = _pendingToken;
    if (pending == null || token == null || token.isEmpty) {
      _errorMessage = 'Registered mobile verification is incomplete.';
      notifyListeners();
      return;
    }
    _profile = Map<String, dynamic>.from(pending);
    _isAuthenticated = isAllowedClientProfile(_profile);
    HospitalTicketApi.contactSessionToken = _isAuthenticated ? token : null;
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setBool(_loggedInKey, _isAuthenticated);
    if (_isAuthenticated) {
      onSessionCleared?.call();
      await prefs.setString(_contactTokenKey, token);
      await prefs.setString(_contactNameKey, '${_profile?['full_name'] ?? ''}');
      await prefs.setString(_contactMobileKey, '${_profile?['mobile'] ?? ''}');
      await prefs.setString(_contactProfileKey, jsonEncode(_profile));
      _pendingProfile = null;
      _pendingToken = null;
      await _registerPushDevice();
    }
    notifyListeners();
  }

  void clearPendingContact() {
    _identityRequestVersion++;
    _pendingProfile = null;
    _pendingToken = null;
    _errorMessage = null;
    notifyListeners();
  }

  @visibleForTesting
  void setPendingRegisteredContactForTesting({
    required Map<String, dynamic> profile,
    required String token,
  }) {
    _pendingProfile = Map<String, dynamic>.from(profile);
    _pendingToken = token;
  }

  Future<void> logout() async {
    _identityRequestVersion++;
    _isAuthenticated = false;
    _profile = null;
    _pendingProfile = null;
    _pendingToken = null;
    onSessionCleared?.call();
    notifyListeners();
    final token = HospitalTicketApi.contactSessionToken;
    if (!demoMode && token != null && token.isNotEmpty) {
      await _unregisterPushDevice();
    }
    HospitalTicketApi.contactSessionToken = null;
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setBool(_loggedInKey, false);
    await prefs.remove(_contactTokenKey);
    await prefs.remove(_contactNameKey);
    await prefs.remove(_contactMobileKey);
    await prefs.remove(_contactProfileKey);
    notifyListeners();
  }

  Future<void> loadProfile() async {
    final version = _identityRequestVersion;
    final token = HospitalTicketApi.contactSessionToken;
    final response = await HospitalTicketApi.request(
      'GET',
      '/api/hospital-tickets/me',
    );
    if (version != _identityRequestVersion ||
        token != HospitalTicketApi.contactSessionToken) {
      return;
    }
    _profile = response['user'] is Map
        ? Map<String, dynamic>.from(response['user'] as Map)
        : null;
    final client = response['client'] is Map
        ? Map<String, dynamic>.from(response['client'] as Map)
        : <String, dynamic>{};
    if (_profile != null && client['id'] == _profile!['client_id']) {
      _profile!.addAll({
        'client_name': client['name'],
        'client_code': client['code'],
        'client_short_name': client['short_name'],
        'client_logo_url': client['logo_url'],
        'client_banner_url': client['banner_url'],
        'client_configuration_version': client['configuration_version'],
      });
    }
    notifyListeners();
    if (kDebugMode) {
      debugPrint(
        '[HospitalActor] user_id=${_profile?['id'] ?? ''} '
        'client_id=${_profile?['client_id'] ?? ''} '
        'role=${_profile?['role_code'] ?? ''} '
        'demoMode=$demoMode',
      );
    }
  }

  static bool isAllowedClientProfile(Map<String, dynamic>? profile) =>
      profile?['profile_type'] == 'client_contact' &&
      profile?['role_code'] == 'client_contact' &&
      '${profile?['client_id'] ?? ''}'.isNotEmpty &&
      profile?['is_active'] != false;

  static Future<void> _registerPushDevice() async {
    try {
      final register =
          registerPushDeviceForTesting ??
          ClientPushService.registerAuthenticatedDevice;
      await register();
    } catch (error) {
      debugPrint('QPMS client push registration skipped: $error');
    }
  }

  static Future<void> _unregisterPushDevice() async {
    try {
      final unregister =
          unregisterPushDeviceForTesting ??
          ClientPushService.unregisterAuthenticatedDevice;
      await unregister();
    } catch (error) {
      debugPrint('QPMS client push unregister skipped: $error');
    }
  }

  String _friendlyError(Object error) {
    if (error is HospitalApiException) {
      final code = error.code.toLowerCase();
      if (error.statusCode == 401 ||
          code.contains('token') ||
          code.contains('session')) {
        return 'Your session has expired. Please sign in again.';
      }
      if (code.contains('inactive')) {
        return 'This hospital contact is inactive. Please contact QPMS support.';
      }
      if (error.statusCode == 403 || code.contains('profile')) {
        return 'Mobile number is not registered for Hospital Client Ticketing. Please contact QPMS support.';
      }
      return error.message;
    }
    return 'Unable to reach QPMS. Check your connection and try again.';
  }
}
