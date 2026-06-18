import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/constants/app_assets.dart';
import '../data/mock_data.dart';
import '../models/ticket.dart';

class DraftTicket {
  DraftTicket({
    this.category = 'Electrical',
    this.title = 'Lights Flickering in Main Corridor',
    this.description =
        'Lights in the main corridor are flickering continuously and require urgent inspection.',
    this.site = 'Rajiv Gandhi Government Hospital, Chennai',
    this.priority = TicketPriority.high,
    this.photos = const [],
  });

  String category;
  String title;
  String description;
  String site;
  TicketPriority priority;
  List<String> photos;
}

class TicketController extends ChangeNotifier {
  TicketController({this.preferences}) {
    resetMockData();
  }

  final SharedPreferences? preferences;
  final Map<String, List<String>> _comments = {};
  late List<Ticket> _tickets;

  List<Ticket> get tickets => List.unmodifiable(_tickets);

  Ticket ticketByNumber(String number) {
    return _tickets.firstWhere((ticket) => ticket.number == number);
  }

  List<Ticket> filterByStatus(TicketStatus? status) {
    if (status == null) return tickets;
    return _tickets.where((ticket) => ticket.status == status).toList();
  }

  List<String> commentsFor(String ticketNumber) {
    return List.unmodifiable(_comments[ticketNumber] ?? const []);
  }

  void addComment(String ticketNumber, String text) {
    final cleanText = text.trim();
    if (cleanText.isEmpty) return;
    _comments.putIfAbsent(ticketNumber, () => <String>[]).add(cleanText);
    notifyListeners();
  }

  Ticket submitDraft(DraftTicket draft) {
    final ticket = Ticket(
      number: featuredTicketNumber,
      category: draft.category,
      title: draft.title.trim(),
      site: draft.site,
      description: draft.description.trim(),
      priority: draft.priority,
      raisedBy: 'Client User',
      assignedTechnician: 'Ravi Kumar',
      raisedDate: '17 June 2026, 09:15 AM',
      status: TicketStatus.inProgress,
      photoAssets: draft.photos.isEmpty
          ? const [
              AppAssets.photoPanel,
              AppAssets.photoLight,
              AppAssets.photoWiring,
            ]
          : draft.photos,
    );
    _tickets.removeWhere((item) => item.number == featuredTicketNumber);
    _tickets.insert(0, ticket);
    _comments.putIfAbsent(featuredTicketNumber, initialComments);
    notifyListeners();
    _saveDemoMarker();
    return ticket;
  }

  bool isDraftValid(DraftTicket draft) {
    return draft.category.trim().isNotEmpty &&
        draft.title.trim().isNotEmpty &&
        draft.description.trim().isNotEmpty &&
        draft.site.trim().isNotEmpty;
  }

  void resetMockData() {
    _tickets = initialTickets();
    _comments
      ..clear()
      ..[featuredTicketNumber] = initialComments();
    notifyListeners();
  }

  Future<void> _saveDemoMarker() async {
    final prefs = preferences ?? await SharedPreferences.getInstance();
    await prefs.setString('qpms_last_demo_ticket', featuredTicketNumber);
  }
}
