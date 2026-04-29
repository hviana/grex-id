DEFINE TABLE shared_record SCHEMAFULL;

DEFINE FIELD recordId ON TABLE shared_record
  TYPE record;

-- Since this must have exactly one item, this should probably be scalar.
DEFINE FIELD ownerTenantIds ON TABLE shared_record
  ON usage_record TYPE set<record<tenant>, 1> DEFAULT <set>[];

DEFINE FIELD accessesTenantIds ON TABLE shared_record
  TYPE set<record<tenant>>
  DEFAULT <set>[];

DEFINE FIELD permissions ON TABLE shared_record
  TYPE set<string>
  DEFAULT <set>[]
  ASSERT $value.len() > 0
     AND $value.all(|$permission| $permission IN ["r", "w", "share"]);

DEFINE INDEX idx_shared_record_unique_share
  ON TABLE shared_record
  COLUMNS recordId, ownerTenantIds, accessesTenantIds, permissions
  UNIQUE;

DEFINE INDEX idx_shared_record_record
  ON TABLE shared_record
  COLUMNS recordId;

DEFINE INDEX idx_shared_record_owner_tenant
  ON TABLE shared_record
  COLUMNS ownerTenantIds;

DEFINE INDEX idx_shared_record_access_tenants
  ON TABLE shared_record
  COLUMNS accessesTenantIds;

DEFINE INDEX idx_shared_record_record_permissions
  ON TABLE shared_record
  COLUMNS recordId, permissions;