DEFINE TABLE menu_item SCHEMAFULL;
DEFINE FIELD systemId       ON menu_item TYPE record<system>;
DEFINE FIELD parentId       ON menu_item TYPE option<record<menu_item>>;
DEFINE FIELD label          ON menu_item TYPE string;
DEFINE FIELD emoji          ON menu_item TYPE option<string>;
DEFINE FIELD componentName  ON menu_item TYPE string;
DEFINE FIELD sortOrder      ON menu_item TYPE int DEFAULT 0;
DEFINE FIELD requiredRoles  ON menu_item TYPE array<string>;
DEFINE FIELD hiddenInPlanIds ON menu_item TYPE array<record<plan>>;
DEFINE FIELD createdAt      ON menu_item TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_menu_system    ON menu_item FIELDS systemId;
DEFINE INDEX idx_menu_parent    ON menu_item FIELDS parentId;
DEFINE INDEX idx_menu_sort      ON menu_item FIELDS systemId, parentId, sortOrder;
