import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/training/models/training_attendee.dart';
import 'package:myqpms_fo_v2/training/models/training_category.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';
import 'package:myqpms_fo_v2/training/models/training_session.dart';
import 'package:myqpms_fo_v2/training/models/training_session_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_topic.dart';
import 'package:myqpms_fo_v2/training/models/training_type.dart';

void main() {
  test('category and type parse policy fields and ignore extras', () {
    final category = TrainingCategory.fromJson({
      'id': 'c1',
      'code': 'hk',
      'name': 'Housekeeping',
      'require_group_photo': true,
      'max_group_photos': 8,
      'extra': 1,
    });
    final type = TrainingType.fromJson({
      'id': 't1',
      'code': 'toolbox',
      'name': 'Toolbox',
      'extra': true,
    });
    expect(category.requireGroupPhoto, isTrue);
    expect(category.maxGroupPhotos, 8);
    expect(type.code, 'toolbox');
  });

  test('topic identity uses UUID even when codes match across categories', () {
    final first = TrainingTopic.fromJson({
      'id': 'one',
      'category_id': 'hk',
      'code': 'emergency_response',
      'module_name': 'Emergency',
    });
    final second = TrainingTopic.fromJson({
      'id': 'two',
      'category_id': 'mep',
      'code': 'emergency_response',
      'module_name': 'Emergency',
    });
    expect(first, isNot(second));
  });

  test('attendee, session topic and evidence parse nullable fields', () {
    final attendee = TrainingAttendee.fromJson({
      'id': 'a',
      'training_session_id': 's',
      'employee_code': 'E1',
      'employee_name': 'Name',
    });
    final topic = TrainingSessionTopic.fromJson({
      'id': 'st',
      'training_session_id': 's',
      'topic_id': 't',
      'is_covered': true,
    });
    final evidence = TrainingEvidence.fromJson({
      'id': 'e',
      'training_session_id': 's',
      'evidence_type': 'topic_photo',
      'file_name': 'a.jpg',
      'mime_type': 'image/jpeg',
      'file_size': 10,
    });
    expect(attendee.profileId, isNull);
    expect(topic.isCompleted, isTrue);
    expect(evidence.evidenceType, TrainingEvidenceType.topicPhoto);
  });

  test('full and list session response shapes parse defensively', () {
    final full = TrainingSession.fromJson({
      'session': {
        'id': 's',
        'status': 'draft',
        'training_date': '2026-09-29',
        'trainer_name_snapshot': 'Trainer',
      },
      'category': {'id': 'c', 'code': 'hk', 'name': 'HK'},
      'training_type': {'id': 't', 'code': 'toolbox', 'name': 'Toolbox'},
      'attendees': [],
      'topics': [],
      'evidence': [],
      'counts': {'attendees': 0},
    });
    final list = TrainingSession.fromJson({
      'id': 's2',
      'status': 'submitted',
      'trainer_name': 'Trainer',
      'attendee_count': 2,
    });
    expect(full.category?.code, 'hk');
    expect(full.isEditable, isTrue);
    expect(list.status, TrainingSessionStatus.submitted);
    expect(list.attendeeCount, 2);
  });
}
