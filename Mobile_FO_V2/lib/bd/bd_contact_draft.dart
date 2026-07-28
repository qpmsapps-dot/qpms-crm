import 'package:flutter/widgets.dart';

import '../models/bd_lead_models.dart';

class BdLeadContactDraft {
  BdLeadContactDraft({
    String name = '',
    String designation = '',
    String phone = '',
    String email = '',
    this.isPrimary = false,
  }) : nameController = TextEditingController(text: name),
       designationController = TextEditingController(text: designation),
       phoneController = TextEditingController(text: phone),
       emailController = TextEditingController(text: email);

  final TextEditingController nameController;
  final TextEditingController designationController;
  final TextEditingController phoneController;
  final TextEditingController emailController;
  bool isPrimary;

  BdLeadContactRequest toRequest() => BdLeadContactRequest(
    name: nameController.text.trim(),
    designation: _nullableText(designationController.text),
    phone: _nullableText(phoneController.text),
    email: _nullableText(emailController.text)?.toLowerCase(),
    isPrimary: isPrimary,
  );

  void dispose() {
    nameController.dispose();
    designationController.dispose();
    phoneController.dispose();
    emailController.dispose();
  }
}

String? validateBdContactDrafts(List<BdLeadContactDraft> contacts) {
  if (contacts.isEmpty) return 'Add at least one contact person.';

  final phones = <String>{};
  final emails = <String>{};
  for (var index = 0; index < contacts.length; index += 1) {
    final contact = contacts[index];
    final number = index + 1;
    final name = contact.nameController.text.trim();
    final phone = contact.phoneController.text.trim();
    final email = contact.emailController.text.trim();

    if (name.isEmpty) {
      return 'Enter a contact name for Contact Person $number.';
    }
    if (phone.isEmpty && email.isEmpty) {
      return 'Enter a contact number or email for Contact Person $number.';
    }
    if (phone.isNotEmpty) {
      final digits = normalizeBdContactPhone(phone);
      if (!RegExp(r'^[+()\-\s0-9]+$').hasMatch(phone) ||
          digits.length < 7 ||
          digits.length > 15) {
        return 'Enter a valid contact number for Contact Person $number.';
      }
      if (!phones.add(digits)) {
        return 'The same contact number is already added for Contact Person $number.';
      }
    }
    if (email.isNotEmpty) {
      if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
        return 'Enter a valid email address for Contact Person $number.';
      }
      if (!emails.add(email.toLowerCase())) {
        return 'The same email address is already added for Contact Person $number.';
      }
    }
  }

  if (contacts.where((contact) => contact.isPrimary).length != 1) {
    return 'Select exactly one Primary contact.';
  }
  return null;
}

String normalizeBdContactPhone(String value) {
  final digits = value.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 12 && digits.startsWith('91')) {
    return digits.substring(2);
  }
  if (digits.length == 11 && digits.startsWith('0')) {
    return digits.substring(1);
  }
  return digits;
}

String? _nullableText(String value) {
  final text = value.trim();
  return text.isEmpty ? null : text;
}
