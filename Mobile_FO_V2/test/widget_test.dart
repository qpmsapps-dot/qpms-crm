import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/app.dart';

void main() {
  testWidgets('shows clean configuration error without dart defines', (
    tester,
  ) async {
    await tester.pumpWidget(const MyQpmsFoApp());
    await tester.pumpAndSettle();

    expect(find.text('myQPMS'), findsOneWidget);
    expect(find.textContaining('SUPABASE_URL'), findsOneWidget);
  });
}
