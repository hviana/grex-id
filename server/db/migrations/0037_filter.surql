DEFINE TABLE filter SCHEMAFULL;
DEFINE FIELD tenantIds       ON filter TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD name          ON filter TYPE string;
DEFINE FIELD applicableTo          ON filter TYPE string;
DEFINE FIELD data            ON filter TYPE object FLEXIBLE;
DEFINE FIELD createdAt       ON filter TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt       ON filter TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_filter_fields ON filter FIELDS tenantIds, name, applicableTo;
