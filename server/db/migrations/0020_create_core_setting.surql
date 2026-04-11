DEFINE TABLE core_setting SCHEMAFULL;
DEFINE FIELD key         ON core_setting TYPE string;
DEFINE FIELD value       ON core_setting TYPE string;
DEFINE FIELD description ON core_setting TYPE string;
DEFINE FIELD createdAt   ON core_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON core_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_key ON core_setting FIELDS key UNIQUE;
