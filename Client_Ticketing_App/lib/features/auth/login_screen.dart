import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/client_ticket_deep_link.dart';
import '../../app/routes.dart';
import '../../core/constants/app_assets.dart';
import '../../core/constants/app_colors.dart';
import '../../state/auth_controller.dart';
import '../../state/notification_controller.dart';
import '../../state/ticket_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const _heroImage = AppAssets.clientLoginCleaning;
  static const _qLogoAsset = 'assets/branding/qpms-logo.png';

  final _formKey = GlobalKey<FormState>();
  final _mobile = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _mobile.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      backgroundColor: const Color(0xFFF4F8FC),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final heroHeight = constraints.maxHeight < 720 ? 310.0 : 372.0;
          return SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: Column(
                children: [
                  SizedBox(
                    height: heroHeight,
                    width: double.infinity,
                    child: const _LoginHero(image: _heroImage),
                  ),
                  Transform.translate(
                    offset: const Offset(0, -34),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Column(
                        children: [
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.fromLTRB(22, 28, 22, 22),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(26),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.72),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(
                                    0xFF0F172A,
                                  ).withValues(alpha: 0.11),
                                  blurRadius: 34,
                                  offset: const Offset(0, 18),
                                ),
                              ],
                            ),
                            child: Form(
                              key: _formKey,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  const Text(
                                    'Welcome',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 27,
                                      fontWeight: FontWeight.w900,
                                      color: AppColors.ink,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  const Text(
                                    'Continue with your registered mobile number.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      height: 1.45,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.muted,
                                    ),
                                  ),
                                  const SizedBox(height: 28),
                                  if (auth.pendingProfile == null) ...[
                                    TextFormField(
                                      controller: _mobile,
                                      keyboardType: TextInputType.phone,
                                      autofillHints: const [
                                        AutofillHints.telephoneNumber,
                                      ],
                                      decoration: const InputDecoration(
                                        labelText: 'Mobile Number',
                                        helperText:
                                            'Enter your registered hospital contact mobile number.',
                                        prefixIcon: Icon(
                                          Icons.phone_android_rounded,
                                        ),
                                      ),
                                      validator: (value) =>
                                          value == null || value.trim().isEmpty
                                          ? 'Enter your registered mobile number.'
                                          : null,
                                    ),
                                    const SizedBox(height: 18),
                                  ] else ...[
                                    _ContactConfirmation(
                                      profile: auth.pendingProfile!,
                                      onUseAnother: _useAnotherNumber,
                                    ),
                                    const SizedBox(height: 18),
                                  ],
                                  if (_error != null)
                                    Container(
                                      width: double.infinity,
                                      margin: const EdgeInsets.only(bottom: 14),
                                      padding: const EdgeInsets.all(12),
                                      decoration: BoxDecoration(
                                        color: AppColors.red.withValues(
                                          alpha: 0.08,
                                        ),
                                        borderRadius: BorderRadius.circular(14),
                                      ),
                                      child: Text(
                                        _error!,
                                        style: const TextStyle(
                                          color: AppColors.red,
                                          fontWeight: FontWeight.w800,
                                          height: 1.35,
                                        ),
                                      ),
                                    ),
                                  SizedBox(
                                    width: double.infinity,
                                    child: ElevatedButton(
                                      onPressed: auth.isLoading
                                          ? null
                                          : auth.pendingProfile == null
                                          ? _lookupMobile
                                          : _continueAsContact,
                                      child: auth.isLoading
                                          ? const SizedBox.square(
                                              dimension: 20,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Colors.white,
                                              ),
                                            )
                                          : Text(
                                              auth.pendingProfile == null
                                                  ? 'Continue with Registered Mobile Number'
                                                  : 'Continue',
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 20),
                          const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.verified_user_outlined,
                                size: 17,
                                color: AppColors.royalBlue,
                              ),
                              SizedBox(width: 7),
                              Text(
                                'Registered mobile access',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.ink,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Need help? Contact QPMS support',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.muted,
                            ),
                          ),
                          SizedBox(
                            height: MediaQuery.paddingOf(context).bottom + 12,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _lookupMobile() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _error = null);
    final auth = context.read<AuthController>();
    final ok = await auth.lookupRegisteredMobile(_mobile.text);
    if (!mounted) return;
    if (!ok) {
      setState(
        () => _error =
            auth.errorMessage ??
            'Mobile number is not registered for Hospital Client Ticketing. Please contact QPMS support.',
      );
    }
  }

  Future<void> _continueAsContact() async {
    setState(() => _error = null);
    final auth = context.read<AuthController>();
    final tickets = context.read<TicketController>();
    final notifications = context.read<NotificationController>();
    await auth.confirmRegisteredContact();
    if (!mounted) return;
    if (auth.isAuthenticated) {
      tickets.clearSessionState();
      await tickets.load();
      await notifications.load();
      if (!mounted) return;
      final pendingLink = PendingClientTicketDeepLink.take();
      if (pendingLink != null) {
        if (pendingLink.hasTicket) {
          await tickets.resolveTicket(pendingLink.ticketNumber!);
        }
        if (!mounted) return;
        final resolved = pendingLink.hasTicket
            ? tickets.findTicket(pendingLink.ticketNumber!)
            : null;
        Navigator.pushReplacementNamed(
          context,
          pendingLink.targetRoute,
          arguments: resolved?.number ?? pendingLink.ticketNumber,
        );
      } else {
        Navigator.pushReplacementNamed(context, AppRoutes.dashboard);
      }
    } else {
      setState(
        () => _error =
            auth.errorMessage ??
            'Unable to continue with this registered mobile number.',
      );
    }
  }

  void _useAnotherNumber() {
    context.read<AuthController>().clearPendingContact();
    setState(() {
      _error = null;
      _mobile.clear();
    });
  }
}

class _ContactConfirmation extends StatelessWidget {
  const _ContactConfirmation({
    required this.profile,
    required this.onUseAnother,
  });

  final Map<String, dynamic> profile;
  final VoidCallback onUseAnother;

  @override
  Widget build(BuildContext context) {
    final name = '${profile['full_name'] ?? ''}'.trim();
    final designation = '${profile['designation'] ?? ''}'.trim();
    final client = '${profile['client_name'] ?? 'Hospital'}'.trim();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paleBlue,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.royalBlue.withValues(alpha: 0.18)),
      ),
      child: Column(
        children: [
          const Text(
            'Continue as',
            style: TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            name.isEmpty ? 'Registered Hospital Contact' : name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.deepBlue,
              fontWeight: FontWeight.w900,
              fontSize: 19,
            ),
          ),
          if (designation.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              designation,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
          const SizedBox(height: 4),
          Text(
            client,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: onUseAnother,
            child: const Text('Use another number'),
          ),
        ],
      ),
    );
  }
}

class _LoginHero extends StatelessWidget {
  const _LoginHero({required this.image});

  final String image;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.asset(
          image,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF031B4E), Color(0xFF005DFF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                const Color(0xFF031B4E).withValues(alpha: 0.1),
                const Color(0xFF062A8F).withValues(alpha: 0.54),
                const Color(0xFF005DFF).withValues(alpha: 0.92),
              ],
              stops: const [0, 0.48, 1],
            ),
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment.bottomCenter,
              radius: 0.92,
              colors: [
                Colors.white.withValues(alpha: 0.18),
                Colors.transparent,
              ],
            ),
          ),
        ),
        SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 26, 24, 58),
            child: Align(
              alignment: Alignment.center,
              child: Container(
                width: 106,
                height: 106,
                padding: const EdgeInsets.all(17),
                decoration: BoxDecoration(
                  color: const Color(0xFF0B3CA8).withValues(alpha: 0.94),
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF001B5E).withValues(alpha: 0.22),
                      blurRadius: 28,
                      offset: const Offset(0, 14),
                    ),
                  ],
                ),
                child: Image.asset(
                  _LoginScreenState._qLogoAsset,
                  fit: BoxFit.contain,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
