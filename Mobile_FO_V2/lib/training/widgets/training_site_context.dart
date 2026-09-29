class TrainingSiteDisplayContext {
  const TrainingSiteDisplayContext({
    required this.siteName,
    this.state,
    this.business,
    this.checkedIn = false,
    this.checkInTime,
  });
  final String siteName;
  final String? state;
  final String? business;
  final bool checkedIn;
  final DateTime? checkInTime;
}
