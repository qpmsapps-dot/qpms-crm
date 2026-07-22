import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/client_bottom_nav.dart';
import '../../core/widgets/ticket_card.dart';
import '../../models/ticket.dart';
import '../../state/ticket_controller.dart';

class MyTicketsScreen extends StatefulWidget {
  const MyTicketsScreen({super.key});
  @override
  State<MyTicketsScreen> createState() => _MyTicketsScreenState();
}

class _MyTicketsScreenState extends State<MyTicketsScreen> {
  TicketListFilter _filter = TicketListFilter.all;
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TicketController>();
    final tickets = controller.filterTickets(_filter, query: _search.text);
    return Scaffold(
      bottomNavigationBar: const ClientBottomNav(currentRoute: AppRoutes.tickets),
      appBar: AppBar(
        title: const Text('Complaints'),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.pushNamed(context, AppRoutes.raiseTicket),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Raise Complaint'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 6, 18, 12),
              child: TextField(
                controller: _search,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search_rounded),
                  hintText: 'Search Ticket ID or location',
                ),
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Row(
                children: TicketListFilter.values.map((filter) {
                  final label = switch (filter) {
                    TicketListFilter.all => 'All',
                    TicketListFilter.open => 'Open',
                    TicketListFilter.assigned => 'Assigned',
                    TicketListFilter.inProgress => 'In Progress',
                    TicketListFilter.awaitingConfirmation =>
                      'Awaiting Confirmation',
                    TicketListFilter.resolved => 'Resolved',
                    TicketListFilter.closed => 'Closed',
                    TicketListFilter.reopened => 'Reopened',
                  };
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(label),
                      selected: _filter == filter,
                      onSelected: (_) => setState(() => _filter = filter),
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: RefreshIndicator(
                onRefresh: controller.load,
                child: tickets.isEmpty
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: const [SizedBox(height: 150), _EmptyTickets()],
                      )
                    : ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(18, 4, 18, 100),
                        itemCount: tickets.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) => TicketCard(
                          ticket: tickets[index],
                          onTap: () => Navigator.pushNamed(
                            context,
                            AppRoutes.ticketDetails,
                            arguments: tickets[index].number,
                          ),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyTickets extends StatelessWidget {
  const _EmptyTickets();
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: AppColors.paleBlue,
            child: Icon(
              Icons.task_alt_rounded,
              color: AppColors.royalBlue,
              size: 30,
            ),
          ),
          SizedBox(height: 14),
          Text(
            'No tickets here',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
              color: AppColors.deepBlue,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Try another status or search term.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted),
          ),
        ],
      ),
    ),
  );
}
