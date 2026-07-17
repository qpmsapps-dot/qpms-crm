import 'hospital_models.dart';

class HospitalDemoAuth {
  static const password = String.fromEnvironment('HOSPITAL_DEMO_PASSWORD');

  static const accounts = <String, HospitalDemoSession>{
    'sup.blocka@qpmsdemo.com': HospitalDemoSession(
      loginId: 'sup.blocka@qpmsdemo.com',
      displayName: 'Supervisor - Block A',
      role: HospitalDemoRole.supervisor,
      assignedBlock: 'Block A',
    ),
    'sup.blockb@qpmsdemo.com': HospitalDemoSession(
      loginId: 'sup.blockb@qpmsdemo.com',
      displayName: 'Supervisor - Block B',
      role: HospitalDemoRole.supervisor,
      assignedBlock: 'Block B',
    ),
    'ops.exec@qpmsdemo.com': HospitalDemoSession(
      loginId: 'ops.exec@qpmsdemo.com',
      displayName: 'Operations Executive',
      role: HospitalDemoRole.operationsExecutive,
    ),
    'facility.manager@qpmsdemo.com': HospitalDemoSession(
      loginId: 'facility.manager@qpmsdemo.com',
      displayName: 'Facility Manager',
      role: HospitalDemoRole.facilityManager,
    ),
  };

  static bool isDemoLoginId(String loginId) =>
      accounts.containsKey(loginId.trim().toLowerCase());

  static HospitalDemoSession? authenticate({
    required String loginId,
    required String candidatePassword,
    String? testPasswordOverride,
  }) {
    final account = accounts[loginId.trim().toLowerCase()];
    final configuredPassword = testPasswordOverride ?? password;
    if (configuredPassword.isEmpty ||
        account == null ||
        candidatePassword != configuredPassword) {
      return null;
    }
    return account;
  }
}
