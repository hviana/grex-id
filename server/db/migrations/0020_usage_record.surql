DEFINE TABLE usage_record SCHEMAFULL;
DEFINE FIELD tenantIds  ON usage_record TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD resourceKey   ON usage_record TYPE string;
DEFINE FIELD value      ON usage_record TYPE number DEFAULT 0;
DEFINE FIELD counts      ON usage_record TYPE number DEFAULT 0;
DEFINE FIELD period     ON usage_record TYPE string;
DEFINE FIELD createdAt  ON usage_record TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ur_tenant ON usage_record FIELDS tenantIds, resourceKey, period;
