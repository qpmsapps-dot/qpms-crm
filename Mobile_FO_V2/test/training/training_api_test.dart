import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_errors.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';

class FakeTransport implements TrainingTransport {
  final calls =
      <
        ({
          String method,
          String path,
          Map<String, String>? query,
          Map<String, dynamic>? body,
        })
      >[];
  final Map<String, TrainingHttpResponse> responses = {};
  int uploads = 0;
  @override
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    calls.add((method: method, path: path, query: query, body: body));
    return responses['$method $path'] ??
        const TrainingHttpResponse(200, {'ok': true});
  }

  @override
  Future<void> upload(
    String signedUrl,
    Uint8List bytes,
    String mimeType,
  ) async {
    uploads++;
  }
}

const user = FoUser(
  authUserId: 'u',
  employeeCode: 'E',
  fullName: 'User',
  mobile: '',
  email: '',
  state: 'KA',
  role: 'FO',
);

void main() {
  late FakeTransport transport;
  late TrainingApi api;
  setUp(() {
    transport = FakeTransport();
    api = TrainingApi(user: user, transport: transport);
  });

  test(
    'master and staff endpoints use exact Phase 2 routes and queries',
    () async {
      transport.responses['GET /api/training/categories'] =
          const TrainingHttpResponse(200, {
            'categories': [
              {'id': 'c', 'code': 'hk', 'name': 'HK'},
            ],
          });
      transport.responses['GET /api/training/types'] =
          const TrainingHttpResponse(200, {
            'training_types': [
              {'id': 't', 'code': 'toolbox', 'name': 'Toolbox'},
            ],
          });
      transport.responses['GET /api/training/topics'] =
          const TrainingHttpResponse(200, {'topics': []});
      transport.responses['GET /api/training/site-staff'] =
          const TrainingHttpResponse(200, {'staff': []});
      expect(await api.getCategories(), hasLength(1));
      expect(await api.getTypes(), hasLength(1));
      await api.getTopics(categoryId: 'c');
      await api.searchSiteStaff(siteId: 'site', query: 'ann', limit: 10);
      expect(transport.calls[2].query, {'category_id': 'c'});
      expect(transport.calls[3].query, {
        'site_id': 'site',
        'q': 'ann',
        'limit': '10',
      });
    },
  );

  test('create payload contains only backend-approved input fields', () async {
    transport.responses['POST /api/training/sessions'] =
        const TrainingHttpResponse(201, {
          'session': {'id': 's', 'status': 'draft'},
        });
    await api.createSession(
      attendanceId: 'a',
      siteVisitId: 'v',
      categoryId: 'c',
      trainingTypeId: 't',
      trainingDate: DateTime(2026, 9, 29),
      trainerName: 'Trainer',
    );
    expect(
      transport.calls.single.body!.keys,
      unorderedEquals([
        'attendance_id',
        'site_visit_id',
        'category_id',
        'training_type_id',
        'training_date',
        'trainer_name',
        'remarks',
      ]),
    );
    expect(transport.calls.single.body, isNot(contains('store_id')));
  });

  test(
    'session, attendee, topic, submit and cancel methods use exact verbs',
    () async {
      const detail = TrainingHttpResponse(200, {
        'session': {'id': 's', 'status': 'draft'},
      });
      transport.responses.addAll({
        'GET /api/training/sessions/s': detail,
        'PATCH /api/training/sessions/s': detail,
        'POST /api/training/sessions/s/attendees': const TrainingHttpResponse(
          201,
          {
            'attendee': {
              'id': 'a',
              'training_session_id': 's',
              'employee_code': 'E',
              'employee_name': 'N',
            },
          },
        ),
        'DELETE /api/training/sessions/s/attendees/a':
            const TrainingHttpResponse(200, {}),
        'PUT /api/training/sessions/s/topics': const TrainingHttpResponse(200, {
          'topics': {'count': 1},
        }),
        'PATCH /api/training/sessions/s/topics/st': const TrainingHttpResponse(
          200,
          {
            'topic': {'id': 'st', 'training_session_id': 's', 'topic_id': 't'},
          },
        ),
        'POST /api/training/sessions/s/submit': detail,
        'POST /api/training/sessions/s/cancel': detail,
      });
      await api.getSession('s');
      await api.updateSession(
        sessionId: 's',
        categoryId: 'c',
        trainingTypeId: 't',
        trainingDate: DateTime(2026),
        trainerName: 'T',
      );
      await api.addAttendee(sessionId: 's', profileId: 'p');
      await api.removeAttendee(sessionId: 's', attendeeId: 'a');
      await api.setTopics(sessionId: 's', topicIds: ['t']);
      await api.updateSessionTopic(
        sessionId: 's',
        sessionTopicId: 'st',
        isCovered: true,
      );
      await api.submitSession('s');
      await api.cancelSession('s');
      expect(transport.calls, hasLength(8));
    },
  );

  test(
    'evidence follows intent, signed upload, completion, view and delete',
    () async {
      transport.responses['POST /api/training/sessions/s/evidence/upload-url'] =
          const TrainingHttpResponse(200, {
            'upload': {
              'evidence_id': 'e',
              'signed_upload_url': 'https://signed',
            },
          });
      transport.responses['POST /api/training/sessions/s/evidence/complete'] =
          const TrainingHttpResponse(201, {
            'evidence': {
              'id': 'e',
              'training_session_id': 's',
              'evidence_type': 'group_photo',
              'file_name': 'a.jpg',
              'mime_type': 'image/jpeg',
              'file_size': 3,
            },
          });
      transport.responses['GET /api/training/sessions/s/evidence/e/view-url'] =
          const TrainingHttpResponse(200, {
            'view': {'url': 'https://view'},
          });
      final intent = await api.createEvidenceUploadIntent(
        sessionId: 's',
        evidenceType: TrainingEvidenceType.groupPhoto,
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      );
      await api.uploadSigned(intent, Uint8List(3), 'image/jpeg');
      await api.completeEvidence(
        sessionId: 's',
        evidenceId: 'e',
        evidenceType: TrainingEvidenceType.groupPhoto,
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      );
      expect(
        (await api.getEvidenceViewUrl(sessionId: 's', evidenceId: 'e')).url,
        'https://view',
      );
      await api.deleteEvidence(sessionId: 's', evidenceId: 'e');
      expect(transport.uploads, 1);
    },
  );

  test('HTTP errors map to typed safe exceptions', () async {
    final cases = <int, Type>{
      400: TrainingValidationException,
      401: TrainingAuthException,
      403: TrainingPermissionException,
      404: TrainingNotFoundException,
      409: TrainingConflictException,
      413: TrainingUploadException,
      415: TrainingUploadException,
      500: TrainingServerException,
    };
    for (final entry in cases.entries) {
      transport.responses['GET /api/training/categories'] =
          TrainingHttpResponse(entry.key, const {
            'code': 'x',
            'message': 'safe',
          });
      expect(
        api.getCategories(),
        throwsA(
          isA<TrainingException>().having(
            (e) => e.runtimeType,
            'type',
            entry.value,
          ),
        ),
      );
    }
  });
}
