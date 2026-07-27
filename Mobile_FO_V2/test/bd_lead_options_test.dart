import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/bd/bd_lead_options.dart';

void main() {
  test('BD lead industry options are approved and deliberately unselected', () {
    expect(bdIndustryOptions, const [
      'Manufacturing',
      'Educational',
      'Retail',
      'Commercial',
      'Electronics',
      'Hospital',
    ]);
    expect(validateBdIndustry(null), 'Please select an Industry');
    expect(validateBdIndustry(''), 'Please select an Industry');
    expect(validateBdIndustry('Retail'), isNull);
  });

  test('BD lead service options and submitted order are canonical', () {
    expect(bdServiceScopeOptions, const [
      'Soft Services',
      'Hard Services',
      'Security Services',
      'Pest Control Services',
      'Landscaping Services',
      'Waste Management',
      'Other Services',
    ]);
    expect(
      orderedBdServiceScope({
        'Other Services',
        'Hard Services',
        'Soft Services',
      }),
      const ['Soft Services', 'Hard Services', 'Other Services'],
    );
    expect(orderedBdServiceScope({}), isEmpty);
  });
}
