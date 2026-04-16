-- Link connected_app to its underlying api_token for revocation cascade
DEFINE FIELD apiTokenId ON connected_app TYPE option<record<api_token>>;
