DEFINE TABLE entity_channel SCHEMAFULL;
DEFINE FIELD type      ON entity_channel TYPE string ASSERT $value != "";
DEFINE FIELD value     ON entity_channel TYPE string ASSERT $value != "";
DEFINE FIELD verified  ON entity_channel TYPE bool DEFAULT false;
DEFINE FIELD createdAt ON entity_channel TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON entity_channel TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ec_type_value ON TABLE entity_channel FIELDS type, value;
DEFINE INDEX idx_ec_verified   ON TABLE entity_channel FIELDS verified;
