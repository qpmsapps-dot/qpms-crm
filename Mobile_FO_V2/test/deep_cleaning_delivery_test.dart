import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_models.dart';
import 'package:myqpms_fo_v2/deep_cleaning/deep_cleaning_service.dart';

void main() {
  test(
    'Planned requires explicit execute action; legacy Scheduled alone never authorizes',
    () {
      final planned = DeepCleaningSchedule.fromJson({
        'schedule_id': 's1',
        'retail_store_id': 'store',
        'status': 'Planned',
        'geographic_state': 'PY',
        'reporting_state': 'TN',
        'permitted_actions': ['view', 'execute'],
      });
      expect(planned.id, 's1');
      expect(planned.canExecute, isTrue);
      expect(planned.geographicState, 'PY');
      expect(planned.reportingState, 'TN');
      expect(
        DeepCleaningSchedule.fromJson({
          'id': 'old',
          'status': 'Scheduled',
        }).canExecute,
        isFalse,
      );
      expect(
        DeepCleaningSchedule.fromJson({
          'id': 'pending',
          'status': 'Planned',
          'assignment_status': 'Assignment Pending',
          'permitted_actions': ['view'],
        }).canExecute,
        isFalse,
      );
    },
  );
  test(
    'old ad-hoc payloads and linked metadata remain readable without rewriting evidence',
    () {
      expect(
        DeepCleaningSubmission.fromJson({
          'id': 'old',
          'status': 'submitted',
          'store_code': 'S1',
          'uploads': [],
        }).scheduleId,
        isNull,
      );
      expect(
        DeepCleaningSubmission.fromJson({
          'id': 'linked',
          'metadata': {'schedule_id': 's1'},
          'uploads': [],
        }).scheduleId,
        's1',
      );
    },
  );
  test(
    'real HTTP contract: identity token, month pagination, planned parsing and submission body',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final requests = <Map<String, dynamic>>[];
      server.listen((request) async {
        expect(
          request.headers.value('authorization'),
          'Bearer synthetic-test-only',
        );
        final body = await utf8.decoder.bind(request).join();
        requests.add({
          'path': request.uri.path,
          'query': request.uri.queryParameters,
          'body': body.isEmpty ? null : jsonDecode(body),
        });
        request.response.headers.contentType = ContentType.json;
        if (request.uri.path.endsWith('/schedules')) {
          request.response.write(
            jsonEncode({
              'contract_version': 'retail-cleaning.v1',
              'rows': [
                {
                  'schedule_id': 's1',
                  'status': 'Planned',
                  'permitted_actions': ['execute'],
                },
              ],
              'pagination': {'page': 2, 'limit': 5, 'total': 6},
            }),
          );
        } else {
          request.response.write(
            jsonEncode({
              'submission': {
                'id': 'draft',
                'schedule_id': 's1',
                'status': 'draft',
                'uploads': [],
              },
            }),
          );
        }
        await request.response.close();
      });
      try {
        final service = DeepCleaningService(
          backendUrl: 'http://127.0.0.1:${server.port}',
          accessToken: () => 'synthetic-test-only',
        );
        final result = await service.listSchedules(
          month: '2026-11',
          status: 'Planned',
          page: 2,
          limit: 5,
        );
        expect(result.page, 2);
        expect(result.total, 6);
        expect(result.rows.single.canExecute, isTrue);
        expect(requests.first['query'], {
          'month': '2026-11',
          'status': 'Planned',
          'page': '2',
          'limit': '5',
        });
        await service.createScheduledDraft(scheduleId: 's1');
        expect(requests.last['body'], {'schedule_id': 's1'});
        await service.submitSubmission(
          'draft',
          outcome: 'Not Done',
          notDoneReason: 'Store closed',
        );
        expect(requests.last['body'], {
          'outcome': 'Not Done',
          'not_done_reason': 'Store closed',
        });
      } finally {
        await server.close(force: true);
      }
    },
  );
  test(
    'old backend cannot silently expose an actionable schedule interface',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        request.response.headers.contentType = ContentType.json;
        request.response.write('{"ok":true,"rows":[]}');
        await request.response.close();
      });
      try {
        await expectLater(
          DeepCleaningService(
            backendUrl: 'http://127.0.0.1:${server.port}',
            accessToken: () => 'synthetic-test-only',
          ).listSchedules(),
          throwsA(isA<DeepCleaningApiException>()),
        );
      } finally {
        await server.close(force: true);
      }
    },
  );
  test('expired identity never sends an unauthenticated request', () async {
    await expectLater(
      DeepCleaningService(
        backendUrl: 'http://127.0.0.1:1',
        accessToken: () => null,
      ).listSchedules(),
      throwsA(
        isA<DeepCleaningApiException>().having(
          (e) => e.code,
          'code',
          'session_expired',
        ),
      ),
    );
  });
  test(
    'photo transport and retry retain the same server-issued upload identity',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final directory = await Directory.systemTemp.createTemp(
        'cleaning-photo-test-',
      );
      final bodies = <Map<String, dynamic>>[];
      var putCount = 0;
      server.listen((request) async {
        request.response.headers.contentType = ContentType.json;
        if (request.method == 'PUT') {
          expect(request.headers.contentType?.mimeType, 'image/jpeg');
          expect(
            await request.fold<List<int>>(
              [],
              (bytes, chunk) => bytes..addAll(chunk),
            ),
            [1, 2, 3],
          );
          putCount++;
        } else {
          final body = Map<String, dynamic>.from(
            jsonDecode(await utf8.decoder.bind(request).join()) as Map,
          );
          bodies.add(body);
          if (request.uri.path.endsWith('/upload-url')) {
            request.response.write(
              jsonEncode({
                'upload': {
                  'upload_id': 'photo1',
                  'storage_bucket': 'client-deep-cleaning-uploads',
                  'storage_path': 'original/private/path.jpg',
                  'signed_url':
                      'http://127.0.0.1:${server.port}/private-upload',
                  'upload_type': 'before',
                  'mime_type': 'image/jpeg',
                },
              }),
            );
          } else {
            request.response.write(
              jsonEncode({
                'upload': {
                  'id': 'photo1',
                  'upload_type': 'before',
                  'upload_status': 'uploaded',
                  'storage_path': 'original/private/path.jpg',
                  'metadata': {'pair_id': 'pair1', 'pair_order': 1},
                },
              }),
            );
          }
        }
        await request.response.close();
      });
      try {
        final service = DeepCleaningService(
          backendUrl: 'http://127.0.0.1:${server.port}',
          accessToken: () => 'synthetic-test-only',
        );
        final first = await service.requestUploadUrl(
          submissionId: 'draft',
          uploadType: DeepCleaningUploadType.before,
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          fileSize: 3,
          pairId: 'pair1',
          pairOrder: 1,
        );
        final file = await File(
          '${directory.path}/photo.jpg',
        ).writeAsBytes([1, 2, 3]);
        await service.uploadToSignedUrl(intent: first, file: file);
        final retry = await service.requestUploadUrl(
          submissionId: 'draft',
          uploadType: DeepCleaningUploadType.before,
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          fileSize: 3,
          pairId: 'pair1',
          pairOrder: 1,
          uploadId: first.uploadId,
        );
        expect(retry.uploadId, first.uploadId);
        expect(bodies.last['upload_id'], 'photo1');
        final photo = await service.completeUpload(
          submissionId: 'draft',
          intent: retry,
          originalFilename: 'photo.jpg',
          fileSize: 3,
        );
        expect(photo.id, 'photo1');
        expect(photo.pairId, 'pair1');
        expect(putCount, 1);
      } finally {
        await server.close(force: true);
        await directory.delete(recursive: true);
      }
    },
  );
}
