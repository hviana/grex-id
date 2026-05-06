DEFINE TABLE shared_record SCHEMAFULL;

DEFINE FIELD recordId ON TABLE shared_record
  TYPE record;

-- Since this must have exactly one item, this should probably be scalar.
DEFINE FIELD ownerTenantIds ON TABLE shared_record
  TYPE set<record<tenant>, 1> DEFAULT <set>[];

DEFINE FIELD fields ON TABLE shared_record
  TYPE set<string>
  DEFAULT <set>[];

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
  FIELDS recordId, ownerTenantIds, accessesTenantIds, permissions, fields
  UNIQUE;

DEFINE INDEX idx_shared_record_record
  ON TABLE shared_record
  FIELDS recordId;

DEFINE INDEX idx_shared_record_owner_tenant
  ON TABLE shared_record
  FIELDS ownerTenantIds;

DEFINE INDEX idx_shared_record_access_tenants
  ON TABLE shared_record
  FIELDS accessesTenantIds;

DEFINE INDEX idx_shared_record_record_permissions
  ON TABLE shared_record
  FIELDS recordId, permissions;