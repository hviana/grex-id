DEFINE TABLE front_setting SCHEMAFULL;
DEFINE FIELD key         ON front_setting TYPE string;
DEFINE FIELD value       ON front_setting TYPE string;
DEFINE FIELD description ON front_setting TYPE option<string>;
DEFINE FIELD tenantId    ON front_setting TYPE record<tenant>;
DEFINE FIELD createdAt   ON front_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON front_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_front_setting_unique  ON front_setting FIELDS key, tenantId UNIQUE;
DEFINE INDEX idx_front_setting_tenant  ON front_setting FIELDS tenantId;
