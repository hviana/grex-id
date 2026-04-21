DEFINE TABLE entity_channel SCHEMAFULL;
DEFINE FIELD ownerId   ON entity_channel TYPE record<user | lead>;
DEFINE FIELD ownerType ON entity_channel TYPE string
  ASSERT $value IN ["user", "lead"];
DEFINE FIELD type      ON entity_channel TYPE string;
DEFINE FIELD value     ON entity_channel TYPE string;
DEFINE FIELD verified  ON entity_channel TYPE bool DEFAULT false;
DEFINE FIELD createdAt ON entity_channel TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON entity_channel TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ec_owner_type_value ON TABLE entity_channel FIELDS ownerId, type, value UNIQUE;
DEFINE INDEX idx_ec_owner            ON TABLE entity_channel FIELDS ownerId;
DEFINE INDEX idx_ec_type_value       ON TABLE entity_channel FIELDS type, value;
DEFINE INDEX idx_ec_owner_verified   ON TABLE entity_channel FIELDS ownerId, verified;
