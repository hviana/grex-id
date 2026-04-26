DEFINE TABLE setting SCHEMAFULL;
DEFINE FIELD key         ON setting TYPE string;
DEFINE FIELD value       ON setting TYPE string;
DEFINE FIELD description ON setting TYPE string;
DEFINE FIELD tenantIds   ON setting TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD createdAt   ON setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_setting_unique  ON setting FIELDS key, tenantIds UNIQUE;
DEFINE INDEX idx_setting_tenant  ON setting FIELDS tenantIds;
