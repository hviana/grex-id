DEFINE TABLE shared_record SCHEMAFULL;

DEFINE FIELD recordId ON TABLE shared_record
  TYPE record;

-- Since this must have exactly one item, this should probably be scalar.
DEFINE FIELD ownerTenantId ON TABLE shared_record
  TYPE record<tenant>;

DEFINE FIELD accessesTenantIds ON TABLE shared_record
  TYPE set<record<tenant>>
  DEFAULT <set>[];

DEFINE FIELD permissions ON TABLE shared_record
  TYPE string
  ASSERT $value IN ["r", "w", "rw", "share"];

DEFINE FIELD shareKey ON TABLE shared_record
  VALUE <string>[
    recordId,
    ownerTenantId,
    accessesTenantIds,
    permissions
  ]
  READONLY;

DEFINE INDEX idx_shared_record_unique_share
  ON TABLE shared_record
  COLUMNS shareKey
  UNIQUE;

DEFINE INDEX idx_shared_record_record
  ON TABLE shared_record
  COLUMNS recordId;

DEFINE INDEX idx_shared_record_owner_tenant
  ON TABLE shared_record
  COLUMNS ownerTenantId;

DEFINE INDEX idx_shared_record_access_tenants
  ON TABLE shared_record
  COLUMNS accessesTenantIds;

DEFINE INDEX idx_shared_record_record_permissions
  ON TABLE shared_record
  COLUMNS recordId, permissions;