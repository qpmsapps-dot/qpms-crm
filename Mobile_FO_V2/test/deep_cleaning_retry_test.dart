import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_form_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_service.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';

class _Service extends DeepCleaningService {
  final draftIds = <String?>[];
  final intentIds = <String?>[];
  final String? rejectionMessage;
  _Service({this.rejectionMessage});
  @override
  Future<RelianceDeepCleaningStoreResult> searchRelianceStores({
    String query = '',
    String? zoneId,
    int page = 1,
    int limit = 20,
  }) async => RelianceDeepCleaningStoreResult(
    rows: [
      RelianceDeepCleaningStore(
        id: 'store',
        storeCode: 'SYN01',
        storeName: 'Synthetic',
        clientName: 'Reliance Retail',
        state: 'TN',
        business: 'Reliance Retail',
      ),
    ],
    zones: [const DeepCleaningZone(id: 'zone', code: 'Z', name: 'Synthetic')],
    page: 1,
    limit: 20,
    total: 1,
  );
  @override
  Future<DeepCleaningSubmission> createDraft({
    String? requestId,
    required String storeCode,
    required String deepCleaningDate,
    String? vendorName,
    String? remarks,
  }) async {
    draftIds.add(requestId);
    if (draftIds.length == 1) {
      if (rejectionMessage != null) {
        throw DeepCleaningApiException(
          rejectionMessage!,
          code: 'store_state_forbidden',
        );
      }
      throw DeepCleaningApiException(
        deepCleaningErrorMessage(503, null, 'combined_release_frozen'),
        code: 'combined_release_frozen',
      );
    }
    return DeepCleaningSubmission.fromJson({
      'id': 'draft',
      'store_code': storeCode,
      'status': 'draft',
      'deep_cleaning_date': deepCleaningDate,
      'metadata': {'evidence_format': 'paired_v1'},
    });
  }

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
    intentIds.add(requestId);
    throw const DeepCleaningApiException('Synthetic intent failure');
  }
}

void main() {
  test(
    '403 preserves the safe backend explanation with a fallback for empty messages',
    () {
      expect(
        deepCleaningErrorMessage(
          403,
          'The database rejected this store under its state-access rules.',
          'store_state_forbidden',
        ),
        'The database rejected this store under its state-access rules.',
      );
      expect(
        deepCleaningErrorMessage(403, '  ', null),
        'You are not authorised for Reliance Retail Deep Cleaning.',
      );
    },
  );
  test('freeze message is specific; diagnostic code remains intact', () {
    final error = DeepCleaningApiException(
      deepCleaningErrorMessage(503, 'raw', 'combined_release_frozen'),
      code: 'combined_release_frozen',
    );
    expect(
      error.message,
      'Deep Cleaning uploads are temporarily unavailable. Please try again after the system is enabled.',
    );
    expect(error.code, 'combined_release_frozen');
    expect(
      deepCleaningErrorMessage(503, 'raw', 'other'),
      'Deep Cleaning request failed. Please try again.',
    );
  });
  for (final kind in ['document', 'before', 'after']) {
    testWidgets('$kind survives rejected draft and stable retries', (
      tester,
    ) async {
      final dir = Directory.systemTemp.createTempSync('deep-cleaning-test-');
      final file = File('${dir.path}/synthetic.png')
        ..writeAsBytesSync(
          base64Decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          ),
        );
      // Retain tiny synthetic files: Windows image decoders can hold them open.
      var picks = 0;
      const channel = MethodChannel('miguelruivo.flutter.plugins.filepicker');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        picks++;
        return [
          {
            'name': 'synthetic.png',
            'path': file.path,
            'size': file.lengthSync(),
          },
        ];
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      final service = _Service(
        rejectionMessage: kind == 'before'
            ? 'The database rejected this AP-2 store under its state-access rules.'
            : null,
      );
      await tester.pumpWidget(
        MaterialApp(
          home: DeepCleaningFormScreen(
            service: service,
            user: FoUser.fromJson({
              'id': 'synthetic',
              'role': 'FO',
              'business': 'Reliance Retail',
            }),
          ),
        ),
      );
      await tester.tap(find.text('Select').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('SYN01'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Select Date'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      if (kind != 'document') {
        await tester.scrollUntilVisible(
          find.text('COMPARISON PAIRS'),
          200,
          scrollable: find.byType(Scrollable).first,
        );
      }
      final add = kind == 'document'
          ? find.text('Add File')
          : find.text('Add').at(kind == 'before' ? 0 : 1);
      await tester.scrollUntilVisible(
        add,
        400,
        scrollable: find.byType(Scrollable).first,
      );
      if (kind != 'document') {
        await tester.ensureVisible(add);
        await tester.pumpAndSettle();
        await tester.tap(add);
        await tester.pumpAndSettle();
      }
      await tester.runAsync(() async {
        await tester.tap(kind == 'document' ? add : find.text('Files'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pumpAndSettle();
      expect(picks, 1, reason: 'picker invoked for $kind');
      for (var wait = 0; wait < 20 && service.draftIds.isEmpty; wait++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pumpAndSettle();
      }
      expect(
        service.draftIds.length,
        1,
        reason: 'selection reached draft creation for $kind',
      );
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Image &&
              w.image is FileImage &&
              (w.image as FileImage).file.path == file.path,
        ),
        findsOneWidget,
      );
      expect(service.intentIds, isEmpty);
      if (kind == 'before') {
        expect(
          find.textContaining('The database rejected this AP-2 store'),
          findsWidgets,
        );
      }
      expect(find.text('Retry'), findsWidgets);
      await tester.ensureVisible(find.text('Retry').first);
      await tester.tap(find.text('Retry').first);
      await tester.pumpAndSettle();
      expect(service.draftIds.length, 2);
      expect(service.draftIds.first, isNotNull);
      expect(service.draftIds.toSet().length, 1);
      await tester.scrollUntilVisible(
        find.text('Retry'),
        -150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Retry').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Retry').first);
      await tester.pumpAndSettle();
      expect(service.intentIds.length, 2);
      expect(service.intentIds.first, isNotNull);
      expect(service.intentIds.toSet().length, 1);
      expect(picks, 1);
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Image &&
              w.image is FileImage &&
              (w.image as FileImage).file.path == file.path,
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  }
}
