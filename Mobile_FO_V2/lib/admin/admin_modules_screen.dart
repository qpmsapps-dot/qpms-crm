import 'package:flutter/material.dart';

import '../tasks/tasks_screen.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';

enum AdminModuleId {
  inspection,
  deepCleaning,
  training,
  siteVisits,
  bdLeads,
  attendance,
  travelKm,
  storeSelection,
  travelClaims,
  hospitalHousekeeping,
  hospitalTickets,
  hospitalNotifications,
  trackingDebug,
  profile,
}

enum AdminModuleGroup {
  fieldOperations('FIELD OPERATIONS'),
  businessDevelopment('BUSINESS DEVELOPMENT'),
  attendanceTravel('ATTENDANCE & TRAVEL'),
  hospitalOperations('HOSPITAL OPERATIONS'),
  support('SUPPORT');

  const AdminModuleGroup(this.label);

  final String label;
}

class AdminModuleItem {
  const AdminModuleItem({
    required this.id,
    required this.group,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    this.fullWidth = false,
  });

  final AdminModuleId id;
  final AdminModuleGroup group;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final bool fullWidth;
}

const adminModuleCatalog = <AdminModuleItem>[
  AdminModuleItem(
    id: AdminModuleId.inspection,
    group: AdminModuleGroup.fieldOperations,
    title: 'Inspection',
    subtitle: 'Site checks',
    icon: Icons.content_paste_search_rounded,
    color: qpmsBlue,
  ),
  AdminModuleItem(
    id: AdminModuleId.deepCleaning,
    group: AdminModuleGroup.fieldOperations,
    title: 'Deep Cleaning',
    subtitle: 'DC activities',
    icon: Icons.cleaning_services_rounded,
    color: foGreen,
  ),
  AdminModuleItem(
    id: AdminModuleId.training,
    group: AdminModuleGroup.fieldOperations,
    title: 'Training',
    subtitle: 'Proof uploads',
    icon: Icons.co_present_rounded,
    color: foPurple,
  ),
  AdminModuleItem(
    id: AdminModuleId.siteVisits,
    group: AdminModuleGroup.fieldOperations,
    title: 'Site Visits',
    subtitle: 'Visit history',
    icon: Icons.location_on_outlined,
    color: qpmsBlue,
  ),
  AdminModuleItem(
    id: AdminModuleId.bdLeads,
    group: AdminModuleGroup.businessDevelopment,
    title: 'BD Leads',
    subtitle: 'Lead pipeline',
    icon: Icons.business_center_outlined,
    color: foOrange,
    fullWidth: true,
  ),
  AdminModuleItem(
    id: AdminModuleId.attendance,
    group: AdminModuleGroup.attendanceTravel,
    title: 'Attendance / Start Day',
    subtitle: 'Duty status',
    icon: Icons.play_circle_outline_rounded,
    color: qpmsBlue,
  ),
  AdminModuleItem(
    id: AdminModuleId.travelKm,
    group: AdminModuleGroup.attendanceTravel,
    title: 'Travel & KM',
    subtitle: 'Route KM',
    icon: Icons.route_outlined,
    color: foGreen,
  ),
  AdminModuleItem(
    id: AdminModuleId.storeSelection,
    group: AdminModuleGroup.attendanceTravel,
    title: 'Site / Store Selection',
    subtitle: 'Check-in sites',
    icon: Icons.storefront_outlined,
    color: foPurple,
  ),
  AdminModuleItem(
    id: AdminModuleId.travelClaims,
    group: AdminModuleGroup.attendanceTravel,
    title: 'Parking / Travel Claims',
    subtitle: 'Expense proofs',
    icon: Icons.receipt_long_outlined,
    color: foOrange,
  ),
  AdminModuleItem(
    id: AdminModuleId.hospitalHousekeeping,
    group: AdminModuleGroup.hospitalOperations,
    title: 'Hospital Housekeeping',
    subtitle: 'Operations view',
    icon: Icons.local_hospital_outlined,
    color: Color(0xFF0F766E),
    fullWidth: true,
  ),
  AdminModuleItem(
    id: AdminModuleId.hospitalTickets,
    group: AdminModuleGroup.hospitalOperations,
    title: 'Hospital Tickets',
    subtitle: 'Ticket queue',
    icon: Icons.confirmation_number_outlined,
    color: Color(0xFF0F766E),
  ),
  AdminModuleItem(
    id: AdminModuleId.hospitalNotifications,
    group: AdminModuleGroup.hospitalOperations,
    title: 'Hospital Notifications',
    subtitle: 'Ticket alerts',
    icon: Icons.notifications_none_rounded,
    color: Color(0xFF0F766E),
  ),
  AdminModuleItem(
    id: AdminModuleId.trackingDebug,
    group: AdminModuleGroup.support,
    title: 'Tracking Debug',
    subtitle: 'GPS health',
    icon: Icons.bug_report_outlined,
    color: foPurple,
  ),
  AdminModuleItem(
    id: AdminModuleId.profile,
    group: AdminModuleGroup.support,
    title: 'Profile',
    subtitle: 'Account tools',
    icon: Icons.person_outline,
    color: qpmsBlue,
  ),
];

class AdminModulesScreen extends StatefulWidget {
  const AdminModulesScreen({
    required this.onOpenActivity,
    required this.onOpenSiteVisits,
    required this.onOpenBdLeads,
    required this.onOpenAttendance,
    required this.onOpenTasks,
    required this.onOpenHospital,
    required this.onOpenProfile,
    super.key,
  });

  final ValueChanged<FoActivityType> onOpenActivity;
  final VoidCallback onOpenSiteVisits;
  final VoidCallback onOpenBdLeads;
  final VoidCallback onOpenAttendance;
  final VoidCallback onOpenTasks;
  final ValueChanged<AdminModuleId> onOpenHospital;
  final VoidCallback onOpenProfile;

  @override
  State<AdminModulesScreen> createState() => _AdminModulesScreenState();
}

class _AdminModulesScreenState extends State<AdminModulesScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final modules = _filteredModules();
    return Scaffold(
      body: FoPage(
        children: [
          const FoHeader(
            title: 'All Modules',
            subtitle: 'Access myQPMS mobile operations',
            leading: FoIconCircle(
              icon: Icons.apps_rounded,
              color: qpmsBlue,
              size: 62,
              iconSize: 34,
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'Search modules...',
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
          const SizedBox(height: 18),
          for (final group in AdminModuleGroup.values)
            if (modules.any((item) => item.group == group)) ...[
              _ModuleGroupSection(
                title: group.label,
                modules: modules
                    .where((item) => item.group == group)
                    .toList(growable: false),
                onTap: _openModule,
              ),
              const SizedBox(height: 18),
            ],
        ],
      ),
    );
  }

  List<AdminModuleItem> _filteredModules() {
    final query = _search.text.trim().toLowerCase();
    if (query.isEmpty) return adminModuleCatalog;
    return adminModuleCatalog
        .where((item) {
          return item.title.toLowerCase().contains(query) ||
              item.subtitle.toLowerCase().contains(query) ||
              item.group.label.toLowerCase().contains(query);
        })
        .toList(growable: false);
  }

  void _openModule(AdminModuleItem item) {
    switch (item.id) {
      case AdminModuleId.inspection:
        widget.onOpenActivity(FoActivityType.inspection);
      case AdminModuleId.deepCleaning:
        widget.onOpenActivity(FoActivityType.deepCleaning);
      case AdminModuleId.training:
        widget.onOpenActivity(FoActivityType.training);
      case AdminModuleId.siteVisits:
        widget.onOpenSiteVisits();
      case AdminModuleId.bdLeads:
        widget.onOpenBdLeads();
      case AdminModuleId.attendance:
      case AdminModuleId.travelKm:
        widget.onOpenAttendance();
      case AdminModuleId.storeSelection:
        widget.onOpenTasks();
      case AdminModuleId.travelClaims:
        widget.onOpenSiteVisits();
      case AdminModuleId.trackingDebug:
        widget.onOpenAttendance();
      case AdminModuleId.hospitalHousekeeping:
      case AdminModuleId.hospitalTickets:
      case AdminModuleId.hospitalNotifications:
        widget.onOpenHospital(item.id);
      case AdminModuleId.profile:
        widget.onOpenProfile();
    }
  }
}

class _ModuleGroupSection extends StatelessWidget {
  const _ModuleGroupSection({
    required this.title,
    required this.modules,
    required this.onTap,
  });

  final String title;
  final List<AdminModuleItem> modules;
  final ValueChanged<AdminModuleItem> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 10),
          child: Text(
            title,
            style: const TextStyle(
              color: qpmsMuted,
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 0,
            ),
          ),
        ),
        LayoutBuilder(
          builder: (context, constraints) {
            final twoColumn = constraints.maxWidth >= 330;
            final cardWidth = twoColumn
                ? (constraints.maxWidth - 12) / 2
                : constraints.maxWidth;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final item in modules)
                  SizedBox(
                    width: item.fullWidth || !twoColumn
                        ? constraints.maxWidth
                        : cardWidth,
                    child: _ModuleCard(item: item, onTap: () => onTap(item)),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _ModuleCard extends StatelessWidget {
  const _ModuleCard({required this.item, required this.onTap});

  final AdminModuleItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: FoCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FoIconCircle(
                  icon: item.icon,
                  color: item.color,
                  size: 44,
                  iconSize: 23,
                ),
                const Spacer(),
                const Icon(Icons.chevron_right_rounded, color: qpmsMuted),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: foNavy,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              item.subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: qpmsMuted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
