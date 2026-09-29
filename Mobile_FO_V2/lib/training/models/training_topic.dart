class TrainingTopic {
  const TrainingTopic({
    required this.id,
    required this.categoryId,
    required this.code,
    required this.moduleName,
    this.topicDescription,
    this.iconKey,
    this.isRequiredDefault = false,
    this.isActive = true,
    this.sortOrder = 0,
  });
  final String id;
  final String categoryId;
  final String code;
  final String moduleName;
  final String? topicDescription;
  final String? iconKey;
  final bool isRequiredDefault;
  final bool isActive;
  final int sortOrder;
  factory TrainingTopic.fromJson(Map<String, dynamic> json) => TrainingTopic(
    id: '${json['id'] ?? ''}',
    categoryId: '${json['category_id'] ?? ''}',
    code: '${json['code'] ?? ''}',
    moduleName: '${json['module_name'] ?? ''}',
    topicDescription: json['topic_description'] as String?,
    iconKey: json['icon_key'] as String?,
    isRequiredDefault: json['is_required_default'] as bool? ?? false,
    isActive: json['is_active'] as bool? ?? true,
    sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'category_id': categoryId,
    'code': code,
    'module_name': moduleName,
    'topic_description': topicDescription,
    'icon_key': iconKey,
    'is_required_default': isRequiredDefault,
    'is_active': isActive,
    'sort_order': sortOrder,
  };
  @override
  bool operator ==(Object other) => other is TrainingTopic && other.id == id;
  @override
  int get hashCode => id.hashCode;
}
