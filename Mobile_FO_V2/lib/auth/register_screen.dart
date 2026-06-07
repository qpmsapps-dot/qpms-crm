import 'package:flutter/material.dart';

import '../models/fo_models.dart';
import '../services/crash_log_service.dart';
import '../services/supabase_service.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _employeeId = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _birth = TextEditingController();
  final _state = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  DateTime? _birthDate;
  String? _gender;
  bool _busy = false;
  bool _showPassword = false;
  bool _showConfirmPassword = false;
  String? _message;
  static const _genderOptions = [
    'Male',
    'Female',
    'Other',
    'Prefer not to say',
  ];

  @override
  void dispose() {
    for (final c in [
      _name,
      _employeeId,
      _mobile,
      _email,
      _birth,
      _state,
      _password,
      _confirm,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _register() async {
    if (!_form.currentState!.validate()) return;
    if (_birthDate == null) {
      setState(() => _message = 'Please select birth date.');
      return;
    }
    if (_gender == null) {
      setState(() => _message = 'Please select gender.');
      return;
    }
    if (_password.text != _confirm.text) {
      setState(() => _message = 'Passwords do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final user = await SupabaseService.register(
        fullName: _name.text,
        employeeId: _employeeId.text,
        mobile: _mobile.text,
        email: _email.text,
        birthDate: _isoDate(_birthDate!),
        gender: _gender!,
        state: _state.text,
        password: _password.text,
      );
      if (mounted) Navigator.of(context).pop<FoUser>(user);
    } on DuplicateEmployeeIdException catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'register',
        action: 'REGISTER_DUPLICATE_EMPLOYEE_ID',
        error: error,
        stackTrace: stackTrace,
      );
      if (mounted) {
        setState(
          () => _message =
              'Employee ID already registered. Please contact admin.',
        );
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'register',
        action: 'REGISTER_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      if (mounted) setState(() => _message = 'Registration failed.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            _field(_name, 'Full Name'),
            _field(
              _employeeId,
              'Employee ID',
              hint: 'Enter Employee ID',
              textCapitalization: TextCapitalization.characters,
            ),
            _field(_mobile, 'Mobile Number', keyboard: TextInputType.phone),
            _field(_email, 'Email', keyboard: TextInputType.emailAddress),
            _birthDateField(),
            _genderField(),
            _field(_state, 'State'),
            _field(
              _password,
              'Password',
              obscure: !_showPassword,
              suffixIcon: _passwordVisibilityButton(
                visible: _showPassword,
                onPressed: () => setState(() => _showPassword = !_showPassword),
              ),
            ),
            _field(
              _confirm,
              'Confirm Password',
              obscure: !_showConfirmPassword,
              suffixIcon: _passwordVisibilityButton(
                visible: _showConfirmPassword,
                onPressed: () => setState(
                  () => _showConfirmPassword = !_showConfirmPassword,
                ),
              ),
            ),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _message!,
                  style: const TextStyle(color: Colors.red),
                ),
              ),
            FilledButton(
              onPressed: _busy ? null : _register,
              child: Text(_busy ? 'Creating...' : 'Create Account'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool obscure = false,
    TextInputType? keyboard,
    String? hint,
    Widget? suffixIcon,
    TextCapitalization textCapitalization = TextCapitalization.none,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        obscureText: obscure,
        keyboardType: keyboard,
        textCapitalization: textCapitalization,
        validator: (value) =>
            value == null || value.trim().isEmpty ? 'Required' : null,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          suffixIcon: suffixIcon,
        ),
      ),
    );
  }

  Widget _passwordVisibilityButton({
    required bool visible,
    required VoidCallback onPressed,
  }) {
    return IconButton(
      tooltip: visible ? 'Hide password' : 'Show password',
      icon: Icon(
        visible ? Icons.visibility_off_outlined : Icons.visibility_outlined,
      ),
      onPressed: onPressed,
    );
  }

  Widget _birthDateField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _birth,
        readOnly: true,
        validator: (_) =>
            _birthDate == null ? 'Please select birth date.' : null,
        decoration: const InputDecoration(labelText: 'Birth Date'),
        onTap: _pickBirthDate,
      ),
    );
  }

  Widget _genderField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        initialValue: _gender,
        decoration: const InputDecoration(labelText: 'Gender'),
        items: _genderOptions
            .map((value) => DropdownMenuItem(value: value, child: Text(value)))
            .toList(),
        onChanged: (value) => setState(() => _gender = value),
        validator: (value) =>
            value == null || value.isEmpty ? 'Please select gender.' : null,
      ),
    );
  }

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      initialDate: _birthDate ?? DateTime(now.year - 18, now.month, now.day),
      firstDate: DateTime(1950),
      lastDate: now,
    );
    if (selected == null || !mounted) return;
    setState(() {
      _birthDate = selected;
      _birth.text = _displayDate(selected);
    });
  }

  String _displayDate(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.year.toString().padLeft(4, '0')}';

  String _isoDate(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';
}
