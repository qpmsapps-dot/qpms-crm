import 'dart:async';
import 'dart:io';

import 'package:battery_plus/battery_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import 'models/fo_models.dart';
import 'services/fo_crash_log_service.dart';
import 'services/fo_permission_service.dart';
import 'services/fo_route_service.dart';
import 'services/fo_storage_service.dart';
import 'services/fo_sync_service.dart';
import 'services/fo_tracking_service.dart';
import 'services/supabase_service.dart';

const _brandBlue = Color(0xFF0A43D1);
const _secondaryBlue = Color(0xFF1E5BFF);
const _lightBlue = Color(0xFFEAF2FF);
const _surface = Color(0xFFF7F9FC);
const _border = Color(0xFFE3E8EF);
const _textPrimary = Color(0xFF0F172A);
const _textSecondary = Color(0xFF64748B);
const _night = Color(0xFF07121F);
const _nightSurface = Color(0xFF0D1B2C);
const _nightBorder = Color(0xFF1D3044);
const _success = Color(0xFF22C55E);
const _warning = Color(0xFFF59E0B);
const _errorRed = Color(0xFFEF4444);

FoUser _activeFoUser = FoUser.demo;

void _startDayLog(String message) {
  debugPrint('[myQPMS FO] $message');
}

Future<void> _persistStartDayLog(
  String action, {
  String? employeeCode,
  Object? error,
  StackTrace? stackTrace,
}) {
  return FoCrashLogService.record(
    employeeCode: employeeCode ?? _activeFoUser.id,
    screen: 'StartDay',
    action: action,
    error: error ?? 'breadcrumb',
    stackTrace: stackTrace,
    syncNow: error != null,
  );
}

bool _hasValidFoIdentity(FoUser user) =>
    user.id.trim().isNotEmpty && user.username.trim().isNotEmpty;

Future<bool> _ensureStartDayPermission() async {
  try {
    _startDayLog('START_DAY_PERMISSION_CHECK_START');
    var snapshot = await FoPermissionService.checkRequired();
    _startDayLog('LOCATION_PERMISSION_STATUS: ${snapshot.statuses}');
    if (!snapshot.allGranted) {
      snapshot = await FoPermissionService.requestRequired();
      _startDayLog('LOCATION_PERMISSION_STATUS: ${snapshot.statuses}');
    }
    _startDayLog(
      snapshot.allGranted
          ? 'START_DAY_PERMISSION_CHECK_SUCCESS'
          : 'START_DAY_PERMISSION_CHECK_FAILED',
    );
    return snapshot.allGranted;
  } catch (error, stackTrace) {
    _startDayLog('START_DAY_PERMISSION_CHECK_FAILED: $error');
    debugPrintStack(stackTrace: stackTrace);
    return false;
  }
}

Future<Position?> _fetchStartDayLocation() async {
  _startDayLog('GPS_FETCH_START');
  try {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    _startDayLog('LOCATION_SERVICE_STATUS: $serviceEnabled');
    if (!serviceEnabled) {
      _startDayLog('GPS_FETCH_FAILED: location service disabled');
      return null;
    }
    var permission = await Geolocator.checkPermission();
    _startDayLog('LOCATION_PERMISSION_STATUS: $permission');
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      _startDayLog('LOCATION_PERMISSION_STATUS: $permission');
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      _startDayLog('GPS_FETCH_FAILED: location permission $permission');
      return null;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 30),
      ),
    );
    _startDayLog('GPS_FETCH_SUCCESS');
    return position;
  } catch (error, stackTrace) {
    _startDayLog('GPS_FETCH_FAILED: $error');
    debugPrintStack(stackTrace: stackTrace);
    return null;
  }
}

Future<int?> _fetchStartDayBattery() async {
  try {
    final battery = await Battery().batteryLevel;
    _startDayLog('BATTERY_FETCH_SUCCESS: $battery');
    return battery;
  } catch (error, stackTrace) {
    _startDayLog('BATTERY_FETCH_FAILED: $error');
    debugPrintStack(stackTrace: stackTrace);
    return null;
  }
}

bool _isUsableTrackingPosition(Position position) {
  final latitude = position.latitude;
  final longitude = position.longitude;
  final accuracy = position.accuracy;
  return latitude.isFinite &&
      longitude.isFinite &&
      accuracy.isFinite &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      accuracy >= 0 &&
      accuracy <= 1000;
}

class MyQpmsFoApp extends StatefulWidget {
  const MyQpmsFoApp({super.key});

  @override
  State<MyQpmsFoApp> createState() => _MyQpmsFoAppState();
}

class _MyQpmsFoAppState extends State<MyQpmsFoApp> with WidgetsBindingObserver {
  bool? _signedIn;
  bool _permissionsCompleted = false;
  ThemeMode _themeMode = ThemeMode.light;
  String? _startupError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _bootstrapAndRestoreSession();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && (_signedIn ?? false)) {
      _refreshPermissionAndTrackingState();
    }
  }

  Future<void> _bootstrapAndRestoreSession() async {
    var hasSession = false;
    var permissionSetupComplete = false;
    await FoCrashLogService.printLatest();
    try {
      await QpmsSupabaseService.initialize();
      unawaited(FoCrashLogService.syncPending());
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Supabase startup failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        setState(() {
          _signedIn = false;
          _permissionsCompleted = false;
          _startupError = error.toString();
        });
      }
      return;
    }

    try {
      hasSession = await FoLocalStorage.hasSession();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Session lookup failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }

    try {
      final snapshot = await FoPermissionService.checkRequired();
      permissionSetupComplete = snapshot.allGranted;
      if (permissionSetupComplete) {
        await FoLocalStorage.setPermissionSetupComplete();
      } else {
        await FoLocalStorage.clearPermissionSetupComplete();
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Permission startup check failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      permissionSetupComplete = false;
    }

    if (hasSession) {
      try {
        _activeFoUser = await FoLocalStorage.getSessionUser();
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] Session user restore failed: $error');
        debugPrintStack(stackTrace: stackTrace);
        hasSession = false;
      }
    }

    if (mounted) {
      setState(() {
        _signedIn = hasSession;
        _permissionsCompleted = permissionSetupComplete;
      });
    }
    if (hasSession && permissionSetupComplete) {
      unawaited(_resumeTrackingIfActiveAttendance());
    }
  }

  Future<void> _onLogin(FoUser user) async {
    _activeFoUser = user;
    await FoLocalStorage.setSession(user: user);
    var permissionSetupComplete = false;
    try {
      final snapshot = await FoPermissionService.checkRequired();
      permissionSetupComplete = snapshot.allGranted;
      if (permissionSetupComplete) {
        await FoLocalStorage.setPermissionSetupComplete();
      } else {
        await FoLocalStorage.clearPermissionSetupComplete();
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Login permission check failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
    if (mounted) {
      setState(() {
        _signedIn = true;
        _permissionsCompleted = permissionSetupComplete;
      });
    }
    if (permissionSetupComplete) {
      unawaited(_resumeTrackingIfActiveAttendance());
    }
  }

  Future<void> _refreshPermissionAndTrackingState() async {
    try {
      final snapshot = await FoPermissionService.checkRequired();
      final permissionSetupComplete = snapshot.allGranted;
      if (permissionSetupComplete) {
        await FoLocalStorage.setPermissionSetupComplete();
        await _resumeTrackingIfActiveAttendance();
      } else {
        await FoLocalStorage.clearPermissionSetupComplete();
        await FoTrackingService.stop();
      }
      if (mounted) {
        setState(() => _permissionsCompleted = permissionSetupComplete);
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Permission resume check failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        setState(() => _permissionsCompleted = false);
      }
    }
  }

  Future<void> _resumeTrackingIfActiveAttendance() async {
    try {
      final attendance = await FoLocalStorage.getActiveAttendance();
      if (attendance == null || !attendance.isActive) {
        await FoTrackingService.stop();
        return;
      }
      await FoTrackingService.start();
    } catch (error, stackTrace) {
      debugPrint(
        '[myQPMS FO] Active attendance tracking resume failed: $error',
      );
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  Future<void> _onLogout() async {
    try {
      final activeAttendance = await FoLocalStorage.getActiveAttendance();
      if (activeAttendance != null) {
        activeAttendance
          ..logoutTime ??= DateTime.now()
          ..isActive = false;
        try {
          activeAttendance.batteryEnd = await Battery().batteryLevel;
        } catch (_) {}
        await FoLocalStorage.saveAttendance(activeAttendance);
        await FoSyncService.syncAttendance(activeAttendance);
        await FoSyncService.upsertLiveStatus(
          foId: activeAttendance.foId,
          attendance: activeAttendance,
          isOnline: false,
          isTracking: false,
          currentStatus: 'offline',
          batteryPercentage: activeAttendance.batteryEnd,
          routeKmToday: activeAttendance.totalRouteKm,
        );
      } else {
        await FoSyncService.upsertLiveStatus(
          foId: _activeFoUser.id,
          isOnline: false,
          isTracking: false,
          currentStatus: 'offline',
        );
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Logout live status update failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
    await FoTrackingService.stop();
    await FoLocalStorage.clearSession();
    if (mounted) {
      setState(() {
        _signedIn = false;
        _permissionsCompleted = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'myQPMS',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'Inter',
        scaffoldBackgroundColor: _surface,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _brandBlue,
          primary: _brandBlue,
          secondary: _secondaryBlue,
          surface: Colors.white,
          error: _errorRed,
        ),
        textTheme: ThemeData.light().textTheme.apply(
          bodyColor: _textPrimary,
          displayColor: _textPrimary,
          fontFamily: 'Inter',
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: _textPrimary,
          elevation: 0,
          scrolledUnderElevation: 1,
          centerTitle: true,
          titleTextStyle: TextStyle(
            color: _textPrimary,
            fontFamily: 'Inter',
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
        ),
        cardTheme: CardThemeData(
          margin: EdgeInsets.zero,
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: _border),
            borderRadius: BorderRadius.circular(20),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          labelStyle: const TextStyle(color: _textSecondary),
          hintStyle: const TextStyle(color: _textSecondary),
          prefixIconColor: _textPrimary,
          suffixIconColor: _textPrimary,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 18,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _brandBlue, width: 1.4),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: _brandBlue,
            foregroundColor: Colors.white,
            textStyle: const TextStyle(
              fontWeight: FontWeight.w500,
              fontSize: 16,
            ),
            minimumSize: const Size.fromHeight(54),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: _night,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3C74FA),
          brightness: Brightness.dark,
          surface: _nightSurface,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: _night,
          foregroundColor: Colors.white,
          elevation: 0,
          scrolledUnderElevation: 0,
        ),
        cardTheme: CardThemeData(
          margin: EdgeInsets.zero,
          color: _nightSurface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: _nightBorder),
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: _night,
          indicatorColor: Color(0xFF173A83),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: _nightSurface,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _nightBorder),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: _nightBorder),
          ),
        ),
      ),
      home: _startupError != null
          ? _ConfigurationErrorScreen(message: _startupError!)
          : _signedIn == null
          ? const _Splash()
          : !_signedIn!
          ? FoLoginScreen(onLogin: _onLogin)
          : !_permissionsCompleted
          ? PermissionSetupScreen(
              onComplete: () {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) {
                    setState(() => _permissionsCompleted = true);
                  }
                });
              },
              onLogout: _onLogout,
            )
          : FoOperationsShell(
              onLogout: _onLogout,
              themeMode: _themeMode,
              onThemeModeChanged: (mode) => setState(() => _themeMode = mode),
            ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [_secondaryBlue, _brandBlue, Color(0xFF05206D)],
          ),
        ),
        child: Stack(
          children: [
            const Positioned.fill(child: _RoutePattern()),
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _CitySkyline(),
            ),
            SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Spacer(flex: 3),
                      const _LogoMark(size: 92),
                      const SizedBox(height: 18),
                      const _BrandWordmark(
                        fontSize: 36,
                        qpmsColor: Colors.white,
                        myColor: Color(0xFF56B8FF),
                      ),
                      const SizedBox(height: 34),
                      Text(
                        'Track. Report. Achieve.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Your Field Work Simplified.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w400,
                            ),
                      ),
                      const Spacer(flex: 4),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConfigurationErrorScreen extends StatelessWidget {
  const _ConfigurationErrorScreen({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final missing = QpmsSupabaseService.missingRequiredKeys;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.error_outline,
                        color: Color(0xFFD8404F),
                        size: 34,
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Mobile configuration missing',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Rebuild the APK with required --dart-define values before testing FO GPS sync.',
                      ),
                      const SizedBox(height: 14),
                      if (missing.isNotEmpty)
                        ...missing.map(
                          (key) => Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Text(
                              key,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: Color(0xFFD8404F),
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(height: 8),
                      Text(
                        message,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF596A88),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class FoLoginScreen extends StatefulWidget {
  const FoLoginScreen({required this.onLogin, super.key});

  final Future<void> Function(FoUser user) onLogin;

  @override
  State<FoLoginScreen> createState() => _FoLoginScreenState();
}

class _FoLoginScreenState extends State<FoLoginScreen> {
  final _mobileController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void dispose() {
    _mobileController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final user = await QpmsSupabaseService.signInFoByMobile(
        mobile: _mobileController.text,
        password: _passwordController.text,
      );
      await widget.onLogin(user);
    } catch (error) {
      final demoUser = FoUser.byUsername(_mobileController.text);
      if (demoUser != null && _passwordController.text == '123456') {
        await widget.onLogin(demoUser);
        return;
      }
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = error.toString().replaceFirst('Bad state: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(28, 28, 28, 18),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 390),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _BrandHeader(size: 52, fontSize: 30),
                  const SizedBox(height: 44),
                  Text(
                    'Welcome Back!',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Please login to continue.',
                    style: TextStyle(color: _textPrimary, fontSize: 16),
                  ),
                  const SizedBox(height: 34),
                  TextField(
                    controller: _mobileController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      hintText: 'Mobile Number',
                      prefixIcon: Icon(Icons.phone_outlined),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    decoration:
                        const InputDecoration(
                          hintText: 'Password',
                          prefixIcon: Icon(Icons.lock_outline),
                        ).copyWith(
                          suffixIcon: IconButton(
                            tooltip: _obscurePassword
                                ? 'Show password'
                                : 'Hide password',
                            onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword,
                            ),
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                          ),
                        ),
                  ),
                  const SizedBox(height: 14),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () {},
                      child: const Text(
                        'Forgot Password?',
                        style: TextStyle(
                          color: _brandBlue,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 6),
                    Text(_error!, style: const TextStyle(color: _errorRed)),
                  ],
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _isLoading ? null : _signIn,
                      child: Text(_isLoading ? 'Logging in...' : 'Login'),
                    ),
                  ),
                  const SizedBox(height: 34),
                  const _DividerLabel(label: 'OR'),
                  const SizedBox(height: 26),
                  Center(
                    child: Text(
                      'New Here?',
                      style: Theme.of(
                        context,
                      ).textTheme.bodyMedium?.copyWith(color: _textPrimary),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => SelfRegistrationScreen(
                              onRegistered: widget.onLogin,
                            ),
                          ),
                        );
                      },
                      icon: const Icon(Icons.person_add_alt_1_outlined),
                      label: const Text('Register Now'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _brandBlue,
                        side: const BorderSide(color: _brandBlue),
                        textStyle: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 17,
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 15),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                  const Center(
                    child: Text(
                      'Version 1.0.0',
                      style: TextStyle(color: _textSecondary, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({this.size = 46, this.fontSize = 22});

  final double size;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _LogoMark(size: size),
        const SizedBox(width: 12),
        _BrandWordmark(fontSize: fontSize),
      ],
    );
  }
}

class _BrandWordmark extends StatelessWidget {
  const _BrandWordmark({
    required this.fontSize,
    this.myColor = _secondaryBlue,
    this.qpmsColor = const Color(0xFF07146B),
  });

  final double fontSize;
  final Color myColor;
  final Color qpmsColor;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: 'my',
        style: TextStyle(
          fontSize: fontSize,
          color: myColor,
          fontWeight: FontWeight.w700,
        ),
        children: [
          TextSpan(
            text: 'QPMS',
            style: TextStyle(color: qpmsColor, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _LogoMark extends StatelessWidget {
  const _LogoMark({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: Image.asset(
        'assets/qpms-logo.png',
        width: size,
        height: size,
        fit: BoxFit.cover,
      ),
    );
  }
}

class SelfRegistrationScreen extends StatefulWidget {
  const SelfRegistrationScreen({required this.onRegistered, super.key});

  final Future<void> Function(FoUser user) onRegistered;

  @override
  State<SelfRegistrationScreen> createState() => _SelfRegistrationScreenState();
}

class _SelfRegistrationScreenState extends State<SelfRegistrationScreen> {
  final _controllers = List.generate(6, (_) => TextEditingController());
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _isSubmitting = false;
  DateTime? _birthDate;
  String? _gender;
  String? _stateName;
  String? _error;

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submitRegistration() async {
    final fullName = _controllers[0].text.trim();
    final mobile = _controllers[1].text.trim();
    final email = _controllers[2].text.trim();
    final password = _controllers[4].text;
    final confirmPassword = _controllers[5].text;

    if (fullName.isEmpty ||
        mobile.isEmpty ||
        email.isEmpty ||
        _birthDate == null ||
        _gender == null ||
        _stateName == null ||
        password.isEmpty ||
        confirmPassword.isEmpty) {
      setState(() => _error = 'Please fill all registration fields.');
      return;
    }
    if (password != confirmPassword) {
      setState(() => _error = 'Password and confirm password do not match.');
      return;
    }
    if (password.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters.');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final user = await QpmsSupabaseService.registerFoUser(
        fullName: fullName,
        mobile: mobile,
        email: email,
        birthDate: _birthDate!,
        gender: _gender!,
        state: _stateName!,
        password: password,
      );
      await widget.onRegistered(user);
      if (mounted) {
        Navigator.pop(context);
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _error = error.toString().replaceFirst('Bad state: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('Self Registration'),
        backgroundColor: _brandBlue,
        foregroundColor: Colors.white,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => Navigator.pop(context),
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 22, 24, 26),
          children: [
            Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(
                    color: _lightBlue,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.person_add_alt_1_outlined,
                    color: _brandBlue,
                    size: 32,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Create Your Account',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Fill in the details below to register',
                        style: TextStyle(color: _textSecondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            _AuthTextField(
              controller: _controllers[0],
              hintText: 'Full Name',
              icon: Icons.person_outline,
            ),
            _AuthTextField(
              controller: _controllers[1],
              hintText: 'Mobile Number',
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
            ),
            _AuthTextField(
              controller: _controllers[2],
              hintText: 'Email',
              icon: Icons.mail_outline,
              keyboardType: TextInputType.emailAddress,
            ),
            _AuthTextField(
              controller: _controllers[3],
              hintText: 'Birth Date',
              icon: Icons.calendar_month_outlined,
              readOnly: true,
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  firstDate: DateTime(1950),
                  lastDate: DateTime.now(),
                  initialDate: DateTime(2000),
                );
                if (picked != null) {
                  _birthDate = picked;
                  _controllers[3].text =
                      '${picked.day.toString().padLeft(2, '0')}/'
                      '${picked.month.toString().padLeft(2, '0')}/'
                      '${picked.year}';
                }
              },
            ),
            _AuthDropdownField(
              hintText: 'Gender',
              icon: Icons.diversity_3_outlined,
              value: _gender,
              items: const ['Female', 'Male', 'Other'],
              onChanged: (value) => setState(() => _gender = value),
            ),
            _AuthDropdownField(
              hintText: 'State',
              icon: Icons.location_on_outlined,
              value: _stateName,
              items: const [
                'Andhra Pradesh',
                'Delhi',
                'Karnataka',
                'Maharashtra',
                'Tamil Nadu',
                'Telangana',
              ],
              onChanged: (value) => setState(() => _stateName = value),
            ),
            _AuthTextField(
              controller: _controllers[4],
              hintText: 'Password',
              icon: Icons.lock_outline,
              obscureText: _obscurePassword,
              suffixIcon: IconButton(
                tooltip: _obscurePassword ? 'Show password' : 'Hide password',
                onPressed: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
                icon: Icon(
                  _obscurePassword
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
              ),
            ),
            _AuthTextField(
              controller: _controllers[5],
              hintText: 'Confirm Password',
              icon: Icons.lock_outline,
              obscureText: _obscureConfirmPassword,
              suffixIcon: IconButton(
                tooltip: _obscureConfirmPassword
                    ? 'Show password'
                    : 'Hide password',
                onPressed: () => setState(
                  () => _obscureConfirmPassword = !_obscureConfirmPassword,
                ),
                icon: Icon(
                  _obscureConfirmPassword
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: _errorRed)),
              const SizedBox(height: 12),
            ],
            FilledButton(
              onPressed: _isSubmitting ? null : _submitRegistration,
              child: Text(_isSubmitting ? 'Submitting...' : 'Submit'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AuthTextField extends StatelessWidget {
  const _AuthTextField({
    required this.controller,
    required this.hintText,
    required this.icon,
    this.keyboardType,
    this.obscureText = false,
    this.readOnly = false,
    this.onTap,
    this.suffixIcon,
  });

  final TextEditingController controller;
  final String hintText;
  final IconData icon;
  final TextInputType? keyboardType;
  final bool obscureText;
  final bool readOnly;
  final VoidCallback? onTap;
  final Widget? suffixIcon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        obscureText: obscureText,
        readOnly: readOnly,
        onTap: onTap,
        decoration: InputDecoration(
          hintText: hintText,
          prefixIcon: Icon(icon),
          suffixIcon: suffixIcon,
        ),
      ),
    );
  }
}

class _AuthDropdownField extends StatelessWidget {
  const _AuthDropdownField({
    required this.hintText,
    required this.icon,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String hintText;
  final IconData icon;
  final String? value;
  final List<String> items;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: InputDecoration(hintText: hintText, prefixIcon: Icon(icon)),
        icon: const Icon(Icons.keyboard_arrow_down),
        items: items
            .map((item) => DropdownMenuItem(value: item, child: Text(item)))
            .toList(),
        onChanged: onChanged,
      ),
    );
  }
}

class _DividerLabel extends StatelessWidget {
  const _DividerLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(color: _border)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Text(
            label,
            style: const TextStyle(
              color: _textPrimary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        const Expanded(child: Divider(color: _border)),
      ],
    );
  }
}

class _RoutePattern extends StatelessWidget {
  const _RoutePattern();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: _RoutePatternPainter());
  }
}

class _RoutePatternPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.10)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3;
    final path = Path()
      ..moveTo(size.width * 0.18, size.height * 0.76)
      ..cubicTo(
        size.width * 0.36,
        size.height * 0.67,
        size.width * 0.46,
        size.height * 0.83,
        size.width * 0.68,
        size.height * 0.64,
      )
      ..cubicTo(
        size.width * 0.78,
        size.height * 0.55,
        size.width * 0.63,
        size.height * 0.45,
        size.width * 0.82,
        size.height * 0.35,
      );
    canvas.drawPath(path, paint);
    final pinPaint = Paint()..color = const Color(0xFF48A6FF);
    for (final point in [
      Offset(size.width * 0.22, size.height * 0.73),
      Offset(size.width * 0.68, size.height * 0.64),
    ]) {
      canvas.drawCircle(point, 8, pinPaint);
      canvas.drawCircle(
        point.translate(0, 10),
        4,
        Paint()..color = Colors.white.withValues(alpha: 0.55),
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _CitySkyline extends StatelessWidget {
  const _CitySkyline();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(double.infinity, 260),
      painter: _CitySkylinePainter(),
    );
  }
}

class _CitySkylinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final basePaint = Paint()
      ..color = const Color(0xFF031B74).withValues(alpha: 0.42);
    final accentPaint = Paint()
      ..color = const Color(0xFF2E8DFF).withValues(alpha: 0.12)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    final buildings = [
      Rect.fromLTWH(24, 104, 34, 112),
      Rect.fromLTWH(68, 76, 58, 140),
      Rect.fromLTWH(142, 118, 46, 98),
      Rect.fromLTWH(212, 88, 64, 128),
      Rect.fromLTWH(302, 126, 48, 90),
      Rect.fromLTWH(370, 100, 42, 116),
    ];
    for (final rect in buildings) {
      canvas.drawRect(rect, basePaint);
    }
    for (var y = 120.0; y < size.height; y += 28) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y + 60), accentPaint);
    }
    for (var x = -80.0; x < size.width; x += 58) {
      canvas.drawLine(Offset(x, size.height), Offset(x + 190, 92), accentPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class PermissionSetupScreen extends StatefulWidget {
  const PermissionSetupScreen({
    required this.onComplete,
    required this.onLogout,
    super.key,
  });

  final VoidCallback onComplete;
  final Future<void> Function() onLogout;

  @override
  State<PermissionSetupScreen> createState() => _PermissionSetupScreenState();
}

class _PermissionSetupScreenState extends State<PermissionSetupScreen> {
  final Map<String, bool> _permissions = {};
  bool _loading = true;
  bool _requestInProgress = false;
  bool _continuing = false;
  bool _autoRequested = false;

  bool get _allGranted =>
      _permissions.isNotEmpty && _permissions.values.every((status) => status);

  @override
  void initState() {
    super.initState();
    _refreshPermissions();
  }

  Future<void> _refreshPermissions() async {
    final snapshot = await FoPermissionService.checkRequired();
    if (mounted) {
      setState(() {
        _permissions
          ..clear()
          ..addAll(snapshot.statuses);
        _loading = false;
      });
    }
    if (snapshot.allGranted) {
      await _continueOperations();
    } else if (!_autoRequested) {
      _autoRequested = true;
      await _requestPermissions();
    }
  }

  Future<void> _requestPermissions() async {
    if (_requestInProgress) {
      return;
    }
    if (mounted) {
      setState(() {
        _requestInProgress = true;
        _loading = true;
      });
    }
    final snapshot = await FoPermissionService.requestRequired();
    if (mounted) {
      setState(() {
        _permissions
          ..clear()
          ..addAll(snapshot.statuses);
        _loading = false;
        _requestInProgress = false;
      });
    }
    if (snapshot.allGranted) {
      await _continueOperations();
    }
  }

  Future<void> _continueOperations() async {
    if (!_allGranted || _continuing) {
      return;
    }
    _continuing = true;
    try {
      await FoLocalStorage.setPermissionSetupComplete();
      if (!mounted) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onComplete();
      });
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Could not persist permission setup: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        setState(() => _continuing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Location Permission'),
        actions: [
          TextButton(onPressed: widget.onLogout, child: const Text('Logout')),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Text(
              'GPS access required',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            const Text(
              'Location permission is required for attendance and route tracking. Tracking starts only after Start Day and stops after End Day.',
              style: TextStyle(color: Color(0xFF596A88)),
            ),
            const SizedBox(height: 18),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else ...[
              _PermissionRow(
                icon: Icons.my_location_outlined,
                name: 'Location',
                purpose: 'Start Day, GPS tracking and KM attendance capture',
                granted: _permissions['Location'] ?? false,
              ),
              if (_permissions.containsKey('Background Location'))
                _PermissionRow(
                  icon: Icons.location_searching_outlined,
                  name: 'Background Location',
                  purpose:
                      'Allow all-the-time location so route tracking can continue after Start Day',
                  granted: _permissions['Background Location'] ?? false,
                ),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _loading ? null : _requestPermissions,
              icon: const Icon(Icons.my_location_outlined),
              label: const Text('Grant Location Permission'),
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: _allGranted ? _continueOperations : null,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: const Text('Continue to Operations'),
            ),
            if (!_allGranted) ...[
              const SizedBox(height: 14),
              const Text(
                'Please allow location access required for background attendance tracking. On Android, choose Allow all the time if the system opens location settings.',
                textAlign: TextAlign.center,
                style: TextStyle(color: _warning),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  const _PermissionRow({
    required this.icon,
    required this.name,
    required this.purpose,
    required this.granted,
  });

  final IconData icon;
  final String name;
  final String purpose;
  final bool granted;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Icon(icon, color: _brandBlue),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(purpose),
        trailing: Icon(
          granted ? Icons.check_circle : Icons.error_outline,
          color: granted ? _success : _warning,
        ),
      ),
    );
  }
}

class FoOperationsShell extends StatefulWidget {
  const FoOperationsShell({
    required this.onLogout,
    required this.themeMode,
    required this.onThemeModeChanged,
    super.key,
  });

  final Future<void> Function() onLogout;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  @override
  State<FoOperationsShell> createState() => _FoOperationsShellState();
}

class _FoOperationsShellState extends State<FoOperationsShell> {
  int _tabIndex = 0;
  int _refreshVersion = 0;
  FoAttendance? _activeAttendance;
  bool _loadingAttendance = true;

  @override
  void initState() {
    super.initState();
    _loadAttendance();
  }

  Future<void> _loadAttendance() async {
    try {
      final attendance = await FoLocalStorage.getActiveAttendance();
      if (mounted) {
        setState(() {
          _activeAttendance = attendance;
          _loadingAttendance = false;
        });
      }
      if (attendance?.isActive ?? false) {
        final snapshot = await FoPermissionService.checkRequired();
        if (snapshot.allGranted) {
          unawaited(FoTrackingService.start());
        }
      } else {
        unawaited(FoTrackingService.stop());
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Active attendance load failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        setState(() => _loadingAttendance = false);
      }
    }
  }

  void _selectTab(int index) => setState(() => _tabIndex = index);

  Future<void> _refreshOperationalState() async {
    await _loadAttendance();
    if (mounted) {
      setState(() => _refreshVersion = _refreshVersion + 1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final shiftActive = _activeAttendance?.isActive ?? false;
    final screens = <Widget>[
      _FoOperationalHome(
        key: ValueKey('home-$_refreshVersion'),
        onNavigate: _selectTab,
        onChanged: _refreshOperationalState,
      ),
      _MyTasksScreen(
        key: ValueKey('tasks-$_refreshVersion'),
        shiftActive: shiftActive,
        onChanged: _refreshOperationalState,
      ),
      _SiteVisitsOverview(
        key: ValueKey('visits-$_refreshVersion'),
        shiftActive: shiftActive,
        onChanged: _refreshOperationalState,
      ),
      _FoProfileTab(
        onLogout: widget.onLogout,
        isDark: widget.themeMode == ThemeMode.dark,
        onThemeChanged: (isDark) => widget.onThemeModeChanged(
          isDark ? ThemeMode.dark : ThemeMode.light,
        ),
      ),
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            _LogoMark(size: 30),
            SizedBox(width: 8),
            Text(
              'myQPMS',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: widget.themeMode == ThemeMode.dark
                ? 'Light mode'
                : 'Dark mode',
            onPressed: () => widget.onThemeModeChanged(
              widget.themeMode == ThemeMode.dark
                  ? ThemeMode.light
                  : ThemeMode.dark,
            ),
            icon: Icon(
              widget.themeMode == ThemeMode.dark
                  ? Icons.light_mode_outlined
                  : Icons.dark_mode_outlined,
            ),
          ),
        ],
      ),
      body: _loadingAttendance
          ? const Center(child: CircularProgressIndicator())
          : IndexedStack(index: _tabIndex, children: screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        height: 68,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.checklist_outlined),
            selectedIcon: Icon(Icons.checklist),
            label: 'My Tasks',
          ),
          NavigationDestination(
            icon: Icon(Icons.location_on_outlined),
            selectedIcon: Icon(Icons.location_on),
            label: 'Site Visits',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}

class _FoOperationalHome extends StatefulWidget {
  const _FoOperationalHome({
    required this.onNavigate,
    required this.onChanged,
    super.key,
  });

  final ValueChanged<int> onNavigate;
  final Future<void> Function() onChanged;

  @override
  State<_FoOperationalHome> createState() => _FoOperationalHomeState();
}

class _FoOperationalHomeState extends State<_FoOperationalHome> {
  FoAttendance? _attendance;
  FoSiteVisit? _currentVisit;
  int _battery = 0;
  double _travelledKm = 0;
  double? _gpsAccuracy;
  int _completedVisits = 0;
  int _plannedTasks = 0;
  int _completedTasks = 0;
  int _timeSpentMinutes = 0;
  DateTime? _lastSyncAt;
  bool _processing = false;
  Timer? _liveStatusTimer;
  bool _liveStatusSyncing = false;

  bool get _trackingActive => _attendance?.isActive ?? false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _liveStatusTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    try {
      _startDayLog('TRACKING_HOME_REFRESH_START');
      final attendance = await FoLocalStorage.getActiveAttendance();
      final visits = await FoLocalStorage.getSiteVisits();
      final tasks = await FoLocalStorage.getDailyTasks(date: DateTime.now());
      final currentVisit = visits.cast<FoSiteVisit?>().firstWhere(
        (visit) => visit?.status != 'COMPLETED',
        orElse: () => null,
      );
      var battery = 0;
      try {
        battery = await Battery().batteryLevel;
      } catch (error) {
        debugPrint('[myQPMS FO] Battery reading unavailable: $error');
      }
      try {
        await Geolocator.isLocationServiceEnabled();
      } catch (error) {
        debugPrint('[myQPMS FO] GPS status unavailable: $error');
      }
      var distance = _travelledKm;
      try {
        _startDayLog('TRACKING_DISTANCE_CALC_START');
        distance = await FoLocalStorage.totalDistanceKm(
          since: attendance?.loginTime,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_DISTANCE_CALC_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      final logs = await FoLocalStorage.getLocationLogs();
      final latestLog =
          logs
              .where(
                (log) =>
                    attendance == null ||
                    !log.timestamp.isBefore(attendance.loginTime),
              )
              .toList()
            ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
      final completedTasks = tasks
          .where((task) => task.status == 'completed')
          .length;
      final timeSpent = visits
          .where((visit) => visit.attendanceId == attendance?.id)
          .fold<int>(
            0,
            (total, visit) => total + (visit.totalDurationMinutes ?? 0),
          );
      final latestSync =
          <DateTime?>[
            attendance?.syncedAt,
            ...tasks.map((task) => task.syncedAt),
            ...visits.map((visit) => visit.syncedAt),
          ].whereType<DateTime>().fold<DateTime?>(
            null,
            (latest, value) =>
                latest == null || value.isAfter(latest) ? value : latest,
          );
      if (mounted) {
        setState(() {
          _attendance = attendance;
          _currentVisit = currentVisit;
          _battery = battery;
          _travelledKm = distance;
          _gpsAccuracy = latestLog.isEmpty ? null : latestLog.first.accuracy;
          _completedVisits = visits
              .where((visit) => visit.status == 'COMPLETED')
              .length;
          _plannedTasks = tasks.length;
          _completedTasks = completedTasks;
          _timeSpentMinutes = timeSpent;
          _lastSyncAt = latestSync;
        });
      }
      _configureLiveStatusTimer(attendance);
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_HOME_REFRESH_FAILED: $error');
      debugPrint('[myQPMS FO] Home status refresh failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  void _configureLiveStatusTimer(FoAttendance? attendance) {
    if (!(attendance?.isActive ?? false)) {
      _liveStatusTimer?.cancel();
      _liveStatusTimer = null;
      return;
    }
    if (_liveStatusTimer?.isActive ?? false) {
      _startDayLog('TRACKING_ALREADY_ACTIVE_SKIP_DUPLICATE_START');
      return;
    }
    _liveStatusTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      try {
        await _syncLiveStatusSnapshot();
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
        await _persistStartDayLog(
          'HOME_LIVE_STATUS_TIMER_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
        );
      }
    });
  }

  Future<void> _syncLiveStatusSnapshot({bool insertLocationLog = false}) async {
    if (_liveStatusSyncing) return;
    FoAttendance? attendance;
    try {
      attendance = _attendance ?? await FoLocalStorage.getActiveAttendance();
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
      debugPrintStack(stackTrace: stackTrace);
      return;
    }
    if (attendance == null || !attendance.isActive) {
      _liveStatusTimer?.cancel();
      _liveStatusTimer = null;
      await FoTrackingService.stop();
      _startDayLog('TRACKING_STOPPED_SAFELY');
      _message(
        'Tracking stopped safely because attendance is no longer active.',
      );
      return;
    }
    _liveStatusSyncing = true;
    Position? position;
    FoLocationLog? latestLog;
    var battery = _battery;
    try {
      _startDayLog('TRACKING_TIMER_TICK');
      try {
        battery = await Battery().batteryLevel;
      } catch (error) {
        debugPrint('[myQPMS FO] Battery live refresh failed: $error');
      }
      if (insertLocationLog) {
        try {
          _startDayLog('TRACKING_LOCATION_FETCH_START');
          position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 25),
            ),
          );
          if (!_isUsableTrackingPosition(position)) {
            _startDayLog(
              'TRACKING_LOCATION_FETCH_FAILED: unusable position accuracy=${position.accuracy}',
            );
            position = null;
          } else {
            _startDayLog('TRACKING_LOCATION_FETCH_SUCCESS');
          }
        } catch (error) {
          _startDayLog('TRACKING_LOCATION_FETCH_FAILED: $error');
        }
      } else {
        try {
          final logs = await FoLocalStorage.getLocationLogs();
          final recentLogs =
              logs
                  .where(
                    (log) =>
                        log.attendanceId == attendance?.id ||
                        !log.timestamp.isBefore(attendance!.loginTime),
                  )
                  .toList()
                ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
          latestLog = recentLogs.isEmpty ? null : recentLogs.first;
        } catch (error, stackTrace) {
          _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
          debugPrintStack(stackTrace: stackTrace);
        }
      }
      var routeKm = _travelledKm;
      try {
        _startDayLog('TRACKING_DISTANCE_CALC_START');
        routeKm = await FoLocalStorage.totalDistanceKm(
          since: attendance.loginTime,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_DISTANCE_CALC_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      if (position != null && insertLocationLog) {
        try {
          _startDayLog('TRACKING_LOG_INSERT_START');
          await FoLocalStorage.appendLocationLog(
            FoLocationLog(
              id: DateTime.now().microsecondsSinceEpoch.toString(),
              foId: _activeFoUser.id,
              attendanceId: attendance.id,
              latitude: position.latitude,
              longitude: position.longitude,
              timestamp: DateTime.now(),
              batteryPercentage: battery,
              speed: position.speed,
              accuracy: position.accuracy,
            ),
          );
          final synced = await FoSyncService.syncLocationLogs();
          _startDayLog(
            synced
                ? 'TRACKING_LOG_INSERT_SUCCESS'
                : 'TRACKING_LOG_INSERT_FAILED',
          );
        } catch (error, stackTrace) {
          _startDayLog('TRACKING_LOG_INSERT_FAILED: $error');
          debugPrintStack(stackTrace: stackTrace);
        }
      }
      try {
        await FoSyncService.upsertLiveStatus(
          foId: _activeFoUser.id,
          attendance: attendance,
          activeSiteVisitId: _currentVisit?.id,
          activeTaskId: _currentVisit?.taskId,
          isOnline: true,
          isTracking: true,
          currentStatus: 'live',
          latitude: position?.latitude ?? latestLog?.latitude,
          longitude: position?.longitude ?? latestLog?.longitude,
          accuracy: position?.accuracy ?? latestLog?.accuracy,
          speed: position?.speed ?? latestLog?.speed,
          batteryPercentage: battery,
          routeKmToday: routeKm,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      if (mounted) {
        setState(() {
          _battery = battery;
          _travelledKm = routeKm;
          _gpsAccuracy =
              position?.accuracy ?? latestLog?.accuracy ?? _gpsAccuracy;
          _lastSyncAt = DateTime.now();
        });
      }
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
      debugPrintStack(stackTrace: stackTrace);
      await _persistStartDayLog(
        'HOME_LIVE_STATUS_CALLBACK_EXCEPTION',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      _liveStatusSyncing = false;
    }
  }

  Future<void> _startDay() async {
    _startDayLog('START_DAY_CLICKED');
    await _persistStartDayLog('START_DAY_BUTTON_CLICKED');
    if (_processing) return;
    if (mounted) setState(() => _processing = true);
    try {
      Future<T> runStartDayStep<T>(
        String startAction,
        String successAction,
        Future<T> Function() action, {
        String? employeeCode,
      }) async {
        await _persistStartDayLog(startAction, employeeCode: employeeCode);
        try {
          final result = await action();
          await _persistStartDayLog(successAction, employeeCode: employeeCode);
          return result;
        } catch (error, stackTrace) {
          await _persistStartDayLog(
            '${startAction}_FAILED',
            employeeCode: employeeCode,
            error: error,
            stackTrace: stackTrace,
          );
          rethrow;
        }
      }

      var user = _activeFoUser;
      try {
        await _persistStartDayLog('PROFILE_LOAD_REMOTE_START');
        user = await QpmsSupabaseService.currentFoUser(
          diagnostics: _persistStartDayLog,
        );
        await _persistStartDayLog(
          'START_DAY_PROFILE_READY',
          employeeCode: user.id,
        );
        _activeFoUser = user;
        await FoLocalStorage.setSession(user: user);
      } catch (error, stackTrace) {
        _startDayLog('PROFILE_LOAD_REMOTE_FAILED: $error');
        await _persistStartDayLog(
          'PROFILE_LOAD_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
        );
        _message('Unable to load profile');
        return;
      }
      _startDayLog('PROFILE_LOADED: ${user.name}');
      if (!_hasValidFoIdentity(user)) {
        _startDayLog(
          'ATTENDANCE_INSERT_FAILED: FO id/username missing before DB write',
        );
        _message('Unable to start day. FO user details are missing.');
        return;
      }
      _startDayLog('EMPLOYEE_CODE_LOADED: ${user.id}');
      _startDayLog('SUPABASE_SESSION_INSERT_SKIPPED: using local FO session');
      final hasPermission = await runStartDayStep<bool>(
        'START_DAY_PERMISSION_CHECK_START',
        'START_DAY_PERMISSION_CHECK_SUCCESS',
        _ensureStartDayPermission,
        employeeCode: user.id,
      );
      if (!hasPermission) {
        await _persistStartDayLog(
          'START_DAY_PERMISSION_CHECK_FAILED',
          employeeCode: user.id,
        );
        _message('Location permission is required to start the day.');
        return;
      }
      final gpsServiceEnabled = await runStartDayStep<bool>(
        'START_DAY_GPS_SERVICE_CHECK_START',
        'START_DAY_GPS_SERVICE_CHECK_SUCCESS',
        Geolocator.isLocationServiceEnabled,
        employeeCode: user.id,
      );
      if (!gpsServiceEnabled) {
        await _persistStartDayLog(
          'START_DAY_GPS_SERVICE_CHECK_FAILED',
          employeeCode: user.id,
          error: 'Location service disabled',
        );
        _message(
          'Unable to fetch current GPS location. Please enable GPS and try again.',
        );
        return;
      }
      final position = await runStartDayStep<Position?>(
        'START_DAY_GPS_FETCH_START',
        'START_DAY_GPS_FETCH_SUCCESS',
        _fetchStartDayLocation,
        employeeCode: user.id,
      );
      if (position == null) {
        await _persistStartDayLog(
          'START_DAY_GPS_FETCH_FAILED',
          employeeCode: user.id,
          error: 'GPS position returned null',
        );
        _message(
          'Unable to fetch current GPS location. Please enable GPS and try again.',
        );
        return;
      }
      final battery = await runStartDayStep<int?>(
        'START_DAY_BATTERY_FETCH_START',
        'START_DAY_BATTERY_FETCH_SUCCESS',
        _fetchStartDayBattery,
        employeeCode: user.id,
      );
      _startDayLog('ATTENDANCE_INSERT_START');
      final attendance = await runStartDayStep<FoAttendance>(
        'START_DAY_ATTENDANCE_CREATE_START',
        'START_DAY_ATTENDANCE_CREATE_SUCCESS',
        () async {
          final attendance = FoAttendance(
            id: DateTime.now().millisecondsSinceEpoch.toString(),
            foId: user.id,
            loginTime: DateTime.now(),
            startLat: position.latitude,
            startLong: position.longitude,
            batteryStart: battery,
          );
          await FoLocalStorage.saveAttendance(attendance);
          return attendance;
        },
        employeeCode: user.id,
      );
      _startDayLog('ATTENDANCE_LOCAL_SAVE_SUCCESS: local_id=${attendance.id}');
      if (mounted) {
        setState(() {
          _attendance = attendance;
          _battery = battery ?? _battery;
          _gpsAccuracy = position.accuracy;
        });
      }
      try {
        _startDayLog('LOCATION_LOG_START');
        await runStartDayStep<void>(
          'START_DAY_LOCATION_LOG_CREATE_START',
          'START_DAY_LOCATION_LOG_CREATE_SUCCESS',
          () {
            return FoLocalStorage.appendLocationLog(
              FoLocationLog(
                id: DateTime.now().microsecondsSinceEpoch.toString(),
                foId: user.id,
                attendanceId: attendance.id,
                latitude: position.latitude,
                longitude: position.longitude,
                timestamp: DateTime.now(),
                batteryPercentage: battery,
                speed: position.speed,
                accuracy: position.accuracy,
              ),
            );
          },
          employeeCode: user.id,
        );
        _startDayLog('LOCATION_LOG_LOCAL_SAVE_SUCCESS');
      } catch (error, stackTrace) {
        _startDayLog('LOCATION_LOG_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
        await _persistStartDayLog(
          'LOCATION_LOG_INSERT_FAILED',
          employeeCode: user.id,
          error: error,
          stackTrace: stackTrace,
        );
      }
      await _persistStartDayLog(
        'ATTENDANCE_REMOTE_SYNC_START',
        employeeCode: user.id,
      );
      final attendanceSynced = await FoSyncService.syncAttendance(attendance);
      if (attendanceSynced) {
        _startDayLog(
          'ATTENDANCE_INSERT_SUCCESS: remote_id=${attendance.remoteId}',
        );
        await _persistStartDayLog(
          'ATTENDANCE_REMOTE_SYNC_SUCCESS',
          employeeCode: user.id,
        );
      } else {
        _startDayLog('ATTENDANCE_INSERT_FAILED: Supabase sync failed');
        await _persistStartDayLog(
          'ATTENDANCE_REMOTE_SYNC_FAILED',
          employeeCode: user.id,
        );
        _message(
          'Unable to start day because attendance could not be saved. Please check connection and try again.',
        );
        return;
      }
      _startDayLog('LOCATION_LOG_START');
      await _persistStartDayLog(
        'LOCATION_LOG_SYNC_START',
        employeeCode: user.id,
      );
      final locationLogsSynced = await FoSyncService.syncLocationLogs();
      if (!locationLogsSynced) {
        _startDayLog('LOCATION_LOG_FAILED');
        await _persistStartDayLog(
          'LOCATION_LOG_SYNC_FAILED',
          employeeCode: user.id,
        );
      } else {
        _startDayLog('LOCATION_LOG_SUCCESS');
        await _persistStartDayLog(
          'LOCATION_LOG_SYNC_SUCCESS',
          employeeCode: user.id,
        );
      }
      _startDayLog('LIVE_STATUS_UPDATE_START');
      final liveStatusUpdated = await runStartDayStep<bool>(
        'START_DAY_LIVE_STATUS_UPDATE_START',
        'START_DAY_LIVE_STATUS_UPDATE_SUCCESS',
        () {
          return FoSyncService.upsertLiveStatus(
            foId: user.id,
            attendance: attendance,
            isOnline: true,
            isTracking: true,
            currentStatus: 'live',
            latitude: position.latitude,
            longitude: position.longitude,
            accuracy: position.accuracy,
            speed: position.speed,
            batteryPercentage: battery,
            routeKmToday: 0,
          );
        },
        employeeCode: user.id,
      );
      _startDayLog(
        liveStatusUpdated
            ? 'LIVE_STATUS_UPDATE_SUCCESS'
            : 'LIVE_STATUS_UPDATE_FAILED',
      );
      await _persistStartDayLog(
        liveStatusUpdated
            ? 'LIVE_STATUS_UPDATE_SUCCESS'
            : 'LIVE_STATUS_UPDATE_FAILED',
        employeeCode: user.id,
      );
      if (!liveStatusUpdated) {
        _message('Live status update failed. Tracking will continue locally.');
      }
      final trackingStarted = await runStartDayStep<bool>(
        'START_DAY_TRACKING_START_BEGIN',
        'START_DAY_TRACKING_START_SUCCESS',
        FoTrackingService.start,
        employeeCode: user.id,
      );
      _startDayLog(
        trackingStarted ? 'TRACKING_START_SUCCESS' : 'TRACKING_START_FAILED',
      );
      await _persistStartDayLog(
        trackingStarted
            ? 'TRACKING_SERVICE_STARTED'
            : 'TRACKING_SERVICE_FAILED',
        employeeCode: user.id,
      );
      if (!trackingStarted) {
        _message(
          'Attendance started, but background tracking could not start.',
        );
      }
      await runStartDayStep<void>(
        'START_DAY_HOME_REFRESH_START',
        'START_DAY_HOME_REFRESH_SUCCESS',
        _loadStatus,
        employeeCode: user.id,
      );
      if (!mounted) return;
      await _persistStartDayLog('PARENT_REFRESH_START', employeeCode: user.id);
      await widget.onChanged();
      await _persistStartDayLog(
        'PARENT_REFRESH_SUCCESS',
        employeeCode: user.id,
      );
      if (!mounted) return;
      if (trackingStarted) {
        _message('Attendance marked present. Tracking active.');
      }
    } catch (error, stackTrace) {
      _startDayLog('START_DAY_FAILED: $error');
      debugPrintStack(stackTrace: stackTrace);
      await _persistStartDayLog(
        'START_DAY_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      _message('Start Day failed. Please try again or contact support.');
    } finally {
      if (mounted) {
        setState(() => _processing = false);
      }
    }
  }

  Future<void> _endDay() async {
    if (_attendance == null) return;
    setState(() => _processing = true);
    await FoTrackingService.stop();
    _liveStatusTimer?.cancel();
    _liveStatusTimer = null;
    Position? position;
    int? battery;
    try {
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 25),
          ),
        );
      } catch (error) {
        debugPrint('[myQPMS FO] End Day GPS unavailable: $error');
      }
      try {
        battery = await Battery().batteryLevel;
      } catch (error) {
        debugPrint('[myQPMS FO] End Day battery unavailable: $error');
      }
      final actualKm = await FoLocalStorage.totalDistanceKm(
        since: _attendance!.loginTime,
      );
      final eligibleKm = _eligibleKm(actualKm);
      _attendance!
        ..logoutTime = DateTime.now()
        ..endLat = position?.latitude
        ..endLong = position?.longitude
        ..batteryEnd = battery
        ..totalRawKm = actualKm
        ..totalRouteKm = actualKm
        ..totalApprovedKm = eligibleKm
        ..eligibilityStatus = 'Eligible'
        ..isActive = false;
      await FoLocalStorage.saveAttendance(_attendance!);
      await FoSyncService.syncAttendance(_attendance!);
      await FoSyncService.upsertLiveStatus(
        foId: _activeFoUser.id,
        attendance: _attendance,
        isOnline: false,
        isTracking: false,
        currentStatus: 'offline',
        latitude: position?.latitude ?? _attendance!.endLat,
        longitude: position?.longitude ?? _attendance!.endLong,
        accuracy: position?.accuracy,
        speed: position?.speed,
        batteryPercentage: battery ?? _battery,
        routeKmToday: _attendance!.totalRouteKm,
      );
      await FoSyncService.syncPending();
      await _loadStatus();
      widget.onChanged();
      _message('Day ended. Route saved and sync queued.');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] End day failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _message('Capture a valid GPS position before ending the day.');
    } finally {
      if (mounted) {
        setState(() => _processing = false);
      }
    }
  }

  void _message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final pendingTasks = _plannedTasks - _completedTasks;
    final eligibleKm = _eligibleKm(_travelledKm);
    return RefreshIndicator(
      onRefresh: _loadStatus,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 18),
        children: [
          _OperationalPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Day Status',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    _StatusPill(
                      label: _trackingActive ? 'Ongoing' : 'Not Started',
                      active: _trackingActive,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _attendance == null
                      ? 'Start your day to begin tracking'
                      : 'Started at ${_time(_attendance!.loginTime)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _processing
                        ? null
                        : (_trackingActive ? _endDay : _startDay),
                    icon: Icon(
                      _trackingActive
                          ? Icons.stop_circle_outlined
                          : Icons.play_arrow_rounded,
                    ),
                    label: Text(_trackingActive ? 'END DAY' : 'START DAY'),
                    style: FilledButton.styleFrom(
                      backgroundColor: _trackingActive
                          ? const Color(0xFFD8404F)
                          : _success,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          _OperationalPanel(
            child: Row(
              children: [
                Expanded(
                  child: _InlineState(
                    label: 'Tracking Status',
                    value: _trackingActive ? 'Active' : 'Inactive',
                    color: _trackingActive ? _success : _warning,
                  ),
                ),
                Expanded(
                  child: _InlineState(
                    label: 'GPS Accuracy',
                    value: _gpsAccuracy == null
                        ? 'Pending'
                        : '${_gpsAccuracy!.toStringAsFixed(0)} m',
                    color: _gpsAccuracy == null ? _warning : _success,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _CompactStat(
                  title: 'Battery %',
                  value: '$_battery%',
                  icon: Icons.battery_5_bar,
                  color: _success,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CompactStat(
                  title: 'Actual KM Travelled',
                  value: '${_travelledKm.toStringAsFixed(1)} km',
                  icon: Icons.route_outlined,
                  color: _brandBlue,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _CompactStat(
                  title: 'Eligible KM',
                  value: '${eligibleKm.toStringAsFixed(1)} km',
                  icon: Icons.fact_check_outlined,
                  color: _success,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CompactStat(
                  title: 'Sites Visited',
                  value: '$_completedVisits',
                  icon: Icons.location_on_outlined,
                  color: _brandBlue,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _OperationalPanel(
            child: Row(
              children: [
                Expanded(
                  child: _InlineState(
                    label: 'Start Time',
                    value: _attendance == null
                        ? '--'
                        : _time(_attendance!.loginTime),
                    color: _brandBlue,
                  ),
                ),
                Expanded(
                  child: _InlineState(
                    label: 'End Time',
                    value: _attendance?.logoutTime == null
                        ? '--'
                        : _time(_attendance!.logoutTime!),
                    color: _brandBlue,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          _OperationalPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Current Active Site / Task',
                  style: TextStyle(fontSize: 12),
                ),
                const SizedBox(height: 6),
                Text(
                  _currentVisit?.site.name ??
                      FoSite.assignedDemoSites.first.name,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 5),
                Text(
                  _currentVisit?.status ?? 'Pending Visit',
                  style: const TextStyle(color: Color(0xFF63A6FF)),
                ),
                const SizedBox(height: 8),
                Text(
                  'Time spent today: ${_durationText(Duration(minutes: _timeSpentMinutes))}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  _lastSyncAt == null
                      ? 'Sync pending'
                      : 'Last sync ${_time(_lastSyncAt!)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          _ListAction(
            label: 'Pending Tasks',
            value: pendingTasks < 0 ? '0' : '$pendingTasks',
            onTap: () => widget.onNavigate(1),
          ),
          const SizedBox(height: 8),
          _ListAction(
            label: 'Today\'s Completed Visits',
            value: '$_completedVisits',
            onTap: () => widget.onNavigate(2),
          ),
          const SizedBox(height: 14),
          const Text(
            'Quick Actions',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _QuickAction(
                icon: Icons.checklist,
                label: 'My Tasks',
                onTap: () => widget.onNavigate(1),
              ),
              _QuickAction(
                icon: Icons.location_on_outlined,
                label: 'Site Visits',
                onTap: () => widget.onNavigate(2),
              ),
              _QuickAction(
                icon: Icons.camera_alt_outlined,
                label: 'Upload Photo',
                onTap: () => widget.onNavigate(2),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MyTasksScreen extends StatefulWidget {
  const _MyTasksScreen({
    required this.shiftActive,
    required this.onChanged,
    super.key,
  });

  final bool shiftActive;
  final VoidCallback onChanged;

  @override
  State<_MyTasksScreen> createState() => _MyTasksScreenState();
}

class _MyTasksScreenState extends State<_MyTasksScreen> {
  FoAttendance? _attendance;
  FoSiteVisit? _activeVisit;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final attendance = await FoLocalStorage.getActiveAttendance();
    final visits = await FoLocalStorage.getSiteVisits();
    final active = visits.cast<FoSiteVisit?>().firstWhere(
      (visit) =>
          visit?.foId == _activeFoUser.id &&
          visit?.checkinTime != null &&
          visit?.checkoutTime == null &&
          visit?.status != 'Checked Out',
      orElse: () => null,
    );
    if (mounted) {
      setState(() {
        _attendance = attendance;
        _activeVisit = active;
        _loading = false;
      });
    }
  }

  Future<Position?> _captureVisitLocation() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        _showMessage('Please enable GPS to continue.');
        return null;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _showMessage('Location permission is required for store visits.');
        return null;
      }
      return Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 25),
        ),
      );
    } catch (error) {
      debugPrint('[myQPMS FO] Visit GPS capture failed: $error');
      _showMessage('Unable to capture GPS location. Please try again.');
      return null;
    }
  }

  Future<void> _openStoreSearch() async {
    if (_attendance == null) {
      _showMessage('Start Day before checking in.');
      return;
    }
    final selected = await showDialog<_StoreSearchResult>(
      context: context,
      builder: (_) => const _StoreSearchDialog(),
    );
    if (selected == null) return;
    if (selected.store != null) {
      await _confirmExistingStore(selected.store!);
    } else {
      await _addNewStore();
    }
  }

  Future<void> _confirmExistingStore(FoSite store) async {
    final position = await _captureVisitLocation();
    if (position == null || !mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _StoreConfirmDialog(store: store, position: position),
    );
    if (confirmed == true) {
      await _checkIn(store: store, position: position);
    }
  }

  Future<void> _addNewStore() async {
    if (_attendance == null) return;
    final position = await _captureVisitLocation();
    if (position == null || !mounted) return;
    final draft = await showDialog<_NewStoreDraft>(
      context: context,
      builder: (_) => _AddStoreDialog(position: position),
    );
    if (draft == null) return;
    setState(() => _busy = true);
    try {
      final store = await FoSyncService.createStore(
        storeName: draft.storeName,
        clientName: draft.clientName,
        storeCode: draft.storeCode,
        state: draft.state,
        employeeCode: _activeFoUser.employeeId,
        fullName: _activeFoUser.name,
        attendance: _attendance!,
        latitude: position.latitude,
        longitude: position.longitude,
        gpsAccuracy: position.accuracy,
      );
      if (store == null) {
        _showMessage('Unable to save store. Please check connection.');
        return;
      }
      await _checkIn(
        store: store,
        position: position,
        successMessage: 'New store added and checked in successfully',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkIn({
    required FoSite store,
    required Position position,
    String? successMessage,
  }) async {
    if (_attendance == null) return;
    setState(() => _busy = true);
    try {
      final now = DateTime.now();
      final visit = FoSiteVisit(
        id: now.microsecondsSinceEpoch.toString(),
        foId: _activeFoUser.employeeId,
        fullName: _activeFoUser.name,
        attendanceId: _attendance!.id,
        site: store,
        selectedTime: now,
        checkinTime: now,
        arrivalTime: now,
        arrivalLat: position.latitude,
        arrivalLong: position.longitude,
        gpsAccuracy: position.accuracy,
        geofenceStatus: 'Checked In',
        reasonForVisit: 'Store visit',
        status: 'Checked In',
      );
      await FoLocalStorage.saveSiteVisit(visit);
      await FoSyncService.syncSiteVisit(visit);
      _showMessage(successMessage ?? 'Checked in at ${store.name}');
      await _load();
      widget.onChanged();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkOut() async {
    final visit = _activeVisit;
    if (visit == null) return;
    final position = await _captureVisitLocation();
    if (position == null) return;
    setState(() => _busy = true);
    try {
      final now = DateTime.now();
      visit
        ..checkoutTime = now
        ..checkoutLat = position.latitude
        ..checkoutLong = position.longitude
        ..checkoutAccuracy = position.accuracy
        ..totalDurationMinutes = now.difference(visit.checkinTime!).inMinutes
        ..status = 'Checked Out'
        ..pendingSync = true;
      await FoLocalStorage.saveSiteVisit(visit);
      await FoSyncService.syncSiteVisit(visit);
      _showMessage('Checked out successfully');
      await _load();
      widget.onChanged();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final visit = _activeVisit;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const _ScreenTitle(title: 'My Tasks'),
        _OperationalPanel(
          child: Column(
            children: [
              _ProfileValue(label: 'Full Name', value: _activeFoUser.name),
              _ProfileValue(
                label: 'Employee Code',
                value: _activeFoUser.employeeId,
              ),
              _ProfileValue(
                label: 'Current Status',
                value: visit == null
                    ? 'No Active Visit'
                    : visit.checkoutTime == null
                    ? 'Checked In'
                    : 'Checked Out',
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _OperationalPanel(
          child: visit == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 26),
                    child: Text(
                      'Ready for Check-In',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: _brandBlue,
                      ),
                    ),
                  ),
                )
              : _ActiveVisitSummary(visit: visit),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _busy || !widget.shiftActive || visit != null
              ? null
              : _openStoreSearch,
          icon: const Icon(Icons.login),
          label: const Text('Check In'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _busy || visit == null ? null : _checkOut,
          icon: const Icon(Icons.logout),
          label: const Text('Check Out'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 15),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
        ),
        if (!widget.shiftActive) ...[
          const SizedBox(height: 12),
          const Text(
            'Start Day from Home before checking in.',
            style: TextStyle(color: _warning),
          ),
        ],
      ],
    );
  }
}

class _SiteVisitsOverview extends StatefulWidget {
  const _SiteVisitsOverview({
    required this.shiftActive,
    required this.onChanged,
    super.key,
  });

  final bool shiftActive;
  final VoidCallback onChanged;

  @override
  State<_SiteVisitsOverview> createState() => _SiteVisitsOverviewState();
}

class _SiteVisitsOverviewState extends State<_SiteVisitsOverview> {
  _VisitFilter _filter = _VisitFilter.today;
  DateTimeRange? _customRange;
  late Future<List<FoSiteVisit>> _future = _loadVisits();

  Future<List<FoSiteVisit>> _loadVisits() async {
    final range = _rangeForFilter();
    final remoteVisits = await FoSyncService.fetchSiteVisitsForFo(
      employeeCode: _activeFoUser.employeeId,
      start: range.start,
      end: range.end,
    );
    if (remoteVisits.isNotEmpty) return remoteVisits;
    final visits = await FoLocalStorage.getSiteVisits();
    final filtered = visits.where((visit) {
      if (visit.foId != _activeFoUser.employeeId &&
          visit.foId != _activeFoUser.id) {
        return false;
      }
      final date = visit.checkinTime ?? visit.selectedTime;
      return !date.isBefore(range.start) && date.isBefore(range.end);
    }).toList();
    filtered.sort(
      (a, b) => (b.checkinTime ?? b.selectedTime).compareTo(
        a.checkinTime ?? a.selectedTime,
      ),
    );
    return filtered;
  }

  DateTimeRange _rangeForFilter() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return switch (_filter) {
      _VisitFilter.today => DateTimeRange(
        start: today,
        end: today.add(const Duration(days: 1)),
      ),
      _VisitFilter.yesterday => DateTimeRange(
        start: today.subtract(const Duration(days: 1)),
        end: today,
      ),
      _VisitFilter.last7Days => DateTimeRange(
        start: today.subtract(const Duration(days: 6)),
        end: today.add(const Duration(days: 1)),
      ),
      _VisitFilter.thisMonth => DateTimeRange(
        start: DateTime(now.year, now.month),
        end: DateTime(now.year, now.month + 1),
      ),
      _VisitFilter.custom =>
        _customRange ??
            DateTimeRange(
              start: today,
              end: today.add(const Duration(days: 1)),
            ),
    };
  }

  Future<void> _setFilter(_VisitFilter filter) async {
    if (filter == _VisitFilter.custom) {
      final now = DateTime.now();
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(now.year - 2),
        lastDate: DateTime(now.year + 1),
        initialDateRange: _customRange,
      );
      if (picked == null) return;
      _customRange = DateTimeRange(
        start: DateTime(
          picked.start.year,
          picked.start.month,
          picked.start.day,
        ),
        end: DateTime(
          picked.end.year,
          picked.end.month,
          picked.end.day,
        ).add(const Duration(days: 1)),
      );
    }
    setState(() {
      _filter = filter;
      _future = _loadVisits();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<FoSiteVisit>>(
      future: _future,
      builder: (context, snapshot) {
        final visits = snapshot.data ?? [];
        return ListView(
          padding: const EdgeInsets.all(14),
          children: [
            const _ScreenTitle(title: 'Site Visits'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _VisitFilter.values
                  .map(
                    (filter) => ChoiceChip(
                      selected: _filter == filter,
                      label: Text(filter.label),
                      onSelected: (_) => _setFilter(filter),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 16),
            if (visits.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 24),
                child: Center(child: Text('No visits found.')),
              ),
            for (final visit in visits) _VisitHistoryCard(visit: visit),
          ],
        );
      },
    );
  }
}

enum _VisitFilter {
  today('Today'),
  yesterday('Yesterday'),
  last7Days('Last 7 Days'),
  thisMonth('This Month'),
  custom('Custom Date Range');

  const _VisitFilter(this.label);

  final String label;
}

class _ActiveVisitSummary extends StatelessWidget {
  const _ActiveVisitSummary({required this.visit});

  final FoSiteVisit visit;

  @override
  Widget build(BuildContext context) {
    final duration = visit.checkinTime == null
        ? 0
        : DateTime.now().difference(visit.checkinTime!).inMinutes;
    return Column(
      children: [
        _ProfileValue(label: 'Store Name', value: visit.site.name),
        _ProfileValue(
          label: 'Client Name',
          value: visit.site.clientName ?? '--',
        ),
        _ProfileValue(label: 'Store Code', value: visit.site.storeCode ?? '--'),
        _ProfileValue(label: 'State', value: visit.site.state ?? '--'),
        _ProfileValue(
          label: 'Check-In Time',
          value: visit.checkinTime == null ? '--' : _time(visit.checkinTime!),
        ),
        _ProfileValue(label: 'Visit Duration', value: '$duration Minutes'),
        _ProfileValue(
          label: 'GPS Accuracy',
          value: visit.gpsAccuracy == null
              ? '--'
              : '${visit.gpsAccuracy!.toStringAsFixed(1)} m',
        ),
      ],
    );
  }
}

class _VisitHistoryCard extends StatelessWidget {
  const _VisitHistoryCard({required this.visit});

  final FoSiteVisit visit;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    visit.site.name,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                _SmallBadge(
                  text: visit.status == 'Checked Out'
                      ? 'Completed'
                      : visit.status,
                  color: visit.status == 'Checked Out' ? _success : _brandBlue,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              visit.site.storeCode ?? '--',
              style: const TextStyle(
                color: _textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            _VisitInfo(label: 'Client:', value: visit.site.clientName ?? '--'),
            _VisitInfo(label: 'State:', value: visit.site.state ?? '--'),
            _VisitInfo(
              label: 'Check-In:',
              value: visit.checkinTime == null
                  ? '--'
                  : _time(visit.checkinTime!),
            ),
            _VisitInfo(
              label: 'Check-Out:',
              value: visit.checkoutTime == null
                  ? '--'
                  : _time(visit.checkoutTime!),
            ),
            _VisitInfo(
              label: 'Duration:',
              value: visit.totalDurationMinutes == null
                  ? '--'
                  : '${visit.totalDurationMinutes} Minutes',
            ),
            _VisitInfo(
              label: 'GPS Accuracy:',
              value: visit.gpsAccuracy == null
                  ? '--'
                  : '${visit.gpsAccuracy!.toStringAsFixed(1)} m',
            ),
          ],
        ),
      ),
    );
  }
}

class _VisitInfo extends StatelessWidget {
  const _VisitInfo({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        children: [
          SizedBox(
            width: 106,
            child: Text(label, style: const TextStyle(color: _textSecondary)),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _StoreSearchResult {
  const _StoreSearchResult.existing(this.store);
  const _StoreSearchResult.newStore() : store = null;

  final FoSite? store;
}

class _StoreSearchDialog extends StatefulWidget {
  const _StoreSearchDialog();

  @override
  State<_StoreSearchDialog> createState() => _StoreSearchDialogState();
}

class _StoreSearchDialogState extends State<_StoreSearchDialog> {
  final _controller = TextEditingController();
  List<FoSite> _results = [];
  bool _searching = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search(String value) async {
    setState(() => _searching = true);
    final results = await FoSyncService.searchStores(value);
    if (mounted) {
      setState(() {
        _results = results;
        _searching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Search Store'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _controller,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'Store Name or Store Code',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (value) {
                if (value.trim().length >= 2) _search(value);
              },
            ),
            const SizedBox(height: 12),
            if (_searching) const LinearProgressIndicator(),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: _results.length,
                itemBuilder: (_, index) {
                  final store = _results[index];
                  return ListTile(
                    title: Text(store.name),
                    subtitle: Text(
                      '${store.storeCode ?? '--'}  |  ${store.clientName ?? '--'}',
                    ),
                    onTap: () => Navigator.pop(
                      context,
                      _StoreSearchResult.existing(store),
                    ),
                  );
                },
              ),
            ),
            TextButton.icon(
              onPressed: () =>
                  Navigator.pop(context, const _StoreSearchResult.newStore()),
              icon: const Icon(Icons.add_business_outlined),
              label: const Text('Add New Store'),
            ),
          ],
        ),
      ),
    );
  }
}

class _StoreConfirmDialog extends StatelessWidget {
  const _StoreConfirmDialog({required this.store, required this.position});

  final FoSite store;
  final Position position;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Confirm Store'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _DialogInfo(label: 'Store Name', value: store.name),
            _DialogInfo(label: 'Client Name', value: store.clientName ?? '--'),
            _DialogInfo(label: 'Store Code', value: store.storeCode ?? '--'),
            _DialogInfo(label: 'State', value: store.state ?? '--'),
            const Divider(),
            _DialogInfo(
              label: 'Saved Store Location',
              value: store.latitude == 0 && store.longitude == 0
                  ? '--'
                  : '${store.latitude.toStringAsFixed(6)}, ${store.longitude.toStringAsFixed(6)}',
            ),
            _DialogInfo(
              label: 'Current GPS Location',
              value:
                  '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}',
            ),
            _DialogInfo(
              label: 'GPS Accuracy',
              value: '${position.accuracy.toStringAsFixed(1)} m',
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Check In at this Store'),
        ),
      ],
    );
  }
}

class _NewStoreDraft {
  const _NewStoreDraft({
    required this.storeName,
    required this.clientName,
    required this.storeCode,
    required this.state,
  });

  final String storeName;
  final String clientName;
  final String storeCode;
  final String state;
}

class _AddStoreDialog extends StatefulWidget {
  const _AddStoreDialog({required this.position});

  final Position position;

  @override
  State<_AddStoreDialog> createState() => _AddStoreDialogState();
}

class _AddStoreDialogState extends State<_AddStoreDialog> {
  final _storeName = TextEditingController();
  final _clientName = TextEditingController();
  final _storeCode = TextEditingController();
  final _state = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _storeName.dispose();
    _clientName.dispose();
    _storeCode.dispose();
    _state.dispose();
    super.dispose();
  }

  void _save() {
    if (_storeName.text.trim().isEmpty ||
        _clientName.text.trim().isEmpty ||
        _storeCode.text.trim().isEmpty ||
        _state.text.trim().isEmpty) {
      setState(() => _error = 'Please fill all required fields.');
      return;
    }
    Navigator.pop(
      context,
      _NewStoreDraft(
        storeName: _storeName.text.trim(),
        clientName: _clientName.text.trim(),
        storeCode: _storeCode.text.trim(),
        state: _state.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add New Store'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _storeName,
              decoration: const InputDecoration(
                hintText: 'Store Name',
                prefixIcon: Icon(Icons.store_outlined),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _clientName,
              decoration: const InputDecoration(
                hintText: 'Client Name',
                prefixIcon: Icon(Icons.business_outlined),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _storeCode,
              decoration: const InputDecoration(
                hintText: 'Store Code / Site Code',
                prefixIcon: Icon(Icons.tag_outlined),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _state,
              decoration: const InputDecoration(
                hintText: 'State',
                prefixIcon: Icon(Icons.location_on_outlined),
              ),
            ),
            const SizedBox(height: 12),
            _DialogInfo(
              label: 'Employee Code',
              value: _activeFoUser.employeeId,
            ),
            _DialogInfo(label: 'Full Name', value: _activeFoUser.name),
            _DialogInfo(
              label: 'Current Latitude',
              value: widget.position.latitude.toStringAsFixed(6),
            ),
            _DialogInfo(
              label: 'Current Longitude',
              value: widget.position.longitude.toStringAsFixed(6),
            ),
            _DialogInfo(
              label: 'GPS Accuracy',
              value: '${widget.position.accuracy.toStringAsFixed(1)} m',
            ),
            _DialogInfo(label: 'Timestamp', value: _time(DateTime.now())),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: _errorRed)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }
}

class _DialogInfo extends StatelessWidget {
  const _DialogInfo({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 132,
            child: Text(label, style: const TextStyle(color: _textSecondary)),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _FoProfileTab extends StatelessWidget {
  const _FoProfileTab({
    required this.onLogout,
    required this.isDark,
    required this.onThemeChanged,
  });

  final Future<void> Function() onLogout;
  final bool isDark;
  final ValueChanged<bool> onThemeChanged;

  @override
  Widget build(BuildContext context) {
    final user = _activeFoUser;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const _ScreenTitle(title: 'Profile'),
        const SizedBox(height: 12),
        const CircleAvatar(
          radius: 35,
          backgroundColor: Color(0xFF173A83),
          child: Icon(Icons.person, size: 38, color: Colors.white),
        ),
        const SizedBox(height: 10),
        Text(
          user.name,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
        ),
        const Text(
          'Field Officer',
          textAlign: TextAlign.center,
          style: TextStyle(color: Color(0xFF8D9DB6)),
        ),
        const SizedBox(height: 18),
        _OperationalPanel(
          child: Column(
            children: [
              _ProfileValue(label: 'Employee Code', value: user.employeeId),
              _ProfileValue(label: 'Mobile', value: user.mobileNumber),
              _ProfileValue(label: 'Region', value: user.region),
              _ProfileValue(
                label: 'Reporting Manager',
                value: user.reportingManager,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          value: isDark,
          onChanged: onThemeChanged,
          title: const Text('Dark Mode'),
          secondary: const Icon(Icons.dark_mode_outlined),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: onLogout,
          icon: const Icon(Icons.logout),
          label: const Text('Logout'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFE85C65),
            side: const BorderSide(color: Color(0xFF63303B)),
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ],
    );
  }
}

class _ScreenTitle extends StatelessWidget {
  const _ScreenTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Text(
        title,
        style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _OperationalPanel extends StatelessWidget {
  const _OperationalPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(padding: const EdgeInsets.all(13), child: child),
    );
  }
}

class _InlineState extends StatelessWidget {
  const _InlineState({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 5),
        Text(
          value,
          style: TextStyle(fontWeight: FontWeight.w700, color: color),
        ),
      ],
    );
  }
}

class _CompactStat extends StatelessWidget {
  const _CompactStat({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String title;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return _OperationalPanel(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 5),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Icon(icon, color: color),
        ],
      ),
    );
  }
}

class _ListAction extends StatelessWidget {
  const _ListAction({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        dense: true,
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        trailing: TextButton(
          onPressed: onTap,
          child: Text(value == '0' ? 'View' : '$value  View'),
        ),
        onTap: onTap,
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.only(right: 7),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            height: 66,
            decoration: BoxDecoration(
              border: Border.all(
                color: Theme.of(context).brightness == Brightness.dark
                    ? _nightBorder
                    : const Color(0xFFE4EAF5),
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 20, color: _brandBlue),
                const SizedBox(height: 5),
                Text(label, style: const TextStyle(fontSize: 10)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SmallBadge extends StatelessWidget {
  const _SmallBadge({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          color: color,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ProfileValue extends StatelessWidget {
  const _ProfileValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 11),
      child: Row(
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const Spacer(),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class FoHomeScreen extends StatefulWidget {
  const FoHomeScreen({required this.onLogout, super.key});

  final Future<void> Function() onLogout;

  @override
  State<FoHomeScreen> createState() => _FoHomeScreenState();
}

class _FoHomeScreenState extends State<FoHomeScreen> {
  FoAttendance? _attendance;
  int? _battery;
  double _travelledKm = 0;
  double? _gpsAccuracy;
  int _sitesVisited = 0;
  bool _processing = false;
  Timer? _liveStatusTimer;
  bool _liveStatusSyncing = false;

  bool get _trackingActive => _attendance?.isActive ?? false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _liveStatusTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    try {
      _startDayLog('TRACKING_HOME_REFRESH_START');
      final attendance = await FoLocalStorage.getActiveAttendance();
      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
        battery = null;
      }
      var distance = _travelledKm;
      try {
        _startDayLog('TRACKING_DISTANCE_CALC_START');
        distance = await FoLocalStorage.totalDistanceKm(
          since: attendance?.loginTime,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_DISTANCE_CALC_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      final visits = await FoLocalStorage.getSiteVisits();
      final logs = await FoLocalStorage.getLocationLogs();
      final latestLog =
          logs
              .where(
                (log) =>
                    attendance == null ||
                    !log.timestamp.isBefore(attendance.loginTime),
              )
              .toList()
            ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
      try {
        await Geolocator.isLocationServiceEnabled();
      } catch (_) {}
      if (mounted) {
        setState(() {
          _attendance = attendance;
          _battery = battery;
          _travelledKm = distance;
          _gpsAccuracy = latestLog.isEmpty ? null : latestLog.first.accuracy;
          _sitesVisited = visits
              .where((visit) => visit.status == 'COMPLETED')
              .length;
        });
      }
      _configureLiveStatusTimer(attendance);
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_HOME_REFRESH_FAILED: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  void _configureLiveStatusTimer(FoAttendance? attendance) {
    if (!(attendance?.isActive ?? false)) {
      _liveStatusTimer?.cancel();
      _liveStatusTimer = null;
      return;
    }
    if (_liveStatusTimer?.isActive ?? false) {
      _startDayLog('TRACKING_ALREADY_ACTIVE_SKIP_DUPLICATE_START');
      return;
    }
    _liveStatusTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      try {
        await _syncLiveStatusSnapshot();
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
        await _persistStartDayLog(
          'HOME_LIVE_STATUS_TIMER_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
        );
      }
    });
  }

  Future<void> _syncLiveStatusSnapshot({bool insertLocationLog = false}) async {
    if (_liveStatusSyncing) return;
    FoAttendance? attendance;
    try {
      attendance = _attendance ?? await FoLocalStorage.getActiveAttendance();
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
      debugPrintStack(stackTrace: stackTrace);
      return;
    }
    if (attendance == null || !attendance.isActive) {
      _liveStatusTimer?.cancel();
      _liveStatusTimer = null;
      await FoTrackingService.stop();
      _startDayLog('TRACKING_STOPPED_SAFELY');
      _showMessage(
        'Tracking stopped safely because attendance is no longer active.',
      );
      return;
    }
    _liveStatusSyncing = true;
    Position? position;
    FoLocationLog? latestLog;
    int? battery = _battery;
    try {
      _startDayLog('TRACKING_TIMER_TICK');
      try {
        battery = await Battery().batteryLevel;
      } catch (error) {
        debugPrint('[myQPMS FO] Battery refresh failed: $error');
      }
      if (insertLocationLog) {
        try {
          _startDayLog('TRACKING_LOCATION_FETCH_START');
          position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 25),
            ),
          );
          if (!_isUsableTrackingPosition(position)) {
            _startDayLog(
              'TRACKING_LOCATION_FETCH_FAILED: unusable position accuracy=${position.accuracy}',
            );
            position = null;
          } else {
            _startDayLog('TRACKING_LOCATION_FETCH_SUCCESS');
          }
        } catch (error) {
          _startDayLog('TRACKING_LOCATION_FETCH_FAILED: $error');
        }
      } else {
        try {
          final logs = await FoLocalStorage.getLocationLogs();
          final recentLogs =
              logs
                  .where(
                    (log) =>
                        log.attendanceId == attendance?.id ||
                        !log.timestamp.isBefore(attendance!.loginTime),
                  )
                  .toList()
                ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
          latestLog = recentLogs.isEmpty ? null : recentLogs.first;
        } catch (error, stackTrace) {
          _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
          debugPrintStack(stackTrace: stackTrace);
        }
      }
      var routeKm = _travelledKm;
      try {
        _startDayLog('TRACKING_DISTANCE_CALC_START');
        routeKm = await FoLocalStorage.totalDistanceKm(
          since: attendance.loginTime,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_DISTANCE_CALC_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      if (position != null && insertLocationLog) {
        try {
          _startDayLog('TRACKING_LOG_INSERT_START');
          await FoLocalStorage.appendLocationLog(
            FoLocationLog(
              id: DateTime.now().microsecondsSinceEpoch.toString(),
              foId: _activeFoUser.id,
              attendanceId: attendance.id,
              latitude: position.latitude,
              longitude: position.longitude,
              timestamp: DateTime.now(),
              batteryPercentage: battery,
              speed: position.speed,
              accuracy: position.accuracy,
            ),
          );
          final synced = await FoSyncService.syncLocationLogs();
          _startDayLog(
            synced
                ? 'TRACKING_LOG_INSERT_SUCCESS'
                : 'TRACKING_LOG_INSERT_FAILED',
          );
        } catch (error, stackTrace) {
          _startDayLog('TRACKING_LOG_INSERT_FAILED: $error');
          debugPrintStack(stackTrace: stackTrace);
        }
      }
      try {
        await FoSyncService.upsertLiveStatus(
          foId: _activeFoUser.id,
          attendance: attendance,
          isOnline: true,
          isTracking: true,
          currentStatus: 'live',
          latitude: position?.latitude ?? latestLog?.latitude,
          longitude: position?.longitude ?? latestLog?.longitude,
          accuracy: position?.accuracy ?? latestLog?.accuracy,
          speed: position?.speed ?? latestLog?.speed,
          batteryPercentage: battery,
          routeKmToday: routeKm,
        );
      } catch (error, stackTrace) {
        _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      if (mounted) {
        setState(() {
          _battery = battery;
          _travelledKm = routeKm;
          _gpsAccuracy =
              position?.accuracy ?? latestLog?.accuracy ?? _gpsAccuracy;
        });
      }
    } catch (error, stackTrace) {
      _startDayLog('TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
      debugPrintStack(stackTrace: stackTrace);
      await _persistStartDayLog(
        'HOME_LIVE_STATUS_CALLBACK_EXCEPTION',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      _liveStatusSyncing = false;
    }
  }

  Future<void> _startDay() async {
    _startDayLog('START_DAY_CLICKED');
    if (_processing) return;
    if (mounted) setState(() => _processing = true);
    try {
      var user = _activeFoUser;
      try {
        await _persistStartDayLog('PROFILE_LOAD_REMOTE_START');
        user = await QpmsSupabaseService.currentFoUser(
          diagnostics: _persistStartDayLog,
        );
        _activeFoUser = user;
        await FoLocalStorage.setSession(user: user);
      } catch (error, stackTrace) {
        _startDayLog('PROFILE_LOAD_REMOTE_FAILED: $error');
        await _persistStartDayLog(
          'PROFILE_LOAD_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
        );
        _showMessage('Unable to load profile');
        return;
      }
      _startDayLog('PROFILE_LOADED: ${user.name}');
      if (!_hasValidFoIdentity(user)) {
        _startDayLog(
          'ATTENDANCE_INSERT_FAILED: FO id/username missing before DB write',
        );
        _showMessage('Unable to start day. FO user details are missing.');
        return;
      }
      _startDayLog('EMPLOYEE_CODE_LOADED: ${user.id}');
      _startDayLog('SUPABASE_SESSION_INSERT_SKIPPED: using local FO session');
      final hasPermission = await _ensureStartDayPermission();
      if (!hasPermission) {
        _showMessage('Location permission is required to start the day.');
        return;
      }
      final position = await _fetchStartDayLocation();
      if (position == null) {
        _showMessage(
          'Unable to fetch current GPS location. Please enable GPS and try again.',
        );
        return;
      }
      final battery = await _fetchStartDayBattery();
      _startDayLog('ATTENDANCE_INSERT_START');
      final attendance = FoAttendance(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        foId: user.id,
        loginTime: DateTime.now(),
        startLat: position.latitude,
        startLong: position.longitude,
        batteryStart: battery,
      );
      await FoLocalStorage.saveAttendance(attendance);
      _startDayLog('ATTENDANCE_LOCAL_SAVE_SUCCESS: local_id=${attendance.id}');
      if (mounted) {
        setState(() {
          _attendance = attendance;
          _battery = battery;
          _gpsAccuracy = position.accuracy;
        });
      }
      try {
        _startDayLog('LOCATION_LOG_START');
        await FoLocalStorage.appendLocationLog(
          FoLocationLog(
            id: DateTime.now().microsecondsSinceEpoch.toString(),
            foId: user.id,
            attendanceId: attendance.id,
            latitude: position.latitude,
            longitude: position.longitude,
            timestamp: DateTime.now(),
            batteryPercentage: battery,
            speed: position.speed,
            accuracy: position.accuracy,
          ),
        );
        _startDayLog('LOCATION_LOG_LOCAL_SAVE_SUCCESS');
      } catch (error, stackTrace) {
        _startDayLog('LOCATION_LOG_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      final attendanceSynced = await FoSyncService.syncAttendance(attendance);
      if (attendanceSynced) {
        _startDayLog(
          'ATTENDANCE_INSERT_SUCCESS: remote_id=${attendance.remoteId}',
        );
      } else {
        _startDayLog('ATTENDANCE_INSERT_FAILED: Supabase sync failed');
        _showMessage(
          'Unable to start day because attendance could not be saved. Please check connection and try again.',
        );
        return;
      }
      _startDayLog('LOCATION_LOG_START');
      final locationLogsSynced = await FoSyncService.syncLocationLogs();
      if (!locationLogsSynced) {
        _startDayLog('LOCATION_LOG_FAILED');
      } else {
        _startDayLog('LOCATION_LOG_SUCCESS');
      }
      _startDayLog('LIVE_STATUS_UPDATE_START');
      final liveStatusUpdated = await FoSyncService.upsertLiveStatus(
        foId: user.id,
        attendance: attendance,
        isOnline: true,
        isTracking: true,
        currentStatus: 'live',
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        batteryPercentage: battery,
        routeKmToday: 0,
      );
      _startDayLog(
        liveStatusUpdated
            ? 'LIVE_STATUS_UPDATE_SUCCESS'
            : 'LIVE_STATUS_UPDATE_FAILED',
      );
      if (!liveStatusUpdated) {
        _showMessage(
          'Live status update failed. Tracking will continue locally.',
        );
      }
      final trackingStarted = await FoTrackingService.start();
      _startDayLog(
        trackingStarted ? 'TRACKING_START_SUCCESS' : 'TRACKING_START_FAILED',
      );
      if (!trackingStarted) {
        _showMessage(
          'Attendance started, but background tracking could not start.',
        );
      }
      await _loadStatus();
      if (mounted) {
        if (trackingStarted) {
          _showMessage('Attendance marked present. Tracking is active.');
        }
      }
    } catch (error, stackTrace) {
      _startDayLog('START_DAY_FAILED: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        _showMessage('Start Day failed. Please try again or contact support.');
      }
    } finally {
      if (mounted) {
        setState(() => _processing = false);
      }
    }
  }

  Future<void> _endDay({bool showMessage = true}) async {
    if (_attendance == null) {
      return;
    }
    setState(() => _processing = true);
    await FoTrackingService.stop();
    _liveStatusTimer?.cancel();
    _liveStatusTimer = null;
    Position? position;
    int? battery;
    try {
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 25),
          ),
        );
      } catch (error) {
        debugPrint('[myQPMS FO] End Day GPS unavailable: $error');
      }
      try {
        battery = await Battery().batteryLevel;
      } catch (error) {
        debugPrint('[myQPMS FO] End Day battery unavailable: $error');
      }
      final actualKm = await FoLocalStorage.totalDistanceKm(
        since: _attendance!.loginTime,
      );
      final eligibleKm = _eligibleKm(actualKm);
      _attendance!
        ..logoutTime = DateTime.now()
        ..endLat = position?.latitude
        ..endLong = position?.longitude
        ..batteryEnd = battery
        ..totalRawKm = actualKm
        ..totalRouteKm = actualKm
        ..totalApprovedKm = eligibleKm
        ..eligibilityStatus = 'Eligible'
        ..isActive = false;
      await FoLocalStorage.saveAttendance(_attendance!);
      await FoSyncService.syncAttendance(_attendance!);
      await FoSyncService.upsertLiveStatus(
        foId: _activeFoUser.id,
        attendance: _attendance,
        isOnline: false,
        isTracking: false,
        currentStatus: 'offline',
        latitude: position?.latitude ?? _attendance!.endLat,
        longitude: position?.longitude ?? _attendance!.endLong,
        accuracy: position?.accuracy,
        speed: position?.speed,
        batteryPercentage: battery ?? _battery,
        routeKmToday: _attendance!.totalRouteKm,
      );
      await FoSyncService.syncPending();
      await _loadStatus();
      if (mounted && showMessage) {
        _showMessage('Day ended. Route logs saved for sync.');
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] End Day failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        _showMessage('Unable to end day. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _processing = false);
      }
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _openSiteVisits() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => SiteVisitScreen(shiftActive: _trackingActive),
      ),
    ).then((_) => _loadStatus());
  }

  @override
  Widget build(BuildContext context) {
    final eligibleKm = _eligibleKm(_travelledKm);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Operations'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Center(
              child: _StatusPill(
                label: _trackingActive ? 'Tracking Active' : 'Off Shift',
                active: _trackingActive,
              ),
            ),
          ),
        ],
      ),
      drawer: _FoDrawer(
        onSiteVisit: _openSiteVisits,
        onEndDay: () => _endDay(),
        onLogout: () async {
          if (_trackingActive) {
            await _endDay(showMessage: false);
          } else {
            await FoSyncService.upsertLiveStatus(
              foId: _activeFoUser.id,
              isOnline: false,
              isTracking: false,
              currentStatus: 'offline',
              batteryPercentage: _battery,
              routeKmToday: _travelledKm,
            );
            await FoTrackingService.stop();
          }
          await widget.onLogout();
        },
      ),
      body: RefreshIndicator(
        onRefresh: _loadStatus,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Text(
              'Hello, ${_activeFoUser.name}',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              '${_activeFoUser.employeeId}  |  ${_activeFoUser.region}',
              style: const TextStyle(color: Color(0xFF596A88)),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: _trackingActive ? const Color(0xFFEAF9F3) : Colors.white,
                border: Border.all(
                  color: _trackingActive
                      ? const Color(0xFFB4E8D2)
                      : const Color(0xFFE4EAF5),
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'TODAY SHIFT',
                    style: TextStyle(
                      color: Color(0xFF596A88),
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _trackingActive ? 'PRESENT' : 'Not started',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: _trackingActive
                          ? _success
                          : const Color(0xFF111A30),
                    ),
                  ),
                  if (_attendance != null)
                    Text('Started at ${_time(_attendance!.loginTime)}'),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _processing
                          ? null
                          : (_trackingActive ? _endDay : _startDay),
                      icon: Icon(
                        _trackingActive
                            ? Icons.stop_circle_outlined
                            : Icons.play_arrow,
                      ),
                      label: Text(_trackingActive ? 'END DAY' : 'START DAY'),
                      style: FilledButton.styleFrom(
                        backgroundColor: _trackingActive
                            ? const Color(0xFFD8404F)
                            : _brandBlue,
                        padding: const EdgeInsets.symmetric(vertical: 15),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            GridView.count(
              crossAxisCount: 2,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.35,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                _MetricCard(
                  icon: Icons.route_outlined,
                  title: 'Actual KM Travelled',
                  value: '${_travelledKm.toStringAsFixed(1)} km',
                  color: _brandBlue,
                ),
                _MetricCard(
                  icon: Icons.fact_check_outlined,
                  title: 'Eligible KM',
                  value: '${eligibleKm.toStringAsFixed(1)} km',
                  color: _success,
                ),
                _MetricCard(
                  icon: Icons.location_on_outlined,
                  title: 'Sites Visited',
                  value: '$_sitesVisited',
                  color: _brandBlue,
                ),
                _MetricCard(
                  icon: Icons.track_changes_outlined,
                  title: 'Tracking Status',
                  value: _trackingActive ? 'Active' : 'Inactive',
                  color: _trackingActive ? _success : _warning,
                ),
                _MetricCard(
                  icon: Icons.gps_fixed,
                  title: 'GPS Accuracy',
                  value: _gpsAccuracy == null
                      ? 'Pending'
                      : '${_gpsAccuracy!.toStringAsFixed(0)} m',
                  color: _gpsAccuracy == null ? _warning : _success,
                ),
                _MetricCard(
                  icon: Icons.battery_5_bar_outlined,
                  title: 'Battery %',
                  value: _battery == null ? '--' : '$_battery%',
                  color: _success,
                ),
                _MetricCard(
                  icon: Icons.play_circle_outline,
                  title: 'Start Time',
                  value: _attendance == null
                      ? '--'
                      : _time(_attendance!.loginTime),
                  color: _brandBlue,
                ),
                _MetricCard(
                  icon: Icons.stop_circle_outlined,
                  title: 'End Time',
                  value: _attendance?.logoutTime == null
                      ? '--'
                      : _time(_attendance!.logoutTime!),
                  color: _warning,
                ),
              ],
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _trackingActive ? _openSiteVisits : null,
              icon: const Icon(Icons.location_on_outlined),
              label: const Text('Open Site Visit'),
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Route points and field activities are stored locally for later sync.',
              style: TextStyle(color: Color(0xFF596A88), fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _FoDrawer extends StatelessWidget {
  const _FoDrawer({
    required this.onSiteVisit,
    required this.onEndDay,
    required this.onLogout,
  });

  final VoidCallback onSiteVisit;
  final Future<void> Function() onEndDay;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            const Padding(padding: EdgeInsets.all(20), child: _BrandHeader()),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('Site Visit'),
              onTap: () {
                Navigator.pop(context);
                onSiteVisit();
              },
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Visit History'),
              onTap: () {
                Navigator.pop(context);
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const VisitHistoryScreen()),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('Profile'),
              onTap: () {
                Navigator.pop(context);
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const FoProfileScreen()),
                );
              },
            ),
            const Spacer(),
            ListTile(
              leading: const Icon(Icons.stop_circle_outlined, color: _warning),
              title: const Text('End Day'),
              onTap: () async {
                Navigator.pop(context);
                await onEndDay();
              },
            ),
            ListTile(
              leading: const Icon(Icons.logout, color: Color(0xFFD8404F)),
              title: const Text('Logout'),
              onTap: () async {
                Navigator.pop(context);
                await onLogout();
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

class SiteVisitScreen extends StatefulWidget {
  const SiteVisitScreen({required this.shiftActive, this.task, super.key});

  final bool shiftActive;
  final FoDailyTask? task;

  @override
  State<SiteVisitScreen> createState() => _SiteVisitScreenState();
}

class _SiteVisitScreenState extends State<SiteVisitScreen> {
  FoSiteVisit? _visit;
  Position? _currentPosition;
  double? _distanceMeters;
  String? _routeWarning;
  bool _busy = false;

  bool get _insideGeofence =>
      _distanceMeters != null &&
      _visit != null &&
      _distanceMeters! <= _visit!.site.geofenceRadiusMeters;

  @override
  void initState() {
    super.initState();
    _loadOpenVisit();
  }

  Future<void> _loadOpenVisit() async {
    try {
      final visits = await FoLocalStorage.getSiteVisits();
      final open = visits.cast<FoSiteVisit?>().firstWhere(
        (visit) => widget.task == null
            ? visit?.status != 'COMPLETED'
            : visit?.taskId == widget.task!.id && visit?.status != 'COMPLETED',
        orElse: () => null,
      );
      var visit = open;
      if (visit == null && widget.task != null && widget.shiftActive) {
        visit = await _createVisitForTask(widget.task!);
      }
      if (mounted) {
        setState(() => _visit = visit);
      }
      if (visit != null) {
        await _refreshLocation();
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Open site visit load failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  Future<void> _chooseSite(FoSite site) async {
    try {
      final visit = await _createVisit(site: site);
      await FoLocalStorage.saveSiteVisit(visit);
      await FoSyncService.syncSiteVisit(visit);
      if (mounted) {
        setState(() => _visit = visit);
      }
      await _refreshLocation();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Destination selection failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _toast('Unable to select this destination right now.');
    }
  }

  Future<FoSiteVisit> _createVisitForTask(FoDailyTask task) async {
    final visit = await _createVisit(site: task.site, task: task);
    await FoLocalStorage.saveSiteVisit(visit);
    await FoSyncService.syncSiteVisit(visit);
    return visit;
  }

  Future<FoSiteVisit> _createVisit({
    required FoSite site,
    FoDailyTask? task,
  }) async {
    final attendance = await FoLocalStorage.getActiveAttendance();
    return FoSiteVisit(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      foId: _activeFoUser.id,
      attendanceId: attendance?.id,
      taskId: task?.id,
      site: site,
      selectedTime: DateTime.now(),
      status: 'PLANNED',
      reasonForVisit: task?.reasonForVisit ?? '',
    );
  }

  Future<void> _refreshLocation() async {
    if (_visit == null) {
      return;
    }
    setState(() => _busy = true);
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 30),
        ),
      );
      final distance = Geolocator.distanceBetween(
        position.latitude,
        position.longitude,
        _visit!.site.latitude,
        _visit!.site.longitude,
      );
      if (distance <= _visit!.site.geofenceRadiusMeters &&
          _visit!.arrivalTime == null) {
        _visit!
          ..status = 'ARRIVED AT SITE'
          ..arrivalTime = DateTime.now()
          ..arrivalLat = position.latitude
          ..arrivalLong = position.longitude
          ..gpsAccuracy = position.accuracy
          ..distanceFromSiteMeters = distance
          ..geofenceStatus = 'Valid';
        await FoLocalStorage.saveSiteVisit(_visit!);
        await FoSyncService.syncSiteVisit(_visit!);
      }
      if (mounted) {
        setState(() {
          _currentPosition = position;
          _distanceMeters = distance;
        });
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Site location refresh failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _toast('Unable to read live location.');
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openMaps() async {
    if (_visit == null) {
      return;
    }
    final navigation = Uri.parse(
      'google.navigation:q=${_visit!.site.latitude},${_visit!.site.longitude}&mode=d',
    );
    final webFallback = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${_visit!.site.latitude},${_visit!.site.longitude}',
    );
    try {
      setState(() {
        _busy = true;
        _routeWarning = null;
      });
      await _refreshLocation();
      final position = _currentPosition;
      if (position == null) {
        _toast('Capture GPS before starting travel.');
        return;
      }
      final straightLineKm =
          Geolocator.distanceBetween(
            position.latitude,
            position.longitude,
            _visit!.site.latitude,
            _visit!.site.longitude,
          ) /
          1000;
      final route = await FoRouteService.fetchDrivingRoute(
        fromLat: position.latitude,
        fromLng: position.longitude,
        toLat: _visit!.site.latitude,
        toLng: _visit!.site.longitude,
      );
      final segment = FoTravelSegment(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        foId: _activeFoUser.id,
        attendanceId: _visit!.attendanceId,
        taskId: _visit!.taskId,
        siteVisitId: _visit!.id,
        fromLat: position.latitude,
        fromLng: position.longitude,
        toLat: _visit!.site.latitude,
        toLng: _visit!.site.longitude,
        straightLineKm: straightLineKm,
        routeKm: route.routeKm,
        routeDurationMinutes: route.durationMinutes,
        googleRoutePolyline: route.polyline,
        segmentStatus: route.available ? 'calculated' : 'pending',
      );
      await FoLocalStorage.saveTravelSegment(segment);
      _visit!
        ..status = 'TRAVELLING'
        ..straightLineKm = straightLineKm
        ..routeKm = route.routeKm
        ..routeDurationMinutes = route.durationMinutes
        ..googleRoutePolyline = route.polyline
        ..distanceSource = 'google_directions'
        ..travelledKm = route.routeKm ?? 0
        ..pendingSync = true;
      await FoLocalStorage.saveSiteVisit(_visit!);
      if (_visit!.taskId != null) {
        final tasks = await FoLocalStorage.getDailyTasks();
        final task = tasks.cast<FoDailyTask?>().firstWhere(
          (item) => item?.id == _visit!.taskId,
          orElse: () => null,
        );
        if (task != null) {
          task
            ..status = 'navigation_started'
            ..navigationStartedAt = DateTime.now()
            ..taskStartedAt = DateTime.now()
            ..workStatus = route.available ? 'route_ready' : 'route_pending'
            ..pendingSync = true;
          await FoLocalStorage.saveDailyTask(task);
          await FoSyncService.syncDailyTask(task);
        }
      }
      await FoSyncService.syncSiteVisit(_visit!);
      await FoSyncService.syncTravelSegments();
      if (!route.available && route.warning != null) {
        setState(() => _routeWarning = route.warning);
        _toast(route.warning!);
      }
      if (!await launchUrl(navigation, mode: LaunchMode.externalApplication) &&
          !await launchUrl(webFallback, mode: LaunchMode.externalApplication)) {
        _toast('Google Maps is unavailable on this device.');
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Navigation launch failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _toast('Unable to open navigation right now.');
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _checkIn() async {
    if (_visit == null || !_insideGeofence) {
      return;
    }
    try {
      _visit!
        ..status = 'CHECKED IN'
        ..checkinTime = DateTime.now()
        ..geofenceStatus = 'Valid'
        ..straightLineKm = (_distanceMeters ?? 0) / 1000
        ..pendingSync = true;
      await FoLocalStorage.saveSiteVisit(_visit!);
      if (_visit!.taskId != null) {
        final tasks = await FoLocalStorage.getDailyTasks();
        final task = tasks.cast<FoDailyTask?>().firstWhere(
          (item) => item?.id == _visit!.taskId,
          orElse: () => null,
        );
        if (task != null) {
          task
            ..status = 'checked_in'
            ..pendingSync = true;
          await FoLocalStorage.saveDailyTask(task);
          await FoSyncService.syncDailyTask(task);
        }
      }
      await FoSyncService.syncSiteVisit(_visit!);
      if (mounted) {
        setState(() {});
      }
      _toast('Checked in. Time spent tracking started.');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Site check-in failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _toast('Unable to save check-in right now.');
    }
  }

  Future<void> _openActivity() async {
    if (_visit == null) {
      return;
    }
    final updated = await Navigator.push<FoSiteVisit>(
      context,
      MaterialPageRoute(
        builder: (_) => InspectionActivityScreen(visit: _visit!),
      ),
    );
    if (updated != null) {
      setState(() => _visit = updated);
    }
  }

  Future<void> _checkOut() async {
    if (_visit == null || _visit!.checkinTime == null) {
      return;
    }
    try {
      await _refreshLocation();
      final routeKm = _visit!.routeKm;
      final checkout = DateTime.now();
      _visit!
        ..status = 'COMPLETED'
        ..checkoutTime = checkout
        ..checkoutLat = _currentPosition?.latitude
        ..checkoutLong = _currentPosition?.longitude
        ..totalDurationMinutes = checkout
            .difference(_visit!.checkinTime!)
            .inMinutes
        ..travelledKm = routeKm ?? 0
        ..approvedKm = _visit!.geofenceStatus == 'Valid' ? (routeKm ?? 0) : 0
        ..pendingSync = true;
      await FoLocalStorage.saveSiteVisit(_visit!);
      if (_visit!.taskId != null) {
        final tasks = await FoLocalStorage.getDailyTasks();
        final task = tasks.cast<FoDailyTask?>().firstWhere(
          (item) => item?.id == _visit!.taskId,
          orElse: () => null,
        );
        if (task != null) {
          task
            ..status = 'completed'
            ..taskCompletedAt = checkout
            ..taskCompletedLatitude = _currentPosition?.latitude
            ..taskCompletedLongitude = _currentPosition?.longitude
            ..workStatus = 'completed'
            ..pendingSync = true;
          await FoLocalStorage.saveDailyTask(task);
          await FoSyncService.syncDailyTask(task);
        }
      }
      await FoSyncService.syncSiteVisit(_visit!);
      final attendance = await FoLocalStorage.getActiveAttendance();
      if (attendance != null) {
        attendance
          ..totalRawKm = await FoLocalStorage.totalDistanceKm(
            since: attendance.loginTime,
          )
          ..totalRouteKm = await FoLocalStorage.totalRouteKm(
            since: attendance.loginTime,
          )
          ..totalApprovedKm = attendance.totalRouteKm
          ..pendingSync = true;
        await FoLocalStorage.saveAttendance(attendance);
        await FoSyncService.syncAttendance(attendance);
      }
      if (mounted) {
        _toast('Visit completed and sync queued.');
        Navigator.pop(context);
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Site check-out failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      _toast('Unable to complete the visit right now.');
    }
  }

  void _toast(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Site Visit')),
      body: _visit == null ? _siteSelection() : _activeVisit(),
    );
  }

  Widget _siteSelection() {
    return FutureBuilder<List<FoSite>>(
      future: FoSyncService.fetchSites(),
      builder: (context, snapshot) {
        final sites = snapshot.data ?? FoSite.assignedDemoSites;
        return ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Text(
              'Assigned Sites',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            const Text(
              'Select one destination for today\'s visit.',
              style: TextStyle(color: Color(0xFF596A88)),
            ),
            const SizedBox(height: 16),
            for (final site in sites)
              Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFFEAF0FF),
                    child: Icon(Icons.location_on_outlined, color: _brandBlue),
                  ),
                  title: Text(site.name),
                  subtitle: Text('${site.address}\n${site.region}'),
                  isThreeLine: true,
                  trailing: const Icon(Icons.chevron_right),
                  onTap: widget.shiftActive ? () => _chooseSite(site) : null,
                ),
              ),
            if (!widget.shiftActive)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text(
                  'Start Day before choosing a site.',
                  style: TextStyle(color: _warning),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _activeVisit() {
    final visit = _visit!;
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                visit.site.name,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            _StatusPill(
              label: visit.status,
              active: visit.status != 'TRAVELLING',
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          '${visit.site.address}, ${visit.site.region}',
          style: const TextStyle(color: Color(0xFF596A88)),
        ),
        const SizedBox(height: 18),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: _InlineState(
                    label: 'Actual KM Travelled',
                    value: visit.routeKm == null
                        ? 'Pending'
                        : '${visit.routeKm!.toStringAsFixed(1)} km',
                    color: visit.routeKm == null ? _warning : _success,
                  ),
                ),
                Expanded(
                  child: _InlineState(
                    label: 'Estimated Travel Time',
                    value: visit.routeDurationMinutes == null
                        ? 'Pending'
                        : '${visit.routeDurationMinutes} mins',
                    color: _brandBlue,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_routeWarning != null) ...[
          const SizedBox(height: 8),
          Text(_routeWarning!, style: const TextStyle(color: _warning)),
        ],
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ARRIVAL VALIDATION',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 10),
                Text(
                  _distanceMeters == null
                      ? 'Capture live GPS to validate arrival.'
                      : '${_distanceMeters!.toStringAsFixed(0)} m from site boundary',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _insideGeofence
                      ? 'Within approved geofence. Check-in enabled.'
                      : 'Check-in enables within ${visit.site.geofenceRadiusMeters.toInt()} m.',
                  style: TextStyle(
                    color: _insideGeofence ? _success : _warning,
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _refreshLocation,
                  icon: const Icon(Icons.gps_fixed),
                  label: Text(_busy ? 'Capturing...' : 'Validate Arrival'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _busy ? null : _openMaps,
          icon: const Icon(Icons.navigation_outlined),
          label: Text(_busy ? 'Preparing route...' : 'START TRAVEL'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 15),
          ),
        ),
        const SizedBox(height: 12),
        if (visit.checkinTime == null)
          FilledButton.icon(
            onPressed: _insideGeofence ? _checkIn : null,
            icon: const Icon(Icons.login),
            label: const Text('CHECK-IN'),
            style: FilledButton.styleFrom(
              backgroundColor: _brandBlue,
              padding: const EdgeInsets.symmetric(vertical: 15),
            ),
          )
        else ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Icon(Icons.timer_outlined, color: _success),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('TIME SPENT', style: TextStyle(fontSize: 12)),
                      StreamBuilder<int>(
                        stream: Stream.periodic(
                          const Duration(minutes: 1),
                          (value) => value,
                        ),
                        builder: (context, snapshot) => Text(
                          _durationText(
                            DateTime.now().difference(visit.checkinTime!),
                          ),
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _openActivity,
            icon: const Icon(Icons.fact_check_outlined),
            label: const Text('Inspection / Activity'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 15),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _checkOut,
            icon: const Icon(Icons.logout),
            label: const Text('CHECK-OUT'),
            style: FilledButton.styleFrom(
              backgroundColor: _brandBlue,
              padding: const EdgeInsets.symmetric(vertical: 15),
            ),
          ),
        ],
      ],
    );
  }
}

class InspectionActivityScreen extends StatefulWidget {
  const InspectionActivityScreen({required this.visit, super.key});

  final FoSiteVisit visit;

  @override
  State<InspectionActivityScreen> createState() =>
      _InspectionActivityScreenState();
}

class _InspectionActivityScreenState extends State<InspectionActivityScreen> {
  late final TextEditingController _remarks = TextEditingController(
    text: widget.visit.remarks,
  );
  String _activityType = 'Site Inspection';
  final Map<String, String> _attachmentStatus = {};

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final file = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 72,
    );
    if (file != null) {
      setState(() {
        widget.visit.photoPaths.add(file.path);
        _attachmentStatus[file.path] = 'Pending';
      });
      await _queueAttachment(file.path, 'image');
    }
  }

  Future<void> _addDocument() async {
    final result = await FilePicker.pickFiles();
    final path = result?.files.single.path;
    if (path != null) {
      setState(() {
        widget.visit.documentPaths.add(path);
        _attachmentStatus[path] = 'Pending';
      });
      await _queueAttachment(path, 'document');
    }
  }

  Future<void> _queueAttachment(String path, String type) async {
    try {
      if (mounted) {
        setState(() => _attachmentStatus[path] = 'Uploading');
      }
      final file = File(path);
      final attachment = FoTaskAttachment(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        foId: widget.visit.foId,
        taskId: widget.visit.taskId,
        siteVisitId: widget.visit.id,
        siteId: widget.visit.site.remoteId,
        localPath: path,
        fileName: path.split(Platform.pathSeparator).last,
        fileType: type,
        fileSize: await file.exists() ? await file.length() : null,
      );
      await FoLocalStorage.saveTaskAttachment(attachment);
      await FoSyncService.syncTaskAttachments();
      final attachments = await FoLocalStorage.getTaskAttachments();
      final synced = attachments.any(
        (item) =>
            item.localPath == path && !item.pendingSync && item.fileUrl != null,
      );
      if (mounted) {
        setState(
          () => _attachmentStatus[path] = synced ? 'Uploaded' : 'Failed',
        );
      }
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Attachment queue failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (mounted) {
        setState(() => _attachmentStatus[path] = 'Failed');
      }
    }
  }

  void _removeEvidence(String path) {
    setState(() {
      widget.visit.photoPaths.remove(path);
      widget.visit.documentPaths.remove(path);
      _attachmentStatus.remove(path);
    });
  }

  Future<void> _save() async {
    widget.visit
      ..workPerformed = _activityType
      ..remarks = _remarks.text.trim()
      ..pendingSync = true;
    await FoLocalStorage.saveSiteVisit(widget.visit);
    await FoSyncService.syncSiteVisit(widget.visit);
    await FoSyncService.syncTaskAttachments();
    if (mounted) {
      Navigator.pop(context, widget.visit);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Inspection / Activity')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _activityType,
            decoration: const InputDecoration(labelText: 'Activity type'),
            items: const [
              DropdownMenuItem(
                value: 'Site Inspection',
                child: Text('Site Inspection'),
              ),
              DropdownMenuItem(
                value: 'Training Activity',
                child: Text('Training Activity'),
              ),
              DropdownMenuItem(value: 'Survey', child: Text('Survey')),
            ],
            onChanged: (value) => setState(() => _activityType = value!),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _remarks,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Remarks',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _addPhoto,
                  icon: const Icon(Icons.add_a_photo_outlined),
                  label: const Text('Photo'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _addDocument,
                  icon: const Icon(Icons.attach_file),
                  label: const Text('Document'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () =>
                setState(() => widget.visit.voiceNotePrepared = true),
            icon: const Icon(Icons.mic_none),
            label: Text(
              widget.visit.voiceNotePrepared
                  ? 'Voice note marked for capture'
                  : 'Prepare Voice Note',
            ),
          ),
          const SizedBox(height: 18),
          _EvidenceSummary(
            visit: widget.visit,
            statuses: _attachmentStatus,
            onRemove: _removeEvidence,
            onRetry: (path) {
              final type = widget.visit.photoPaths.contains(path)
                  ? 'image'
                  : 'document';
              _queueAttachment(path, type);
            },
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: _save,
            style: FilledButton.styleFrom(
              backgroundColor: _brandBlue,
              padding: const EdgeInsets.symmetric(vertical: 15),
            ),
            child: const Text('Save Activity'),
          ),
        ],
      ),
    );
  }
}

class _EvidenceSummary extends StatelessWidget {
  const _EvidenceSummary({
    required this.visit,
    required this.statuses,
    required this.onRemove,
    required this.onRetry,
  });

  final FoSiteVisit visit;
  final Map<String, String> statuses;
  final void Function(String path) onRemove;
  final void Function(String path) onRetry;

  @override
  Widget build(BuildContext context) {
    final evidence = [
      ...visit.photoPaths.map((path) => (path: path, type: 'image')),
      ...visit.documentPaths.map((path) => (path: path, type: 'document')),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'EVIDENCE ATTACHED',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (evidence.isEmpty)
              const Text('No evidence selected yet.')
            else
              ...evidence.map((item) {
                final status = statuses[item.path] ?? 'Pending';
                final fileName = item.path.split(Platform.pathSeparator).last;
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xFFE4EAF5)),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child:
                            item.type == 'image' && File(item.path).existsSync()
                            ? Image.file(
                                File(item.path),
                                width: 54,
                                height: 54,
                                fit: BoxFit.cover,
                              )
                            : Container(
                                width: 54,
                                height: 54,
                                color: const Color(0xFFEAF0FF),
                                child: const Icon(Icons.insert_drive_file),
                              ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              fileName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              status,
                              style: TextStyle(
                                color: status == 'Uploaded'
                                    ? _success
                                    : status == 'Failed'
                                    ? const Color(0xFFD8404F)
                                    : _warning,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (status == 'Failed')
                        IconButton(
                          tooltip: 'Retry upload',
                          onPressed: () => onRetry(item.path),
                          icon: const Icon(Icons.refresh),
                        ),
                      IconButton(
                        tooltip: 'Remove',
                        onPressed: () => onRemove(item.path),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                );
              }),
            Text(
              visit.voiceNotePrepared
                  ? 'Voice note capture requested'
                  : 'No voice note selected',
            ),
          ],
        ),
      ),
    );
  }
}

class VisitHistoryScreen extends StatelessWidget {
  const VisitHistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Visit History')),
      body: FutureBuilder<List<FoSiteVisit>>(
        future: FoLocalStorage.getSiteVisits(),
        builder: (context, snapshot) {
          final visits = snapshot.data ?? [];
          if (visits.isEmpty) {
            return const Center(child: Text('No site visits recorded yet.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(18),
            itemCount: visits.length,
            separatorBuilder: (context, index) => const SizedBox(height: 10),
            itemBuilder: (_, index) {
              final visit = visits[index];
              return Card(
                child: ListTile(
                  title: Text(visit.site.name),
                  subtitle: Text(
                    '${visit.status}  |  ${visit.travelledKm.toStringAsFixed(1)} km\n'
                    '${_date(visit.selectedTime)}',
                  ),
                  isThreeLine: true,
                  trailing: visit.totalDurationMinutes == null
                      ? null
                      : Text('${visit.totalDurationMinutes} min'),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class FoProfileScreen extends StatelessWidget {
  const FoProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = _activeFoUser;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const CircleAvatar(
            radius: 38,
            backgroundColor: Color(0xFFEAF0FF),
            child: Icon(Icons.person, size: 42, color: _brandBlue),
          ),
          const SizedBox(height: 12),
          Text(
            user.name,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
          ),
          const Text(
            'Field Officer',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF596A88)),
          ),
          const SizedBox(height: 22),
          Card(
            child: Column(
              children: [
                _ProfileTile(label: 'Employee Code', value: user.employeeId),
                _ProfileTile(label: 'Mobile', value: user.mobileNumber),
                _ProfileTile(label: 'Region', value: user.region),
                _ProfileTile(
                  label: 'Reporting Manager',
                  value: user.reportingManager,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileTile extends StatelessWidget {
  const _ProfileTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label, style: const TextStyle(color: Color(0xFF596A88))),
      trailing: Text(
        value,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.icon,
    required this.title,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String title;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const Spacer(),
            Text(
              title,
              style: const TextStyle(fontSize: 12, color: Color(0xFF596A88)),
            ),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: active ? const Color(0xFFE6F7F0) : const Color(0xFFF0F3F9),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: active ? _success : const Color(0xFF596A88),
        ),
      ),
    );
  }
}

String _time(DateTime dateTime) {
  final hour = dateTime.hour % 12 == 0 ? 12 : dateTime.hour % 12;
  final minutes = dateTime.minute.toString().padLeft(2, '0');
  final period = dateTime.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minutes $period';
}

String _date(DateTime dateTime) =>
    '${dateTime.day.toString().padLeft(2, '0')}/'
    '${dateTime.month.toString().padLeft(2, '0')}/${dateTime.year}';

double _eligibleKm(double actualKm) {
  final floorKm = actualKm.floorToDouble();
  final fraction = actualKm - floorKm;
  if (fraction >= 0.5) {
    return actualKm.ceilToDouble();
  }
  return double.parse(actualKm.toStringAsFixed(2));
}

String _durationText(Duration duration) {
  final hours = duration.inHours.toString().padLeft(2, '0');
  final minutes = (duration.inMinutes % 60).toString().padLeft(2, '0');
  return '${hours}h : ${minutes}m';
}
