import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthController extends ChangeNotifier {
  static const _loggedInKey = 'qpms_logged_in';

  AuthController({this.preferences});

  final SharedPreferences? preferences;
  bool _isAuthenticated = false;
  bool _isLoading = false;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;

  Future<void> load() async {
    final prefs = preferences ?? await SharedPreferences.getInstance();
    _isAuthenticated = prefs.getBool(_loggedInKey) ?? false;
    notifyListeners();
  }

  Future<bool> login(String userId, String password) async {
    _isLoading = true;
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 500));
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

  Future<void> logout() async {
    _isAuthenticated = false;
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setBool(_loggedInKey, false);
    notifyListeners();
  }
}
