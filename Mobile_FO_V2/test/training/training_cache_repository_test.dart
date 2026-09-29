import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/models/fo_models.dart';
import 'package:myqpms_fo_v2/training/data/training_api.dart';
import 'package:myqpms_fo_v2/training/data/training_draft_cache.dart';
import 'package:myqpms_fo_v2/training/data/training_errors.dart';
import 'package:myqpms_fo_v2/training/data/training_repository.dart';
import 'package:myqpms_fo_v2/training/models/training_evidence.dart';

class MemoryStore implements TrainingCacheStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

class UploadTransport implements TrainingTransport {
  int intents = 0;
  int uploads = 0;
  int temporaryFailures = 0;
  int? permanentFailureStatus;
  @override
  Future<TrainingHttpResponse> send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    if (path.endsWith('/upload-url')) {
      intents++;
      return TrainingHttpResponse(200, {
        'upload': {
          'evidence_id': 'e$intents',
          'signed_upload_url': 'https://signed/$intents',
        },
      });
    }
    if (path.endsWith('/complete')) {
      return TrainingHttpResponse(201, {
        'evidence': {
          'id': 'done',
          'training_session_id': 's',
          'evidence_type': body!['evidence_type'],
          'file_name': body['file_name'],
          'mime_type': body['mime_type'],
          'file_size': body['file_size'],
        },
      });
    }
    return const TrainingHttpResponse(200, {'ok': true});
  }

  @override
  Future<void> upload(
    String signedUrl,
    Uint8List bytes,
    String mimeType,
  ) async {
    uploads++;
    if (permanentFailureStatus != null) {
      throw TrainingUploadException(
        'permanent',
        statusCode: permanentFailureStatus,
        retryable: false,
      );
    }
    if (temporaryFailures > 0) {
      temporaryFailures--;
      throw const TrainingTransportException('temporary');
    }
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
  test(
    'draft persists and restores step without tokens or signed URLs',
    () async {
      final store = MemoryStore();
      final cache = TrainingDraftCache(store: store);
      final draft = TrainingDraftRecord(
        cacheId: 'draft',
        attendanceId: 'a',
        siteVisitId: 'v',
        categoryId: 'c',
        trainingTypeId: 't',
        trainingDate: DateTime(2026, 9, 29),
        trainerName: 'Trainer',
        currentStep: TrainingFlowStep.topics,
      );
      await cache.saveDraft(draft);
      final loaded = await cache.loadDraft('draft');
      expect(loaded?.currentStep, TrainingFlowStep.topics);
      expect(store.values.values.single, isNot(contains('token')));
      expect(store.values.values.single, isNot(contains('signed')));
    },
  );

  test('cache clears only requested draft and queue session', () async {
    final store = MemoryStore();
    final cache = TrainingDraftCache(store: store);
    final now = DateTime.now();
    await cache.saveDraft(
      TrainingDraftRecord(
        cacheId: 'one',
        attendanceId: 'a',
        siteVisitId: 'v',
        trainingDate: now,
        trainerName: 'T',
      ),
    );
    await cache.saveDraft(
      TrainingDraftRecord(
        cacheId: 'two',
        attendanceId: 'a',
        siteVisitId: 'v2',
        trainingDate: now,
        trainerName: 'T',
      ),
    );
    for (final id in ['1', '2']) {
      await cache.putPendingEvidence(
        TrainingPendingEvidence(
          localId: id,
          sessionId: id,
          evidenceType: TrainingEvidenceType.groupPhoto,
          localFilePath: 'x',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          fileSize: 3,
          createdAt: now,
          updatedAt: now,
        ),
      );
    }
    await cache.clearDraft('one');
    await cache.clearSessionQueue('1');
    expect(await cache.loadDraft('one'), isNull);
    expect(await cache.loadDraft('two'), isNotNull);
    expect(await cache.queueForSession('1'), isEmpty);
    expect(await cache.queueForSession('2'), hasLength(1));
  });

  test('validation enforces size, MIME and topic linkage', () {
    expect(
      () => TrainingRepository.validateEvidence(
        type: TrainingEvidenceType.trainingDocument,
        mimeType: 'image/jpeg',
        fileSize: 2,
      ),
      throwsA(isA<TrainingUploadException>()),
    );
    expect(
      () => TrainingRepository.validateEvidence(
        type: TrainingEvidenceType.topicPhoto,
        mimeType: 'image/jpeg',
        fileSize: 2,
      ),
      throwsA(isA<TrainingValidationException>()),
    );
    expect(
      () => TrainingRepository.validateEvidence(
        type: TrainingEvidenceType.groupPhoto,
        mimeType: 'image/jpeg',
        fileSize: TrainingRepository.maxFileBytes + 1,
      ),
      throwsA(isA<TrainingUploadException>()),
    );
  });

  test(
    'pending upload survives repository restart and requests fresh intent on retry',
    () async {
      final store = MemoryStore();
      final cache = TrainingDraftCache(store: store);
      final transport = UploadTransport()..temporaryFailures = 1;
      final first = TrainingRepository(
        api: TrainingApi(user: user, transport: transport),
        cache: cache,
        readFile: (_) async => Uint8List(3),
      );
      final job = await first.enqueueEvidence(
        localId: 'job',
        sessionId: 's',
        evidenceType: TrainingEvidenceType.groupPhoto,
        localFilePath: 'x',
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      );
      await expectLater(
        first.uploadPending(job),
        throwsA(isA<TrainingTransportException>()),
      );
      final second = TrainingRepository(
        api: TrainingApi(user: user, transport: transport),
        cache: cache,
        readFile: (_) async => Uint8List(3),
      );
      final uploaded = await second.retryPending('s');
      expect(uploaded, hasLength(1));
      expect(transport.intents, 2);
      expect(await cache.queueForSession('s'), isEmpty);
    },
  );

  test(
    'non-retryable upload errors stay failed and duplicate local jobs are prevented',
    () async {
      final store = MemoryStore();
      final cache = TrainingDraftCache(store: store);
      final transport = UploadTransport()..permanentFailureStatus = 415;
      final repository = TrainingRepository(
        api: TrainingApi(user: user, transport: transport),
        cache: cache,
        readFile: (_) async => Uint8List(3),
      );
      await repository.enqueueEvidence(
        localId: 'same',
        sessionId: 's',
        evidenceType: TrainingEvidenceType.groupPhoto,
        localFilePath: 'x',
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      );
      await repository.enqueueEvidence(
        localId: 'same',
        sessionId: 's',
        evidenceType: TrainingEvidenceType.groupPhoto,
        localFilePath: 'x',
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3,
      );
      expect(await cache.queueForSession('s'), hasLength(1));
      final job = (await cache.queueForSession('s')).single;
      await expectLater(
        repository.uploadPending(job),
        throwsA(isA<TrainingUploadException>()),
      );
      final intentsBeforeRetry = transport.intents;
      final restarted = TrainingRepository(
        api: TrainingApi(user: user, transport: transport),
        cache: cache,
        readFile: (_) async => Uint8List(3),
      );
      expect(await restarted.retryPending('s'), isEmpty);
      expect(transport.intents, intentsBeforeRetry);
    },
  );
}
