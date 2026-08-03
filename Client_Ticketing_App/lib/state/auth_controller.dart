import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/app_config.dart';
import '../services/client_push_service.dart';
import '../services/hospital_ticket_api.dart';

class AuthController extends ChangeNotifier {
  static const _loggedInKey = 'qpms_logged_in';

  AuthController({this.preferences, bool? demoMode})
    : demoMode = demoMode ?? ClientAppConfig.demoMode;

  final SharedPreferences? preferences;
  final bool demoMode;
  Map<String, dynamic>? _profile;
  bool _isAuthenticated = false;
  bool _isLoading = true;
  bool _bootstrapped = false;
  String? _errorMessage;
  StreamSubscription<AuthState>? _authSubscription;
  Future<void>? _bootstrapFuture;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;
  bool get isBootstrapped => _bootstrapped;
  String? get errorMessage => _errorMessage;
  Map<String, dynamic>? get profile => _profile;

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
      final auth = Supabase.instance.client.auth;
      await _authSubscription?.cancel();
      _authSubscription = auth.onAuthStateChange.listen(_handleAuthState);
      final session = auth.currentSession;
      if (session != null) {
        try {
          await loadProfile();
          _isAuthenticated = isAllowedClientProfile(_profile);
          if (!_isAuthenticated) {
            _errorMessage =
                'This account is not authorised for Client Ticketing.';
            await auth.signOut();
          } else {
            unawaited(ClientPushService.registerAuthenticatedDevice());
          }
        } catch (error) {
          _isAuthenticated = false;
          _errorMessage = _friendlyError(error);
        }
      }
    }
    _bootstrapped = true;
    _isLoading = false;
    notifyListeners();
  }

  Future<void> _handleAuthState(AuthState state) async {
    if (state.event == AuthChangeEvent.signedOut || state.session == null) {
      _isAuthenticated = false;
      _profile = null;
      if (_bootstrapped) {
        _errorMessage = 'Your session has expired. Please sign in again.';
      }
      notifyListeners();
      return;
    }
    if (state.event == AuthChangeEvent.signedIn ||
        state.event == AuthChangeEvent.tokenRefreshed ||
        state.event == AuthChangeEvent.userUpdated) {
      if (_isLoading && state.event == AuthChangeEvent.signedIn) return;
      try {
        await loadProfile();
        _isAuthenticated = isAllowedClientProfile(_profile);
      } catch (error) {
        _isAuthenticated = false;
        _errorMessage = _friendlyError(error);
      }
      notifyListeners();
    }
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
    var ok = false;
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: userId.trim().toLowerCase(),
        password: password,
      );
      await loadProfile();
      ok = isAllowedClientProfile(_profile);
      if (!ok) await Supabase.instance.client.auth.signOut();
      _isAuthenticated = ok;
      if (ok) unawaited(ClientPushService.registerAuthenticatedDevice());
      if (!ok) {
        _errorMessage = 'This account is not authorised for Client Ticketing.';
      }
    } catch (error) {
      ok = false;
      _errorMessage = _friendlyError(error);
    }
    _isLoading = false;
    notifyListeners();
    return ok;
  }

  Future<void> logout() async {
    _isAuthenticated = false;
    _profile = null;
    if (!demoMode && ClientAppConfig.isConfigured) {
      await ClientPushService.unregisterAuthenticatedDevice();
      await Supabase.instance.client.auth.signOut();
    }
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setBool(_loggedInKey, false);
    notifyListeners();
  }

  Future<void> loadProfile() async {
    final response = await HospitalTicketApi.request(
      'GET',
      '/api/hospital-tickets/me',
    );
    _profile = response['user'] is Map
        ? Map<String, dynamic>.from(response['user'] as Map)
        : null;
  }

  static bool isAllowedClientProfile(Map<String, dynamic>? profile) =>
      profile?['profile_type'] == 'client' &&
      const {'doctor', 'hospital_management'}.contains(profile?['role_code']) &&
      profile?['is_active'] != false;

  String _friendlyError(Object error) {
    if (error is AuthException) {
      return error.statusCode == '400'
          ? 'Invalid Login ID or password.'
          : 'Unable to validate your sign-in. Please try again.';
    }
    if (error is HospitalApiException) {
      final code = error.code.toLowerCase();
      if (error.statusCode == 401 ||
          code.contains('token') ||
          code.contains('session')) {
        return 'Your session has expired. Please sign in again.';
      }
      if (code.contains('inactive')) {
        return 'This hospital user is inactive. Contact your administrator.';
      }
      if (error.statusCode == 403 || code.contains('profile')) {
        return 'No active hospital profile mapping was found for this account.';
      }
      return error.message;
    }
    return 'Unable to reach QPMS. Check your connection and try again.';
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }
}
