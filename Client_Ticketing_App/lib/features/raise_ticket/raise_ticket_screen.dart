import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_assets.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_drawer.dart';
import '../../data/mock_data.dart';
import '../../models/ticket.dart';
import '../../state/notification_controller.dart';
import '../../state/ticket_controller.dart';

class RaiseTicketScreen extends StatefulWidget {
  const RaiseTicketScreen({super.key});

  @override
  State<RaiseTicketScreen> createState() => _RaiseTicketScreenState();
}

class _RaiseTicketScreenState extends State<RaiseTicketScreen> {
  final _draft = DraftTicket();
  final _title = TextEditingController(
    text: 'Lights Flickering in Main Corridor',
  );
  final _description = TextEditingController(
    text:
        'Lights in the main corridor are flickering continuously and require urgent inspection.',
  );
  final _search = TextEditingController();
  final _picker = ImagePicker();
  final _pickedImages = <XFile>[];
  int _step = 0;
  bool _submitting = false;
  String? _error;

  final _categories = const [
    ('Electrical', Icons.flash_on_rounded),
    ('Plumbing', Icons.plumbing_rounded),
    ('Housekeeping', Icons.cleaning_services_rounded),
    ('Training', Icons.co_present_rounded),
    ('Civil / Carpentry', Icons.handyman_rounded),
    ('IT / Network', Icons.desktop_windows_rounded),
    ('Security', Icons.security_rounded),
    ('HVAC', Icons.ac_unit_rounded),
    ('Other', Icons.more_horiz_rounded),
  ];

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: const QpmsDrawer(),
      appBar: AppBar(
        title: Text('Raise New Ticket - Step ${_step + 1}'),
        leading: _step == 0
            ? Builder(
                builder: (context) => IconButton(
                  icon: const Icon(Icons.menu_rounded),
                  onPressed: () => Scaffold.of(context).openDrawer(),
                ),
              )
            : IconButton(
                icon: const Icon(Icons.arrow_back_rounded),
                onPressed: _back,
              ),
      ),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned(
              right: -30,
              bottom: 8,
              child: Opacity(
                opacity: 0.1,
                child: SvgPicture.asset(AppAssets.workerCorner, width: 170),
              ),
            ),
            ListView(
              padding: const EdgeInsets.fromLTRB(18, 4, 18, 24),
              children: [
                _StepHeader(step: _step),
                const SizedBox(height: 18),
                if (_step == 0) _categoryStep(),
                if (_step == 1) _locationStep(),
                if (_step == 2) _reviewStep(),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _categoryStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Select Category',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 3,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            for (final item in _categories)
              _CategoryTile(
                label: item.$1,
                icon: item.$2,
                selected: _draft.category == item.$1,
                onTap: () => setState(() => _draft.category = item.$1),
              ),
          ],
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _title,
          decoration: const InputDecoration(
            labelText: 'Issue Title *',
            hintText: 'Enter a short title of the issue',
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _description,
          minLines: 4,
          maxLines: 5,
          maxLength: 250,
          decoration: const InputDecoration(
            labelText: 'Description *',
            hintText: 'Provide more details about the issue',
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (_error != null) _ErrorText(_error!),
        const SizedBox(height: 8),
        ElevatedButton(
          onPressed: _canGoStep1 ? _nextFromStep1 : null,
          child: const Text('Next'),
        ),
      ],
    );
  }

  Widget _locationStep() {
    final query = _search.text.trim().toLowerCase();
    final sites = demoSites
        .where((site) => site.name.toLowerCase().contains(query))
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Select Site / Location',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search_rounded),
            hintText: 'Search Site / Location',
          ),
        ),
        const SizedBox(height: 12),
        for (final site in sites)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              padding: EdgeInsets.zero,
              onTap: () => setState(() => _draft.site = site.name),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(
                      _draft.site == site.name
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_unchecked_rounded,
                      color: AppColors.royalBlue,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        site.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          color: AppColors.deepBlue,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        if (_error != null) _ErrorText(_error!),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _back,
                child: const Text('Back'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: _draft.site.isNotEmpty ? _nextFromStep2 : null,
                child: const Text('Next'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _reviewStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Review & Submit',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(
            children: [
              _ReviewRow('Category', _draft.category),
              _ReviewRow('Site / Location', _draft.site),
              _ReviewRow('Issue Title', _title.text),
              _ReviewRow('Description', _description.text),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Priority',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 8),
        SegmentedButton<TicketPriority>(
          segments: TicketPriority.values
              .map(
                (priority) => ButtonSegment(
                  value: priority,
                  label: Text(priorityLabel(priority)),
                  icon: Icon(_priorityIcon(priority)),
                ),
              )
              .toList(),
          selected: {_draft.priority},
          onSelectionChanged: (value) =>
              setState(() => _draft.priority = value.first),
        ),
        const SizedBox(height: 16),
        const Text(
          'Upload Photos',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final image in _pickedImages)
              _PickedThumb(
                image: image,
                onRemove: () => setState(() => _pickedImages.remove(image)),
              ),
            _MockThumb(AppAssets.photoPanel),
            _MockThumb(AppAssets.photoLight),
            _AddPhotoButton(onTap: _pickPhoto),
          ],
        ),
        if (_error != null) _ErrorText(_error!),
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _submitting ? null : _back,
                child: const Text('Back'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Submit Ticket'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  bool get _canGoStep1 =>
      _draft.category.isNotEmpty &&
      _title.text.trim().isNotEmpty &&
      _description.text.trim().isNotEmpty;

  void _nextFromStep1() {
    if (!_canGoStep1) {
      setState(() => _error = 'Please select category, title and description.');
      return;
    }
    _draft
      ..title = _title.text
      ..description = _description.text;
    setState(() {
      _error = null;
      _step = 1;
    });
  }

  void _nextFromStep2() {
    if (_draft.site.isEmpty) {
      setState(() => _error = 'Please select a site / location.');
      return;
    }
    setState(() {
      _error = null;
      _step = 2;
    });
  }

  void _back() {
    if (_step == 0) {
      Navigator.pop(context);
    } else {
      setState(() => _step -= 1);
    }
  }

  Future<void> _pickPhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Choose from Gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Use Camera'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      final photo = await _picker.pickImage(source: source, imageQuality: 75);
      if (photo != null) setState(() => _pickedImages.add(photo));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Photo permission unavailable. Demo photos remain available.',
          ),
        ),
      );
    }
  }

  Future<void> _submit() async {
    _draft
      ..title = _title.text
      ..description = _description.text
      ..photos = const [
        AppAssets.photoPanel,
        AppAssets.photoLight,
        AppAssets.photoWiring,
      ];
    if (!context.read<TicketController>().isDraftValid(_draft)) {
      setState(() => _error = 'Please complete all required ticket details.');
      return;
    }
    setState(() => _submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 650));
    if (!mounted) return;
    final ticket = context.read<TicketController>().submitDraft(_draft);
    context.read<NotificationController>().addTicketRaisedNotification(
      ticket.number,
    );
    setState(() => _submitting = false);
    _showSuccess(ticket.number);
  }

  IconData _priorityIcon(TicketPriority priority) {
    return switch (priority) {
      TicketPriority.low => Icons.check_circle_rounded,
      TicketPriority.medium => Icons.error_rounded,
      TicketPriority.high => Icons.priority_high_rounded,
    };
  }

  Future<void> _showSuccess(String ticketNumber) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Ticket Raised Successfully'),
        content: Text('Ticket Number: $ticketNumber'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              Navigator.pushReplacementNamed(
                context,
                AppRoutes.ticketDetails,
                arguments: ticketNumber,
              );
            },
            child: const Text('View Ticket'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              Navigator.pushNamedAndRemoveUntil(
                context,
                AppRoutes.dashboard,
                (_) => false,
              );
            },
            child: const Text('Back to Dashboard'),
          ),
        ],
      ),
    );
  }
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({required this.step});
  final int step;

  @override
  Widget build(BuildContext context) {
    final labels = ['Category', 'Location', 'Review'];
    return Row(
      children: [
        for (var i = 0; i < labels.length; i++) ...[
          Expanded(
            child: Row(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: step == i
                      ? AppColors.royalBlue
                      : AppColors.paleBlue,
                  child: Text(
                    '${i + 1}',
                    style: TextStyle(
                      color: step == i ? Colors.white : AppColors.royalBlue,
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 5),
                Flexible(
                  child: Text(
                    labels[i],
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      color: step == i ? AppColors.royalBlue : AppColors.muted,
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (i < labels.length - 1) const SizedBox(width: 6),
        ],
      ],
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icon,
            color: selected ? AppColors.royalBlue : AppColors.purple,
            size: 28,
          ),
          const SizedBox(height: 8),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 108,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MockThumb extends StatelessWidget {
  const _MockThumb(this.asset);
  final String asset;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SvgPicture.asset(asset, width: 70, height: 62, fit: BoxFit.cover),
    );
  }
}

class _PickedThumb extends StatelessWidget {
  const _PickedThumb({required this.image, required this.onRemove});
  final XFile image;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.file(
            File(image.path),
            width: 70,
            height: 62,
            fit: BoxFit.cover,
          ),
        ),
        Positioned(
          right: 2,
          top: 2,
          child: InkWell(
            onTap: onRemove,
            child: const CircleAvatar(
              radius: 10,
              backgroundColor: AppColors.red,
              child: Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

class _AddPhotoButton extends StatelessWidget {
  const _AddPhotoButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: 70,
        height: 62,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.line),
        ),
        child: const Icon(
          Icons.add_rounded,
          color: AppColors.royalBlue,
          size: 32,
        ),
      ),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(
        text,
        style: const TextStyle(
          color: AppColors.red,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
