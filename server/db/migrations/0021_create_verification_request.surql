DEFINE TABLE verification_request SCHEMAFULL;
DEFINE FIELD userId     ON verification_request TYPE record<user | lead>;
DEFINE FIELD type       ON verification_request TYPE string
  ASSERT $value IN ["email_verify", "phone_verify", "password_reset"];
DEFINE FIELD token      ON verification_request TYPE string;
DEFINE FIELD expiresAt  ON verification_request TYPE datetime;
DEFINE FIELD usedAt     ON verification_request TYPE option<datetime>;
DEFINE FIELD createdAt  ON verification_request TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_vr_token    ON verification_request FIELDS token UNIQUE;
DEFINE INDEX idx_vr_user     ON verification_request FIELDS userId, type, createdAt;
