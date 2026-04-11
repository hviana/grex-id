DEFINE TABLE usage_record SCHEMAFULL;
DEFINE FIELD companyId   ON usage_record TYPE record<company>;
DEFINE FIELD systemId    ON usage_record TYPE record<system>;
DEFINE FIELD actorType   ON usage_record TYPE string
  ASSERT $value IN ["user", "token", "connected_app"];
DEFINE FIELD actorId     ON usage_record TYPE string;
DEFINE FIELD resource    ON usage_record TYPE string;
DEFINE FIELD value       ON usage_record TYPE number;
DEFINE FIELD period      ON usage_record TYPE string;
DEFINE FIELD createdAt   ON usage_record TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ur_actor   ON usage_record FIELDS actorType, actorId, resource, period;
DEFINE INDEX idx_ur_company ON usage_record FIELDS companyId, systemId, resource, period;
