bool endDayKmResultIsPersisted(Map<String, dynamic> result, String id) {
  final uuid = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );
  final receipt = result['receipt_id']?.toString() ?? '';
  final run = result['calculation_run_id']?.toString() ?? '';
  final digest = result['input_digest']?.toString() ?? '';
  final status = result['route_sync_status'];
  return result['attendance_id'] == id &&
      result['status'] == 'persisted' &&
      result['updated'] == true &&
      result['dry_run'] == false &&
      result['financial_posted'] == true &&
      DateTime.tryParse(result['logout_time']?.toString() ?? '') != null &&
      RegExp(r'^[0-9a-f]{64}$').hasMatch(digest) &&
      ((status == 'canonical_v2_incremental_persisted' && uuid.hasMatch(receipt)) ||
          (status == 'canonical_v2_persisted' && uuid.hasMatch(run)));
}

bool endDayKmSnapshotMatches({
  required Map<String, dynamic> result,
  required String attendanceId,
  required DateTime? endTime,
  required double savedKm,
  required double? savedPetrol,
  required Map<String, dynamic> metadata,
}) {
  if (!endDayKmResultIsPersisted(result, attendanceId) || endTime == null) {
    return false;
  }
  final confirmedEnd = DateTime.parse(result['logout_time'].toString());
  final km = double.tryParse(result['total_approved_km']?.toString() ?? '');
  final petrol = double.tryParse(result['petrol_amount']?.toString() ?? '');
  if (!endTime.isAtSameMomentAs(confirmedEnd) ||
      km == null || !km.isFinite || km < 0 ||
      petrol == null || !petrol.isFinite || petrol < 0 ||
      !savedKm.isFinite || savedPetrol == null || !savedPetrol.isFinite ||
      (savedKm - km).abs() > 0.011 || (savedPetrol - petrol).abs() > 0.011 ||
      metadata['last_reopened_at'] != result['last_reopened_at']) {
    return false;
  }
  return result['route_sync_status'] == 'canonical_v2_incremental_persisted'
      ? metadata['shared_km_last_receipt'] == result['receipt_id']
      : metadata['km_calculation_run_id'] == result['calculation_run_id'];
}

Duration endDayKmRetryDelay(Map<String, dynamic>? result) {
  final seconds = int.tryParse(result?['retry_after_seconds']?.toString() ?? '') ?? 30;
  return Duration(seconds: seconds.clamp(15, 300));
}
