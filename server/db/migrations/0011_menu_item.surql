DEFINE TABLE menu_item SCHEMAFULL;
DEFINE FIELD tenantIds      ON menu_item TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD parentId       ON menu_item TYPE option<record<menu_item>>;
DEFINE FIELD label          ON menu_item TYPE string;
DEFINE FIELD emoji          ON menu_item TYPE option<string>;
DEFINE FIELD componentName  ON menu_item TYPE string;
DEFINE FIELD sortOrder      ON menu_item TYPE int DEFAULT 0;
DEFINE FIELD requiredRoles  ON menu_item TYPE set<string>;
DEFINE FIELD hiddenInPlanIds ON menu_item TYPE set<record<plan>>;
DEFINE FIELD createdAt      ON menu_item TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_menu_tenant    ON menu_item FIELDS tenantIds;
DEFINE INDEX idx_menu_parent    ON menu_item FIELDS parentId;
DEFINE INDEX idx_menu_sort      ON menu_item FIELDS tenantIds, parentId, sortOrder;
DEFINE INDEX idx_menu_label_fts ON TABLE menu_item FIELDS label FULLTEXT ANALYZER general_analyzer_fts BM25;
