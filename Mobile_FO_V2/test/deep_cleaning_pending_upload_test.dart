import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_form_screen.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_service.dart';

void main() {
  testWidgets(
    'restored draft exposes incomplete uploads for authorized removal',
    (tester) async {
      final draft = DeepCleaningSubmission.fromJson({
        'id': 'draft',
        'business': 'Reliance Retail',
        'store_code': 'S1',
        'status': 'draft',
        'metadata': {'evidence_format': 'paired_v1'},
        'uploads': [
          {
            'id': 'pending-photo',
            'submission_id': 'draft',
            'upload_type': 'before',
            'original_filename': 'unfinished.jpg',
            'upload_status': 'pending',
            'metadata': {'pair_id': 'pair1', 'pair_order': 1},
          },
        ],
      });
      final service = _PendingDraftService(draft);
      const user = FoUser(
        authUserId: 'fo-auth',
        employeeCode: 'FO1',
        fullName: 'Synthetic FO',
        mobile: '',
        email: '',
        state: 'TN',
        role: 'FO',
        business: 'Reliance Retail',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: DeepCleaningFormScreen(
            user: user,
            initialSubmission: draft,
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Incomplete uploads'), findsOneWidget);
      expect(find.text('unfinished.jpg'), findsOneWidget);
      await tester.ensureVisible(find.text('Remove incomplete upload'));
      await tester.tap(find.text('Remove incomplete upload'));
      await tester.pumpAndSettle();
      expect(service.removed, ['draft', 'pending-photo']);
      expect(find.text('Incomplete uploads'), findsNothing);
    },
  );
}

class _PendingDraftService extends DeepCleaningService {
  _PendingDraftService(this.draft);
  final DeepCleaningSubmission draft;
  final removed = <String>[];
  @override
  Future<DeepCleaningSubmission> getSubmission(String id) async => draft;
  @override
  Future<void> deleteUpload({
    required String submissionId,
    required String uploadId,
  }) async {
    removed.addAll([submissionId, uploadId]);
  }
}
