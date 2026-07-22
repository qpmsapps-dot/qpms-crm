import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/utils/friendly_errors.dart';
import '../../core/widgets/app_card.dart';
import '../../data/mock_data.dart';
import '../../models/hospital_location_models.dart';
import '../../models/ticket.dart';
import '../../state/auth_controller.dart';
import '../../state/ticket_controller.dart';

class RaiseTicketScreen extends StatefulWidget {
  const RaiseTicketScreen({super.key});

  @override
  State<RaiseTicketScreen> createState() => _RaiseTicketScreenState();
}

enum _ComplaintStep {
  block,
  floor,
  departmentLocation,
  location,
  landmark,
  category,
  priority,
  details,
  review,
}

class _RaiseTicketScreenState extends State<RaiseTicketScreen> {
  final _description = TextEditingController();
  final _landmark = TextEditingController();
  final _picker = ImagePicker();
  final _photos = <XFile>[];
  final _draft = ComplaintDraft();

  int _step = 0;
  bool _submitting = false;
  bool _loadingBlocks = false;
  bool _loadingFloors = false;
  bool _loadingDepartments = false;
  bool _loadingLocations = false;
  String? _hierarchyError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadBlocks());
  }

  @override
  void dispose() {
    _description.dispose();
    _landmark.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final profile = context.watch<AuthController>().profile;
    final steps = _stepsFor(controller);
    final stepIndex = _step >= steps.length ? steps.length - 1 : _step;
    final currentStep = steps[stepIndex];
    _draft.site = _profileText(profile, const [
      'client_name',
      'hospital_client_name',
      'site_name',
    ], fallback: 'Client Site');
    final categories = controller.categories.isEmpty && controller.demoMode
        ? housekeepingCategories
        : controller.categories
              .map((row) => '${row['category_name'] ?? ''}'.trim())
              .where((value) => value.isNotEmpty)
              .toList();

    return PopScope(
      canPop: !_hasDraftData(),
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !_hasDraftData()) return;
        if (await _confirmDiscard()) {
          if (context.mounted) Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Raise Complaint')),
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 10),
                child: _StepProgress(step: stepIndex, totalSteps: steps.length),
              ),
              if (_hierarchyError != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 10),
                  child: _InlineMessage(
                    message: friendlyErrorMessage(
                      _hierarchyError,
                      fallback:
                          'Unable to load locations. Tap Retry to try again.',
                    ),
                    onRetry: _draft.blockId.isEmpty
                        ? _loadBlocks
                        : () => _selectBlock(_draft.blockId),
                  ),
                ),
              Expanded(
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                  children: [
                    _IntroCard(stepTitle: _titleForStep(currentStep)),
                    const SizedBox(height: 14),
                    _buildStep(controller, categories, currentStep),
                  ],
                ),
              ),
              _WizardActions(
                canGoBack: stepIndex > 0 && !_submitting,
                canGoNext: _canProceed(controller, currentStep),
                isLastStep: stepIndex == steps.length - 1,
                submitting: _submitting,
                onBack: () => setState(() => _step = stepIndex - 1),
                onNext: () => _nextOrSubmit(steps, stepIndex),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStep(
    TicketController controller,
    List<String> categories,
    _ComplaintStep step,
  ) {
    final floors = controller.hospitalFloors;
    final departments = controller.departmentsFor(
      blockId: _draft.blockId,
      floorId: _draft.floorId,
    );
    final locations = controller.locationsFor(
      blockId: _draft.blockId,
      floorId: _draft.floorId,
      departmentId: _draft.departmentId,
    );
    final directLocations = controller.locationsFor(
      blockId: _draft.blockId,
      floorId: _draft.floorId,
    );
    return switch (step) {
      _ComplaintStep.block => _StepCard(
        title: 'Select Block',
        child: _SearchSelectField(
          label: 'Block *',
          icon: Icons.apartment_rounded,
          value: _draft.blockId,
          loading: _loadingBlocks,
          emptyText: 'No authorised blocks available.',
          options: [
            for (final block in controller.hospitalBlocks)
              _PickerOption(block.id, block.name),
          ],
          onChanged: _selectBlock,
        ),
      ),
      _ComplaintStep.floor => _StepCard(
        title: 'Select Floor',
        child: _SearchSelectField(
          label: 'Floor',
          icon: Icons.layers_rounded,
          value: _draft.floorId,
          loading: _loadingFloors,
          emptyText: floors.isEmpty
              ? 'No confirmed floors are available for this block.'
              : 'Select a floor.',
          options: [
            for (final floor in floors) _PickerOption(floor.id, floor.name),
            if (_hasUnconfirmedDepartments(controller))
              const _PickerOption('', 'Floor not confirmed / Not specified'),
          ],
          onChanged: _selectFloor,
        ),
      ),
      _ComplaintStep.departmentLocation => _StepCard(
        title: 'Select Department / Location',
        child: Column(
          children: [
            _SearchSelectField(
              label: 'Department / Unit *',
              icon: Icons.local_hospital_rounded,
              value: _draft.departmentId,
              loading: _loadingDepartments,
              emptyText: 'No departments found for this selection.',
              options: [
                for (final department in departments)
                  _PickerOption(
                    department.id,
                    department.hasConfirmedFloor
                        ? department.name
                        : '${department.name} (floor not confirmed)',
                  ),
              ],
              onChanged: _selectDepartment,
            ),
            const SizedBox(height: 14),
            _SearchSelectField(
              label: 'Room / Area',
              icon: Icons.meeting_room_rounded,
              value: _draft.locationId,
              loading: _loadingLocations,
              enabled: _draft.departmentId.isNotEmpty,
              emptyText: _draft.departmentId.isEmpty
                  ? 'Select a department first.'
                  : 'No room or area is mapped yet.',
              options: [
                for (final location in locations)
                  _PickerOption(location.id, location.displayName),
              ],
              onChanged: _selectLocation,
            ),
          ],
        ),
      ),
      _ComplaintStep.location => _StepCard(
        title: 'Select Location',
        child: _SearchSelectField(
          label: 'Location *',
          icon: Icons.meeting_room_rounded,
          value: _draft.locationId,
          loading: _loadingLocations,
          enabled: _draft.blockId.isNotEmpty,
          emptyText: 'No locations are available for this block.',
          options: [
            for (final location in directLocations)
              _PickerOption(location.id, location.displayName),
          ],
          onChanged: _selectLocation,
        ),
      ),
      _ComplaintStep.landmark => _StepCard(
        title: 'Exact Landmark',
        child: TextFormField(
          controller: _landmark,
          maxLength: 180,
          minLines: 3,
          maxLines: 4,
          enabled: !_submitting,
          decoration: const InputDecoration(
            labelText: 'Exact Location / Landmark',
            prefixIcon: Icon(Icons.place_rounded),
            helperText:
                'Near Lift No. 2, Opposite Nursing Station, Corridor outside CTICU',
            alignLabelWithHint: true,
          ),
          onChanged: (value) {
            setState(() => _draft.exactLandmark = value.trim());
          },
        ),
      ),
      _ComplaintStep.category => _StepCard(
        title: 'Complaint Category',
        child: _SearchSelectField(
          label: 'Category *',
          icon: Icons.cleaning_services_rounded,
          value: _draft.category,
          emptyText: 'No complaint categories available.',
          options: [
            for (final category in categories)
              _PickerOption(category, category),
          ],
          onChanged: (value) => setState(() => _draft.category = value),
        ),
      ),
      _ComplaintStep.priority => _StepCard(
        title: 'Priority',
        child: SegmentedButton<TicketPriority>(
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
          onSelectionChanged: _submitting
              ? null
              : (values) => setState(() => _draft.priority = values.first),
        ),
      ),
      _ComplaintStep.details => _StepCard(
        title: 'Add Details and Photos',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextFormField(
              controller: _description,
              minLines: 5,
              maxLines: 7,
              maxLength: 300,
              enabled: !_submitting,
              decoration: const InputDecoration(
                labelText: 'Description *',
                hintText: 'Describe what needs attention',
                alignLabelWithHint: true,
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 14),
            const Text(
              'Photos (optional)',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                color: AppColors.deepBlue,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final photo in _photos)
                  _PhotoThumb(
                    photo: photo,
                    onRemove: _submitting
                        ? () {}
                        : () => setState(() => _photos.remove(photo)),
                  ),
                if (_photos.length < 3 && !_submitting)
                  _AddPhotoButton(onTap: _choosePhoto),
              ],
            ),
          ],
        ),
      ),
      _ComplaintStep.review => _ReviewStep(
        summary: controller.buildLocationSummary(_draft),
        block: _draft.block,
        floor: _draft.floor,
        department: _draft.department,
        location: _draft.location,
        landmark: _draft.exactLandmark,
        category: _draft.category,
        priority: priorityLabel(_draft.priority),
        description: _description.text.trim(),
        photoCount: _photos.length,
      ),
    };
  }

  bool _canProceed(TicketController controller, _ComplaintStep step) {
    if (_submitting) return false;
    return switch (step) {
      _ComplaintStep.block => _draft.blockId.isNotEmpty,
      _ComplaintStep.floor =>
        _draft.floorId.isNotEmpty || _hasUnconfirmedDepartments(controller),
      _ComplaintStep.departmentLocation => _draft.departmentId.isNotEmpty,
      _ComplaintStep.location => _draft.locationId.isNotEmpty,
      _ComplaintStep.landmark =>
        _draft.locationId.isNotEmpty || _landmark.text.trim().isNotEmpty,
      _ComplaintStep.category => _draft.category.trim().isNotEmpty,
      _ComplaintStep.priority => true,
      _ComplaintStep.details => _description.text.trim().isNotEmpty,
      _ComplaintStep.review => true,
    };
  }

  Future<void> _nextOrSubmit(List<_ComplaintStep> steps, int stepIndex) async {
    if (stepIndex < steps.length - 1) {
      setState(() => _step = stepIndex + 1);
      return;
    }
    await _submit();
  }

  Future<void> _loadBlocks() async {
    setState(() {
      _loadingBlocks = true;
      _hierarchyError = null;
    });
    try {
      final controller = context.read<TicketController>();
      await controller.loadBlocks();
      if (controller.categories.isEmpty) {
        await controller.loadCategories();
      }
      if (!mounted) return;
      final blocks = controller.hospitalBlocks;
      if (blocks.isNotEmpty && _draft.blockId.isEmpty) {
        await _selectBlock(blocks.first.id);
      }
    } catch (error) {
      if (mounted) setState(() => _hierarchyError = error.toString());
    } finally {
      if (mounted) setState(() => _loadingBlocks = false);
    }
  }

  Future<void> _selectBlock(String blockId) async {
    final controller = context.read<TicketController>();
    final block = controller.hospitalBlocks.firstWhere(
      (row) => row.id == blockId,
      orElse: () => HospitalBlock(id: blockId, name: ''),
    );
    setState(() {
      _draft
        ..blockId = blockId
        ..block = block.name
        ..floorId = ''
        ..floor = ''
        ..departmentId = ''
        ..department = ''
        ..locationId = ''
        ..location = '';
      _loadingFloors = true;
      _loadingDepartments = true;
      _hierarchyError = null;
    });
    try {
      await controller.loadFloorsForBlock(blockId);
      await controller.loadDepartmentsForBlock(blockId);
      final hasFloors = controller.hospitalFloors.any(
        (row) => row.blockId == blockId,
      );
      final hasDepartments = controller.hospitalDepartments.any(
        (row) => row.blockId == blockId,
      );
      if (!hasFloors && !hasDepartments) {
        if (mounted) setState(() => _loadingLocations = true);
        await controller.loadLocationsForSelection(blockId);
      }
    } catch (error) {
      if (mounted) setState(() => _hierarchyError = error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _loadingFloors = false;
          _loadingDepartments = false;
          _loadingLocations = false;
        });
      }
    }
  }

  Future<void> _selectFloor(String floorId) async {
    final floor = context.read<TicketController>().hospitalFloors.firstWhere(
      (row) => row.id == floorId,
      orElse: () =>
          HospitalFloor(id: floorId, blockId: _draft.blockId, name: ''),
    );
    setState(() {
      _draft
        ..floorId = floorId
        ..floor = floorId.isEmpty ? 'Floor not confirmed' : floor.name
        ..departmentId = ''
        ..department = ''
        ..locationId = ''
        ..location = '';
    });
    final controller = context.read<TicketController>();
    setState(() {
      _loadingDepartments = true;
      _loadingLocations = false;
      _hierarchyError = null;
    });
    try {
      await controller.loadDepartmentsForBlock(
        _draft.blockId,
        floorId: floorId,
      );
      final hasDepartments = controller
          .departmentsFor(blockId: _draft.blockId, floorId: floorId)
          .isNotEmpty;
      if (!hasDepartments) {
        if (mounted) setState(() => _loadingLocations = true);
        await controller.loadLocationsForSelection(
          _draft.blockId,
          floorId: floorId,
        );
      }
    } catch (error) {
      if (mounted) setState(() => _hierarchyError = error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _loadingDepartments = false;
          _loadingLocations = false;
        });
      }
    }
  }

  Future<void> _selectDepartment(String departmentId) async {
    final controller = context.read<TicketController>();
    final department = controller.hospitalDepartments.firstWhere(
      (row) => row.id == departmentId,
      orElse: () => HospitalDepartment(
        id: departmentId,
        blockId: _draft.blockId,
        name: '',
      ),
    );
    setState(() {
      _draft
        ..departmentId = departmentId
        ..department = department.name
        ..locationId = ''
        ..location = '';
      if (department.floorId.isEmpty) {
        _draft
          ..floorId = ''
          ..floor = 'Floor not confirmed';
      }
      _loadingLocations = true;
      _hierarchyError = null;
    });
    try {
      await controller.loadLocationsForSelection(
        _draft.blockId,
        floorId: department.floorId,
        departmentId: departmentId,
      );
    } catch (error) {
      if (mounted) setState(() => _hierarchyError = error.toString());
    } finally {
      if (mounted) setState(() => _loadingLocations = false);
    }
  }

  void _selectLocation(String locationId) {
    final location = context
        .read<TicketController>()
        .hospitalLocations
        .firstWhere(
          (row) => row.id == locationId,
          orElse: () => HospitalLocation(
            id: locationId,
            blockId: _draft.blockId,
            name: '',
          ),
        );
    setState(() {
      _draft
        ..locationId = locationId
        ..location = location.displayName;
    });
  }

  bool _hasUnconfirmedDepartments(TicketController controller) => controller
      .hospitalDepartments
      .any((row) => row.blockId == _draft.blockId && row.floorId.isEmpty);

  List<_ComplaintStep> _stepsFor(TicketController controller) {
    final steps = <_ComplaintStep>[_ComplaintStep.block];
    if (_draft.blockId.isEmpty) return steps;

    final hasFloors = controller.hospitalFloors.any(
      (row) => row.blockId == _draft.blockId,
    );
    final hasDepartments = controller
        .departmentsFor(blockId: _draft.blockId, floorId: _draft.floorId)
        .isNotEmpty;

    if (hasFloors) steps.add(_ComplaintStep.floor);
    if (hasDepartments) {
      steps.add(_ComplaintStep.departmentLocation);
    } else {
      steps.add(_ComplaintStep.location);
    }
    steps.addAll(const [
      _ComplaintStep.landmark,
      _ComplaintStep.category,
      _ComplaintStep.priority,
      _ComplaintStep.details,
      _ComplaintStep.review,
    ]);
    return steps;
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
        const SnackBar(content: Text('Unable to access the selected photo.')),
      );
    }
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    _draft
      ..description = _description.text.trim()
      ..exactLandmark = _landmark.text.trim()
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            friendlyErrorMessage(
              error,
              fallback: 'Unable to submit the complaint. Please try again.',
            ),
          ),
        ),
      );
    }
  }

  bool _hasDraftData() =>
      _draft.blockId.isNotEmpty ||
      _draft.departmentId.isNotEmpty ||
      _landmark.text.trim().isNotEmpty ||
      _description.text.trim().isNotEmpty ||
      _photos.isNotEmpty;

  Future<bool> _confirmDiscard() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard complaint?'),
        content: const Text('Your current complaint details will be lost.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep Editing'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return ok == true;
  }

  String _titleForStep(_ComplaintStep step) => switch (step) {
    _ComplaintStep.block => 'Select the block for this complaint.',
    _ComplaintStep.floor =>
      'Choose a floor or continue with an unconfirmed floor.',
    _ComplaintStep.departmentLocation =>
      'Pick the department and room or area.',
    _ComplaintStep.location => 'Pick the room, area, or location.',
    _ComplaintStep.landmark => 'Add a precise landmark.',
    _ComplaintStep.category => 'Choose the complaint category.',
    _ComplaintStep.priority => 'Set the urgency.',
    _ComplaintStep.details => 'Describe the issue and add photos.',
    _ComplaintStep.review => 'Review all details before submitting.',
  };
}

class _StepProgress extends StatelessWidget {
  const _StepProgress({required this.step, required this.totalSteps});
  final int step;
  final int totalSteps;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Text(
            'Step ${step + 1} of $totalSteps',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              color: AppColors.royalBlue,
            ),
          ),
          const Spacer(),
          Text(
            '${(((step + 1) / totalSteps) * 100).round()}%',
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.muted,
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
      ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: LinearProgressIndicator(
          value: (step + 1) / totalSteps,
          minHeight: 8,
          backgroundColor: AppColors.line,
          color: AppColors.royalBlue,
        ),
      ),
    ],
  );
}

class _IntroCard extends StatelessWidget {
  const _IntroCard({required this.stepTitle});
  final String stepTitle;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.paleBlue,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFFBFDBFE)),
    ),
    child: Row(
      children: [
        const CircleAvatar(
          backgroundColor: Colors.white,
          child: Icon(Icons.add_task_rounded, color: AppColors.royalBlue),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            stepTitle,
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
              height: 1.35,
            ),
          ),
        ),
      ],
    ),
  );
}

class _StepCard extends StatelessWidget {
  const _StepCard({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 16),
        child,
      ],
    ),
  );
}

class _ReviewStep extends StatelessWidget {
  const _ReviewStep({
    required this.summary,
    required this.block,
    required this.floor,
    required this.department,
    required this.location,
    required this.landmark,
    required this.category,
    required this.priority,
    required this.description,
    required this.photoCount,
  });

  final String summary;
  final String block;
  final String floor;
  final String department;
  final String location;
  final String landmark;
  final String category;
  final String priority;
  final String description;
  final int photoCount;

  @override
  Widget build(BuildContext context) => _StepCard(
    title: 'Review and Submit',
    child: Column(
      children: [
        _ReviewRow('Location', summary),
        _ReviewRow('Block', block),
        if (floor.isNotEmpty) _ReviewRow('Floor', floor),
        _ReviewRow('Department', department),
        if (location.isNotEmpty) _ReviewRow('Room / Area', location),
        if (landmark.isNotEmpty) _ReviewRow('Landmark', landmark),
        _ReviewRow('Category', category),
        _ReviewRow('Priority', priority),
        _ReviewRow('Description', description),
        _ReviewRow('Photos', '$photoCount selected'),
      ],
    ),
  );
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 105,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: AppColors.muted,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value.isEmpty ? 'Not specified' : value,
            style: const TextStyle(
              fontSize: 12,
              height: 1.35,
              fontWeight: FontWeight.w900,
              color: AppColors.ink,
            ),
          ),
        ),
      ],
    ),
  );
}

class _WizardActions extends StatelessWidget {
  const _WizardActions({
    required this.canGoBack,
    required this.canGoNext,
    required this.isLastStep,
    required this.submitting,
    required this.onBack,
    required this.onNext,
  });

  final bool canGoBack;
  final bool canGoNext;
  final bool isLastStep;
  final bool submitting;
  final VoidCallback onBack;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 14),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: canGoBack ? onBack : null,
              child: const Text('Back'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              onPressed: canGoNext ? onNext : null,
              icon: submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(
                      isLastStep ? Icons.check_rounded : Icons.arrow_forward,
                    ),
              label: Text(
                submitting
                    ? 'Submitting...'
                    : isLastStep
                    ? 'Submit Complaint'
                    : 'Next',
              ),
              style: isLastStep
                  ? ElevatedButton.styleFrom(backgroundColor: AppColors.green)
                  : null,
            ),
          ),
        ],
      ),
    ),
  );
}

class _PickerOption {
  const _PickerOption(this.value, this.label);
  final String value;
  final String label;
}

class _SearchSelectField extends StatelessWidget {
  const _SearchSelectField({
    required this.label,
    required this.value,
    required this.options,
    required this.icon,
    required this.onChanged,
    this.loading = false,
    this.enabled = true,
    this.emptyText = 'No options available.',
  });

  final String label;
  final String value;
  final List<_PickerOption> options;
  final IconData icon;
  final ValueChanged<String> onChanged;
  final bool loading;
  final bool enabled;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final selected = options.where((row) => row.value == value).toList();
    final display = selected.isEmpty ? '' : selected.first.label;
    return TextFormField(
      readOnly: true,
      enabled: enabled && !loading,
      controller: TextEditingController(text: display),
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        suffixIcon: loading
            ? const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            : const Icon(Icons.search_rounded),
        helperText: options.isEmpty && !loading ? emptyText : null,
      ),
      onTap: options.isEmpty || loading || !enabled
          ? null
          : () async {
              final next = await showModalBottomSheet<String>(
                context: context,
                isScrollControlled: true,
                builder: (_) => _PickerSheet(title: label, options: options),
              );
              if (next != null) onChanged(next);
            },
    );
  }
}

class _PickerSheet extends StatefulWidget {
  const _PickerSheet({required this.title, required this.options});
  final String title;
  final List<_PickerOption> options;

  @override
  State<_PickerSheet> createState() => _PickerSheetState();
}

class _PickerSheetState extends State<_PickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.options
        .where((row) => row.label.toLowerCase().contains(_query.toLowerCase()))
        .toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 18,
          right: 18,
          top: 14,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 14,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: Column(
            children: [
              TextField(
                autofocus: true,
                decoration: InputDecoration(
                  labelText: widget.title.replaceAll('*', '').trim(),
                  prefixIcon: const Icon(Icons.search_rounded),
                ),
                onChanged: (value) => setState(() => _query = value),
              ),
              const SizedBox(height: 10),
              Expanded(
                child: filtered.isEmpty
                    ? const Center(child: Text('No matching records.'))
                    : ListView.builder(
                        itemCount: filtered.length,
                        itemBuilder: (context, index) => ListTile(
                          title: Text(filtered[index].label),
                          onTap: () =>
                              Navigator.pop(context, filtered[index].value),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineMessage extends StatelessWidget {
  const _InlineMessage({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Material(
    color: const Color(0xFFFFF7ED),
    borderRadius: BorderRadius.circular(12),
    child: ListTile(
      leading: const Icon(Icons.warning_rounded, color: AppColors.orange),
      title: Text(message, style: const TextStyle(fontSize: 12)),
      trailing: TextButton(onPressed: onRetry, child: const Text('Retry')),
    ),
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

IconData _priorityIcon(TicketPriority priority) => switch (priority) {
  TicketPriority.low => Icons.keyboard_arrow_down_rounded,
  TicketPriority.medium => Icons.remove_rounded,
  TicketPriority.high => Icons.priority_high_rounded,
};

String _profileText(
  Map<String, dynamic>? profile,
  List<String> keys, {
  required String fallback,
}) {
  for (final key in keys) {
    final text = '${profile?[key] ?? ''}'.trim();
    if (text.isNotEmpty && text != 'null') return text;
  }
  return fallback;
}
