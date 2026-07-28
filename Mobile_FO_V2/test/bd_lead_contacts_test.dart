import 'package:flutter_test/flutter_test.dart';
import 'package:myqpms_fo_v2/bd/bd_contact_draft.dart';
import 'package:myqpms_fo_v2/models/bd_lead_models.dart';

void main() {
  test('contact draft validates required fields and normalized duplicates', () {
    final first = BdLeadContactDraft(isPrimary: true);
    final second = BdLeadContactDraft();
    addTearDown(first.dispose);
    addTearDown(second.dispose);

    expect(
      validateBdContactDrafts([first]),
      'Enter a contact name for Contact Person 1.',
    );
    first.nameController.text = 'First';
    expect(
      validateBdContactDrafts([first]),
      'Enter a contact number or email for Contact Person 1.',
    );

    first.phoneController.text = '+91 90000 00001';
    second.nameController.text = 'Second';
    second.phoneController.text = '9000000001';
    expect(
      validateBdContactDrafts([first, second]),
      'The same contact number is already added for Contact Person 2.',
    );

    second.phoneController.clear();
    first.emailController.text = 'CONTACT@EXAMPLE.COM';
    second.emailController.text = ' contact@example.com ';
    expect(
      validateBdContactDrafts([first, second]),
      'The same email address is already added for Contact Person 2.',
    );
  });

  test('contact draft validates phone and email formats', () {
    final draft = BdLeadContactDraft(isPrimary: true)
      ..nameController.text = 'Primary'
      ..phoneController.text = '123'
      ..emailController.text = 'bad';
    addTearDown(draft.dispose);

    expect(
      validateBdContactDrafts([draft]),
      'Enter a valid contact number for Contact Person 1.',
    );
    draft.phoneController.clear();
    expect(
      validateBdContactDrafts([draft]),
      'Enter a valid email address for Contact Person 1.',
    );
  });

  test(
    'create request serializes canonical contacts array with one primary',
    () {
      final request = CreateBdLeadRequest(
        clientName: 'Example Client',
        industryType: 'Commercial',
        siteLocation: 'Example Site',
        state: 'Tamil Nadu',
        city: 'Chennai',
        contacts: const [
          BdLeadContactRequest(
            name: 'Primary',
            phone: '9000000001',
            isPrimary: true,
          ),
          BdLeadContactRequest(
            name: 'Secondary',
            email: 'secondary@example.com',
          ),
        ],
        leadSource: 'Referral',
        leadPriority: 'Medium',
        idempotencyKey: 'mobile-test',
      );

      final json = request.toJson();
      expect(json.containsKey('contact_person_name'), isFalse);
      expect(json['contacts'], [
        {
          'name': 'Primary',
          'designation': null,
          'phone': '9000000001',
          'email': null,
          'isPrimary': true,
        },
        {
          'name': 'Secondary',
          'designation': null,
          'phone': null,
          'email': 'secondary@example.com',
          'isPrimary': false,
        },
      ]);
    },
  );

  test(
    'create request serializes selected BD profile assignment only when set',
    () {
      const assigned = CreateBdLeadRequest(
        clientName: 'Client',
        siteLocation: 'Site',
        state: 'Tamil Nadu',
        city: 'Chennai',
        contacts: [
          BdLeadContactRequest(
            name: 'Primary',
            phone: '9000000001',
            isPrimary: true,
          ),
        ],
        leadSource: 'Referral',
        leadPriority: 'High',
        idempotencyKey: 'submission-1',
        assignedBdProfileId: 'profile-bd-1',
      );
      expect(assigned.toJson()['assigned_bd_profile_id'], 'profile-bd-1');

      const unassigned = CreateBdLeadRequest(
        clientName: 'Client',
        siteLocation: 'Site',
        state: 'Tamil Nadu',
        city: 'Chennai',
        contacts: [
          BdLeadContactRequest(
            name: 'Primary',
            phone: '9000000001',
            isPrimary: true,
          ),
        ],
        leadSource: 'Referral',
        leadPriority: 'High',
        idempotencyKey: 'submission-2',
      );
      expect(
        unassigned.toJson().containsKey('assigned_bd_profile_id'),
        isFalse,
      );
    },
  );

  test('lead parses all contacts and derives primary contact', () {
    final lead = BdLead.fromJson({
      'id': 'lead-1',
      'client_name': 'Example',
      'contacts': [
        {
          'contact_person_name': 'Secondary',
          'contact_number': '9000000002',
          'is_primary': false,
        },
        {
          'contact_person_name': 'Primary',
          'email_id': 'primary@example.com',
          'is_primary': true,
        },
      ],
    });

    expect(lead.contacts.length, 2);
    expect(lead.primaryContact?.name, 'Primary');
  });

  test('legacy primary and scalar contact responses remain readable', () {
    final primaryResponse = BdLead.fromJson({
      'id': 'lead-1',
      'client_name': 'Example',
      'primary_contact': {
        'contact_person_name': 'Primary',
        'contact_number': '9000000001',
      },
    });
    expect(primaryResponse.contacts.length, 1);
    expect(primaryResponse.primaryContact?.name, 'Primary');

    final scalarResponse = BdLead.fromJson({
      'id': 'lead-2',
      'client_name': 'Legacy',
      'contact_person_name': 'Legacy Contact',
      'email_id': 'legacy@example.com',
    });
    expect(scalarResponse.contacts.length, 1);
    expect(scalarResponse.primaryContact?.name, 'Legacy Contact');
  });
}
