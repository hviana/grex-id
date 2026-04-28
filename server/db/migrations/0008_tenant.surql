DEFINE TABLE tenant SCHEMAFULL;

DEFINE FIELD actorId   ON tenant TYPE option<record>;
DEFINE FIELD companyId ON tenant TYPE option<record<company>>;
DEFINE FIELD systemId  ON tenant TYPE option<record<system>>;
DEFINE FIELD isOwner   ON tenant TYPE bool DEFAULT false;

DEFINE FIELD createdAt ON tenant TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON tenant TYPE datetime DEFAULT time::now();

-- Better than set<record<group>> if you want to avoid duplicated groups
DEFINE FIELD groupIds ON tenant TYPE set<record<group>> DEFAULT <set>[];

-- Prevent duplicated tenant membership for the same actor + company + system
DEFINE INDEX idx_tenant_unique_actor_company_system
ON tenant FIELDS actorId, companyId, systemId UNIQUE;

-- Common lookups
DEFINE INDEX idx_tenant_actor
ON tenant FIELDS actorId;

DEFINE INDEX idx_tenant_company
ON tenant FIELDS companyId;

DEFINE INDEX idx_tenant_system
ON tenant FIELDS systemId;

DEFINE INDEX idx_tenant_company_system
ON tenant FIELDS companyId, systemId;

DEFINE INDEX idx_tenant_actor_company
ON tenant FIELDS actorId, companyId;

DEFINE INDEX idx_tenant_actor_system
ON tenant FIELDS actorId, systemId;

DEFINE INDEX idx_tenant_actor_company_system
ON tenant FIELDS actorId, companyId, systemId;

-- Useful for checking owners inside a company/system scope
DEFINE INDEX idx_tenant_company_system_owner
ON tenant FIELDS companyId, systemId, isOwner;

-- Useful for finding tenants by group membership
DEFINE INDEX idx_tenant_groupIds
ON tenant FIELDS groupIds;

-- Useful for pagination / sorting / recent updates
DEFINE INDEX idx_tenant_createdAt
ON tenant FIELDS createdAt;

DEFINE INDEX idx_tenant_updatedAt
ON tenant FIELDS updatedAt;