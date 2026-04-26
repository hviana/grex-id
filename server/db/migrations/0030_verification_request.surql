DEFINE TABLE verification_request SCHEMAFULL;
DEFINE FIELD ownerId     ON verification_request TYPE record<user | lead>;
DEFINE FIELD ownerType   ON verification_request TYPE string
  ASSERT $value IN ["user", "lead"];
DEFINE FIELD actionKey   ON verification_request TYPE string;
DEFINE FIELD token       ON verification_request TYPE string;
DEFINE FIELD payload     ON verification_request TYPE option<object> FLEXIBLE;
DEFINE FIELD expiresAt   ON verification_request TYPE datetime;
DEFINE FIELD usedAt      ON verification_request TYPE option<datetime>;
DEFINE FIELD tenantId    ON verification_request TYPE option<record<tenant>>;
DEFINE FIELD createdAt   ON verification_request TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_vr_token      ON verification_request FIELDS token UNIQUE;
DEFINE INDEX idx_vr_owner_act  ON verification_request FIELDS ownerId, actionKey, createdAt;
