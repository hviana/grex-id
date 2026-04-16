-- Voucher plan-scoping: optionally restrict voucher to specific plans
DEFINE FIELD applicablePlanIds ON voucher TYPE array<record<plan>> DEFAULT [];
