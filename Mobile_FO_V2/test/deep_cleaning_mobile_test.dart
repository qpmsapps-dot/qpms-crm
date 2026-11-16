import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_form_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/utils/mobile_roles.dart';

void main() {
  testWidgets('comparison pairs fit a compact Android-sized form', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final user = FoUser.fromJson({
      'id': 'profile-1',
      'auth_user_id': 'auth-1',
      'employee_code': 'RRFO001',
      'full_name': 'Retail FO',
      'role': 'FO',
      'business': 'Reliance Retail',
    });
    final submission = DeepCleaningSubmission.fromJson({
      'id': 'draft-1',
      'business': 'Reliance Retail',
      'store_code': 'RR001',
      'store_name': 'Retail Store',
      'status': 'submitted',
      'created_at': '2026-10-19T00:00:00Z',
      'metadata': {'evidence_format': 'paired_v1'},
    });
    await tester.pumpWidget(
      MaterialApp(
        home: DeepCleaningFormScreen(user: user, initialSubmission: submission),
      ),
    );
    await tester.pump();
    await tester.scrollUntilVisible(
      find.text('COMPARISON PAIRS'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('COMPARISON PAIRS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  test(
    'Zone store and paired evidence metadata parse without changing legacy rows',
    () {
      final store = RelianceDeepCleaningStore.fromJson({
        'id': 'store-1',
        'store_code': 'RR001',
        'store_name': 'Retail Store',
        'state': 'TN',
        'zone_id': 'zone-1',
        'zone_code': 'TN-1',
        'zone_name': 'Chennai',
      });
      expect(store.zoneId, 'zone-1');
      expect(store.zoneName, 'Chennai');
      final submission = DeepCleaningSubmission.fromJson({
        'id': 'draft-1',
        'business': 'Reliance Retail',
        'store_code': 'RR001',
        'status': 'draft',
        'created_at': '2026-10-19T00:00:00Z',
        'metadata': {'evidence_format': 'paired_v1', 'zone_name': 'Chennai'},
      });
      expect(submission.zoneName, 'Chennai');
      final pairId = newDeepCleaningPairId();
      expect(
        pairId,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      final upload = DeepCleaningUpload.fromJson({
        'id': 'upload-1',
        'submission_id': 'submission-1',
        'upload_type': 'before',
        'storage_bucket': 'private',
        'storage_path': 'path',
        'mime_type': 'image/jpeg',
        'file_size': 100,
        'sequence_no': 2,
        'upload_status': 'uploaded',
        'metadata': {'pair_id': pairId, 'pair_order': 3},
      });
      expect(upload.pairId, pairId);
      expect(upload.pairOrder, 3);
      expect(
        DeepCleaningUpload.fromJson({
          ...{
            'id': 'legacy',
            'submission_id': 'submission-1',
            'upload_type': 'after',
            'storage_bucket': 'private',
            'storage_path': 'old',
            'mime_type': 'image/jpeg',
            'file_size': 100,
            'sequence_no': 1,
            'upload_status': 'uploaded',
          },
        }).pairId,
        isNull,
      );
    },
  );

  test(
    'standalone form uses Zone filter and explicit side-by-side pair assignment',
    () {
      final form = File(
        'lib/deep_cleaning/deep_cleaning_form_screen.dart',
      ).readAsStringSync();
      final service = File(
        'lib/deep_cleaning/deep_cleaning_service.dart',
      ).readAsStringSync();
      expect(form, contains('No Zone assigned. Contact your administrator.'));
      expect(form, contains('_comparisonPairsCard(readOnly)'));
      expect(form, contains('Add Another Pair'));
      expect(form, contains('Bulk Select Images'));
      expect(form, contains('Choose its pair and Before / After side'));
      expect(form, contains('FilePicker.pickFiles('));
      expect(form, contains('FilePicker.getDirectoryPath()'));
      expect(form, contains('Select images using Files instead.'));
      expect(service, contains("'evidence_format': 'paired_v1'"));
      expect(service, contains("'zone_id': zoneId!"));
    },
  );
  test('Reliance Retail FO visibility is role and business scoped', () {
    expect(isRelianceRetailFo(role: 'FO', business: 'Reliance Retail'), isTrue);
    expect(
      isRelianceRetailFo(role: 'Field Officer', business: 'Reliance'),
      isTrue,
    );
    expect(isRelianceRetailFo(role: 'FO', business: 'DME'), isFalse);
    expect(isRelianceRetailFo(role: 'FO', business: 'Retail'), isFalse);
    expect(
      isRelianceRetailFo(role: 'Operations Manager', business: 'Reliance'),
      isFalse,
    );
  });

  test('submit rules match backend evidence requirements', () {
    expect(
      canSubmitDeepCleaningEvidence(
        hasConfirmedBefore: false,
        hasConfirmedAfter: true,
        hasSingleSupportingDocument: true,
        hasActiveUploads: false,
      ),
      isFalse,
    );
    expect(
      canSubmitDeepCleaningEvidence(
        hasConfirmedBefore: true,
        hasConfirmedAfter: false,
        hasSingleSupportingDocument: true,
        hasActiveUploads: false,
      ),
      isFalse,
    );
    expect(
      canSubmitDeepCleaningEvidence(
        hasConfirmedBefore: true,
        hasConfirmedAfter: true,
        hasSingleSupportingDocument: true,
        hasActiveUploads: true,
      ),
      isFalse,
    );
    expect(
      canSubmitDeepCleaningEvidence(
        hasConfirmedBefore: true,
        hasConfirmedAfter: true,
        hasSingleSupportingDocument: false,
        hasActiveUploads: false,
      ),
      isFalse,
    );
    expect(
      canSubmitDeepCleaningEvidence(
        hasConfirmedBefore: true,
        hasConfirmedAfter: true,
        hasSingleSupportingDocument: true,
        hasActiveUploads: false,
      ),
      isTrue,
    );
  });

  test('new Deep Cleaning module is API-mediated and not attendance based', () {
    final service = File(
      'lib/deep_cleaning/deep_cleaning_service.dart',
    ).readAsStringSync();
    final form = File(
      'lib/deep_cleaning/deep_cleaning_form_screen.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/deep_cleaning/deep_cleaning_screen.dart',
    ).readAsStringSync();
    final combined = '$service\n$form\n$screen';

    expect(combined, contains('/api/client-deep-cleaning'));
    expect(combined, isNot(contains(".from('client_deep_cleaning")));
    expect(combined, isNot(contains(".from('store_master")));
    expect(combined, isNot(contains('SERVICE_ROLE')));
    expect(combined, isNot(contains('SUPABASE_SERVICE')));
    expect(combined, isNot(contains('Geolocator')));
    expect(combined, isNot(contains('LocalStore')));
    expect(combined, isNot(contains('getAttendance')));
    expect(combined, isNot(contains('activeVisit')));
    expect(combined, isNot(contains('fo_attendance')));
    expect(combined, isNot(contains('fo_site_visits')));
    expect(combined, isNot(contains('route_distance')));
    expect(combined, isNot(contains('updateAttendanceKm')));
  });

  test('upload semantics require one supporting document', () {
    final form = File(
      'lib/deep_cleaning/deep_cleaning_form_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/deep_cleaning/deep_cleaning_service.dart',
    ).readAsStringSync();

    expect(DeepCleaningUploadType.before.apiValue, 'before');
    expect(DeepCleaningUploadType.after.apiValue, 'after');
    expect(DeepCleaningUploadType.document.apiValue, 'document');
    expect(form, isNot(contains('Vendor Name (optional)')));
    expect(form, contains('Required: exactly 1 image or PDF'));
    expect(form, contains('_supportingDocumentSection(readOnly)'));
    expect(form, contains("allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf']"));
    expect(service, contains("body['vendor_name'] = vendorName"));
    expect(service, contains('upload_type'));
    expect(service, contains('uploadToSignedUrl'));
    expect(service, contains('completeUpload'));
    expect(service, contains('viewUploadUrl'));
    expect(service, contains('/view-url'));
  });

  test('schedule UI is hidden and only report history loads on entry', () {
    final screen = File(
      'lib/deep_cleaning/deep_cleaning_screen.dart',
    ).readAsStringSync();
    expect(screen, contains('static const _showScheduleInterface = false'));
    expect(screen, contains('if (_showScheduleInterface) _loadSchedules();'));
    expect(screen, contains("subtitle: 'Reliance Retail reports'"));
  });

  test('Reliance legacy attendance-based Cleaning card is hidden', () {
    final tasks = File('lib/tasks/tasks_screen.dart').readAsStringSync();
    expect(tasks, contains('if (!isRelianceRetailBusiness(widget.user.business))'));
  });

  test('submitted records are treated as read-only in model and form', () {
    final submitted = DeepCleaningSubmission.fromJson({
      'id': 'submission-id',
      'business': 'Reliance Retail',
      'store_code': 'TH72',
      'status': 'submitted',
      'created_at': DateTime.now().toIso8601String(),
    });
    expect(submitted.isSubmitted, isTrue);
    expect(submitted.isEditable, isFalse);

    final form = File(
      'lib/deep_cleaning/deep_cleaning_form_screen.dart',
    ).readAsStringSync();
    expect(form, contains('readOnly'));
    expect(form, contains('Submitted'));
    expect(form, contains('if (!readOnly)'));
  });

  test(
    'recovered remote evidence uses signed previews and backend deletion',
    () {
      final form = File(
        'lib/deep_cleaning/deep_cleaning_form_screen.dart',
      ).readAsStringSync();
      expect(form, contains('Image.network'));
      expect(form, contains('_signedUrlFor'));
      expect(form, contains('_refreshRemotePreview'));
      expect(form, contains('_openRemoteUpload'));
      expect(form, contains('_deleteRemoteUpload'));
      expect(form, contains('deleteUpload'));
      expect(
        form,
        contains('if (submissionId == null || _isSubmitted) return false;'),
      );
    },
  );
}
