-- Rename core_setting → setting, front_core_setting → front_setting
-- Add systemSlug for per-system overrides with fallback to core defaults

DEFINE TABLE setting SCHEMAFULL;
DEFINE FIELD key         ON setting TYPE string;
DEFINE FIELD value       ON setting TYPE string;
DEFINE FIELD description ON setting TYPE string;
DEFINE FIELD systemSlug  ON setting TYPE option<string>;
DEFINE FIELD createdAt   ON setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON setting TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_setting_unique ON setting FIELDS key, systemSlug UNIQUE;

DEFINE TABLE front_setting SCHEMAFULL;
DEFINE FIELD key         ON front_setting TYPE string;
DEFINE FIELD value       ON front_setting TYPE string;
DEFINE FIELD description ON front_setting TYPE option<string>;
DEFINE FIELD systemSlug  ON front_setting TYPE option<string>;
DEFINE FIELD createdAt   ON front_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON front_setting TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_front_setting_unique ON front_setting FIELDS key, systemSlug UNIQUE;

INSERT INTO setting SELECT key, value, description, NONE AS systemSlug, createdAt, updatedAt FROM core_setting;
INSERT INTO front_setting SELECT key, value, description, NONE AS systemSlug, createdAt, updatedAt FROM front_core_setting;
REMOVE TABLE core_setting;
REMOVE TABLE front_core_setting;
