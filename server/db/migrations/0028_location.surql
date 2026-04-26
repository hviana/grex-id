DEFINE TABLE location SCHEMAFULL;
DEFINE FIELD name             ON location TYPE string;
DEFINE FIELD description      ON location TYPE option<string>;
DEFINE FIELD tenantId         ON location TYPE record<tenant>;
DEFINE FIELD address          ON location TYPE object;
DEFINE FIELD address.street   ON location TYPE string;
DEFINE FIELD address.number   ON location TYPE string;
DEFINE FIELD address.complement    ON location TYPE option<string>;
DEFINE FIELD address.neighborhood  ON location TYPE option<string>;
DEFINE FIELD address.city     ON location TYPE string;
DEFINE FIELD address.state    ON location TYPE string;
DEFINE FIELD address.country  ON location TYPE string;
DEFINE FIELD address.postalCode ON location TYPE string;
DEFINE FIELD createdAt        ON location TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt        ON location TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_location_tenant ON location FIELDS tenantId;
DEFINE INDEX idx_location_name   ON TABLE location FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
