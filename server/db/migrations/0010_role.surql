DEFINE TABLE role SCHEMAFULL;
DEFINE FIELD name        ON role TYPE string;
DEFINE FIELD tenantId    ON role TYPE record<tenant>;
DEFINE FIELD isBuiltIn   ON role TYPE bool DEFAULT false;
DEFINE FIELD createdAt   ON role TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON role TYPE option<datetime>;

DEFINE INDEX idx_role_tenant      ON role FIELDS tenantId;
DEFINE INDEX idx_role_name_tenant ON role FIELDS name, tenantId UNIQUE;
