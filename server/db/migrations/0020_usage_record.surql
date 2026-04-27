DEFINE TABLE usage_record SCHEMAFULL;
DEFINE FIELD tenantIds  ON usage_record TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD resourceKey   ON usage_record TYPE string;
DEFINE FIELD value      ON usage_record TYPE number;
DEFINE FIELD period     ON usage_record TYPE string;
DEFINE FIELD createdAt  ON usage_record TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ur_tenant ON usage_record FIELDS tenantIds, resourceKey, period;
