DEFINE TABLE payment_method SCHEMAFULL;
DEFINE FIELD tenantIds       ON payment_method TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD type            ON payment_method TYPE string DEFAULT "credit_card";
DEFINE FIELD data            ON payment_method TYPE object FLEXIBLE;
DEFINE FIELD billingAddressId  ON payment_method TYPE record<address>;
DEFINE FIELD isDefault       ON payment_method TYPE bool DEFAULT false;
DEFINE FIELD createdAt       ON payment_method TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_pm_tenant ON payment_method FIELDS tenantIds;
