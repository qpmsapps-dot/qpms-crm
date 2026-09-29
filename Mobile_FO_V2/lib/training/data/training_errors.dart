class TrainingException implements Exception {
  const TrainingException(
    this.message, {
    this.code,
    this.statusCode,
    this.retryable = false,
  });
  final String message;
  final String? code;
  final int? statusCode;
  final bool retryable;
  @override
  String toString() => message;
}

class TrainingValidationException extends TrainingException {
  const TrainingValidationException(
    super.message, {
    super.code,
    super.statusCode,
  });
}

class TrainingAuthException extends TrainingException {
  const TrainingAuthException(super.message, {super.code, super.statusCode});
}

class TrainingPermissionException extends TrainingException {
  const TrainingPermissionException(
    super.message, {
    super.code,
    super.statusCode,
  });
}

class TrainingNotFoundException extends TrainingException {
  const TrainingNotFoundException(
    super.message, {
    super.code,
    super.statusCode,
  });
}

class TrainingConflictException extends TrainingException {
  const TrainingConflictException(
    super.message, {
    super.code,
    super.statusCode,
  });
}

class TrainingUploadException extends TrainingException {
  const TrainingUploadException(
    super.message, {
    super.code,
    super.statusCode,
    super.retryable,
  });
}

class TrainingServerException extends TrainingException {
  const TrainingServerException(
    super.message, {
    super.code,
    super.statusCode,
    super.retryable = true,
  });
}

class TrainingTransportException extends TrainingException {
  const TrainingTransportException(super.message)
    : super(code: 'network_error', retryable: true);
}

TrainingException mapTrainingError(int status, Map<String, dynamic> body) {
  final code = '${body['code'] ?? body['error'] ?? 'training_error'}';
  final message = '${body['message'] ?? 'Training request failed.'}';
  return switch (status) {
    400 => TrainingValidationException(message, code: code, statusCode: status),
    401 => TrainingAuthException(message, code: code, statusCode: status),
    403 => TrainingPermissionException(message, code: code, statusCode: status),
    404 => TrainingNotFoundException(message, code: code, statusCode: status),
    409 => TrainingConflictException(message, code: code, statusCode: status),
    413 => TrainingUploadException(message, code: code, statusCode: status),
    415 => TrainingUploadException(message, code: code, statusCode: status),
    _ => TrainingServerException(
      message,
      code: code,
      statusCode: status,
      retryable: status >= 500,
    ),
  };
}
