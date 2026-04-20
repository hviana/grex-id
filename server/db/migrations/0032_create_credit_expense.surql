DEFINE TABLE credit_expense SCHEMAFULL;
DEFINE FIELD companyId    ON credit_expense TYPE record<company>;
DEFINE FIELD systemId     ON credit_expense TYPE record<system>;
DEFINE FIELD resourceKey  ON credit_expense TYPE string;
DEFINE FIELD amount       ON credit_expense TYPE number;
DEFINE FIELD count        ON credit_expense TYPE number DEFAULT 0;
DEFINE FIELD day          ON credit_expense TYPE string;
DEFINE FIELD createdAt    ON credit_expense TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ce_company_day ON credit_expense FIELDS companyId, systemId, day;
DEFINE FIELD actorId      ON credit_expense TYPE option<string>;

DEFINE INDEX idx_ce_resource    ON credit_expense FIELDS companyId, systemId, resourceKey, day UNIQUE;
DEFINE INDEX idx_ce_actor_resource ON credit_expense FIELDS actorId, resourceKey, day;
