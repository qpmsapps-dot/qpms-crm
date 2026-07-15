import 'package:flutter/material.dart';

import '../bd/bd_shell.dart';
import '../models/fo_models.dart';
import '../profile/profile_screen.dart';
import '../tasks/tasks_screen.dart';
import '../theme/app_theme.dart';
import '../ui/fo_ui.dart';
import '../visits/visits_screen.dart';
import '../utils/mobile_roles.dart';
import 'home_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({required this.user, required this.onLogout, super.key});

  final FoUser user;
  final Future<void> Function() onLogout;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  late final PageController _pageController;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _selectTab(int value) {
    if (value == _index) return;
    _pageController.animateToPage(
      value,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (isBusinessDevelopmentRole(widget.user.role)) {
      return BdShell(user: widget.user, onLogout: widget.onLogout);
    }
    final showBdModule = canAccessBusinessDevelopmentModule(widget.user.role);
    final pages = <Widget>[
      HomeScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        key: const PageStorageKey('home'),
      ),
      TasksScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        isSelected: _index == 1,
        key: const PageStorageKey('tasks'),
      ),
      VisitsScreen(user: widget.user, key: const PageStorageKey('visits')),
      ProfileScreen(
        user: widget.user,
        onLogout: widget.onLogout,
        key: const PageStorageKey('profile'),
      ),
    ];
    return Scaffold(
      body: PageView(
        controller: _pageController,
        onPageChanged: (value) => setState(() => _index = value),
        children: pages,
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: foBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x180A43D1),
                blurRadius: 24,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              _navItem(0, Icons.home_outlined, Icons.home_rounded, 'Home'),
              _navItem(
                1,
                Icons.assignment_outlined,
                Icons.assignment_rounded,
                'My Tasks',
              ),
              _navItem(
                2,
                Icons.location_on_outlined,
                Icons.location_on_rounded,
                'Site Visit',
              ),
              if (showBdModule) _bdModuleItem(),
              _navItem(3, Icons.person_outline, Icons.person, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(
    int index,
    IconData icon,
    IconData selectedIcon,
    String label,
  ) {
    final selected = _index == index;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _selectTab(index),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 54,
                height: 38,
                decoration: BoxDecoration(
                  color: selected ? qpmsBlue.withValues(alpha: 0.12) : null,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  selected ? selectedIcon : icon,
                  color: selected ? qpmsBlue : const Color(0xFF66708D),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? qpmsBlue : const Color(0xFF66708D),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bdModuleItem() {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                BdShell(user: widget.user, onLogout: widget.onLogout),
          ),
        ),
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 54,
                height: 38,
                child: Icon(
                  Icons.business_center_outlined,
                  color: Color(0xFF66708D),
                ),
              ),
              SizedBox(height: 4),
              Text(
                'BD Leads',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Color(0xFF66708D),
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
