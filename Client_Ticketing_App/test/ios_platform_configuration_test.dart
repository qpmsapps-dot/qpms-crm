import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('native iOS runner has the required client app configuration', () {
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    final project = File(
      'ios/Runner.xcodeproj/project.pbxproj',
    ).readAsStringSync();
    final entitlements = File(
      'ios/Runner/Runner.entitlements',
    ).readAsStringSync();
    final scheme = File(
      'ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme',
    ).readAsStringSync();

    expect(plist, contains('<string>QPMS Client Ticketing</string>'));
    expect(plist, contains('<key>NSCameraUsageDescription</key>'));
    expect(plist, contains('<key>NSPhotoLibraryUsageDescription</key>'));
    expect(plist, contains('<string>qpms</string>'));
    expect(plist, contains('<string>remote-notification</string>'));
    expect(project, contains('IPHONEOS_DEPLOYMENT_TARGET = 15.0;'));
    expect(File('ios/Podfile').existsSync(), isFalse);
    expect(project, contains('FlutterGeneratedPluginSwiftPackage'));
    expect(scheme, contains('Run Prepare Flutter Framework Script'));
    expect(
      project,
      contains('PRODUCT_BUNDLE_IDENTIFIER = com.qpms.clientticketing;'),
    );
    expect(project, contains('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;'));
    expect(project, contains('com.apple.Push = {'));
    expect(entitlements, contains('<key>aps-environment</key>'));
  });

  test('Codemagic workflow builds only the unsigned iOS simulator app', () {
    final workflow = File('../codemagic.yaml').readAsStringSync();

    expect(workflow, contains('client-ticketing-ios-simulator:'));
    expect(workflow, contains('flutter build ios --simulator --debug'));
    expect(workflow, isNot(contains('cocoapods:')));
    expect(workflow, isNot(contains('flutter build apk')));
    expect(workflow, isNot(contains('flutter build ipa')));
    expect(workflow, isNot(contains('publishing:')));
  });
}
