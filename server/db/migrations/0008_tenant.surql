DEFINE TABLE tenant SCHEMAFULL;
DEFINE FIELD actorId    ON tenant TYPE option<record>;
DEFINE FIELD companyId  ON tenant TYPE option<record<company>>;
DEFINE FIELD systemId   ON tenant TYPE option<record<system>>;
DEFINE FIELD isOwner    ON tenant TYPE bool DEFAULT false;
DEFINE FIELD createdAt  ON tenant TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt  ON tenant TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tenant_unique          ON tenant COLUMNS actorId, companyId, systemId UNIQUE;
DEFINE INDEX idx_tenant_company_system  ON tenant COLUMNS companyId, systemId WHERE actorId IS NONE;
DEFINE INDEX idx_tenant_actor           ON tenant COLUMNS actorId;
DEFINE INDEX idx_tenant_company         ON tenant COLUMNS companyId;
DEFINE INDEX idx_tenant_system          ON tenant COLUMNS systemId;

DEFINE TABLE tenant_role SCHEMAFULL;
DEFINE FIELD tenantId  ON tenant_role TYPE record<tenant>;
DEFINE FIELD roleId    ON tenant_role TYPE record<role>;
DEFINE FIELD createdAt ON tenant_role TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tr_unique  ON tenant_role FIELDS tenantId, roleId UNIQUE;
DEFINE INDEX idx_tr_tenant  ON tenant_role FIELDS tenantId;
DEFINE INDEX idx_tr_role    ON tenant_role FIELDS roleId;
