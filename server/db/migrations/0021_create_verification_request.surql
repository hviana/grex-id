DEFINE TABLE verification_request SCHEMAFULL;
DEFINE FIELD ownerId     ON verification_request TYPE record<user | lead>;
DEFINE FIELD ownerType   ON verification_request TYPE string
  ASSERT $value IN ["user", "lead"];
DEFINE FIELD actionKey   ON verification_request TYPE string;
DEFINE FIELD token       ON verification_request TYPE string;
DEFINE FIELD payload     ON verification_request TYPE option<object> FLEXIBLE;
DEFINE FIELD expiresAt   ON verification_request TYPE datetime;
DEFINE FIELD usedAt      ON verification_request TYPE option<datetime>;
DEFINE FIELD companyId   ON verification_request TYPE option<record<company>>;
DEFINE FIELD systemId    ON verification_request TYPE option<record<system>>;
DEFINE FIELD systemSlug  ON verification_request TYPE option<string>;
DEFINE FIELD actorId     ON verification_request TYPE option<string>;
DEFINE FIELD actorType   ON verification_request TYPE option<string>
  ASSERT $value = NONE OR $value IN ["user", "lead", "api_token", "connected_app", "anonymous", "system"];
DEFINE FIELD createdAt   ON verification_request TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_vr_token      ON verification_request FIELDS token UNIQUE;
DEFINE INDEX idx_vr_owner_act  ON verification_request FIELDS ownerId, actionKey, createdAt;
