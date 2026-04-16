DEFINE TABLE recovery_channel SCHEMAFULL;
DEFINE FIELD userId    ON recovery_channel TYPE record<user>;
DEFINE FIELD type      ON recovery_channel TYPE string
  ASSERT $value IN ["email", "phone"];
DEFINE FIELD value     ON recovery_channel TYPE string;
DEFINE FIELD verified  ON recovery_channel TYPE bool DEFAULT false;
DEFINE FIELD createdAt ON recovery_channel TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON recovery_channel TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_rc_user_type_value ON TABLE recovery_channel FIELDS userId, type, value UNIQUE;
DEFINE INDEX idx_rc_user ON TABLE recovery_channel FIELDS userId;
