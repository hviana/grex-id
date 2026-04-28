DEFINE ANALYZER general_analyzer_fts
  TOKENIZERS class, blank
  FILTERS lowercase, ascii, ngram(3, 32);