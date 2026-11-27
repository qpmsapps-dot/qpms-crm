import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../models/fo_models.dart';
import '../data/training_api.dart';
import '../data/training_repository.dart';
import '../models/training_session.dart';
import '../state/management_training_controller.dart';
import '../state/training_flow_controller.dart';
import 'mepc_training_screen.dart';

class ManagementTrainingShell extends StatefulWidget {
  const ManagementTrainingShell({
    required this.user,
    required this.onLogout,
    this.operationalWorkspace,
    this.api,
    super.key,
  });
  final FoUser user;
  final TrainingApi? api;
  final VoidCallback onLogout;
  final WidgetBuilder? operationalWorkspace;
  @override
  State<ManagementTrainingShell> createState() =>
      _ManagementTrainingShellState();
}

class _ManagementTrainingShellState extends State<ManagementTrainingShell> {
  final _store = TextEditingController();
  final _trainer = TextEditingController();
  late final TrainingApi _api = widget.api ?? TrainingApi(user: widget.user);
  late final TrainingRepository _repository = TrainingRepository(api: _api);
  bool _busy = false;
  String? _message;
  List<TrainingSession> _reports = [];
  String get _intentKey => 'training.management.v3.${widget.user.authUserId}';
  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _store.dispose();
    _trainer.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final reports = await _repository.getSessions();
      if (mounted) {
        setState(
          () => _reports = reports
              .where((s) => s.category?.code == 'technical_mep')
              .toList(),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _message = '$error');
    }
  }

  Future<void> _open({bool resume = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    ManagementTrainingController? controller;
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_intentKey);
      Map<String, dynamic> intent;
      if (saved != null) {
        if (!resume) {
          throw StateError(
            'Resume the existing report before starting another.',
          );
        }
        intent = Map<String, dynamic>.from(jsonDecode(saved));
      } else {
        if (resume) throw StateError('No saved management report.');
        final setup = await _api.managementSetup(
          storeCode: _store.text.trim(),
          trainerCode: _trainer.text.trim(),
          date: TrainingFlowController.indiaDate()
              .toIso8601String()
              .split('T')
              .first,
        );
        intent = {
          'setup': setup,
          'key':
              '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}',
        };
        await prefs.setString(_intentKey, jsonEncode(intent));
      }
      controller = ManagementTrainingController(
        api: _api,
        repository: _repository,
        setup: Map<String, dynamic>.from(intent['setup']),
        creationKey: intent['key'],
        persistenceKey: _intentKey,
      );
      await controller.restore();
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              MepcTrainingScreen(controller: controller!, management: true),
        ),
      );
      if (controller.isSubmitted) await prefs.remove(_intentKey);
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _message = '$error');
    } finally {
      controller?.dispose();
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _closeLocalReport() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Close saved report locally?'),
        content: const Text(
          'Server reports and evidence will remain unchanged. Check permitted reports before starting a separate report to avoid an unintended duplicate.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep saved report'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Close locally'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await (await SharedPreferences.getInstance()).remove(_intentKey);
    if (mounted) {
      setState(
        () => _message =
            'Saved local report closed. Server history is preserved.',
      );
    }
  }

  Future<void> _detail(TrainingSession row) async {
    try {
      final report = await _repository.getSession(row.id);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            '${report.storeCodeSnapshot} — ${report.storeNameSnapshot}',
          ),
          content: SizedBox(
            width: 400,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Channel: ${report.submissionChannel ?? 'Unknown'}\nUploader: ${report.uploaderProfileId ?? 'Unknown'}\nActual trainer: ${report.actualTrainerProfileId ?? 'Unknown'}\n${report.trainerName}\n${report.trainingDate}\n${report.status.name}\n${report.remarks ?? ''}',
                  ),
                  for (final topic in report.selectedTopics)
                    Text(topic.topic?.moduleName ?? topic.topicId),
                  for (final evidence in report.evidence)
                    TextButton(
                      onPressed: () async {
                        try {
                          final view = await _repository.getEvidenceViewUrl(
                            report.id,
                            evidence.id,
                          );
                          await launchUrl(
                            Uri.parse(view.url),
                            mode: LaunchMode.externalApplication,
                          );
                        } catch (error) {
                          if (mounted) setState(() => _message = '$error');
                        }
                      },
                      child: Text(evidence.fileName),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _message = '$error');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('MEPC Training'),
      actions: [
        IconButton(
          onPressed: widget.onLogout,
          icon: const Icon(Icons.logout),
          tooltip: 'Sign out',
        ),
      ],
    ),
    body: RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            widget.user.fullName,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const Text(
            'Management submission • Today (IST)\nNo Start Day or Check-In required.',
          ),
          TextField(
            controller: _store,
            decoration: const InputDecoration(labelText: 'Exact Store Code'),
            enabled: !_busy,
          ),
          TextField(
            controller: _trainer,
            decoration: const InputDecoration(
              labelText: 'Actual trainer employee code',
            ),
            enabled: !_busy,
          ),
          FilledButton(
            onPressed: _busy ? null : _open,
            child: const Text('Open MEPC Training form'),
          ),
          OutlinedButton(
            onPressed: _busy ? null : () => _open(resume: true),
            child: const Text('Resume saved report / retry'),
          ),
          TextButton(
            onPressed: _busy ? null : _closeLocalReport,
            child: const Text('Close saved report locally'),
          ),
          if (_busy) const LinearProgressIndicator(),
          if (_message != null) Text(_message!),
          const Divider(),
          const Text('Permitted MEPC reports — past year'),
          for (final report in _reports)
            ListTile(
              title: Text(
                '${report.storeCodeSnapshot} — ${report.storeNameSnapshot}',
              ),
              subtitle: Text(
                '${report.trainingDate?.toIso8601String().split('T').first} • ${report.status.name}',
              ),
              onTap: () => _detail(report),
            ),
          if (widget.operationalWorkspace != null)
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: widget.operationalWorkspace!),
              ),
              child: const Text('Existing operational workspace'),
            ),
        ],
      ),
    ),
  );
}
