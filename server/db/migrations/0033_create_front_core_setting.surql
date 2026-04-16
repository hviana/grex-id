-- Front-safe settings table, physically separated from core_setting
-- Ensures frontend bundle cannot accidentally leak server-only secrets
DEFINE TABLE front_core_setting SCHEMAFULL;
DEFINE FIELD key         ON front_core_setting TYPE string;
DEFINE FIELD value       ON front_core_setting TYPE string;
DEFINE FIELD description ON front_core_setting TYPE option<string>;
DEFINE FIELD createdAt   ON front_core_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON front_core_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_fcs_key ON front_core_setting FIELDS key UNIQUE;
