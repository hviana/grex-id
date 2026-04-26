DEFINE TABLE payment_method SCHEMAFULL;
DEFINE FIELD tenantId        ON payment_method TYPE record<tenant>;
DEFINE FIELD type            ON payment_method TYPE string DEFAULT "credit_card";
DEFINE FIELD cardMask        ON payment_method TYPE string;
DEFINE FIELD cardToken       ON payment_method TYPE string;
DEFINE FIELD holderName      ON payment_method TYPE string;
DEFINE FIELD holderDocument  ON payment_method TYPE string;
DEFINE FIELD billingAddressId  ON payment_method TYPE record<address>;
DEFINE FIELD isDefault       ON payment_method TYPE bool DEFAULT false;
DEFINE FIELD createdAt       ON payment_method TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_pm_tenant ON payment_method FIELDS tenantId;
