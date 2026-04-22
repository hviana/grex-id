DEFINE TABLE setting SCHEMAFULL;
DEFINE FIELD key         ON setting TYPE string;
DEFINE FIELD value       ON setting TYPE string;
DEFINE FIELD description ON setting TYPE string;
DEFINE FIELD systemSlug  ON setting TYPE string DEFAULT "core" ASSERT $value != "";
DEFINE FIELD createdAt   ON setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_setting_unique ON setting FIELDS key, systemSlug UNIQUE;
