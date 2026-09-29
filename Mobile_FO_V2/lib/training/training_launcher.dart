import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../services/supabase_service.dart';
import '../utils/mobile_roles.dart';
import 'data/training_api.dart';
import 'data/training_draft_cache.dart';
import 'data/training_errors.dart';
import 'data/training_repository.dart';
import 'screens/training_flow_screen.dart';
import 'state/training_flow_controller.dart';
import 'widgets/training_site_context.dart';

enum TrainingLaunchMode { structuredNew, structuredResume, legacy }

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
      isRelianceStructuredTrainingRole(role) &&
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
      final cache = TrainingDraftCache();
      TrainingDraftRecord? localDraft;
      try {
        localDraft = await cache.loadDraft(contextKey);
      } catch (_) {
        if (context.mounted) {
          await _showError(
            context,
            'The saved Training draft could not be read. Please try again.',
            retryable: true,
          );
        }
        return null;
      }
      if (!context.mounted) return null;

      final contextAllowsNew =
          attendance.isActive &&
          siteVisit.isActive &&
          SupabaseService.isValidUuid(attendanceId) &&
          SupabaseService.isValidUuid(siteVisitId);
      var mode = resolveTrainingLaunchMode(
        role: user.role,
        business: siteVisit.business,
        clientName: siteVisit.clientName,
        storeName: siteVisit.storeName,
        contextAllowsNew: contextAllowsNew,
        localDraft: localDraft,
      );
      if (mode == TrainingLaunchMode.legacy) {
        return _openLegacy(context, legacyBuilder);
      }

      while (context.mounted) {
        if (!context.mounted) return null;
        _showLoading(context);
        TrainingFlowController? controller;
        try {
          final repository = TrainingRepository(
            api: TrainingApi(user: user),
            cache: cache,
          );
          controller = TrainingFlowController(repository: repository);
          if (mode == TrainingLaunchMode.structuredResume) {
            await controller.resume(localDraft!.sessionId!.trim());
            if (!_matchesContext(
              controller,
              attendanceId: attendanceId,
              siteVisitId: siteVisitId,
            )) {
              await cache.clearDraft(contextKey);
              controller.dispose();
              controller = null;
              mode = contextAllowsNew
                  ? TrainingLaunchMode.structuredNew
                  : TrainingLaunchMode.legacy;
            } else if (!controller.isEditable) {
              await cache.clearDraft(contextKey);
            }
          }
          if (mode == TrainingLaunchMode.structuredNew) {
            await controller!.initializeNew(
              attendanceId: attendanceId,
              siteVisitId: siteVisitId,
              trainerName: user.fullName,
            );
          }
          if (context.mounted) _closeLoading(context);
          if (!context.mounted) return null;
          if (mode == TrainingLaunchMode.legacy) {
            return _openLegacy(context, legacyBuilder);
          }
          if (!context.mounted || controller == null) return null;
          final result = await Navigator.of(context).push<bool>(
            MaterialPageRoute(
              builder: (_) => _TrainingControllerRoute(
                controller: controller!,
                siteContext: TrainingSiteDisplayContext(
                  siteName: siteVisit.storeName,
                  state: siteVisit.state,
                  business: siteVisit.business ?? siteVisit.clientName,
                  checkedIn: siteVisit.isActive,
                  checkInTime: siteVisit.checkInTime,
                ),
              ),
            ),
          );
          return result;
        } on TrainingNotFoundException catch (_) {
          controller?.dispose();
          if (context.mounted) _closeLoading(context);
          await cache.clearDraft(contextKey);
          localDraft = null;
          mode = contextAllowsNew
              ? TrainingLaunchMode.structuredNew
              : TrainingLaunchMode.legacy;
          if (mode == TrainingLaunchMode.legacy && context.mounted) {
            return _openLegacy(context, legacyBuilder);
          }
        } on TrainingException catch (error) {
          controller?.dispose();
          if (context.mounted) _closeLoading(context);
          if (!context.mounted) return null;
          final retry = await _showError(
            context,
            error.message,
            retryable: error.retryable,
          );
          if (!retry) return null;
        } catch (_) {
          controller?.dispose();
          if (context.mounted) _closeLoading(context);
          if (!context.mounted) return null;
          final retry = await _showError(
            context,
            'Training could not be opened right now.',
            retryable: true,
          );
          if (!retry) return null;
        }
      }
      return null;
    } finally {
      _openingContexts.remove(contextKey);
    }
  }

  static String _remoteId(String? remoteId, String localId) =>
      remoteId?.trim().isNotEmpty == true ? remoteId!.trim() : localId.trim();

  static bool _matchesContext(
    TrainingFlowController controller, {
    required String attendanceId,
    required String siteVisitId,
  }) {
    final session = controller.session;
    return session != null &&
        session.attendanceId == attendanceId &&
        session.siteVisitId == siteVisitId;
  }

  static Future<bool?> _openLegacy(
    BuildContext context,
    LegacyTrainingBuilder builder,
  ) => Navigator.of(context).push<bool>(MaterialPageRoute(builder: builder));

  static void _showLoading(BuildContext context) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const PopScope(
        canPop: false,
        child: AlertDialog(
          content: Row(
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
              SizedBox(width: 16),
              Expanded(child: Text('Preparing Training...')),
            ],
          ),
        ),
      ),
    );
  }

  static void _closeLoading(BuildContext context) {
    Navigator.of(context, rootNavigator: true).pop();
  }

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

class _TrainingControllerRouteState extends State<_TrainingControllerRoute> {
  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TrainingFlowScreen(
    controller: widget.controller,
    siteContext: widget.siteContext,
  );
}
