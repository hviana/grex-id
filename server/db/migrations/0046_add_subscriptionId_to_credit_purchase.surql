DEFINE FIELD subscriptionId ON credit_purchase TYPE option<record<subscription>>;
DEFINE INDEX idx_cp_subscription ON credit_purchase FIELDS subscriptionId;
