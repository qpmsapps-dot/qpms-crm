import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../services/supabase_service.dart';
import '../services/local_store.dart';
import '../utils/mobile_roles.dart';
import 'data/training_api.dart';
import 'data/training_draft_cache.dart';
import 'data/training_errors.dart';
import 'data/training_repository.dart';
import 'models/training_category.dart';
import 'screens/training_flow_screen.dart';
import 'screens/hk_training_screen.dart';
import 'state/training_flow_controller.dart';
import 'widgets/training_site_context.dart';

enum TrainingLaunchMode { structuredNew, structuredResume, legacy }

bool isTrainingFoRole(String role) =>
    {'FO', 'FIELDOFFICER'}.contains(_normalizedTrainingStoreText(role));

bool isTrainingCreatorRole(String role) {
  try {
    return const {'FO', 'KAM', 'Operations Manager', 'Branch Head'}
        .contains(canonicalMobileRole(role));
  } catch (_) {
    return false;
  }
}

String _normalizedTrainingStoreText(String? value) =>
    (value ?? '').trim().replaceAll(RegExp(r'[\s_-]+'), '').toUpperCase();

bool isRelianceStructuredTrainingStore({
  String? business,
  String? clientName,
  String? storeName,
}) {
  final normalizedBusiness = _normalizedTrainingStoreText(business);
  final normalizedClient = _normalizedTrainingStoreText(clientName);
  if (const {'RELIANCE', 'RELIANCERETAIL'}.contains(normalizedBusiness)) {
    return true;
  }
  if ((normalizedBusiness.isEmpty || normalizedBusiness == 'RETAIL') &&
      const {'RELIANCE', 'RELIANCERETAIL'}.contains(normalizedClient)) {
    return true;
  }
  if (normalizedBusiness.isNotEmpty && normalizedBusiness != 'RETAIL') {
    return false;
  }
  const banners = <String>{
    'TRENDS',
    'RELIANCERETAIL',
    'RELIANCETRENDS',
    'DIGITAL',
    'RELIANCEDIGITAL',
    'SMART',
    'RELIANCESMART',
    'SMARTBAZAAR',
    'SMARTPOINT',
  };
  if (banners.contains(normalizedClient)) return true;
  final normalizedStore = _normalizedTrainingStoreText(storeName);
  return banners.any(normalizedStore.startsWith);
}

TrainingLaunchMode resolveTrainingLaunchMode({
  required String role,
  String? business,
  String? clientName,
  String? storeName,
  required bool contextAllowsNew,
  TrainingDraftRecord? localDraft,
}) {
  final eligible =
      isTrainingCreatorRole(role) &&
      isRelianceStructuredTrainingStore(
        business: business,
        clientName: clientName,
        storeName: storeName,
      );
  if (!eligible) return TrainingLaunchMode.legacy;
  if (localDraft?.sessionId?.trim().isNotEmpty == true) {
    return TrainingLaunchMode.structuredResume;
  }
  return contextAllowsNew
      ? TrainingLaunchMode.structuredNew
      : TrainingLaunchMode.legacy;
}

typedef LegacyTrainingBuilder = Widget Function(BuildContext context);

Future<TrainingCategory?> selectNewTrainingCategory(
  BuildContext context,
  List<TrainingCategory> categories,
) => showDialog<TrainingCategory>(
  context: context,
  builder: (dialogContext) => SimpleDialog(
    title: const Text('Training category'),
    children: [
      for (final category in categories.where((item) => item.isActive))
        SimpleDialogOption(
          onPressed: () => Navigator.pop(dialogContext, category),
          child: Text(category.name),
        ),
    ],
  ),
);

class TrainingLauncher {
  TrainingLauncher._();

  static final Set<String> _openingContexts = <String>{};

  static Future<bool?> openTrainingFlow({
    required BuildContext context,
    required FoUser user,
    required Attendance attendance,
    required SiteVisit siteVisit,
    required LegacyTrainingBuilder legacyBuilder,
    required bool historical,
  }) async {
    final attendanceId = _remoteId(attendance.remoteId, attendance.id);
    final siteVisitId = _remoteId(siteVisit.remoteId, siteVisit.id);
    final contextKey = '$attendanceId:$siteVisitId';
    if (!_openingContexts.add(contextKey)) {
      _snack(context, 'Training is already opening.');
      return null;
    }

    try {
      if (!isRelianceStructuredTrainingStore(business: user.business) &&
          !isRelianceStructuredTrainingStore(
            business: siteVisit.business,
            clientName: siteVisit.clientName,
            storeName: siteVisit.storeName,
          )) {
        return _openLegacy(context, legacyBuilder);
      }
      final repository = TrainingRepository(
        api: TrainingApi(user: user),
        cache: TrainingDraftCache(),
      );
      final canCreate =
          isTrainingCreatorRole(user.role) &&
          attendance.isActive &&
          siteVisit.isActive &&
          SupabaseService.isValidUuid(attendanceId) &&
          SupabaseService.isValidUuid(siteVisitId);
      final sessions = await repository.getSessions(
        mine: true,
        siteVisitId: siteVisitId,
        limit: 200,
      );
      if (!context.mounted) return null;
      String? selectedId;
      if (sessions.isNotEmpty) {
        selectedId = await showDialog<String>(
          context: context,
          builder: (dialogContext) => SimpleDialog(
            title: const Text('Training reports'),
            children: [
              for (final session in sessions)
                SimpleDialogOption(
                  onPressed: () => Navigator.pop(dialogContext, session.id),
                  child: Text(
                    '${session.storeNameSnapshot ?? 'Training'} • ${session.trainingDate?.toIso8601String().split('T').first ?? ''} • ${session.status.name}',
                  ),
                ),
              if (canCreate)
                SimpleDialogOption(
                  onPressed: () => Navigator.pop(dialogContext, '__new__'),
                  child: const Text('Create new Training'),
                ),
            ],
          ),
        );
        if (selectedId == null || !context.mounted) return null;
      } else if (!canCreate) {
        return _openLegacy(context, legacyBuilder);
      }
      final controller = TrainingFlowController(
        repository: repository,
        activeContextCheck: () async {
          final currentAttendance = await LocalStore.getAttendance();
          final currentVisit = await LocalStore.activeVisit(
            user: user,
            attendance: currentAttendance,
          );
          return currentAttendance?.isActive == true &&
              currentVisit?.isActive == true &&
              _remoteId(currentAttendance!.remoteId, currentAttendance.id) ==
                  attendanceId &&
              _remoteId(currentVisit!.remoteId, currentVisit.id) == siteVisitId;
        },
      )..readOnlyContext = !canCreate;
      try {
        if (selectedId != null && selectedId != '__new__') {
          await controller.resume(selectedId);
        } else {
          await controller.initializeNew(
            attendanceId: attendanceId,
            siteVisitId: siteVisitId,
            trainerName: user.fullName,
          );
          if (isTrainingFoRole(user.role) &&
              isRelianceStructuredTrainingStore(business: user.business) &&
              controller.session == null &&
              controller.selectedCategory == null) {
            if (!context.mounted) {
              controller.dispose();
              return null;
            }
            if (!controller.categories.any((item) => item.isActive)) {
              throw const TrainingValidationException(
                'Training is unavailable. Contact your administrator.',
              );
            }
            final category = await selectNewTrainingCategory(
              context,
              controller.categories,
            );
            if (category == null || !context.mounted) {
              controller.dispose();
              return null;
            }
            controller.selectCategory(category);
            await controller.loadTopics();
          }
        }
        if (!context.mounted) {
          controller.dispose();
          return null;
        }
        return await Navigator.of(context).push<bool>(
          MaterialPageRoute(
            builder: (_) => _TrainingControllerRoute(
              controller: controller,
              siteContext: TrainingSiteDisplayContext(
                siteName: '',
                checkedIn: canCreate,
              ),
            ),
          ),
        );
      } catch (_) {
        controller.dispose();
        rethrow;
      }
    } on TrainingException catch (error) {
      if (context.mounted) {
        await _showError(context, error.message, retryable: false);
      }
      return null;
    } finally {
      _openingContexts.remove(contextKey);
    }
  }

  static String _remoteId(String? remoteId, String localId) =>
      remoteId?.trim().isNotEmpty == true ? remoteId!.trim() : localId.trim();

  static Future<bool?> _openLegacy(
    BuildContext context,
    LegacyTrainingBuilder builder,
  ) => Navigator.of(context).push<bool>(MaterialPageRoute(builder: builder));

  static Future<bool> _showError(
    BuildContext context,
    String message, {
    required bool retryable,
  }) async =>
      await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Unable to open Training'),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Close'),
            ),
            if (retryable)
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Retry'),
              ),
          ],
        ),
      ) ??
      false;

  static void _snack(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _TrainingControllerRoute extends StatefulWidget {
  const _TrainingControllerRoute({
    required this.controller,
    required this.siteContext,
  });

  final TrainingFlowController controller;
  final TrainingSiteDisplayContext siteContext;

  @override
  State<_TrainingControllerRoute> createState() =>
      _TrainingControllerRouteState();
}

class _TrainingControllerRouteState extends State<_TrainingControllerRoute>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        widget.controller.session != null) {
      widget.controller.refresh().catchError((Object _) {
        // Fail closed until the employee can refresh an authoritative session.
        widget.controller.lockForHistory();
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      (widget.controller.session?.hkTrainingPolicy == 'hk_single_page_v1' ||
          (widget.controller.session == null &&
              widget.controller.selectedCategory?.code == 'hk'))
      ? HkTrainingScreen(controller: widget.controller)
      : TrainingFlowScreen(
          controller: widget.controller,
          siteContext: widget.siteContext,
        );
}
