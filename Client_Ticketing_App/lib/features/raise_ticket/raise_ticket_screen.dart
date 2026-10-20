import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/utils/friendly_errors.dart';
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

enum _ComplaintStep { locationPriority, evidenceReview }

class _RaiseTicketScreenState extends State<RaiseTicketScreen> {
  final _description = TextEditingController();
  final _landmark = TextEditingController();
  final _picker = ImagePicker();
  final _photos = <XFile>[];
  final _draft = ComplaintDraft();

  int _step = 0;
  final String _serviceCategory = 'Housekeeping';
  bool _submitting = false;
  bool _loadingHierarchy = false;
  String? _hierarchyError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadHierarchy());
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
    return PopScope(
      canPop: !_hasDraftData(),
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !_hasDraftData()) return;
        if (await _confirmDiscard()) {
          if (context.mounted) Navigator.pop(context);
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF6F8FC),
        body: Stack(
          children: [
            SafeArea(
              child: Column(
                children: [
                  const _RaiseTicketHeader(),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                    child: _StepProgress(
                      step: stepIndex,
                      totalSteps: steps.length,
                    ),
                  ),
                  if (_hierarchyError != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      child: _InlineMessage(
                        message: friendlyErrorMessage(
                          _hierarchyError,
                          fallback:
                              'Unable to load locations. Tap Retry to try again.',
                        ),
                        onRetry: _draft.blockId.isEmpty
                            ? _loadHierarchy
                            : () => _selectBlock(_draft.blockId),
                      ),
                    ),
                  Expanded(
                    child: ListView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 112),
                      children: [
                        _IntroCard(step: currentStep),
                        const SizedBox(height: 14),
                        _buildStep(controller, currentStep),
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
            if (_submitting) const _SubmittingOverlay(),
          ],
        ),
      ),
    );
  }

  Widget _buildStep(TicketController controller, _ComplaintStep step) {
    return switch (step) {
      _ComplaintStep.locationPriority => _LocationPriorityStep(
        draft: _draft,
        blocks: [
          for (final block in controller.hospitalBlocks)
            _PickerOption(block.id, block.name),
        ],
        floors: _floorOptions(controller),
        areas: _areaOptions(controller),
        loadingBlocks: _loadingHierarchy,
        loadingFloors: _loadingHierarchy,
        loadingAreas: _loadingHierarchy,
        landmarkController: _landmark,
        submitting: _submitting,
        onBlockChanged: _selectBlock,
        onFloorChanged: _selectFloor,
        onAreaChanged: _selectAreaOrWard,
        onPriorityChanged: (priority) => setState(() {
          _draft.priority = priority;
        }),
        onLandmarkChanged: (value) => setState(() {
          _draft.exactLandmark = value.trim();
        }),
      ),
      _ComplaintStep.evidenceReview => _EvidenceReviewStep(
        summary: controller.buildLocationSummary(_draft),
        draft: _draft,
        serviceCategory: _serviceCategory,
        descriptionController: _description,
        photos: _photos,
        submitting: _submitting,
        onDescriptionChanged: (_) => setState(() {}),
        onAddPhoto: _choosePhoto,
        onRemovePhoto: (photo) => setState(() => _photos.remove(photo)),
      ),
    };
  }

  List<String> _categoryNames(TicketController controller) {
    return controller.categories.isEmpty && controller.demoMode
        ? housekeepingCategories
        : controller.categories
              .map((row) => '${row['category_name'] ?? ''}'.trim())
              .where((value) => value.isNotEmpty)
              .toList();
  }

  List<_PickerOption> _floorOptions(TicketController controller) {
    final floors = controller.hospitalFloors
        .where((floor) => floor.blockId == _draft.blockId)
        .toList();
    return [for (final floor in floors) _PickerOption(floor.id, floor.name)];
  }

  List<_PickerOption> _areaOptions(TicketController controller) {
    final locations = controller.locationsFor(
      blockId: _draft.blockId,
      floorId: _draft.floorId,
      departmentId: _draft.departmentId,
    );
    final directLocations = controller.locationsFor(
      blockId: _draft.blockId,
      floorId: _draft.floorId,
    );
    final options = <_PickerOption>[
      for (final location in [...locations, ...directLocations])
        _PickerOption('loc:${location.id}', location.displayName),
    ];
    final seen = <String>{};
    return options.where((row) => seen.add(row.label.toLowerCase())).toList();
  }

  void _selectAreaOrWard(String value) {
    if (value.startsWith('loc:')) {
      _selectLocation(value.substring(4));
      return;
    }
    if (value.startsWith('dept:')) {
      _selectDepartment(value.substring(5));
    }
  }

  String? _categoryValueForService(List<String> categories, String service) {
    final lower = service.toLowerCase();
    final exact = categories
        .where((row) => row.toLowerCase() == lower)
        .toList();
    if (exact.isNotEmpty) return exact.first;
    final contains = categories
        .where((row) => row.toLowerCase().contains(lower))
        .toList();
    if (contains.isNotEmpty) return contains.first;
    return null;
  }

  bool _canProceed(TicketController controller, _ComplaintStep step) {
    if (_submitting) return false;
    return switch (step) {
      _ComplaintStep.locationPriority =>
        _draft.blockId.isNotEmpty &&
            _draft.floorId.isNotEmpty &&
            _draft.locationId.isNotEmpty,
      _ComplaintStep.evidenceReview => _description.text.trim().isNotEmpty,
    };
  }

  Future<void> _nextOrSubmit(List<_ComplaintStep> steps, int stepIndex) async {
    if (stepIndex < steps.length - 1) {
      setState(() => _step = stepIndex + 1);
      return;
    }
    await _submit();
  }

  Future<void> _loadHierarchy() async {
    setState(() {
      _loadingHierarchy = true;
      _hierarchyError = null;
    });
    try {
      final controller = context.read<TicketController>();
      await controller.loadCompleteHierarchy();
      if (!mounted) return;
      if (kDebugMode) {
        final profile = context.read<AuthController>().profile;
        debugPrint(
          '[RaiseTicketHierarchy] demoMode=${controller.demoMode} '
          'client_id=${profile?['client_id'] ?? ''} '
          'user_id=${profile?['id'] ?? ''} '
          'blocks=${controller.hospitalBlocks.map((row) => row.name).join(', ')} '
          'selected_before=${_draft.blockId}/${_draft.block}',
        );
      }
      if (_draft.blockId.isNotEmpty &&
          !controller.hospitalBlocks.any((row) => row.id == _draft.blockId)) {
        setState(() {
          _draft
            ..blockId = ''
            ..block = ''
            ..floorId = ''
            ..floor = ''
            ..departmentId = ''
            ..department = ''
            ..locationId = ''
            ..location = '';
        });
      }
      if (controller.categories.isEmpty) {
        await controller.loadCategories();
      }
      _draft.category =
          _categoryValueForService(
            _categoryNames(controller),
            'Housekeeping',
          ) ??
          '';
    } catch (error) {
      if (mounted) setState(() => _hierarchyError = error.toString());
    } finally {
      if (mounted) setState(() => _loadingHierarchy = false);
    }
  }

  void _selectBlock(String blockId) {
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
      _hierarchyError = null;
    });
  }

  void _selectFloor(String floorId) {
    final floor = context.read<TicketController>().hospitalFloors.firstWhere(
      (row) => row.id == floorId,
      orElse: () =>
          HospitalFloor(id: floorId, blockId: _draft.blockId, name: ''),
    );
    setState(() {
      _draft
        ..floorId = floorId
        ..floor = floor.name
        ..departmentId = ''
        ..department = ''
        ..locationId = ''
        ..location = '';
    });
  }

  void _selectDepartment(String departmentId) {
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
      _hierarchyError = null;
    });
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

  List<_ComplaintStep> _stepsFor(TicketController controller) {
    return const [
      _ComplaintStep.locationPriority,
      _ComplaintStep.evidenceReview,
    ];
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
    final landmarkText = _landmark.text.trim();
    _draft
      ..description = _description.text.trim()
      ..exactLandmark = landmarkText
      ..photoPaths = _photos.map((photo) => photo.path).toList();
    if (_draft.category.trim().isEmpty) {
      final controller = context.read<TicketController>();
      final mappedCategory = _categoryValueForService(
        _categoryNames(controller),
        _serviceCategory,
      );
      if (mappedCategory == null) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Housekeeping service is not currently configured. Please contact QPMS support.',
            ),
          ),
        );
        return;
      }
      _draft.category = mappedCategory;
    }
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
      if (error is TicketPhotoUploadPartialException) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error.failedCount == 1
                  ? 'Ticket raised successfully. 1 photo could not be uploaded.'
                  : 'Ticket raised successfully. ${error.failedCount} photos could not be uploaded.',
            ),
          ),
        );
        Navigator.pushReplacementNamed(
          context,
          AppRoutes.ticketSubmitted,
          arguments: error.ticket.number,
        );
        return;
      }
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            friendlyErrorMessage(
              error,
              fallback: 'Unable to submit the ticket. Please try again.',
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
        title: const Text('Discard ticket?'),
        content: const Text('Your current ticket details will be lost.'),
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
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.royalBlue,
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: LinearProgressIndicator(
          value: (step + 1) / totalSteps,
          minHeight: 5,
          backgroundColor: AppColors.line,
          color: AppColors.royalBlue,
        ),
      ),
    ],
  );
}

class _IntroCard extends StatelessWidget {
  const _IntroCard({required this.step});

  final _ComplaintStep step;

  @override
  Widget build(BuildContext context) {
    final data = switch (step) {
      _ComplaintStep.locationPriority => (
        Icons.location_on_rounded,
        'Choose the location and priority of the issue.',
        'Accurate details help us resolve it faster.',
      ),
      _ComplaintStep.evidenceReview => (
        Icons.info_outline_rounded,
        'Add details, photos and review before submitting.',
        '',
      ),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.paleBlue.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.royalBlue.withValues(alpha: 0.12)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(data.$1, color: AppColors.royalBlue, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  data.$2,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: AppColors.deepBlue,
                    height: 1.25,
                  ),
                ),
                if (data.$3.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    data.$3,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.35,
                      color: AppColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RaiseTicketHeader extends StatelessWidget {
  const _RaiseTicketHeader();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
    child: Row(
      children: [
        _HeaderButton(
          icon: Icons.arrow_back_rounded,
          onTap: () => Navigator.maybePop(context),
        ),
        const Expanded(
          child: Text(
            'Raise Ticket',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w900,
              color: AppColors.ink,
            ),
          ),
        ),
        _HeaderButton(icon: Icons.support_agent_rounded, onTap: () {}),
      ],
    ),
  );
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0F172A).withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Icon(icon, color: AppColors.deepBlue, size: 22),
    ),
  );
}

class _LocationPriorityStep extends StatelessWidget {
  const _LocationPriorityStep({
    required this.draft,
    required this.blocks,
    required this.floors,
    required this.areas,
    required this.loadingBlocks,
    required this.loadingFloors,
    required this.loadingAreas,
    required this.landmarkController,
    required this.submitting,
    required this.onBlockChanged,
    required this.onFloorChanged,
    required this.onAreaChanged,
    required this.onLandmarkChanged,
    required this.onPriorityChanged,
  });

  final ComplaintDraft draft;
  final List<_PickerOption> blocks;
  final List<_PickerOption> floors;
  final List<_PickerOption> areas;
  final bool loadingBlocks;
  final bool loadingFloors;
  final bool loadingAreas;
  final TextEditingController landmarkController;
  final bool submitting;
  final ValueChanged<String> onBlockChanged;
  final ValueChanged<String> onFloorChanged;
  final ValueChanged<String> onAreaChanged;
  final ValueChanged<String> onLandmarkChanged;
  final ValueChanged<TicketPriority> onPriorityChanged;

  String get _areaValue {
    if (draft.locationId.isNotEmpty) return 'loc:${draft.locationId}';
    if (draft.departmentId.isNotEmpty) return 'dept:${draft.departmentId}';
    return '';
  }

  @override
  Widget build(BuildContext context) => _ReferenceCard(
    icon: Icons.location_on_rounded,
    title: 'Location Details',
    subtitle: 'Provide the exact location of the issue',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SearchSelectField(
          label: 'Block',
          placeholder: 'Select a block',
          icon: Icons.apartment_rounded,
          value: draft.blockId,
          loading: loadingBlocks,
          loadingText: 'Loading blocks...',
          emptyText: 'No authorised blocks available.',
          options: blocks,
          onChanged: onBlockChanged,
        ),
        const SizedBox(height: 18),
        _SearchSelectField(
          label: 'Floor',
          placeholder: 'Select a floor',
          icon: Icons.stairs_rounded,
          value: draft.floorId,
          loading: loadingFloors,
          enabled: draft.blockId.isNotEmpty,
          disabledText: 'Select a block first',
          loadingText: 'Loading floors...',
          emptyText: 'Floor mapping is not available for this block.',
          options: floors,
          onChanged: onFloorChanged,
        ),
        const SizedBox(height: 18),
        _SearchSelectField(
          label: 'Area / Ward',
          placeholder: 'Select an area or ward',
          icon: Icons.bed_rounded,
          value: _areaValue,
          loading: loadingAreas,
          enabled: draft.blockId.isNotEmpty && draft.floorId.isNotEmpty,
          disabledText: draft.blockId.isEmpty
              ? 'Select a block first'
              : 'Select a floor first',
          loadingText: 'Loading areas...',
          emptyText: 'No areas or wards are mapped to this floor.',
          options: areas,
          onChanged: onAreaChanged,
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: landmarkController,
          maxLength: 180,
          enabled: !submitting,
          decoration: const InputDecoration(
            labelText: 'Exact landmark / location (optional)',
            hintText: 'e.g., Near Lift No. 2, Opposite Nursing Station',
            prefixIcon: Icon(Icons.place_outlined),
            counterText: '',
          ),
          onChanged: onLandmarkChanged,
        ),
        const SizedBox(height: 22),
        const Text(
          'Priority',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 5),
        const Text(
          'Select the urgency level of this issue',
          style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 14),
        _PrioritySelector(
          value: draft.priority,
          onChanged: submitting ? null : onPriorityChanged,
        ),
        const SizedBox(height: 18),
        const _InfoNotice(
          icon: Icons.lightbulb_outline_rounded,
          title: 'Tip',
          text: 'Choosing the right priority helps our team respond faster.',
        ),
      ],
    ),
  );
}

class _EvidenceReviewStep extends StatelessWidget {
  const _EvidenceReviewStep({
    required this.summary,
    required this.draft,
    required this.serviceCategory,
    required this.descriptionController,
    required this.photos,
    required this.submitting,
    required this.onDescriptionChanged,
    required this.onAddPhoto,
    required this.onRemovePhoto,
  });

  final String summary;
  final ComplaintDraft draft;
  final String serviceCategory;
  final TextEditingController descriptionController;
  final List<XFile> photos;
  final bool submitting;
  final ValueChanged<String> onDescriptionChanged;
  final VoidCallback onAddPhoto;
  final ValueChanged<XFile> onRemovePhoto;

  @override
  Widget build(BuildContext context) => _ReferenceCard(
    icon: Icons.article_rounded,
    title: 'Issue Details',
    subtitle: 'Tell us what needs attention',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SelectedCategoryNotice(category: serviceCategory),
        const SizedBox(height: 20),
        const Text(
          'Describe the issue',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.deepBlue,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Provide as much detail as possible',
          style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 14),
        TextFormField(
          controller: descriptionController,
          minLines: 5,
          maxLines: 7,
          maxLength: 1000,
          enabled: !submitting,
          decoration: const InputDecoration(
            hintText: 'Explain what happened and what support is needed...',
            alignLabelWithHint: true,
          ),
          onChanged: onDescriptionChanged,
        ),
        const _SectionDivider(),
        const _FormSectionHeader(
          icon: Icons.photo_camera_rounded,
          title: 'Photos',
          subtitle: 'Add clear photos related to the issue',
        ),
        const SizedBox(height: 14),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              if (photos.length < 5 && !submitting)
                Padding(
                  padding: EdgeInsets.only(right: photos.isEmpty ? 0 : 12),
                  child: _AddPhotoButton(onTap: onAddPhoto),
                ),
              for (var index = 0; index < photos.length; index++) ...[
                _PhotoThumb(
                  photo: photos[index],
                  onRemove: submitting
                      ? () {}
                      : () => onRemovePhoto(photos[index]),
                ),
                if (index != photos.length - 1) const SizedBox(width: 12),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        const _InfoNotice(
          text:
              'You can add up to 5 photos. Make sure images are clear and well-lit.',
        ),
        const _SectionDivider(),
        const _FormSectionHeader(
          icon: Icons.fact_check_rounded,
          title: 'Review Summary',
          subtitle: 'Review the details before submitting',
        ),
        const SizedBox(height: 14),
        _TicketSummaryStrip(
          block: draft.block,
          floor: draft.floor,
          location: draft.location.isNotEmpty
              ? draft.location
              : draft.department.isNotEmpty
              ? draft.department
              : draft.exactLandmark,
          locationLabel:
              draft.location.isNotEmpty || draft.department.isNotEmpty
              ? 'Area / Ward'
              : 'Exact Location',
          priority: priorityLabel(draft.priority),
          category: serviceCategory,
        ),
        const SizedBox(height: 12),
        _ReviewRow('Block', draft.block),
        _ReviewRow('Floor', draft.floor),
        if (draft.location.isNotEmpty || draft.department.isNotEmpty)
          _ReviewRow(
            'Area / Ward',
            draft.location.isNotEmpty ? draft.location : draft.department,
          ),
        if (draft.exactLandmark.isNotEmpty)
          _ReviewRow('Exact Location', draft.exactLandmark),
        _ReviewRow('Priority', priorityLabel(draft.priority)),
        _ReviewRow('Category', serviceCategory),
        _ReviewRow('Issue Description', descriptionController.text.trim()),
      ],
    ),
  );
}

class _ReferenceCard extends StatelessWidget {
  const _ReferenceCard({
    required this.icon,
    required this.title,
    required this.child,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: AppColors.line),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFF0F172A).withValues(alpha: 0.055),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppColors.paleBlue,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: AppColors.royalBlue, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: AppColors.deepBlue,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 5),
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        color: AppColors.muted,
                        height: 1.3,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        child,
      ],
    ),
  );
}

class _FormSectionHeader extends StatelessWidget {
  const _FormSectionHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: AppColors.paleBlue,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: AppColors.royalBlue, size: 20),
      ),
      const SizedBox(width: 11),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: AppColors.deepBlue,
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              subtitle,
              style: const TextStyle(
                color: AppColors.muted,
                height: 1.3,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 22),
    child: Divider(height: 1, color: AppColors.line),
  );
}

class _SelectedCategoryNotice extends StatelessWidget {
  const _SelectedCategoryNotice({required this.category});

  final String category;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.paleBlue,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.line),
    ),
    child: Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(11),
          ),
          child: const Icon(
            Icons.cleaning_services_rounded,
            color: AppColors.royalBlue,
            size: 20,
          ),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Text(
            'Category',
            style: TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        Flexible(
          child: Text(
            category,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: AppColors.deepBlue,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    ),
  );
}

class _PrioritySelector extends StatelessWidget {
  const _PrioritySelector({required this.value, required this.onChanged});

  final TicketPriority value;
  final ValueChanged<TicketPriority>? onChanged;

  @override
  Widget build(BuildContext context) {
    const items = [
      TicketPriority.low,
      TicketPriority.medium,
      TicketPriority.high,
    ];
    return Row(
      children: [
        for (var index = 0; index < items.length; index++) ...[
          Expanded(
            child: _PriorityOption(
              priority: items[index],
              selected: value == items[index],
              onTap: onChanged == null ? null : () => onChanged!(items[index]),
            ),
          ),
          if (index < items.length - 1) const SizedBox(width: 8),
        ],
      ],
    );
  }
}

class _PriorityOption extends StatelessWidget {
  const _PriorityOption({
    required this.priority,
    required this.selected,
    required this.onTap,
  });

  final TicketPriority priority;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      TicketPriority.low => AppColors.green,
      TicketPriority.medium => AppColors.orange,
      TicketPriority.high => AppColors.red,
    };
    return InkWell(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        height: 54,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? color : AppColors.line,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(_priorityIcon(priority), color: color, size: 18),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                priorityLabel(priority),
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? color : AppColors.ink,
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TicketSummaryStrip extends StatelessWidget {
  const _TicketSummaryStrip({
    required this.block,
    required this.floor,
    required this.location,
    required this.locationLabel,
    required this.priority,
    required this.category,
  });

  final String block;
  final String floor;
  final String location;
  final String locationLabel;
  final String priority;
  final String category;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.line),
      color: Colors.white,
    ),
    child: Column(
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final itemWidth = (constraints.maxWidth - 10) / 2;
            return Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                SizedBox(
                  width: itemWidth,
                  child: _SummaryMini(
                    icon: Icons.apartment_rounded,
                    value: block,
                    label: 'Block',
                  ),
                ),
                SizedBox(
                  width: itemWidth,
                  child: _SummaryMini(
                    icon: Icons.stairs_rounded,
                    value: floor,
                    label: 'Floor',
                  ),
                ),
                SizedBox(
                  width: itemWidth,
                  child: _SummaryMini(
                    icon: Icons.warning_rounded,
                    value: priority,
                    label: 'Priority',
                    color: priority == 'Critical'
                        ? AppColors.red
                        : AppColors.royalBlue,
                  ),
                ),
                SizedBox(
                  width: itemWidth,
                  child: _SummaryMini(
                    icon: Icons.cleaning_services_rounded,
                    value: category,
                    label: 'Category',
                  ),
                ),
              ],
            );
          },
        ),
        if (location.trim().isNotEmpty) ...[
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.paleBlue,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.place_outlined,
                  color: AppColors.royalBlue,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        locationLabel,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        location,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12.5,
                          height: 1.3,
                          fontWeight: FontWeight.w900,
                          color: AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    ),
  );
}

class _SummaryMini extends StatelessWidget {
  const _SummaryMini({
    required this.icon,
    required this.value,
    required this.label,
    this.color = AppColors.royalBlue,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: const Color(0xFFF8FAFC),
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: AppColors.line),
    ),
    child: Row(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                value.isEmpty ? '-' : value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _InfoNotice extends StatelessWidget {
  const _InfoNotice({
    required this.text,
    this.icon = Icons.info_outline_rounded,
    this.title,
  });

  final String text;
  final IconData icon;
  final String? title;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppColors.paleBlue.withValues(alpha: 0.65),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.royalBlue.withValues(alpha: 0.1)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.royalBlue, size: 17),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (title != null) ...[
                Text(
                  title!,
                  style: const TextStyle(
                    color: AppColors.deepBlue,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
              ],
              Text(
                text,
                style: const TextStyle(
                  color: AppColors.muted,
                  height: 1.35,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
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
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: AppColors.line)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: canGoBack ? onBack : null,
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.royalBlue,
                side: const BorderSide(color: AppColors.royalBlue),
                minimumSize: const Size.fromHeight(54),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.arrow_back_rounded),
                  SizedBox(width: 8),
                  Text('Back'),
                ],
              ),
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
                      isLastStep
                          ? Icons.arrow_forward_rounded
                          : Icons.arrow_forward_rounded,
                    ),
              label: Text(
                submitting
                    ? 'Submitting'
                    : isLastStep
                    ? 'Submit Ticket'
                    : 'Next',
              ),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                backgroundColor: AppColors.royalBlue,
                disabledBackgroundColor: const Color(0xFFCBD5E1),
                disabledForegroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                textStyle: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
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
    required this.placeholder,
    required this.value,
    required this.options,
    required this.icon,
    required this.onChanged,
    this.loading = false,
    this.enabled = true,
    this.emptyText = 'No options available.',
    this.loadingText = 'Loading options...',
    this.disabledText = 'Select a previous field first',
  });

  final String label;
  final String placeholder;
  final String value;
  final List<_PickerOption> options;
  final IconData icon;
  final ValueChanged<String> onChanged;
  final bool loading;
  final bool enabled;
  final String emptyText;
  final String loadingText;
  final String disabledText;

  @override
  Widget build(BuildContext context) {
    final selected = options.where((row) => row.value == value).toList();
    final selectedValue = selected.isEmpty ? null : value;
    final helperText = loading
        ? loadingText
        : !enabled
        ? disabledText
        : options.isEmpty
        ? emptyText
        : null;
    return DropdownButtonFormField<String>(
      initialValue: selectedValue,
      isExpanded: true,
      icon: const Icon(
        Icons.keyboard_arrow_down_rounded,
        color: AppColors.muted,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: placeholder,
        prefixIcon: Icon(
          icon,
          color: enabled ? AppColors.royalBlue : AppColors.muted,
        ),
        helperText: helperText,
        filled: true,
        fillColor: enabled ? Colors.white : const Color(0xFFF8FAFC),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.line),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.royalBlue, width: 1.4),
        ),
        labelStyle: const TextStyle(
          color: AppColors.deepBlue,
          fontWeight: FontWeight.w800,
        ),
        hintStyle: const TextStyle(
          color: AppColors.muted,
          fontWeight: FontWeight.w700,
        ),
        helperStyle: const TextStyle(
          color: AppColors.muted,
          fontWeight: FontWeight.w600,
        ),
      ),
      items: [
        for (final option in options)
          DropdownMenuItem<String>(
            value: option.value,
            child: Text(
              option.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: enabled && !loading && options.isNotEmpty
          ? (next) {
              if (next != null) onChanged(next);
            }
          : null,
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

class _SubmittingOverlay extends StatelessWidget {
  const _SubmittingOverlay();

  @override
  Widget build(BuildContext context) => Positioned.fill(
    child: ColoredBox(
      color: const Color(0xFF0F172A).withValues(alpha: 0.62),
      child: Center(
        child: Container(
          width: 270,
          padding: const EdgeInsets.fromLTRB(28, 30, 28, 28),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 34,
                offset: const Offset(0, 18),
              ),
            ],
          ),
          child: const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _SubmittingSpinner(),
              SizedBox(height: 20),
              Text(
                'Submitting your ticket...',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.deepBlue,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 10),
              Text(
                'Please wait while we notify the QPMS team.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.muted,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _SubmittingSpinner extends StatefulWidget {
  const _SubmittingSpinner();

  @override
  State<_SubmittingSpinner> createState() => _SubmittingSpinnerState();
}

class _SubmittingSpinnerState extends State<_SubmittingSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 950),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RotationTransition(
    turns: _controller,
    child: SizedBox(
      width: 82,
      height: 82,
      child: CircularProgressIndicator(
        strokeWidth: 8,
        valueColor: const AlwaysStoppedAnimation(AppColors.royalBlue),
        backgroundColor: AppColors.royalBlue.withValues(alpha: 0.16),
      ),
    ),
  );
}

class _AddPhotoButton extends StatelessWidget {
  const _AddPhotoButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: Container(
      width: 92,
      height: 92,
      decoration: BoxDecoration(
        border: Border.all(
          color: AppColors.royalBlue.withValues(alpha: 0.45),
          style: BorderStyle.solid,
        ),
        borderRadius: BorderRadius.circular(16),
        color: Colors.white,
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.add_a_photo_rounded, color: AppColors.royalBlue, size: 26),
          SizedBox(height: 7),
          Text(
            'Add Photo',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w900,
              color: AppColors.royalBlue,
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
          width: 92,
          height: 92,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => Container(
            width: 92,
            height: 92,
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
            minimumSize: const Size(24, 24),
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
