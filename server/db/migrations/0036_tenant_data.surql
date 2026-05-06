DEFINE TABLE tenant_data SCHEMAFULL;
DEFINE FIELD tenantIds       ON tenant_data TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD data            ON tenant_data TYPE object FLEXIBLE;
DEFINE FIELD createdAt       ON tenant_data TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt       ON tenant_data TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_tenant_data_tenant ON tenant_data FIELDS tenantIds;
