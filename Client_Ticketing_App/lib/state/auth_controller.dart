import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/app_config.dart';
import '../services/hospital_ticket_api.dart';

class AuthController extends ChangeNotifier {
  static const _loggedInKey = 'qpms_logged_in';

  AuthController({this.preferences, bool? demoMode})
    : demoMode = demoMode ?? ClientAppConfig.demoMode;

  final SharedPreferences? preferences;
  final bool demoMode;
  Map<String, dynamic>? _profile;
  bool _isAuthenticated = false;
  bool _isLoading = false;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;
  Map<String, dynamic>? get profile => _profile;

  Future<void> load() async {
    final prefs = preferences ?? await SharedPreferences.getInstance();
    if (demoMode) {
      _isAuthenticated = prefs.getBool(_loggedInKey) ?? false;
    } else if (ClientAppConfig.isConfigured) {
      _isAuthenticated = Supabase.instance.client.auth.currentSession != null;
      if (_isAuthenticated) await loadProfile();
    }
    notifyListeners();
  }

  Future<bool> login(String userId, String password) async {
    _isLoading = true;
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
      ok = _profile?['profile_type'] == 'client';
      if (!ok) await Supabase.instance.client.auth.signOut();
      _isAuthenticated = ok;
    } catch (_) {
      ok = false;
    }
    _isLoading = false;
    notifyListeners();
    return ok;
  }

  Future<void> logout() async {
    _isAuthenticated = false;
    _profile = null;
    if (!demoMode && ClientAppConfig.isConfigured) {
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
}
