import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/app_card.dart';
import '../../data/mock_data.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class RaiseTicketScreen extends StatefulWidget {
  const RaiseTicketScreen({super.key});

  @override
  State<RaiseTicketScreen> createState() => _RaiseTicketScreenState();
}

class _RaiseTicketScreenState extends State<RaiseTicketScreen> {
  final _formKey = GlobalKey<FormState>();
  final _description = TextEditingController();
  final _picker = ImagePicker();
  final _photos = <XFile>[];
  final _draft = ComplaintDraft();
  bool _submitting = false;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final blockValues = controller.blocks.isEmpty
        ? demoBlocks
        : controller.blocks.map((row) => '${row['block_name']}').toList();
    final selectedBlock = blockValues.contains(_draft.block)
        ? _draft.block
        : blockValues.first;
    final matchingBlocks = controller.blocks
        .where((row) => row['block_name'] == selectedBlock)
        .toList();
    final blockId = matchingBlocks.isEmpty ? null : matchingBlocks.first['id'];
    final floorValues = controller.locations.isEmpty
        ? demoFloors
        : controller.locations
              .where((row) => blockId == null || row['block_id'] == blockId)
              .map((row) => '${row['floor_name']}')
              .toSet()
              .toList();
    final selectedFloor = floorValues.contains(_draft.floor)
        ? _draft.floor
        : floorValues.first;
    final locationValues = controller.locations.isEmpty
        ? demoLocations
        : controller.locations
              .where(
                (row) =>
                    (blockId == null || row['block_id'] == blockId) &&
                    row['floor_name'] == selectedFloor,
              )
              .map((row) => '${row['location_name']}')
              .toList();
    final selectedLocation = locationValues.contains(_draft.location)
        ? _draft.location
        : locationValues.first;
    _draft.block = selectedBlock;
    _draft.floor = selectedFloor;
    _draft.location = selectedLocation;
    final categoryValues = controller.categories.isEmpty
        ? housekeepingCategories
        : controller.categories
              .map((row) => '${row['category_name']}')
              .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Raise Complaint')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 6, 18, 28),
            children: [
              const _IntroCard(),
              const SizedBox(height: 16),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _SectionTitle('Complaint location'),
                    const SizedBox(height: 14),
                    _SelectField(
                      label: 'Block',
                      value: selectedBlock,
                      values: blockValues,
                      icon: Icons.apartment_rounded,
                      onChanged: (value) => setState(() {
                        _draft.block = value;
                        final selected = controller.blocks
                            .where((row) => row['block_name'] == value)
                            .toList();
                        final nextBlockId = selected.isEmpty
                            ? null
                            : selected.first['id'];
                        final available = controller.locations
                            .where((row) => row['block_id'] == nextBlockId)
                            .toList();
                        if (available.isNotEmpty) {
                          _draft.floor = '${available.first['floor_name']}';
                          _draft.location =
                              '${available.first['location_name']}';
                        }
                      }),
                    ),
                    const SizedBox(height: 12),
                    _SelectField(
                      label: 'Floor',
                      value: selectedFloor,
                      values: floorValues,
                      icon: Icons.layers_rounded,
                      onChanged: (value) => setState(() {
                        _draft.floor = value;
                        final locations = controller.locationsForBlockAndFloor(
                          _draft.block,
                          value,
                        );
                        _draft.location = locations.isEmpty
                            ? ''
                            : locations.first;
                      }),
                    ),
                    const SizedBox(height: 12),
                    _SelectField(
                      label: 'Department / Location',
                      value: selectedLocation,
                      values: locationValues,
                      icon: Icons.location_on_rounded,
                      onChanged: (value) =>
                          setState(() => _draft.location = value),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _SectionTitle('Complaint details'),
                    const SizedBox(height: 14),
                    _SelectField(
                      label: 'Category',
                      value: _draft.category,
                      values: categoryValues,
                      icon: Icons.cleaning_services_rounded,
                      onChanged: (value) =>
                          setState(() => _draft.category = value),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Priority',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 8),
                    SegmentedButton<TicketPriority>(
                      segments: TicketPriority.values
                          .map(
                            (priority) => ButtonSegment(
                              value: priority,
                              label: Text(priorityLabel(priority)),
                            ),
                          )
                          .toList(),
                      selected: {_draft.priority},
                      onSelectionChanged: (values) =>
                          setState(() => _draft.priority = values.first),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _description,
                      minLines: 4,
                      maxLines: 6,
                      maxLength: 300,
                      decoration: const InputDecoration(
                        labelText: 'Description *',
                        hintText:
                            'Example: Bathroom not cleaned properly near nurse station',
                        alignLabelWithHint: true,
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? 'Please describe the housekeeping complaint.'
                          : null,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Expanded(child: _SectionTitle('Photo (optional)')),
                        Text(
                          'Up to 3',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        for (final photo in _photos)
                          _PhotoThumb(
                            photo: photo,
                            onRemove: () =>
                                setState(() => _photos.remove(photo)),
                          ),
                        if (_photos.length < 3)
                          _AddPhotoButton(onTap: _choosePhoto),
                      ],
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Add a clear photo without including patient records or personal information.',
                      style: TextStyle(
                        fontSize: 11,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: _submitting
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_rounded),
                label: Text(
                  _submitting ? 'Submitting complaint…' : 'Submit Complaint',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _choosePhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.camera_alt_rounded),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      final image = await _picker.pickImage(
        source: source,
        imageQuality: 75,
        maxWidth: 1600,
      );
      if (image != null && mounted) setState(() => _photos.add(image));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Photo access is unavailable. You can submit without a photo.',
          ),
        ),
      );
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    await Future<void>.delayed(const Duration(milliseconds: 450));
    if (!mounted) return;
    _draft
      ..description = _description.text
      ..photoPaths = _photos.map((photo) => photo.path).toList();
    try {
      final ticket = await context.read<TicketController>().submitComplaint(
        _draft,
      );
      if (!mounted) return;
      Navigator.pushReplacementNamed(
        context,
        AppRoutes.ticketSubmitted,
        arguments: ticket.number,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }
}

class _IntroCard extends StatelessWidget {
  const _IntroCard();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.paleBlue,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFFBFDBFE)),
    ),
    child: const Row(
      children: [
        CircleAvatar(
          backgroundColor: Colors.white,
          child: Icon(
            Icons.cleaning_services_rounded,
            color: AppColors.royalBlue,
          ),
        ),
        SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Housekeeping support',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.deepBlue,
                ),
              ),
              SizedBox(height: 3),
              Text(
                'Share the exact location so our team can respond quickly.',
                style: TextStyle(
                  fontSize: 12,
                  height: 1.35,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w900,
      color: AppColors.deepBlue,
    ),
  );
}

class _SelectField extends StatelessWidget {
  const _SelectField({
    required this.label,
    required this.value,
    required this.values,
    required this.icon,
    required this.onChanged,
  });
  final String label;
  final String value;
  final List<String> values;
  final IconData icon;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
    initialValue: values.contains(value) ? value : values.first,
    decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
    items: values
        .map((item) => DropdownMenuItem(value: item, child: Text(item)))
        .toList(),
    onChanged: (next) {
      if (next != null) onChanged(next);
    },
  );
}

class _AddPhotoButton extends StatelessWidget {
  const _AddPhotoButton({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(14),
    child: Container(
      width: 86,
      height: 86,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(14),
        color: AppColors.paleBlue,
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.add_a_photo_rounded, color: AppColors.royalBlue),
          SizedBox(height: 5),
          Text(
            'Add photo',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: AppColors.deepBlue,
            ),
          ),
        ],
      ),
    ),
  );
}

class _PhotoThumb extends StatelessWidget {
  const _PhotoThumb({required this.photo, required this.onRemove});
  final XFile photo;
  final VoidCallback onRemove;
  @override
  Widget build(BuildContext context) => Stack(
    clipBehavior: Clip.none,
    children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Image.file(
          File(photo.path),
          width: 86,
          height: 86,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => Container(
            width: 86,
            height: 86,
            color: AppColors.paleBlue,
            child: const Icon(Icons.broken_image_outlined),
          ),
        ),
      ),
      Positioned(
        right: -6,
        top: -6,
        child: IconButton.filled(
          onPressed: onRemove,
          icon: const Icon(Icons.close, size: 14),
          style: IconButton.styleFrom(
            backgroundColor: AppColors.red,
            minimumSize: const Size(26, 26),
            padding: EdgeInsets.zero,
          ),
        ),
      ),
    ],
  );
}
