DEFINE TABLE front_setting SCHEMAFULL;
DEFINE FIELD key         ON front_setting TYPE string;
DEFINE FIELD value       ON front_setting TYPE string;
DEFINE FIELD description ON front_setting TYPE option<string>;
DEFINE FIELD tenantIds   ON front_setting TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD createdAt   ON front_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON front_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_front_setting_unique  On front_setting FIELDS key, tenantIds UNIQUE;
DEFINE INDEX idx_front_setting_tenant  On front_setting FIELDS tenantIds;
