-- Fix paymentMethodId to explicitly be optional (option<record<payment_method>>)
-- This resolves the coercion error when paymentMethodId is NONE on free plans
DEFINE FIELD paymentMethodId ON subscription TYPE option<record<payment_method>>;
