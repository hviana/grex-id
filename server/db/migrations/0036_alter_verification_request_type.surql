DEFINE FIELD type ON verification_request TYPE string
  ASSERT $value IN ["email_verify", "phone_verify", "password_reset", "lead_update", "recovery_verify"];
