DEFINE TABLE shared_record SCHEMAFULL;

DEFINE FIELD recordId ON TABLE shared_record
  TYPE record;

DEFINE FIELD ownerTenantIds ON TABLE shared_record
  TYPE set<record<tenant>>
  DEFAULT []
  ASSERT $value.len() = 1;

DEFINE FIELD accessesTenantIds ON TABLE shared_record
  TYPE set<record<tenant>>
  DEFAULT [];

DEFINE FIELD permissions ON TABLE shared_record
  TYPE string
  ASSERT $value IN ["r", "w", "rw", "share"];

-- Chave normalizada para impedir duplicação lógica.
-- A ordenação impede que [tenant:1, tenant:2] e [tenant:2, tenant:1]
-- sejam tratados como compartilhamentos diferentes.
DEFINE FIELD shareKey ON TABLE shared_record
  VALUE <string>[
    recordId,
    array::sort(ownerTenantIds),
    array::sort(accessesTenantIds),
    permissions
  ]
  READONLY;

-- Impede replicação do mesmo compartilhamento.
DEFINE INDEX idx_shared_record_unique_share
  ON TABLE shared_record
  COLUMNS shareKey
  UNIQUE;

-- Índices auxiliares para consultas comuns.
DEFINE INDEX idx_shared_record_record
  ON TABLE shared_record
  COLUMNS recordId;

DEFINE INDEX idx_shared_record_owner_tenants
  ON TABLE shared_record
  COLUMNS ownerTenantIds;

DEFINE INDEX idx_shared_record_access_tenants
  ON TABLE shared_record
  COLUMNS accessesTenantIds;

DEFINE INDEX idx_shared_record_record_permissions
  ON TABLE shared_record
  COLUMNS recordId, permissions;