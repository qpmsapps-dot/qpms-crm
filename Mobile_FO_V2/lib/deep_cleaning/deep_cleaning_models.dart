import 'dart:io';
import 'dart:math';

const deepCleaningMaxUploadBytes = 5 * 1024 * 1024;
const deepCleaningBusiness = 'Reliance Retail';

class DeepCleaningSchedule {
  const DeepCleaningSchedule({
    required this.id,
    required this.retailStoreId,
    required this.storeCode,
    required this.storeName,
    required this.scheduledDate,
    required this.status,
    this.notDoneReason,
    this.completedAt,
    this.notes,
    this.city,
    this.geographicState,
    this.reportingState,
    this.zoneId,
    this.zoneLabel,
    this.latitude,
    this.longitude,
    this.assignmentStatus = 'Assignment Pending',
    this.permittedActions = const [],
  });
  final String id,
      retailStoreId,
      storeCode,
      storeName,
      scheduledDate,
      status,
      assignmentStatus;
  final String? notDoneReason,
      notes,
      city,
      geographicState,
      reportingState,
      zoneId,
      zoneLabel;
  final double? latitude, longitude;
  String get locationLabel =>
      city ??
      (latitude != null && longitude != null
          ? '$latitude, $longitude'
          : 'Location unavailable');
  final DateTime? completedAt;
  final List<String> permittedActions;
  bool get canExecute => permittedActions.contains('execute');
  factory DeepCleaningSchedule.fromJson(Map<String, dynamic> json) =>
      DeepCleaningSchedule(
        id: _text(json['schedule_id'] ?? json['id']),
        retailStoreId: _text(json['retail_store_id']),
        storeCode: _text(json['store_code']),
        storeName: _text(json['store_name']),
        scheduledDate: _text(json['scheduled_date']),
        status: _text(json['status']),
        notDoneReason: _nullableText(json['not_done_reason']),
        completedAt: _dateTime(json['completed_at']),
        notes: _nullableText(json['notes']),
        city: _nullableText(json['city']),
        geographicState: _nullableText(json['geographic_state']),
        reportingState: _nullableText(json['reporting_state']),
        zoneId: _nullableText(json['zone_id']),
        zoneLabel: _nullableText(
          json['zone_code'] ??
              (json['zone'] is Map ? json['zone']['code'] : null),
        ),
        latitude: double.tryParse('${json['latitude']}'),
        longitude: double.tryParse('${json['longitude']}'),
        assignmentStatus: _text(json['assignment_status']),
        permittedActions: (json['permitted_actions'] as List? ?? [])
            .whereType<String>()
            .toList(),
      );
}

enum DeepCleaningUploadType {
  before('before', 'Before Cleaning'),
  after('after', 'After Cleaning'),
  checklist('checklist', 'Checklist / Document'),
  document('document', 'Supporting Document');

  const DeepCleaningUploadType(this.apiValue, this.label);

  final String apiValue;
  final String label;

  static DeepCleaningUploadType fromApi(String value) {
    final clean = value.trim().toLowerCase();
    return DeepCleaningUploadType.values.firstWhere(
      (type) => type.apiValue == clean,
      orElse: () => DeepCleaningUploadType.checklist,
    );
  }
}

enum DeepCleaningLocalUploadStatus { pending, uploading, uploaded, failed }

bool canSubmitDeepCleaningEvidence({
  required bool hasConfirmedBefore,
  required bool hasConfirmedAfter,
  required bool hasSingleSupportingDocument,
  required bool hasActiveUploads,
}) {
  return hasConfirmedBefore &&
      hasConfirmedAfter &&
      hasSingleSupportingDocument &&
      !hasActiveUploads;
}

String newDeepCleaningPairId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class DeepCleaningZone {
  const DeepCleaningZone({
    required this.id,
    required this.code,
    required this.name,
  });
  final String id;
  final String code;
  final String name;

  factory DeepCleaningZone.fromJson(Map<String, dynamic> json) =>
      DeepCleaningZone(
        id: _text(json['id']),
        code: _text(json['zone_code']),
        name: _text(json['zone_name']),
      );
}

class RelianceDeepCleaningStoreResult {
  const RelianceDeepCleaningStoreResult({
    required this.rows,
    required this.zones,
    required this.page,
    required this.limit,
    required this.total,
  });
  final List<RelianceDeepCleaningStore> rows;
  final List<DeepCleaningZone> zones;
  final int page;
  final int limit;
  final int total;
}

class RelianceDeepCleaningStore {
  const RelianceDeepCleaningStore({
    required this.id,
    required this.storeCode,
    required this.storeName,
    required this.clientName,
    required this.state,
    this.city,
    this.storeFormat,
    this.business,
    this.zoneId,
    this.zoneCode,
    this.zoneName,
  });

  final String id;
  final String storeCode;
  final String storeName;
  final String clientName;
  final String state;
  final String? city;
  final String? storeFormat;
  final String? business;
  final String? zoneId;
  final String? zoneCode;
  final String? zoneName;

  factory RelianceDeepCleaningStore.fromJson(Map<String, dynamic> json) {
    final metadata = json['metadata'] is Map
        ? Map<String, dynamic>.from(json['metadata'] as Map)
        : const <String, dynamic>{};
    return RelianceDeepCleaningStore(
      id: _text(json['id']),
      storeCode: _text(json['store_code']),
      storeName: _text(json['store_name']),
      clientName: _text(json['client_name']),
      state: _text(json['state']),
      city: _nullableText(
        json['city'] ?? metadata['city'] ?? metadata['location'],
      ),
      storeFormat: _nullableText(
        json['store_format'] ?? metadata['store_format'] ?? metadata['format'],
      ),
      business: _nullableText(json['business']),
      zoneId: _nullableText(json['zone_id']),
      zoneCode: _nullableText(json['zone_code']),
      zoneName: _nullableText(json['zone_name']),
    );
  }
}

class DeepCleaningSubmission {
  const DeepCleaningSubmission({
    required this.id,
    required this.business,
    required this.storeCode,
    required this.status,
    required this.createdAt,
    this.storeId,
    this.scheduleId,
    this.storeName,
    this.clientName,
    this.state,
    this.city,
    this.storeFormat,
    this.deepCleaningDate,
    this.performedByType,
    this.vendorName,
    this.submittedByUserId,
    this.submittedByEmployeeCode,
    this.remarks,
    this.finalOutcome,
    this.notDoneReason,
    this.submittedAt,
    this.updatedAt,
    this.uploads = const [],
    this.evidenceFormat,
    this.zoneId,
    this.zoneCode,
    this.zoneName,
  });

  final String id;
  final String business;
  final String storeCode;
  final String? storeId;
  final String? scheduleId;
  final String? storeName;
  final String? clientName;
  final String? state;
  final String? city;
  final String? storeFormat;
  final String? deepCleaningDate;
  final String? performedByType;
  final String? vendorName;
  final String? submittedByUserId;
  final String? submittedByEmployeeCode;
  final String? remarks;
  final String? finalOutcome;
  final String? notDoneReason;
  final String status;
  final DateTime? submittedAt;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final List<DeepCleaningUpload> uploads;
  final String? evidenceFormat;
  final String? zoneId;
  final String? zoneCode;
  final String? zoneName;

  bool get isSubmitted => status == 'submitted';
  bool get isEditable => status == 'draft' || status == 'uploading';

  factory DeepCleaningSubmission.fromJson(Map<String, dynamic> json) {
    return DeepCleaningSubmission(
      id: _text(json['id']),
      business: _text(json['business']),
      storeCode: _text(json['store_code']),
      storeId: _nullableText(json['retail_store_id'] ?? json['store_id']),
      scheduleId: _nullableText(
        json['schedule_id'] ??
            (json['metadata'] is Map ? json['metadata']['schedule_id'] : null),
      ),
      storeName: _nullableText(json['store_name']),
      clientName: _nullableText(json['client_name']),
      state: _nullableText(json['state']),
      city: _nullableText(json['city']),
      storeFormat: _nullableText(json['store_format']),
      deepCleaningDate: _nullableText(json['deep_cleaning_date']),
      performedByType: _nullableText(json['performed_by_type']),
      vendorName: _nullableText(json['vendor_name']),
      submittedByUserId: _nullableText(json['submitted_by_user_id']),
      submittedByEmployeeCode: _nullableText(
        json['submitted_by_employee_code'],
      ),
      remarks: _nullableText(json['remarks']),
      finalOutcome: _nullableText(json['final_outcome']),
      notDoneReason: _nullableText(json['not_done_reason']),
      status: _text(json['status']),
      submittedAt: _dateTime(json['submitted_at']),
      createdAt: _dateTime(json['created_at']) ?? DateTime.now(),
      updatedAt: _dateTime(json['updated_at']),
      uploads: (json['uploads'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (row) =>
                DeepCleaningUpload.fromJson(Map<String, dynamic>.from(row)),
          )
          .toList(),
      evidenceFormat: json['metadata'] is Map
          ? _nullableText((json['metadata'] as Map)['evidence_format'])
          : null,
      zoneId: json['metadata'] is Map
          ? _nullableText((json['metadata'] as Map)['zone_id'])
          : null,
      zoneCode: json['metadata'] is Map
          ? _nullableText((json['metadata'] as Map)['zone_code'])
          : null,
      zoneName: json['metadata'] is Map
          ? _nullableText((json['metadata'] as Map)['zone_name'])
          : null,
    );
  }
}

class DeepCleaningUpload {
  const DeepCleaningUpload({
    required this.id,
    required this.submissionId,
    required this.uploadType,
    required this.storageBucket,
    required this.storagePath,
    required this.mimeType,
    required this.fileSize,
    required this.sequenceNo,
    required this.uploadStatus,
    this.originalFilename,
    this.uploadedAt,
    this.pairId,
    this.pairOrder,
  });

  final String id;
  final String submissionId;
  final DeepCleaningUploadType uploadType;
  final String storageBucket;
  final String storagePath;
  final String? originalFilename;
  final String mimeType;
  final int fileSize;
  final int sequenceNo;
  final String uploadStatus;
  final DateTime? uploadedAt;
  final String? pairId;
  final int? pairOrder;

  bool get isUploaded => uploadStatus == 'uploaded';

  factory DeepCleaningUpload.fromJson(Map<String, dynamic> json) {
    return DeepCleaningUpload(
      id: _text(json['id']),
      submissionId: _text(json['submission_id']),
      uploadType: DeepCleaningUploadType.fromApi(_text(json['upload_type'])),
      storageBucket: _text(json['storage_bucket']),
      storagePath: _text(json['storage_path']),
      originalFilename: _nullableText(json['original_filename']),
      mimeType: _text(json['mime_type']),
      fileSize: _int(json['file_size']),
      sequenceNo: _int(json['sequence_no']),
      uploadStatus: _text(json['upload_status']),
      uploadedAt: _dateTime(json['uploaded_at']),
      pairId: json['metadata'] is Map
          ? _nullableText((json['metadata'] as Map)['pair_id'])
          : null,
      pairOrder:
          json['metadata'] is Map &&
              (json['metadata'] as Map)['pair_order'] != null
          ? _int((json['metadata'] as Map)['pair_order'])
          : null,
    );
  }
}

class DeepCleaningUploadIntent {
  const DeepCleaningUploadIntent({
    required this.uploadId,
    required this.storageBucket,
    required this.storagePath,
    required this.signedUrl,
    required this.uploadType,
    required this.mimeType,
    this.maxFileSize,
  });

  final String uploadId;
  final String storageBucket;
  final String storagePath;
  final String signedUrl;
  final DeepCleaningUploadType uploadType;
  final String mimeType;
  final int? maxFileSize;

  factory DeepCleaningUploadIntent.fromJson(Map<String, dynamic> json) {
    return DeepCleaningUploadIntent(
      uploadId: _text(json['upload_id']),
      storageBucket: _text(json['storage_bucket']),
      storagePath: _text(json['storage_path']),
      signedUrl: _text(json['signed_url']),
      uploadType: DeepCleaningUploadType.fromApi(_text(json['upload_type'])),
      mimeType: _text(json['mime_type']),
      maxFileSize: json['max_file_size'] == null
          ? null
          : _int(json['max_file_size']),
    );
  }
}

class DeepCleaningViewUrl {
  const DeepCleaningViewUrl({
    required this.uploadId,
    required this.signedUrl,
    required this.expiresIn,
    this.expiresAt,
  });

  final String uploadId;
  final String signedUrl;
  final int expiresIn;
  final DateTime? expiresAt;

  bool get isFresh {
    final expiry = expiresAt;
    if (expiry == null) return signedUrl.isNotEmpty;
    return DateTime.now().isBefore(
      expiry.subtract(const Duration(seconds: 30)),
    );
  }

  factory DeepCleaningViewUrl.fromJson(Map<String, dynamic> json) {
    return DeepCleaningViewUrl(
      uploadId: _text(json['upload_id']),
      signedUrl: _text(json['signed_url']),
      expiresIn: _int(json['expires_in']),
      expiresAt: _dateTime(json['expires_at']),
    );
  }
}

class DeepCleaningLocalUpload {
  DeepCleaningLocalUpload({
    required this.uploadType,
    required this.file,
    required this.mimeType,
    required this.fileSize,
    required this.originalFilename,
    this.status = DeepCleaningLocalUploadStatus.pending,
    this.uploadId,
    this.storagePath,
    this.remoteUpload,
    this.error,
    this.pairId,
    this.pairOrder,
    this.progress = 0,
    this.replacesUploadId,
  });

  final DeepCleaningUploadType uploadType;
  final File file;
  final String mimeType;
  final int fileSize;
  final String originalFilename;
  // Survives a lost upload-intent response and retries while this form is open.
  final String requestId = newDeepCleaningPairId();
  DeepCleaningLocalUploadStatus status;
  String? uploadId;
  String? storagePath;
  DeepCleaningUpload? remoteUpload;
  DeepCleaningUploadIntent? intent;
  String? error;
  final String? pairId;
  final int? pairOrder;
  double progress;
  String? replacesUploadId;

  bool get isActive => status == DeepCleaningLocalUploadStatus.uploading;
  bool get isUploaded => status == DeepCleaningLocalUploadStatus.uploaded;
}

String deepCleaningStatusLabel(String status) {
  switch (status.trim().toLowerCase()) {
    case 'submitted':
      return 'Submitted';
    case 'uploading':
      return 'Uploading';
    case 'draft':
    default:
      return 'Draft';
  }
}

String _text(Object? value) => '${value ?? ''}'.trim();

String? _nullableText(Object? value) {
  final clean = _text(value);
  return clean.isEmpty ? null : clean;
}

int _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(_text(value)) ?? 0;
}

DateTime? _dateTime(Object? value) {
  final clean = _text(value);
  if (clean.isEmpty) return null;
  return DateTime.tryParse(clean);
}
