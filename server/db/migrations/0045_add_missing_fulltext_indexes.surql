-- Add missing FULLTEXT indexes for searchable text fields

DEFINE INDEX idx_plan_name ON TABLE plan FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_voucher_code ON TABLE voucher FIELDS code FULLTEXT ANALYZER general_analyzer_fts BM25;
