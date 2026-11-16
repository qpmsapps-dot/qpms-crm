import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_form_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_readiness.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_service.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

final _user = FoUser.fromJson({
  'id': 'synthetic-fo',
  'role': 'FO',
  'business': 'Reliance Retail',
});
DeepCleaningUpload _upload(String id, String type) =>
    DeepCleaningUpload.fromJson({
      'id': id,
      'submission_id': 'synthetic-record',
      'upload_type': type,
      'upload_status': 'uploaded',
      'mime_type': type == 'document' ? 'application/pdf' : 'image/png',
      'file_size': 100,
      'metadata': {
        'pair_id': type == 'document' ? null : 'pair-one',
        'pair_order': 1,
      },
    });
final _uploads = [
  _upload('before-one', 'before'),
  _upload('after-one', 'after'),
  _upload('proof-one', 'document'),
];
DeepCleaningSubmission _record({
  String status = 'draft',
  String remarks = '',
  List<DeepCleaningUpload>? uploads,
}) => DeepCleaningSubmission(
  id: 'synthetic-record',
  business: 'Reliance Retail',
  storeCode: 'SYN01',
  storeName: 'Synthetic Store',
  status: status,
  createdAt: DateTime.utc(2026, 11, 14),
  deepCleaningDate: '2026-11-12',
  evidenceFormat: 'paired_v1',
  remarks: remarks,
  submittedAt: status == 'submitted' ? DateTime.utc(2026, 11, 14, 8, 30) : null,
  uploads: uploads ?? _uploads,
);

class _Service extends DeepCleaningService {
  DeepCleaningSubmission current = _record();
  final response = Completer<DeepCleaningSubmission>();
  int submits = 0;
  int saves = 0;
  @override
  Future<DeepCleaningSubmission> getSubmission(String id) async => current;
  @override
  Future<DeepCleaningSubmission> updateDraft({
    required String id,
    String? storeCode,
    String? deepCleaningDate,
    String? vendorName,
    String? remarks,
  }) async {
    saves++;
    current = _record(remarks: remarks ?? '');
    return current;
  }

  @override
  Future<DeepCleaningSubmission> submitSubmission(
    String id, {
    String? outcome,
    String? notDoneReason,
  }) {
    submits++;
    return response.future;
  }

  @override
  Future<DeepCleaningViewUrl> viewUploadUrl({
    required String submissionId,
    required String uploadId,
  }) async =>
      throw const DeepCleaningApiException('Synthetic preview unavailable');
  @override
  Future<DeepCleaningListResult> listSubmissions({
    int page = 1,
    int limit = 25,
    String? status,
    String? storeCode,
  }) async => DeepCleaningListResult(
    rows: [
      current,
      _record(status: 'submitted'),
    ],
    page: 1,
    limit: 25,
    total: 2,
  );
}

Future<void> _form(WidgetTester tester, _Service service) async {
  await tester.pumpWidget(
    MaterialApp(
      home: DeepCleaningFormScreen(
        user: _user,
        service: service,
        initialSubmission: service.current,
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.scrollUntilVisible(
    find.byType(TextField),
    150,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final failFirst in [false, true]) {
    testWidgets(
      'replacement previews stay local before and after confirmation; retry=$failFirst',
      (tester) async {
        final root = Directory.systemTemp.createTempSync(
          'qpms-replacement-preview-',
        );
        final file = File('${root.path}/replacement.png')
          ..writeAsBytesSync(
            base64Decode(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            ),
          );
        const channel = MethodChannel('miguelruivo.flutter.plugins.filepicker');
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (_) async => [
            {
              'name': 'replacement.png',
              'path': file.path,
              'size': file.lengthSync(),
            },
          ],
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        final service = _ReplacementService(failFirst);
        await tester.binding.setSurfaceSize(const Size(1000, 1600));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await _form(tester, service);
        await tester.scrollUntilVisible(
          find.text('COMPARISON PAIRS'),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.ensureVisible(find.text('Replace').first);
        await tester.tap(find.text('Replace').first);
        await tester.pumpAndSettle();
        await tester.runAsync(() async {
          await tester.tap(find.text('Files'));
          await Future<void>.delayed(const Duration(milliseconds: 100));
        });
        await tester.pumpAndSettle();
        for (
          var wait = 0;
          wait < 20 && find.byType(AlertDialog).evaluate().isEmpty;
          wait++
        ) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 50)),
          );
          await tester.pumpAndSettle();
        }
        await tester.tap(find.widgetWithText(FilledButton, 'Replace'));
        await tester.pump();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        final localPreview = find.byWidgetPredicate(
          (w) =>
              w is Image &&
              w.image is FileImage &&
              (w.image as FileImage).file.path == file.path,
        );
        expect(localPreview, findsOneWidget);
        expect(service.removed, isEmpty);
        if (failFirst) {
          await tester.ensureVisible(find.text('Retry').first);
          await tester.pump();
          await tester.tap(find.text('Retry').first);
          await tester.pump();
        }
        expect(service.removed, isEmpty);
        service.confirm.complete(_upload('new-before', 'before'));
        await tester.pumpAndSettle();
        expect(service.removed, ['before-one']);
        expect(localPreview, findsOneWidget);
        expect(service.previewRequests, isNot(contains('new-before')));
        expect(service.requestIds.toSet(), hasLength(1));
        if (failFirst) expect(service.uploadIds, [null, 'new-before']);
        expect(tester.takeException(), isNull);
      },
    );
  }

  test(
    'readiness requires complete unique pairs and exactly one confirmed document; remarks optional',
    () {
      expect(DeepCleaningReadiness.fromSubmission(_record()).ready, isTrue);
      expect(
        DeepCleaningReadiness.fromSubmission(
          _record(uploads: [_uploads.first, _uploads.last]),
        ).ready,
        isFalse,
      );
      expect(
        DeepCleaningReadiness.fromSubmission(
          _record(uploads: [..._uploads, _upload('duplicate', 'before')]),
        ).ready,
        isFalse,
      );
      expect(
        DeepCleaningReadiness.fromSubmission(
          _record(uploads: [..._uploads, _upload('second-proof', 'document')]),
        ).ready,
        isFalse,
      );
      expect(
        DeepCleaningReadiness(
          hasStore: true,
          hasDate: true,
          uploads: _uploads,
          paired: true,
          expectedPairIds: ['pair-one', 'empty-pair'],
        ).ready,
        isFalse,
      );
      expect(
        DeepCleaningReadiness(
          hasStore: true,
          hasDate: true,
          uploads: _uploads,
          paired: true,
          hasLocalFiles: true,
        ).ready,
        isFalse,
      );
    },
  );

  testWidgets(
    'review saves current optional remarks and waits for server acceptance; duplicate tap is guarded',
    (tester) async {
      final service = _Service();
      await _form(tester, service);
      await tester.enterText(
        find.byType(TextField).first,
        'Actual optional note',
      );
      await tester.tap(find.text('Review & Submit'));
      await tester.pumpAndSettle();
      expect(service.current.remarks, 'Actual optional note');
      expect(service.saves, 1);
      expect(find.text('Review Submission'), findsOneWidget);
      await tester.tap(find.text('Final Submit'));
      await tester.pump();
      expect(service.submits, 1);
      expect(find.text('Submission Successful'), findsNothing);
      expect(find.text('Awaiting server confirmation...'), findsOneWidget);
      await tester.tap(find.text('Awaiting server confirmation...'));
      await tester.pump();
      expect(service.submits, 1);
      service.response.complete(_record(status: 'submitted'));
      await tester.pumpAndSettle();
      expect(find.text('Submission Successful'), findsOneWidget);
      expect(find.text('synthetic-record'), findsOneWidget);
      expect(find.text('2026-11-12'), findsOneWidget);
      expect(find.text('2026-11-14 14:00:00 IST'), findsOneWidget);
      expect(find.text('Final Submit'), findsNothing);
    },
  );

  testWidgets('unconfirmed submission response never displays success', (
    tester,
  ) async {
    final service = _Service();
    await _form(tester, service);
    await tester.tap(find.text('Review & Submit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Final Submit'));
    await tester.pump();
    service.response.complete(_record());
    await tester.pumpAndSettle();
    expect(find.text('Submission Successful'), findsNothing);
    expect(find.textContaining('Submission is not confirmed.'), findsOneWidget);
    expect(find.text('Final Submit'), findsOneWidget);
  });

  testWidgets('failed draft save retains remarks and cannot enter review', (
    tester,
  ) async {
    final service = _FailingSave();
    await _form(tester, service);
    await tester.enterText(find.byType(TextField).first, 'Keep this note');
    await tester.tap(find.text('Review & Submit'));
    await tester.pumpAndSettle();
    expect(find.text('Review Submission'), findsNothing);
    expect(find.text('Keep this note'), findsOneWidget);
    expect(service.submits, 0);
  });

  testWidgets('safe exit warns about unsaved work and Stay retains it', (
    tester,
  ) async {
    final service = _Service();
    await _form(tester, service);
    await tester.enterText(find.byType(TextField).first, 'Unsaved note');
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Leave this report?'), findsOneWidget);
    expect(find.textContaining('no offline draft backup'), findsOneWidget);
    await tester.tap(find.text('Stay'));
    await tester.pumpAndSettle();
    expect(find.text('Unsaved note'), findsOneWidget);
  });

  testWidgets(
    'record tabs use confirmed detail readiness and preserve submitted records',
    (tester) async {
      final service = _Service();
      service.current = _record(uploads: []);
      await tester.pumpWidget(
        MaterialApp(
          home: DeepCleaningScreen(user: _user, service: service),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Resume Work'), findsOneWidget);
      expect(find.text('100%'), findsNothing);
      expect(find.text('Submitted records'), findsNothing);
      await tester.tap(find.text('Submitted'));
      await tester.pumpAndSettle();
      expect(find.text('View Record'), findsOneWidget);
      expect(find.text('Submission confirmed by the server.'), findsOneWidget);
      expect(find.text('Assigned Schedule'), findsNothing);
    },
  );

  testWidgets(
    'off-screen record detail failures stay inside their readiness cards',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: DeepCleaningScreen(
            user: _user,
            service: _FailedRecordDetails(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Readiness unavailable. Open the draft to retry.'),
        findsWidgets,
      );
      expect(find.text('100%'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'compact large-text form has readable confirmed/error photo states',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = _Service();
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.3)),
            child: child!,
          ),
          home: DeepCleaningFormScreen(
            user: _user,
            service: service,
            initialSubmission: service.current,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('COMPARISON PAIRS'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('Retry preview'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
}

class _FailingSave extends _Service {
  @override
  Future<DeepCleaningSubmission> updateDraft({
    required String id,
    String? storeCode,
    String? deepCleaningDate,
    String? vendorName,
    String? remarks,
  }) async => throw const DeepCleaningApiException('Synthetic save failure');
}

class _ReplacementService extends _Service {
  _ReplacementService(this.failFirst);
  final bool failFirst;
  final confirm = Completer<DeepCleaningUpload>();
  final removed = <String>[];
  final previewRequests = <String>[];
  final requestIds = <String?>[];
  final uploadIds = <String?>[];
  int transfers = 0;
  @override
  Future<DeepCleaningUploadIntent> requestUploadUrl({
    String? requestId,
    String? uploadId,
    required String submissionId,
    required DeepCleaningUploadType uploadType,
    required String filename,
    required String mimeType,
    required int fileSize,
    String? pairId,
    int? pairOrder,
  }) async {
    requestIds.add(requestId);
    uploadIds.add(uploadId);
    return DeepCleaningUploadIntent(
      uploadId: 'new-before',
      storageBucket: 'synthetic',
      storagePath: 'synthetic',
      signedUrl: 'https://synthetic.invalid',
      uploadType: uploadType,
      mimeType: mimeType,
    );
  }

  @override
  Future<void> uploadToSignedUrl({
    required DeepCleaningUploadIntent intent,
    required File file,
    void Function(double)? onProgress,
  }) async {
    transfers++;
    if (failFirst && transfers == 1) {
      throw const DeepCleaningApiException('Synthetic transfer failure');
    }
  }

  @override
  Future<DeepCleaningUpload> completeUpload({
    required String submissionId,
    required DeepCleaningUploadIntent intent,
    required String originalFilename,
    required int fileSize,
  }) => confirm.future;
  @override
  Future<void> deleteUpload({
    required String submissionId,
    required String uploadId,
  }) async {
    removed.add(uploadId);
  }

  @override
  Future<DeepCleaningViewUrl> viewUploadUrl({
    required String submissionId,
    required String uploadId,
  }) async {
    previewRequests.add(uploadId);
    throw const DeepCleaningApiException('Synthetic preview unavailable');
  }
}

class _FailedRecordDetails extends _Service {
  @override
  Future<DeepCleaningListResult> listSubmissions({
    int page = 1,
    int limit = 25,
    String? status,
    String? storeCode,
  }) async => DeepCleaningListResult(
    rows: List.generate(
      12,
      (index) => DeepCleaningSubmission.fromJson({
        'id': 'synthetic-$index',
        'store_code': 'SYN$index',
        'status': 'draft',
        'deep_cleaning_date': '2026-11-12',
      }),
    ),
    page: 1,
    limit: 25,
    total: 12,
  );

  @override
  Future<DeepCleaningSubmission> getSubmission(String id) async =>
      throw const DeepCleaningApiException('Synthetic detail request failed');
}
