DEFINE TABLE role SCHEMAFULL;
DEFINE FIELD name        ON role TYPE string;
DEFINE FIELD systemId    ON role TYPE record<system>;
DEFINE FIELD permissions ON role TYPE array<string>;
DEFINE FIELD isBuiltIn   ON role TYPE bool DEFAULT false;
DEFINE FIELD createdAt   ON role TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON role TYPE option<datetime>;

DEFINE INDEX idx_role_system      ON role FIELDS systemId;
DEFINE INDEX idx_role_name_system ON role FIELDS name, systemId UNIQUE;
