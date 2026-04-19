-- Async payment fields on payment table
DEFINE FIELD continuityData ON payment TYPE option<object> FLEXIBLE;
DEFINE FIELD expiresAt      ON payment TYPE option<datetime>;

-- Expand status enum to include "expired"
DEFINE FIELD status ON payment TYPE string
  ASSERT $value IN ["pending", "completed", "failed", "expired"];

-- Index for the expiry job to efficiently find pending payments past their expiry
DEFINE INDEX idx_payment_expires ON payment FIELDS status, expiresAt;

-- Expand credit_purchase status enum to include "expired"
DEFINE FIELD status ON credit_purchase TYPE string
  ASSERT $value IN ["pending", "completed", "failed", "expired"];
