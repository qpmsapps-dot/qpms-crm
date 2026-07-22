import '../../services/hospital_ticket_api.dart';

String friendlyErrorMessage(Object? error, {required String fallback}) {
  if (error is HospitalApiException) {
    final code = error.code.toLowerCase();
    final message = error.message.toLowerCase();
    if (error.statusCode == 401 || code.contains('session')) {
      return 'Your session has expired. Please sign in again.';
    }
    if (code.contains('timeout') || message.contains('timed out')) {
      return 'The request took too long. Please try again.';
    }
    if (code.contains('network') ||
        message.contains('socket') ||
        message.contains('connection')) {
      return 'No internet connection. Please check your network and try again.';
    }
    if (message.contains('already submitted') ||
        message.contains('idempotent')) {
      return 'This complaint was already submitted.';
    }
    if (message.contains('location') ||
        message.contains('block') ||
        message.contains('department') ||
        message.contains('floor')) {
      return 'Unable to load locations. Tap Retry to try again.';
    }
    if (message.contains('photo') || message.contains('upload')) {
      return 'Photo upload failed. Please retry.';
    }
    return fallback;
  }
  final text = '$error'.toLowerCase();
  if (text.contains('timeout')) return 'The request took too long. Please try again.';
  if (text.contains('socket') || text.contains('network')) {
    return 'No internet connection. Please check your network and try again.';
  }
  return fallback;
}
