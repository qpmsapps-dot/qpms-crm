class TrainingType {
  const TrainingType({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.isActive = true,
    this.sortOrder = 0,
  });
  final String id;
  final String code;
  final String name;
  final String? description;
  final bool isActive;
  final int sortOrder;
  factory TrainingType.fromJson(Map<String, dynamic> json) => TrainingType(
    id: '${json['id'] ?? ''}',
    code: '${json['code'] ?? ''}',
    name: '${json['name'] ?? ''}',
    description: json['description'] as String?,
    isActive: json['is_active'] as bool? ?? true,
    sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'code': code,
    'name': name,
    'description': description,
    'is_active': isActive,
    'sort_order': sortOrder,
  };
  @override
  bool operator ==(Object other) => other is TrainingType && other.id == id;
  @override
  int get hashCode => id.hashCode;
}
