import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/screens/training_review_step.dart';
import 'training_ui_test_support.dart';

void main() {
  test(
    'MEPC policy 2 cannot submit pending/missing topic photos or completion proof',
    () {
      final c = uiController(TrainingUiFakeRepository());
      final server = TrainingSession.fromJson({
        'session': {
          'id': 'session',
          'status': 'draft',
          'can_edit': true,
          'completion_policy_version': 2,
          'require_attendee_snapshot': false,
        },
        'category': {
          'id': 'technical',
          'code': 'technical_mep',
          'name': 'MEPC',
        },
      });
      c.session = server;
      c.selectedCategory = server.category;
      c.selectedSessionTopics = [
        const TrainingSessionTopic(
          id: 'st',
          trainingSessionId: 'session',
          topicId: 'topic',
          isCovered: true,
        ),
      ];
      TrainingEvidence file(
        String id,
        TrainingEvidenceType type, {
        bool uploaded = false,
      }) => TrainingEvidence(
        id: id,
        trainingSessionId: 'session',
        trainingSessionTopicId: type == TrainingEvidenceType.topicPhoto
            ? 'st'
            : null,
        evidenceType: type,
        fileName: 'proof.png',
        mimeType: 'image/png',
        fileSize: 10,
        isUploaded: uploaded,
      );
      expect(c.requiresMepcCompletionProof, isTrue);
      c.evidence = [
        file('photo', TrainingEvidenceType.topicPhoto, uploaded: true),
      ];
      expect(c.canSubmitLocally, isFalse);
      c.evidence.add(file('proof', TrainingEvidenceType.additionalDocument));
      expect(c.canSubmitLocally, isFalse);
      c.evidence = [
        file('photo', TrainingEvidenceType.topicPhoto),
        file('proof', TrainingEvidenceType.additionalDocument, uploaded: true),
      ];
      expect(c.canSubmitLocally, isFalse);
      c.evidence = [
        file('photo', TrainingEvidenceType.topicPhoto, uploaded: true),
        file('proof', TrainingEvidenceType.additionalDocument, uploaded: true),
      ];
      expect(c.canSubmitLocally, isTrue);
      expect(server.copyWith(evidence: c.evidence).completionPolicyVersion, 2);
    },
  );
  test(
    'HK and historical version-1 policy do not acquire MEPC completion enforcement',
    () {
      final c = uiController(TrainingUiFakeRepository());
      expect(c.requiresMepcCompletionProof, isFalse);
      c.selectedCategory = testTechnicalCategory;
      expect(c.requiresMepcCompletionProof, isFalse);
      c.session = null;
      expect(c.requiresMepcCompletionProof, isTrue);
    },
  );
  testWidgets('MEPC review explains mandatory verified completion proof', (
    tester,
  ) async {
    final c = uiController(TrainingUiFakeRepository())
      ..session = null
      ..selectedCategory = testTechnicalCategory;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: TrainingReviewStep(controller: c)),
      ),
    );
    expect(find.textContaining('completion proof'), findsOneWidget);
  });
}
